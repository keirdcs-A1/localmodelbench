# localmodelbench

A local scoreboard for local models.

It finds every model installed in your Ollama, runs each one through three
benchmarks, and gives you a score per job, so you can work out which model
belongs in which seat instead of guessing from a vendor's benchmark table.

It also tells you what each model actually costs you in disk space, which is
not the number `ollama list` shows you.

No dependencies. No build step. No account. Nothing leaves your machine.

```
git clone https://github.com/keirdcs-A1/localmodelbench.git
cd localmodelbench
node server.js
```

Open **http://127.0.0.1:4321**.

---

## Why this exists

Most Ollama benchmarking tools measure tokens per second. That is worth knowing,
and it is not the thing that decides whether a model can do a job.

The published quality benchmarks have the opposite problem: they measure real
capability, on tasks that are nothing like what you are going to ask the model to
do, usually reported by the company that trained it.

This sits in between. Small, opinionated, and about the jobs people actually
give a local model.

## What it measures

| Battery | What it tests | How it is scored |
|---|---|---|
| **tool-calling** | Picks the right tool, with the right arguments, in the right order, and leaves alone the ones it should not touch | Mechanically. No judgement. |
| **coding** | Writes a working JavaScript function | The code is executed against unit tests. It passes or it does not. |
| **general** | Reasoning, instruction following, grounding, and writing | Automatic checks where the instruction is mechanically checkable, plus your own blind scoring for the rest |

Each battery has **easy / medium / hard** tiers, so you can see where a model
falls over rather than reading one flat average.

Each case can be run at four **reasoning efforts**: `default` (no thinking flag
sent), `off` (thinking explicitly disabled), `low` and `high`.

`default` and `off` are separate runs on purpose. On some models an explicit
`think: false` behaves differently from sending no flag at all, including leaking
chain-of-thought into the answer, and you want to know if yours is one of them.

## Three things it does differently

**Gates are separate from scores.** Calling a tool it was told not to touch, or
inventing a tool that does not exist and then claiming the action worked, is a
disqualifying failure. Those are listed above the scoreboard rather than averaged
into a number. Averaging a disqualifying failure away is how you end up picking a
model that quietly does the wrong thing.

**The coding battery runs the code.** The model writes a function, the app
extracts it and executes it against real unit tests in a separate process. There
is no model grading another model's code, and no eyeballing.

**Grading is blind.** On the general battery the model's name is hidden until you
have scored the answer, so you cannot favour the one you expected to win.

There is deliberately **no single composite score** across batteries. The best
model for writing code and the best model for driving your tools are different
questions, and one number would hide that.

## The disk inventory

Derived models share their layers with the base they were built from. A custom
model built with a Modelfile does not hold its own copy of the base weights, it
points at the same files on disk.

So adding up the size column from `ollama list` overcounts, often by a lot. On a
typical setup with a few custom models it will tell you that you are using twice
the disk you actually are, and "delete this one to free 23GB" will free nothing.

The Inventory tab reads the Ollama manifests directly and reports two numbers per
model:

- **On disk** — everything that model references
- **Reclaimable** — the layers only it references, which is what deleting it
  would actually free

If you point it at an agent's `config.json`, it also shows which models are wired
up to a real job and which are just sitting there:

```
MODELBENCH_AGENT_CONFIG=/path/to/your/config.json node server.js
```

It looks for `models`, `modelRouting`, `model.name` and `chat.summariserModel`
keys. If your config has a different shape, `readRoleMap()` in `server.js` is
about fifteen lines and easy to adjust.

## Requirements

- Node 20 or newer
- Ollama running locally

Set `OLLAMA_HOST` if yours is not on `http://127.0.0.1:11434`. Set `PORT` to move
the web UI off 4321.

## Making it yours

The fixtures ship with an invented person called Sam, in an invented town, so the
benchmark can be shared without leaking anything about whoever runs it. **The
point is to replace them.** A benchmark built from your own life is worth more
than one built from mine.

The fake calendar, inbox, memory, diary and reminders live in `lib/fixtures.js`
with a frozen date of 2026-03-12.

**Do not edit the tracked files.** Copy them to a `.local.js` sibling instead:

| Edit this | Not this |
|---|---|
| `lib/fixtures.local.js` | `lib/fixtures.js` |
| `benchmarks/tool-calling.local.js` | `benchmarks/tool-calling.js` |
| `benchmarks/coding.local.js` | `benchmarks/coding.js` |
| `benchmarks/general.local.js` | `benchmarks/general.js` |

```
cp lib/fixtures.js lib/fixtures.local.js
cp benchmarks/tool-calling.js benchmarks/tool-calling.local.js
```

A `.local.js` file replaces the tracked one entirely, and all of them are
gitignored. So you can put your actual colleagues, your actual street and your
actual projects in there and a `git push` can never leak them. The Run tab shows
a banner naming which parts are running from your own files, so it is never a
surprise which data is in play. A broken local file logs a warning and falls back
to the built-in version rather than taking the app down.

If you change the fixture data, update the `answerContains` values in your local
tool-calling cases to match.

Cases are plain arrays. Add one, restart the server, and it appears in the UI.

**A tool-calling case:**

```js
{
  id: "tc-my-case",
  tier: "medium",
  prompt: "What have I got on tomorrow?",
  expectTools: ["read_calendar"],          // must be called, in this order
  forbidTools: ["remember"],               // must not be called
  expectArgs: { read_calendar: { date: "2026-03-13" } },
  answerContains: ["dentist"],             // must actually use the result
}
```

Also available: `expectNoTools`, `forbidUnknownTools`, `answerRefuses`.

**A coding case:**

```js
{
  id: "code-my-case",
  tier: "easy",
  functionName: "myFunction",
  prompt: "Write a JavaScript function `myFunction(x)` that ...",
  tests: [{ call: "myFunction(2)", expect: 4 }],
}
```

**A general case:**

```js
{
  id: "gen-my-case",
  tier: "medium",
  category: "reasoning",
  prompt: "...",
  autoChecks: [{ type: "maxWords", value: 50, label: "Under 50 words" }],
  rubric: ["What you are looking for when you score it"],
}
```

Check types: `maxSentences`, `maxWords`, `contains`, `notContains`, `notMatches`
(regex), `custom`.

## Safety

The coding battery **executes code written by a language model on your machine**.

Before anything runs, the code is checked for constructs a pure function has no
business using: `require`, `import`, `process`, `child_process`, `fetch`, `eval`,
`Function`, `globalThis`, `Worker`. Anything that trips the check is failed
without being executed. What survives runs in a separate short-lived Node process
in an empty temp directory, with a 10 second timeout and a 256MB memory cap.

That is a guardrail, not a sandbox. If you add your own coding cases, or point
this at a model you do not trust, understand what you are running.

## What it is not

It tests models against **self-contained fake tools**, not your live calendar and
inbox. That is deliberate: it makes runs reproducible and lets you test any model
without an agent running. Use it to shortlist. Confirm the winner against your
real system before you commit to it.

It is also small. Three batteries, 33 cases. It will tell you that one model
routes tools reliably and another invents them. It will not tell you which is
better at a 200,000 token refactor.

## Prior art

Worth knowing about before you use this:

- [promptfoo](https://github.com/promptfoo/promptfoo) — the mature,
  general-purpose LLM eval framework. Config-driven, far more capable, has a web
  viewer with manual grading. Reach for it if you want a real testing framework.
- [aidatatools/ollama-benchmark](https://github.com/aidatatools/ollama-benchmark)
  — the most established Ollama throughput benchmark, if speed is all you need.
- [homebench](https://github.com/david-g-3654/homebench) — speed, memory and
  deterministically-graded quality in a terminal UI.

This one exists because none of them combine tool-calling scored on argument
accuracy, code scored by execution, blind human grading, and disk accounting that
understands shared layers.

## Layout

```
server.js              web server and JSON API
lib/ollama.js          Ollama client
lib/fixtures.js        the fake calendar, inbox, memory, diary
lib/scoring.js         deterministic scoring
lib/sandbox.js         runs model-written code against tests
lib/runner.js          the run matrix and aggregation
lib/inventory.js       blob-aware disk accounting
lib/load.js            loads your .local.js overrides
lib/store.js           saves runs as JSON
benchmarks/            the cases, one file per battery
public/                the UI
results/               your saved runs and scores (gitignored)
```

## Licence

MIT.
