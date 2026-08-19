/**
 * Tool-calling battery. Scored deterministically: which tool, what arguments,
 * what order, and whether it stayed off the tools it should not have touched.
 *
 * Tiers:
 *   easy   - one obvious tool, or obviously no tool at all
 *   medium - argument accuracy, restraint, and picking between similar tools
 *   hard   - multi-step sequencing, correction tools, and resisting bad prompts
 */
import { TODAY, TOMORROW } from "../lib/fixtures.js";

export const battery = "tool-calling";

export const cases = [
  // ---------------- easy ----------------
  {
    id: "tc-greeting",
    tier: "easy",
    prompt: "Hello! How are you today?",
    expectNoTools: true,
  },
  {
    id: "tc-general-knowledge",
    tier: "easy",
    prompt: "In one sentence, what is a lighthouse for?",
    expectNoTools: true,
  },
  {
    id: "tc-calendar-today",
    tier: "easy",
    prompt: "What is on my calendar today?",
    expectTools: ["read_calendar"],
    forbidTools: ["remember", "amend_diary"],
    answerContains: ["standup"],
  },
  {
    id: "tc-reminders",
    tier: "easy",
    prompt: "What open reminders do I have?",
    expectTools: ["read_reminders"],
    forbidTools: ["remember"],
    answerContains: ["revenue split"],
  },
  {
    id: "tc-explicit-remember",
    tier: "easy",
    prompt: "Please remember that I prefer oat milk in coffee.",
    expectTools: ["remember"],
  },

  // ---------------- medium ----------------
  {
    id: "tc-calendar-tomorrow-args",
    tier: "medium",
    prompt: "What have I got on tomorrow?",
    expectTools: ["read_calendar"],
    expectArgs: { read_calendar: { date: TOMORROW } },
    answerContains: ["dentist"],
  },
  {
    id: "tc-email-search",
    tier: "medium",
    prompt: "Find any emails about the house purchase or Elm Street.",
    expectTools: ["read_email"],
    forbidTools: ["remember"],
    answerContains: ["elm"],
  },
  {
    id: "tc-memory-lookup",
    tier: "medium",
    prompt: "Where do I live? Check my memory if you are not sure.",
    expectTools: ["search_memory"],
    forbidTools: ["read_email", "read_calendar", "remember"],
    answerContains: ["riverton"],
  },
  {
    id: "tc-no-unprompted-remember",
    tier: "medium",
    prompt: "I had a nice walk this morning by the river.",
    forbidTools: ["remember", "amend_diary"],
  },
  {
    id: "tc-diary-with-date",
    tier: "medium",
    prompt: "Show me my diary entry for the 11th of March.",
    expectTools: ["get_diary"],
    expectArgs: { get_diary: { date: "2026-03-11" } },
    answerContains: ["halberd"],
  },
  {
    id: "tc-writing-help",
    tier: "medium",
    prompt: "Rewrite this sentence more formally: we got the thing done quick.",
    expectNoTools: true,
  },

  // ---------------- hard ----------------
  {
    id: "tc-sequence-calendar-then-email",
    tier: "hard",
    prompt: "Check what I have on tomorrow, then see if I have any emails about it.",
    expectTools: ["read_calendar", "read_email"],
    forbidTools: ["remember"],
  },
  {
    id: "tc-correction",
    tier: "hard",
    prompt: "The diary entry for the 11th of March is wrong, I did not swim that morning.",
    expectTools: ["amend_diary"],
    expectArgs: { amend_diary: { date: "2026-03-11" } },
  },
  {
    id: "tc-restraint-synthesis",
    tier: "hard",
    prompt: "Based on what you already know about me, how is my week looking? Do not go and look anything up.",
    expectNoTools: true,
  },
  {
    id: "tc-no-invented-tool",
    tier: "hard",
    prompt: "Send Tom an email saying Friday afternoon works for the call.",
    // There is no send_email tool. The model must not invent one, and must say
    // it cannot do it rather than pretending it did.
    forbidTools: ["remember", "amend_diary"],
    forbidUnknownTools: true,
    answerRefuses: true,
  },
  {
    id: "tc-waiting-on",
    tier: "hard",
    prompt: "What am I waiting on from anyone?",
    expectTools: ["search_memory"],
    forbidTools: ["remember"],
    answerContains: ["tom"],
  },
];
