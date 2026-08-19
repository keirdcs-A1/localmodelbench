/**
 * General intelligence battery.
 *
 * Two layers of scoring:
 *  1. autoChecks run deterministically where the instruction is mechanically
 *     checkable (sentence counts, word limits, forbidden words). These give an
 *     instant signal with no judgement involved.
 *  2. rubric items are scored by you, blind, in the UI. Model names are hidden
 *     while you score so you cannot favour the one you expect to win.
 *
 * The `category` field lets the scoreboard break results out by what is being
 * tested rather than lumping everything into one number.
 */
export const battery = "general";

export const cases = [
  // ---------------- easy ----------------
  {
    id: "gen-one-sentence",
    tier: "easy",
    category: "instruction-following",
    prompt: "In exactly one sentence, explain what a mortgage is. Do not add any preamble or follow-up question.",
    autoChecks: [
  { type: "maxSentences", value: 1, label: "Exactly one sentence" },
  { type: "maxWords", value: 60, label: "Under 60 words" },
  { type: "notContains", value: ["let me know", "would you like", "i hope this helps", "certainly!", "sure!"], label: "No preamble or padding" },
    ],
    rubric: ["Accurate", "Actually readable in one sentence"],
  },
  {
    id: "gen-simple-reasoning",
    tier: "easy",
    category: "reasoning",
    prompt:
      "A shop sells notebooks at £3 each. Buy three or more and you get 20% off the whole order. " +
      "How much do 4 notebooks cost? Give the number and one line of working.",
    autoChecks: [{ type: "contains", value: ["9.60", "9.6"], label: "Correct answer (£9.60)" }],
    rubric: ["Working is correct, not just the answer"],
  },
  {
    id: "gen-summarise",
    tier: "easy",
    category: "instruction-following",
    prompt:
      "Summarise the following in no more than 25 words: 'The board met on Tuesday and agreed to defer the " +
      "capital expenditure decision until the Q3 results are published, citing uncertainty in the supply chain " +
      "and a weaker than expected order book in the industrial division.'",
    autoChecks: [{ type: "maxWords", value: 25, label: "25 words or fewer" }],
    rubric: ["Keeps both reasons (supply chain and order book)", "Reads as English, not a clipped list"],
  },
  // ---------------- medium ----------------
  {
    id: "gen-no-invention",
    tier: "medium",
    category: "grounding",
    prompt: "What is my brother's phone number?",
    autoChecks: [
  { type: "notMatches", value: "\\b(?:0\\d{3}[ -]?\\d{3}[ -]?\\d{4}|\\+44\\s?\\d{4})\\b", label: "Did not invent a phone number" },
    ],
    rubric: ["Says clearly it does not have that information", "Does not guess, hedge into a made-up answer, or ask a stream of questions"],
  },
  {
    id: "gen-flawed-premise",
    tier: "medium",
    category: "reasoning",
    prompt:
      "Since compound interest means my savings double every year at 5%, how long until £10,000 becomes £80,000?",
    rubric: [
      "Catches that the premise is wrong (5% does not double annually)",
      "Corrects it rather than answering the broken question",
      "Gives the actual answer, roughly 43 years",
    ],
  },
  {
    id: "gen-tone-rewrite",
    tier: "medium",
    category: "writing",
    prompt:
      "Rewrite this for a CEO who has thirty seconds, in UK English, no bullet points, no em dashes: " +
      "'So basically the numbers came in a bit under where we thought, mainly because two big deals slipped " +
      "into next quarter, but the pipeline itself is actually fine and we think it catches up by year end.'",
    autoChecks: [
  { type: "notContains", value: ["—"], label: "No em dashes" },
  { type: "maxWords", value: 90, label: "Under 90 words" },
    ],
    rubric: ["Keeps the slip-versus-pipeline distinction", "Sounds like a person, not a press release"],
  },
  {
    id: "gen-ambiguity",
    tier: "medium",
    category: "reasoning",
    prompt:
      "My colleague said 'I never said she took the money.' How many different meanings can that sentence have, " +
      "and what causes the difference? Answer in under 80 words.",
    autoChecks: [{ type: "maxWords", value: 90, label: "Roughly within the word limit" }],
    rubric: ["Identifies stress or emphasis as the mechanism", "Gives at least three distinct readings"],
  },
  {
    id: "gen-tradeoff-judgement",
    tier: "hard",
    category: "reasoning",
    prompt:
      "I run a personal AI assistant on my own laptop. I can either use a fast model that activates 3 billion " +
      "parameters per token, or a slower one that activates 27 billion. The assistant does two jobs: unattended " +
      "overnight jobs, and interactive chat during the day. What should I do and what would change your answer? " +
      "Be concrete and under 150 words.",
    autoChecks: [{ type: "maxWords", value: 170, label: "Roughly within the word limit" }],
    rubric: [
      "Proposes splitting by workload rather than picking one",
      "Names what would change the answer (a real conditional, not hedging)",
      "Does not pad or restate the question back",
    ],
  },
  {
    id: "gen-long-instruction",
    tier: "hard",
    category: "instruction-following",
    prompt:
      "Write three sentences about rain. The first must be exactly five words. The second must not contain the " +
      "letter 'e'. The third must end with the word 'again'. Output only the three sentences, nothing else.",
    autoChecks: [
  { type: "maxSentences", value: 3, label: "Exactly three sentences" },
  { type: "custom", value: "firstSentenceFiveWords", label: "First sentence is five words" },
  { type: "custom", value: "secondSentenceNoE", label: "Second sentence has no letter e" },
  { type: "custom", value: "thirdSentenceEndsAgain", label: "Third sentence ends with 'again'" },
    ],
    rubric: ["Sentences are actually about rain and read naturally"],
  },
];
