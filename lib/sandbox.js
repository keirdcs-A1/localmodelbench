/**
 * Runs model-generated JavaScript against unit tests.
 *
 * Safety: every coding task is a single pure function, so before anything is
 * executed the code is checked for tokens a pure function has no business
 * using (require, import, process, fs, network, eval). Anything that trips the
 * check is failed without being run. Execution then happens in a separate
 * short-lived Node process, in an empty temp directory, with a hard timeout and
 * a small memory cap. This is a guardrail, not a jail: only run benchmarks you
 * are willing to have execute on your machine.
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BANNED = [
  /\brequire\s*\(/,
  /\bimport\s*[\(\s]/,
  /\bprocess\b/,
  /\bchild_process\b/,
  /\bglobalThis\b/,
  /\b__dirname\b/,
  /\b__filename\b/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\beval\s*\(/,
  /new\s+Function\s*\(/,
  /\bWorker\b/,
];

/** Pull the JavaScript out of a model reply. */
export function extractCode(reply) {
  if (!reply) return "";
  const fenced = [...reply.matchAll(/```(?:javascript|js|typescript|ts)?\s*\n([\s\S]*?)```/gi)].map((m) => m[1]);
  if (fenced.length) {
    // Prefer the longest block; models sometimes show a usage example after.
    return fenced.sort((a, b) => b.length - a.length)[0].trim();
  }
  // No fence: if the reply looks like bare code, take it.
  if (/\b(function|const|let|var|=>)\b/.test(reply)) return reply.trim();
  return "";
}

export function safetyCheck(code) {
  for (const pattern of BANNED) {
    if (pattern.test(code)) {
      return { safe: false, reason: `code contains a banned construct: ${pattern.source}` };
    }
  }
  return { safe: true };
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

const MARKER = "__MODELBENCH_RESULT__";

function buildProgram(code, tests) {
  const calls = tests
    .map((t) => `__out.push(__safe(function () { return (${t.call}); }));`)
    .join("\n");
  return `'use strict';
${code}

const __out = [];
function __safe(fn) {
  try { return { ok: true, value: fn() }; }
  catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
}
${calls}
console.log(${JSON.stringify(MARKER)} + JSON.stringify(__out, function (k, v) {
  if (typeof v === 'number' && Number.isNaN(v)) return '__NaN__';
  if (v === undefined) return '__undefined__';
  return v;
}));
`;
}

function revive(value) {
  if (value === "__NaN__") return NaN;
  if (value === "__undefined__") return undefined;
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = revive(v);
    return out;
  }
  return value;
}

/**
 * Execute the code against the case's tests.
 * Returns { score 0..1, passed, total, detail[], error }.
 */
export async function runCodeTests(code, tests, { timeoutMs = 10000 } = {}) {
  const check = safetyCheck(code);
  if (!check.safe) {
    return { score: 0, passed: 0, total: tests.length, blocked: true, error: check.reason, detail: [] };
  }

  const dir = await mkdtemp(path.join(tmpdir(), "modelbench-"));
  const file = path.join(dir, "case.js");
  try {
    await writeFile(file, buildProgram(code, tests), "utf8");
    const output = await new Promise((resolve) => {
      const child = spawn(process.execPath, ["--no-warnings", "--max-old-space-size=256", file], {
        cwd: dir,
        env: { PATH: "", HOME: dir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs);
      child.stdout.on("data", (d) => { stdout += d.toString(); if (stdout.length > 200000) child.kill("SIGKILL"); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("close", (codeOut) => { clearTimeout(timer); resolve({ stdout, stderr, code: codeOut }); });
      child.on("error", (e) => { clearTimeout(timer); resolve({ stdout, stderr: String(e), code: -1 }); });
    });

    const line = output.stdout.split("\n").find((l) => l.startsWith(MARKER));
    if (!line) {
      const reason = output.stderr.trim().split("\n").slice(0, 3).join(" ").slice(0, 300)
        || (output.code === null ? "timed out" : `exited with code ${output.code}`);
      return { score: 0, passed: 0, total: tests.length, error: reason || "no output", detail: [] };
    }

    const results = revive(JSON.parse(line.slice(MARKER.length)));
    const detail = tests.map((t, i) => {
      const r = results[i];
      if (!r || !r.ok) return { call: t.call, pass: false, error: r?.error ?? "no result", expected: t.expect };
      return { call: t.call, pass: deepEqual(r.value, t.expect), actual: r.value, expected: t.expect };
    });
    const passed = detail.filter((d) => d.pass).length;
    return { score: tests.length ? passed / tests.length : 0, passed, total: tests.length, detail };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
