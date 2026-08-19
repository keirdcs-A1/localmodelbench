/**
 * Disk inventory for the local Ollama fleet.
 *
 * The important bit: derived models share blobs with the base they were built
 * from. a derived model does not hold its own copy of the base weights, it points at
 * the same layer files. So summing the size column from `ollama list` badly
 * overcounts, and "delete this custom model to free 23GB" would free nothing.
 *
 * This reads the manifests directly and reports two numbers per model:
 *   totalBytes     - everything it references
 *   exclusiveBytes - blobs ONLY it references, which is what you actually
 *                    reclaim by deleting it
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const MODELS_DIR = process.env.OLLAMA_MODELS || path.join(homedir(), ".ollama", "models");

async function walk(dir, depth = 0) {
  if (depth > 6) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, depth + 1)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Model name from a manifest path. Layout is:
 *   manifests/<registry>/<namespace>/<model>/<tag>
 * which maps to "model:tag", or "namespace/model:tag" when not the library.
 */
function nameFromManifestPath(manifestRoot, file) {
  const rel = path.relative(manifestRoot, file);
  const parts = rel.split(path.sep);
  if (parts.length < 3) return null;
  const tag = parts[parts.length - 1];
  const model = parts[parts.length - 2];
  const namespace = parts[parts.length - 3];
  const base = namespace && namespace !== "library" ? `${namespace}/${model}` : model;
  return `${base}:${tag}`;
}

export async function readInventory() {
  const manifestRoot = path.join(MODELS_DIR, "manifests");
  try {
    await stat(manifestRoot);
  } catch {
    return { available: false, reason: `cannot read ${manifestRoot}`, models: [], totals: null };
  }

  const files = await walk(manifestRoot);
  const models = [];
  const blobRefs = new Map(); // digest -> { size, models:Set }

  for (const file of files) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(file, "utf8"));
    } catch {
      continue;
    }
    if (!manifest || !Array.isArray(manifest.layers)) continue;
    const name = nameFromManifestPath(manifestRoot, file);
    if (!name) continue;

    const layers = [...manifest.layers];
    if (manifest.config?.digest) layers.push(manifest.config);

    const seen = new Set();
    let totalBytes = 0;
    for (const layer of layers) {
      if (!layer?.digest || seen.has(layer.digest)) continue;
      seen.add(layer.digest);
      const size = Number(layer.size ?? 0);
      totalBytes += size;
      if (!blobRefs.has(layer.digest)) blobRefs.set(layer.digest, { size, models: new Set() });
      blobRefs.get(layer.digest).models.add(name);
    }
    models.push({ name, totalBytes, digests: [...seen] });
  }

  // Exclusive size: blobs referenced by exactly one model.
  for (const model of models) {
    let exclusive = 0;
    const sharedWith = new Set();
    for (const digest of model.digests) {
      const ref = blobRefs.get(digest);
      if (!ref) continue;
      if (ref.models.size === 1) exclusive += ref.size;
      else for (const other of ref.models) if (other !== model.name) sharedWith.add(other);
    }
    model.exclusiveBytes = exclusive;
    model.sharedWith = [...sharedWith].sort();
    delete model.digests;
  }

  let uniqueTotal = 0;
  for (const ref of blobRefs.values()) uniqueTotal += ref.size;
  const naiveTotal = models.reduce((sum, m) => sum + m.totalBytes, 0);

  models.sort((a, b) => b.exclusiveBytes - a.exclusiveBytes);
  return {
    available: true,
    modelsDir: MODELS_DIR,
    models,
    totals: {
      uniqueBytes: uniqueTotal,
      naiveSumBytes: naiveTotal,
      overcountBytes: naiveTotal - uniqueTotal,
      modelCount: models.length,
    },
  };
}

/**
 * Merge the disk view with what Ollama reports and which roles an agent-style
 * config assigns, so the answer to "can I delete this?" is on one row.
 */
export function annotate(inventory, ollamaModels, showDetails, roleMap) {
  const byName = new Map(inventory.models.map((m) => [m.name, m]));
  const normalise = (n) => (n.includes(":") ? n : `${n}:latest`);

  return ollamaModels.map((model) => {
    const disk = byName.get(normalise(model.name)) ?? null;
    const detail = showDetails[model.name] ?? {};
    const roles = roleMap[model.name] ?? roleMap[normalise(model.name)] ?? [];
    const derivedFrom = detail.base ?? null;
    return {
      name: model.name,
      parameterSize: detail.parameterSize ?? model.parameterSize,
      quantization: detail.quantization ?? model.quantization,
      family: detail.family ?? model.family,
      capabilities: detail.capabilities ?? [],
      hasSystemPrompt: Boolean(detail.hasSystemPrompt),
      derivedFrom,
      roles,
      inUse: roles.length > 0,
      totalBytes: disk?.totalBytes ?? model.size ?? 0,
      exclusiveBytes: disk?.exclusiveBytes ?? null,
      sharedWith: disk?.sharedWith ?? [],
      modifiedAt: model.modifiedAt,
    };
  });
}
