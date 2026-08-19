/**
 * Minimal Ollama client. No dependencies.
 * Talks to the Ollama HTTP API on localhost:11434 by default.
 */

const DEFAULT_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

function endpoint(path) {
  return `${DEFAULT_HOST.replace(/\/$/, "")}${path}`;
}

async function request(path, body, timeoutMs = 600000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint(path), {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Ollama ${path} returned ${res.status}: ${text.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

/** Is Ollama reachable? Returns { ok, reason }. */
export async function ping() {
  try {
    await request("/api/tags", null, 4000);
    return { ok: true, host: DEFAULT_HOST };
  } catch (error) {
    return { ok: false, host: DEFAULT_HOST, reason: error.message };
  }
}

/** Every model installed locally. */
export async function listModels() {
  const data = await request("/api/tags", null, 15000);
  return (data.models ?? []).map((m) => ({
    name: m.name,
    size: m.size ?? 0,
    family: m.details?.family ?? null,
    parameterSize: m.details?.parameter_size ?? null,
    quantization: m.details?.quantization_level ?? null,
    modifiedAt: m.modified_at ?? null,
  }));
}

/** Model detail, including the Modelfile so we can find the FROM base. */
export async function showModel(name) {
  try {
    const data = await request("/api/show", { model: name }, 20000);
    const modelfile = data.modelfile ?? "";
    const fromMatch = modelfile.match(/^FROM\s+(.+)$/mi);
    let base = fromMatch ? fromMatch[1].trim() : null;
    // Ollama rewrites FROM to a blob path for derived models; ignore those.
    if (base && (base.startsWith("/") || base.includes("blobs/sha256"))) base = null;
    const systemMatch = modelfile.match(/^SYSTEM\s+(?:"""([\s\S]*?)"""|"(.*)"|(.*))$/mi);
    return {
      name,
      base,
      hasSystemPrompt: Boolean(data.system || systemMatch),
      systemPrompt: data.system ?? (systemMatch ? (systemMatch[1] ?? systemMatch[2] ?? systemMatch[3] ?? "").trim() : null),
      parameters: data.parameters ?? null,
      capabilities: data.capabilities ?? [],
      contextLength: data.model_info?.["general.context_length"]
        ?? data.model_info?.[`${data.details?.family}.context_length`]
        ?? null,
      parameterSize: data.details?.parameter_size ?? null,
      quantization: data.details?.quantization_level ?? null,
      family: data.details?.family ?? null,
    };
  } catch (error) {
    return { name, base: null, error: error.message, capabilities: [] };
  }
}

/**
 * Turn our effort label into the request field Ollama expects.
 * "default" omits the field entirely, which matters: on qwen3-family models an
 * explicit think:false has been observed to leak chain-of-thought into the
 * content channel, so "default" and "off" are genuinely different runs.
 */
function thinkField(effort) {
  switch (effort) {
    case "off": return { think: false };
    case "low": return { think: "low" };
    case "high": return { think: "high" };
    case "default":
    default: return {};
  }
}

/**
 * One chat call. Returns the raw message plus timing and token counts.
 * Falls back gracefully when a model does not support the requested think level.
 */
export async function chat({ model, messages, tools, effort = "default", temperature = 0.2, numCtx, timeoutMs = 600000 }) {
  const body = {
    model,
    messages,
    stream: false,
    options: { temperature },
    ...thinkField(effort),
  };
  if (numCtx) body.options.num_ctx = numCtx;
  if (tools && tools.length) body.tools = tools;

  let data;
  let effortApplied = effort;
  try {
    data = await request("/api/chat", body, timeoutMs);
  } catch (error) {
    const msg = String(error.message || "");
    // Older builds only accept a boolean; some models reject thinking entirely.
    if ((effort === "low" || effort === "high") && /think/i.test(msg)) {
      const retry = { ...body, think: true };
      try {
        data = await request("/api/chat", retry, timeoutMs);
        effortApplied = "on";
      } catch (second) {
        if (/think|does not support/i.test(String(second.message || ""))) {
          const bare = { ...body };
          delete bare.think;
          data = await request("/api/chat", bare, timeoutMs);
          effortApplied = "unsupported";
        } else {
          throw second;
        }
      }
    } else if (effort === "off" && /think|does not support/i.test(msg)) {
      const bare = { ...body };
      delete bare.think;
      data = await request("/api/chat", bare, timeoutMs);
      effortApplied = "unsupported";
    } else {
      throw error;
    }
  }

  const message = data.message ?? {};
  const evalCount = data.eval_count ?? null;
  const evalDurationNs = data.eval_duration ?? null;
  return {
    content: message.content ?? "",
    thinking: message.thinking ?? null,
    toolCalls: (message.tool_calls ?? []).map((call) => ({
      name: call.function?.name ?? "",
      arguments: call.function?.arguments ?? {},
    })),
    raw: message,
    effortApplied,
    promptTokens: data.prompt_eval_count ?? null,
    completionTokens: evalCount,
    totalMs: data.total_duration ? Math.round(data.total_duration / 1e6) : null,
    tokensPerSecond: evalCount && evalDurationNs ? Number((evalCount / (evalDurationNs / 1e9)).toFixed(2)) : null,
  };
}
