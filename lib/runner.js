/**
 * Runs the matrix: models x batteries x tiers x reasoning efforts.
 *
 * Runs are sequential on purpose. Two models loaded at once on a Mac will
 * swap in and out of unified memory and the tokens/sec numbers become
 * meaningless, which defeats the point of measuring speed at all.
 */
import { chat } from "./ollama.js";
import { scoreToolCase, runAutoChecks, stripThinking } from "./scoring.js";
import { extractCode, runCodeTests } from "./sandbox.js";
import { loadWithLocalOverride } from "./load.js";

// Fixtures and cases can each be overridden by a gitignored `.local.js`
// sibling, so your own calendar and inbox data never sit in a tracked file.
const fixturesLoad = await loadWithLocalOverride("./fixtures.js", "./fixtures.local.js");
const { TOOL_SCHEMAS, SYSTEM_PROMPT, executeTool } = fixturesLoad.module;

const toolLoad = await loadWithLocalOverride("../benchmarks/tool-calling.js", "../benchmarks/tool-calling.local.js");
const codingLoad = await loadWithLocalOverride("../benchmarks/coding.js", "../benchmarks/coding.local.js");
const generalLoad = await loadWithLocalOverride("../benchmarks/general.js", "../benchmarks/general.local.js");

export const BATTERIES = {
  "tool-calling": toolLoad.module.cases,
  coding: codingLoad.module.cases,
  general: generalLoad.module.cases,
};

/** Which parts are running from your own local files rather than the defaults. */
export const USING_LOCAL = {
  fixtures: fixturesLoad.usingLocal,
  "tool-calling": toolLoad.usingLocal,
  coding: codingLoad.usingLocal,
  general: generalLoad.usingLocal,
};

export const TIERS = ["easy", "medium", "hard"];
export const EFFORTS = ["default", "off", "low", "high"];

const MAX_TOOL_ROUNDS = 5;

/** One tool-calling case: loop until the model stops asking for tools. */
async function runToolCase(model, testCase, effort) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: testCase.prompt },
  ];
  const toolCalls = [];
  let reply = "";
  let rounds = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalMs = 0;
  let tokensPerSecond = null;
  let effortApplied = effort;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    rounds += 1;
    const res = await chat({ model, messages, tools: TOOL_SCHEMAS, effort });
    effortApplied = res.effortApplied;
    promptTokens += res.promptTokens ?? 0;
    completionTokens += res.completionTokens ?? 0;
    totalMs += res.totalMs ?? 0;
    if (res.tokensPerSecond) tokensPerSecond = res.tokensPerSecond;

    if (!res.toolCalls.length) {
      reply = stripThinking(res.content);
      break;
    }

    messages.push({ role: "assistant", content: res.content ?? "", tool_calls: res.raw.tool_calls ?? [] });
    for (const call of res.toolCalls) {
      toolCalls.push(call);
      const output = executeTool(call.name, call.arguments);
      messages.push({ role: "tool", content: output, tool_name: call.name });
    }
    reply = stripThinking(res.content);
  }

  const scored = scoreToolCase(testCase, { toolCalls, reply });
  return {
    ...scored,
    reply,
    rounds,
    promptTokens,
    completionTokens,
    totalMs,
    tokensPerSecond,
    effortApplied,
    toolCallDetail: toolCalls,
  };
}

async function runCodingCase(model, testCase, effort) {
  const messages = [
    {
      role: "system",
      content:
        "You are a careful JavaScript developer. Reply with a single fenced JavaScript code block containing " +
        "only the requested function. No imports, no require, no explanation outside the code block.",
    },
    { role: "user", content: testCase.prompt },
  ];
  const res = await chat({ model, messages, effort });
  const code = extractCode(res.content);
  if (!code) {
    return {
      score: 0,
      passed: 0,
      total: testCase.tests.length,
      error: "no code block found in the reply",
      reply: stripThinking(res.content),
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      totalMs: res.totalMs,
      tokensPerSecond: res.tokensPerSecond,
      effortApplied: res.effortApplied,
    };
  }
  const outcome = await runCodeTests(code, testCase.tests);
  return {
    ...outcome,
    code,
    reply: stripThinking(res.content),
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    totalMs: res.totalMs,
    tokensPerSecond: res.tokensPerSecond,
    effortApplied: res.effortApplied,
  };
}

async function runGeneralCase(model, testCase, effort) {
  const messages = [{ role: "user", content: testCase.prompt }];
  const res = await chat({ model, messages, effort });
  const answer = stripThinking(res.content);
  const auto = runAutoChecks(testCase, answer);
  return {
    ...auto,
    score: auto.autoScore,
    reply: answer,
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    totalMs: res.totalMs,
    tokensPerSecond: res.tokensPerSecond,
    effortApplied: res.effortApplied,
    needsHumanScore: Boolean(testCase.rubric?.length),
    rubric: testCase.rubric ?? [],
  };
}

export function buildPlan({ models, batteries, tiers, efforts }) {
  const plan = [];
  for (const model of models) {
    for (const battery of batteries) {
      const all = BATTERIES[battery] ?? [];
      for (const testCase of all.filter((c) => tiers.includes(c.tier))) {
        for (const effort of efforts) {
          plan.push({ model, battery, tier: testCase.tier, effort, caseId: testCase.id });
        }
      }
    }
  }
  return plan;
}

/**
 * Execute a plan, calling onProgress after each step.
 * `shouldStop` lets the UI cancel a long run without killing the server.
 */
export async function executePlan(plan, { onProgress, shouldStop } = {}) {
  const results = [];
  for (let i = 0; i < plan.length; i += 1) {
    if (shouldStop?.()) break;
    const step = plan[i];
    const testCase = (BATTERIES[step.battery] ?? []).find((c) => c.id === step.caseId);
    if (!testCase) continue;

    const startedAt = Date.now();
    let outcome;
    try {
      if (step.battery === "tool-calling") outcome = await runToolCase(step.model, testCase, step.effort);
      else if (step.battery === "coding") outcome = await runCodingCase(step.model, testCase, step.effort);
      else outcome = await runGeneralCase(step.model, testCase, step.effort);
    } catch (error) {
      outcome = { score: 0, error: String(error.message ?? error), failed: true };
    }

    const record = {
      ...step,
      ...outcome,
      category: testCase.category ?? null,
      prompt: testCase.prompt,
      wallMs: Date.now() - startedAt,
    };
    results.push(record);
    onProgress?.({ index: i + 1, total: plan.length, step, record, results });
  }
  return results;
}

/* ------------------------- aggregation ------------------------- */

function mean(values) {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!nums.length) return null;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(4));
}

/**
 * Roll results up per model. Gates are reported separately from scores: a model
 * that called a forbidden tool is flagged even if it averaged well, because
 * averaging a disqualifying failure away is exactly how you pick the wrong model.
 */
export function summarise(results, humanScores = {}) {
  const models = [...new Set(results.map((r) => r.model))];
  return models.map((model) => {
    const mine = results.filter((r) => r.model === model);
    const byBattery = {};

    for (const battery of Object.keys(BATTERIES)) {
      const rows = mine.filter((r) => r.battery === battery);
      if (!rows.length) continue;
      const scored = rows.map((r) => {
        if (battery !== "general") return r.score;
        const key = `${r.model}|${r.battery}|${r.caseId}|${r.effort}`;
        const human = humanScores[key];
        if (typeof human !== "number") return r.score;
        if (typeof r.score !== "number") return human;
        return (r.score + human) / 2;
      });
      const byTier = {};
      for (const tier of TIERS) {
        const tierRows = rows.map((r, i) => ({ r, s: scored[i] })).filter((x) => x.r.tier === tier);
        if (tierRows.length) byTier[tier] = mean(tierRows.map((x) => x.s));
      }
      const byEffort = {};
      for (const effort of EFFORTS) {
        const effortRows = rows.map((r, i) => ({ r, s: scored[i] })).filter((x) => x.r.effort === effort);
        if (effortRows.length) {
          byEffort[effort] = {
            score: mean(effortRows.map((x) => x.s)),
            tokensPerSecond: mean(effortRows.map((x) => x.r.tokensPerSecond)),
            medianMs: mean(effortRows.map((x) => x.r.wallMs)),
            completionTokens: mean(effortRows.map((x) => x.r.completionTokens)),
          };
        }
      }
      const byCategory = {};
      for (const category of [...new Set(rows.map((r) => r.category).filter(Boolean))]) {
        const catRows = rows.map((r, i) => ({ r, s: scored[i] })).filter((x) => x.r.category === category);
        byCategory[category] = mean(catRows.map((x) => x.s));
      }
      byBattery[battery] = {
        score: mean(scored),
        byTier,
        byEffort,
        byCategory,
        cases: rows.length,
        pendingHumanScores: rows.filter((r) => r.needsHumanScore && typeof humanScores[`${r.model}|${r.battery}|${r.caseId}|${r.effort}`] !== "number").length,
      };
    }

    const gateFailures = mine.filter((r) => r.gateFailed).map((r) => ({ caseId: r.caseId, battery: r.battery, effort: r.effort, gates: r.gates ?? [] }));
    const errors = mine.filter((r) => r.failed).length;

    return {
      model,
      byBattery,
      gateFailures,
      errors,
      tokensPerSecond: mean(mine.map((r) => r.tokensPerSecond)),
      totalCases: mine.length,
      // Deliberately no single composite number across batteries. The right
      // model for the coder role and the exec role are different questions.
    };
  });
}
