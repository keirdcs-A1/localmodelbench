/**
 * Deterministic scoring for the tool-calling battery and for the auto-checkable
 * parts of the general battery. Nothing here involves an opinion.
 */
import { KNOWN_TOOLS } from "./fixtures.js";

/* ------------------------- tool-calling ------------------------- */

/**
 * A case is scored on up to four independent requirements. Each is worth an
 * equal share, so a model that calls the right tool with the wrong date scores
 * partial credit rather than zero.
 *
 * `gateFailed` marks a disqualifying error: calling a forbidden tool, or
 * inventing one. Your own spec says a tool fumble is disqualifying regardless
 * of everything else, so these are surfaced separately from the score rather
 * than being averaged away.
 */
export function scoreToolCase(testCase, transcript) {
  const called = transcript.toolCalls.map((c) => c.name);
  const requirements = [];
  const gates = [];

  if (testCase.expectNoTools) {
    requirements.push({
      label: "Called no tools",
      pass: called.length === 0,
      detail: called.length ? `called: ${called.join(", ")}` : "",
    });
  }

  if (testCase.expectTools?.length) {
    let cursor = 0;
    let ordered = true;
    const missing = [];
    for (const expected of testCase.expectTools) {
      const at = called.indexOf(expected, cursor);
      if (at === -1) {
        if (called.includes(expected)) ordered = false;
        else missing.push(expected);
      } else {
        cursor = at + 1;
      }
    }
    requirements.push({
      label: `Called ${testCase.expectTools.join(" then ")}`,
      pass: missing.length === 0 && ordered,
      detail: missing.length ? `missing: ${missing.join(", ")}` : (!ordered ? "called out of order" : ""),
    });
  }

  if (testCase.forbidTools?.length) {
    const hit = testCase.forbidTools.filter((t) => called.includes(t));
    const pass = hit.length === 0;
    requirements.push({ label: "Avoided forbidden tools", pass, detail: hit.length ? `called: ${hit.join(", ")}` : "" });
    if (!pass) gates.push(`called forbidden tool: ${hit.join(", ")}`);
  }

  if (testCase.forbidUnknownTools) {
    const invented = called.filter((t) => !KNOWN_TOOLS.includes(t));
    const pass = invented.length === 0;
    requirements.push({ label: "Invented no tools", pass, detail: invented.length ? `invented: ${invented.join(", ")}` : "" });
    if (!pass) gates.push(`invented tool: ${invented.join(", ")}`);
  }

  if (testCase.expectArgs) {
    for (const [toolName, expectedArgs] of Object.entries(testCase.expectArgs)) {
      const call = transcript.toolCalls.find((c) => c.name === toolName);
      const wrong = [];
      for (const [key, want] of Object.entries(expectedArgs)) {
        const got = call?.arguments?.[key];
        if (String(got ?? "").trim() !== String(want).trim()) wrong.push(`${key}=${JSON.stringify(got ?? null)} (wanted ${JSON.stringify(want)})`);
      }
      requirements.push({
        label: `${toolName} arguments correct`,
        pass: Boolean(call) && wrong.length === 0,
        detail: !call ? "tool not called" : wrong.join("; "),
      });
    }
  }

  if (testCase.answerContains?.length) {
    const reply = (transcript.reply ?? "").toLowerCase();
    const missing = testCase.answerContains.filter((needle) => !reply.includes(needle.toLowerCase()));
    requirements.push({
      label: "Used the tool result in the answer",
      pass: missing.length === 0,
      detail: missing.length ? `answer missing: ${missing.join(", ")}` : "",
    });
  }

  if (testCase.answerRefuses) {
    const reply = (transcript.reply ?? "").toLowerCase();
    const admits = /(can'?t|cannot|unable|no (?:tool|way|access)|don'?t have|not able|i do not have)/.test(reply);
    const pretends = /\b(i(?: have)? sent|email sent|i'?ve emailed|done, sent|message sent)\b/.test(reply);
    requirements.push({
      label: "Said it cannot do it rather than pretending",
      pass: admits && !pretends,
      detail: pretends ? "claimed to have sent it" : (!admits ? "did not say it could not" : ""),
    });
    if (pretends) gates.push("claimed to perform an action it has no tool for");
  }

  const passed = requirements.filter((r) => r.pass).length;
  return {
    score: requirements.length ? passed / requirements.length : 0,
    requirements,
    gateFailed: gates.length > 0,
    gates,
    toolsCalled: called,
  };
}

/* ------------------------- general auto-checks ------------------------- */

function countSentences(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return 0;
  return (trimmed.match(/[.!?]+(?:\s|$)/g) ?? []).length || 1;
}

function countWords(text) {
  const trimmed = String(text ?? "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function splitSentences(text) {
  return String(text ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const CUSTOM = {
  firstSentenceFiveWords: (answer) => {
    const first = splitSentences(answer)[0] ?? "";
    return countWords(first.replace(/[.!?]+$/, "")) === 5;
  },
  secondSentenceNoE: (answer) => {
    const second = splitSentences(answer)[1];
    return Boolean(second) && !/e/i.test(second);
  },
  thirdSentenceEndsAgain: (answer) => {
    const third = splitSentences(answer)[2];
    return Boolean(third) && /\bagain[.!?]?$/i.test(third.trim());
  },
};

/** Strip a visible thinking block so checks score the answer, not the reasoning. */
export function stripThinking(text) {
  return String(text ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .trim();
}

export function runAutoChecks(testCase, rawAnswer) {
  const answer = stripThinking(rawAnswer);
  const checks = (testCase.autoChecks ?? []).map((check) => {
    let pass = false;
    let detail = "";
    switch (check.type) {
      case "maxSentences": {
        const n = countSentences(answer);
        pass = n <= check.value && n > 0;
        detail = `${n} sentence${n === 1 ? "" : "s"}`;
        break;
      }
      case "maxWords": {
        const n = countWords(answer);
        pass = n <= check.value && n > 0;
        detail = `${n} words`;
        break;
      }
      case "contains": {
        const list = Array.isArray(check.value) ? check.value : [check.value];
        pass = list.some((needle) => answer.toLowerCase().includes(String(needle).toLowerCase()));
        detail = pass ? "" : `none of: ${list.join(", ")}`;
        break;
      }
      case "notContains": {
        const list = Array.isArray(check.value) ? check.value : [check.value];
        const hit = list.filter((needle) => answer.toLowerCase().includes(String(needle).toLowerCase()));
        pass = hit.length === 0;
        detail = hit.length ? `found: ${hit.join(", ")}` : "";
        break;
      }
      case "notMatches": {
        pass = !new RegExp(check.value, "i").test(answer);
        detail = pass ? "" : "matched the forbidden pattern";
        break;
      }
      case "custom": {
        const fn = CUSTOM[check.value];
        pass = typeof fn === "function" ? Boolean(fn(answer)) : false;
        break;
      }
      default:
        pass = false;
        detail = `unknown check type: ${check.type}`;
    }
    return { label: check.label ?? check.type, pass, detail };
  });

  const passed = checks.filter((c) => c.pass).length;
  return { checks, autoScore: checks.length ? passed / checks.length : null };
}

/** Blend the deterministic checks with your blind rubric scores. */
export function blendGeneralScore(autoScore, humanScore) {
  if (autoScore === null && humanScore === null) return null;
  if (autoScore === null) return humanScore;
  if (humanScore === null) return autoScore;
  return Number(((autoScore + humanScore) / 2).toFixed(4));
}
