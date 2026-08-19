/**
 * Self-contained fake tools for the tool-calling battery.
 *
 * All of this data is invented. It describes a fictional person, "Sam", so the
 * benchmark can be published and shared without leaking anything about whoever
 * is running it. The tool names and argument shapes mirror what a personal
 * assistant agent typically exposes, so results transfer to that decision.
 *
 * Nothing here touches a real calendar, inbox or memory store, so a run today
 * and a run in six months are directly comparable, and any model can be tested
 * without an agent running.
 *
 * SWAP THIS OUT. If you want the benchmark to reflect your own life, replace
 * the data below and update the `answerContains` values in
 * benchmarks/tool-calling.js to match. Keep the frozen date, or update every
 * case that depends on it.
 */
export const TODAY = "2026-03-12"; // a Thursday
export const TOMORROW = "2026-03-13";

const CALENDAR = {
  "2026-03-12": [
    { time: "09:30", title: "Standup", location: "Video call" },
    { time: "14:00", title: "Results dry run with Priya", location: "Meeting room 2" },
  ],
  "2026-03-13": [
    { time: "11:00", title: "Dentist", location: "Fairview Road" },
    { time: "16:30", title: "Call with Tom re: the Halberd brief", location: "Phone" },
  ],
  "2026-03-16": [{ time: "10:00", title: "Q1 planning", location: "Office" }],
};

const EMAILS = [
  { id: "e1", date: "2026-03-12", from: "priya@halberd.example", subject: "Dry run deck v3", snippet: "Latest deck attached, slide 9 still needs the revenue split." },
  { id: "e2", date: "2026-03-12", from: "noreply@bank.example", subject: "Your March statement is ready", snippet: "Sign in to view your statement." },
  { id: "e3", date: "2026-03-11", from: "tom@halberd.example", subject: "Halberd brief timing", snippet: "Can we push our call to Friday afternoon?" },
  { id: "e4", date: "2026-03-09", from: "agent@propertyco.example", subject: "Elm Street offer", snippet: "The vendor has come back on the offer, please call." },
];

const MEMORIES = [
  { id: "m1", text: "Sam lives in Riverton.", tags: ["location"] },
  { id: "m2", text: "Sam is waiting on Tom to confirm the Halberd brief scope.", tags: ["waiting", "halberd"] },
  { id: "m3", text: "Sam prefers concise written briefings, no preamble.", tags: ["preference"] },
  { id: "m4", text: "Sam is evaluating local models for the assistant's main role.", tags: ["project", "models"] },
];

const DIARY = {
  "2026-03-11": "Swam before work. Spent the afternoon on the Halberd brief. Called the agent about Elm Street.",
  "2026-03-10": "Long day of meetings. Gym in the evening.",
};

const REMINDERS = [
  { id: "r1", text: "Send Priya the revenue split", due: "2026-03-12", done: false },
  { id: "r2", text: "Chase the insurance quote", due: "2026-03-13", done: false },
  { id: "r3", text: "Book the car service", due: null, done: false },
];

const DIGESTS = {
  "2026-03-11": "Yesterday: Halberd brief progressed, property agent called. Today: standup at 09:30, results dry run at 14:00.",
};

/** JSON Schema tool definitions handed to the model. */
export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "read_calendar",
      description: "Read calendar events for a given date. Use for any question about what is on, scheduled, or booked.",
      parameters: {
        type: "object",
        properties: { date: { type: "string", description: "Date in YYYY-MM-DD format" } },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_email",
      description: "Read recent emails, optionally filtered by a search query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional keywords to filter on" },
          date: { type: "string", description: "Optional date in YYYY-MM-DD format" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_memory",
      description: "Search the user's stored long-term memory about themselves, their life and their projects.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What to search for" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description: "Store a new durable fact about the user. Only use when the user explicitly asks you to remember something.",
      parameters: {
        type: "object",
        properties: { text: { type: "string", description: "The fact to store" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_diary",
      description: "Read the user's diary entry for a specific date.",
      parameters: {
        type: "object",
        properties: { date: { type: "string", description: "Date in YYYY-MM-DD format" } },
        required: ["date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "amend_diary",
      description: "Correct an existing diary entry when the user says something in it is wrong.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Date in YYYY-MM-DD format" },
          correction: { type: "string", description: "What to correct" },
        },
        required: ["date", "correction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_reminders",
      description: "List the user's open reminders and tasks.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_digest",
      description: "Read a previously generated daily digest for a date.",
      parameters: {
        type: "object",
        properties: { date: { type: "string", description: "Date in YYYY-MM-DD format" } },
        required: ["date"],
      },
    },
  },
];

/** Execute a fake tool call and return a result string for the model. */
export function executeTool(name, args = {}) {
  const a = args && typeof args === "object" ? args : {};
  switch (name) {
    case "read_calendar": {
      const date = String(a.date ?? TODAY);
      const events = CALENDAR[date] ?? [];
      if (!events.length) return `No events on ${date}.`;
      return `Events on ${date}:\n` + events.map((e) => `- ${e.time} ${e.title} (${e.location})`).join("\n");
    }
    case "read_email": {
      const q = String(a.query ?? "").toLowerCase().trim();
      const date = a.date ? String(a.date) : null;
      let hits = EMAILS;
      if (date) hits = hits.filter((e) => e.date === date);
      if (q) {
        const terms = q.split(/\s+/).filter(Boolean);
        hits = hits.filter((e) => terms.some((t) => `${e.subject} ${e.snippet} ${e.from}`.toLowerCase().includes(t)));
      }
      if (!hits.length) return "No matching emails.";
      return hits.map((e) => `[${e.date}] ${e.from} — ${e.subject}: ${e.snippet}`).join("\n");
    }
    case "search_memory": {
      const q = String(a.query ?? "").toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      const hits = MEMORIES.filter((m) => terms.some((t) => `${m.text} ${m.tags.join(" ")}`.toLowerCase().includes(t)));
      if (!hits.length) return "No memories matched that query.";
      return hits.map((m) => `- ${m.text}`).join("\n");
    }
    case "remember":
      return `Stored as a proposed memory: "${String(a.text ?? "").slice(0, 200)}"`;
    case "get_diary": {
      const date = String(a.date ?? "");
      return DIARY[date] ? `Diary for ${date}: ${DIARY[date]}` : `No diary entry for ${date}.`;
    }
    case "amend_diary":
      return `Correction queued for ${String(a.date ?? "unknown date")}: ${String(a.correction ?? "")}`;
    case "read_reminders": {
      const open = REMINDERS.filter((r) => !r.done);
      return open.map((r) => `- ${r.text}${r.due ? ` (due ${r.due})` : ""}`).join("\n");
    }
    case "get_digest": {
      const date = String(a.date ?? "");
      return DIGESTS[date] ? DIGESTS[date] : `No digest for ${date}.`;
    }
    default:
      return `ERROR: no such tool "${name}". Available tools: ${TOOL_SCHEMAS.map((t) => t.function.name).join(", ")}.`;
  }
}

export const KNOWN_TOOLS = TOOL_SCHEMAS.map((t) => t.function.name);

export const SYSTEM_PROMPT = [
  `You are a personal assistant. Today's date is ${TODAY} (a Thursday).`,
  "You have tools that read the user's real calendar, email, memory, diary and reminders.",
  "Use a tool when the answer depends on the user's personal data. Do not use a tool for general knowledge, chit-chat or writing help.",
  "Only store a memory when the user explicitly asks you to remember something.",
  "Answer concisely in UK English.",
].join(" ");
