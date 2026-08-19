#!/usr/bin/env node
/**
 * ModelBench: a local scoreboard for local models.
 *
 * Zero dependencies. Start it with `node server.js` and open the address it
 * prints. It talks to Ollama on 127.0.0.1:11434 and never sends anything off
 * the machine.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { ping, listModels, showModel } from "./lib/ollama.js";
import { readInventory, annotate } from "./lib/inventory.js";
import { buildPlan, executePlan, summarise, BATTERIES, TIERS, EFFORTS, USING_LOCAL } from "./lib/runner.js";
import { saveRun, loadRun, listRuns, loadHumanScores, saveHumanScore } from "./lib/store.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 4321);

/** Model roles read from an agent config.json, if one is pointed at. */
const CONFIG_PATH = process.env.MODELBENCH_AGENT_CONFIG || "";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

/** Live run state. One run at a time: models must not compete for memory. */
let current = null;

async function readRoleMap() {
  if (!CONFIG_PATH) return {};
  try {
    const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    const map = {};
    const add = (name, role) => {
      if (!name) return;
      map[name] = map[name] ?? [];
      if (!map[name].includes(role)) map[name].push(role);
    };
    for (const [role, name] of Object.entries(config.models ?? {})) add(name, role);
    for (const [role, name] of Object.entries(config.modelRouting ?? {})) add(name, `routing:${role}`);
    if (config.model?.name) add(config.model.name, "model.name");
    if (config.chat?.summariserModel) add(config.chat.summariserModel, "summariser");
    return map;
  } catch {
    return {};
  }
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (chunks.reduce((n, c) => n + c.length, 0) > 2_000_000) throw new Error("body too large");
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end("forbidden"); }
  try {
    await stat(file);
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
}

async function startRun(config) {
  const plan = buildPlan(config);
  const run = {
    id: `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 6)}`,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: "running",
    config,
    total: plan.length,
    done: 0,
    results: [],
  };
  current = { run, cancelled: false, currentStep: plan[0] ?? null };
  await saveRun(run);

  // Fire and forget: the UI polls /api/run/status.
  (async () => {
    try {
      const results = await executePlan(plan, {
        shouldStop: () => current?.cancelled,
        onProgress: ({ index, record, step }) => {
          run.done = index;
          run.results.push(record);
          if (current) current.currentStep = plan[index] ?? null;
          if (index % 5 === 0) saveRun(run).catch(() => {});
        },
      });
      run.results = results;
      run.status = current?.cancelled ? "cancelled" : "finished";
    } catch (error) {
      run.status = "failed";
      run.error = String(error.message ?? error);
    } finally {
      run.finishedAt = new Date().toISOString();
      run.done = run.results.length;
      await saveRun(run).catch(() => {});
    }
  })();

  return run;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const route = url.pathname;

  try {
    if (route === "/api/health") {
      return json(res, 200, { ...(await ping()), batteries: Object.keys(BATTERIES), tiers: TIERS, efforts: EFFORTS, usingLocal: USING_LOCAL });
    }

    if (route === "/api/models") {
      const status = await ping();
      if (!status.ok) return json(res, 200, { ok: false, reason: status.reason, host: status.host, models: [] });
      const models = await listModels();
      const details = {};
      for (const model of models) details[model.name] = await showModel(model.name);
      const inventory = await readInventory();
      const roleMap = await readRoleMap();
      return json(res, 200, {
        ok: true,
        host: status.host,
        models: annotate(inventory, models, details, roleMap),
        inventory: { available: inventory.available, reason: inventory.reason ?? null, totals: inventory.totals },
        rolesFrom: CONFIG_PATH || null,
      });
    }

    if (route === "/api/benchmarks") {
      const out = {};
      for (const [name, cases] of Object.entries(BATTERIES)) {
        out[name] = cases.map((c) => ({ id: c.id, tier: c.tier, category: c.category ?? null, prompt: c.prompt, humanScored: Boolean(c.rubric?.length) }));
      }
      return json(res, 200, out);
    }

    if (route === "/api/run" && req.method === "POST") {
      if (current && current.run.status === "running") return json(res, 409, { error: "a run is already in progress" });
      const body = await readBody(req);
      const config = {
        models: (body.models ?? []).filter(Boolean),
        batteries: (body.batteries ?? []).filter((b) => BATTERIES[b]),
        tiers: (body.tiers ?? []).filter((t) => TIERS.includes(t)),
        efforts: (body.efforts ?? []).filter((e) => EFFORTS.includes(e)),
      };
      if (!config.models.length || !config.batteries.length || !config.tiers.length || !config.efforts.length) {
        return json(res, 400, { error: "pick at least one model, battery, tier and effort" });
      }
      const run = await startRun(config);
      return json(res, 200, { id: run.id, total: run.total });
    }

    if (route === "/api/run/status") {
      if (!current) return json(res, 200, { idle: true });
      const { run } = current;
      return json(res, 200, {
        idle: false,
        id: run.id,
        status: run.status,
        done: run.done,
        total: run.total,
        currentStep: current.currentStep,
        lastResults: run.results.slice(-6).map((r) => ({ model: r.model, battery: r.battery, caseId: r.caseId, effort: r.effort, score: r.score, gateFailed: Boolean(r.gateFailed), error: r.error ?? null })),
      });
    }

    if (route === "/api/run/cancel" && req.method === "POST") {
      if (current) current.cancelled = true;
      return json(res, 200, { cancelled: true });
    }

    if (route === "/api/runs") return json(res, 200, await listRuns());

    if (route === "/api/run/detail") {
      const id = url.searchParams.get("id");
      const run = id ? await loadRun(id) : current?.run ?? null;
      if (!run) return json(res, 404, { error: "run not found" });
      const humanScores = await loadHumanScores();
      return json(res, 200, { run, summary: summarise(run.results, humanScores), humanScores });
    }

    if (route === "/api/score" && req.method === "POST") {
      const body = await readBody(req);
      if (!body.key) return json(res, 400, { error: "key required" });
      const value = body.value === null ? null : Number(body.value);
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) return json(res, 400, { error: "value must be between 0 and 1" });
      return json(res, 200, { scores: await saveHumanScore(body.key, value) });
    }

    if (route.startsWith("/api/")) return json(res, 404, { error: "no such route" });

    return await serveStatic(res, route);
  } catch (error) {
    return json(res, 500, { error: String(error.message ?? error) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  ModelBench running at http://127.0.0.1:${PORT}`);
  console.log(`  Ollama expected at ${process.env.OLLAMA_HOST || "http://127.0.0.1:11434"}`);
  if (CONFIG_PATH) console.log(`  Reading model roles from ${CONFIG_PATH}`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
