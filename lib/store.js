/** Run persistence. Plain JSON files, no database. */
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RESULTS_DIR = path.join(ROOT, "results");
const SCORES_FILE = path.join(RESULTS_DIR, "human-scores.json");

async function ensureDir() {
  await mkdir(RESULTS_DIR, { recursive: true });
}

export async function saveRun(run) {
  await ensureDir();
  await writeFile(path.join(RESULTS_DIR, `${run.id}.json`), JSON.stringify(run, null, 2), "utf8");
}

export async function loadRun(id) {
  try {
    return JSON.parse(await readFile(path.join(RESULTS_DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

export async function listRuns() {
  await ensureDir();
  const files = (await readdir(RESULTS_DIR)).filter((f) => f.endsWith(".json") && f !== "human-scores.json");
  const runs = [];
  for (const file of files) {
    try {
      const run = JSON.parse(await readFile(path.join(RESULTS_DIR, file), "utf8"));
      runs.push({
        id: run.id,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? null,
        status: run.status,
        models: run.config?.models ?? [],
        batteries: run.config?.batteries ?? [],
        tiers: run.config?.tiers ?? [],
        efforts: run.config?.efforts ?? [],
        cases: run.results?.length ?? 0,
      });
    } catch { /* skip unreadable */ }
  }
  return runs.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

export async function loadHumanScores() {
  try {
    return JSON.parse(await readFile(SCORES_FILE, "utf8"));
  } catch {
    return {};
  }
}

export async function saveHumanScore(key, value) {
  await ensureDir();
  const scores = await loadHumanScores();
  if (value === null) delete scores[key];
  else scores[key] = value;
  await writeFile(SCORES_FILE, JSON.stringify(scores, null, 2), "utf8");
  return scores;
}
