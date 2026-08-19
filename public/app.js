/* ModelBench frontend. No framework, no build step. */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const kid of kids.flat()) if (kid != null) node.append(kid.nodeType ? kid : String(kid));
  return node;
};
const api = async (path, options) => {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${path} failed (${res.status})`);
  return body;
};
const bytes = (n) => {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
};
const pct = (v) => (typeof v === "number" && Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—");

/** Score meter: one hue, magnitude, rounded data-end anchored left. */
function meter(value) {
  const known = typeof value === "number" && Number.isFinite(value);
  const wrap = el("div", { className: known ? "meter" : "meter unknown" });
  const track = el("div", { className: "track" });
  if (known) track.append(el("div", { className: "fill", style: `width:${Math.max(0, Math.min(1, value)) * 100}%` }));
  wrap.append(track, el("span", { className: "value", textContent: known ? pct(value) : "—" }));
  return wrap;
}

const state = {
  models: [],
  benchmarks: {},
  meta: { batteries: [], tiers: [], efforts: [] },
  poll: null,
  currentRunId: null,
  detail: null,
};

/* ---------------------------- tabs ---------------------------- */
function showTab(name) {
  for (const button of document.querySelectorAll("nav button")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  }
  for (const section of document.querySelectorAll("main > section")) {
    section.hidden = section.id !== `tab-${name}`;
  }
  if (name === "scoreboard") loadRuns();
  if (name === "score") renderScoring();
  if (name === "inventory") renderInventory();
}
document.querySelector("nav").addEventListener("click", (e) => {
  const button = e.target.closest("button[data-tab]");
  if (button) showTab(button.dataset.tab);
});
$("#theme").addEventListener("click", () => {
  const now = document.documentElement.getAttribute("data-theme");
  const next = now === "dark" ? "light" : now === "light" ? "" : "dark";
  if (next) document.documentElement.setAttribute("data-theme", next);
  else document.documentElement.removeAttribute("data-theme");
});

/* ---------------------------- run tab ---------------------------- */
const EFFORT_HELP = {
  default: "no thinking flag sent at all",
  off: "thinking explicitly disabled",
  low: "light reasoning",
  high: "heavy reasoning",
};

function checkbox(group, value, label, meta, checked) {
  const input = el("input", { type: "checkbox", value, checked: Boolean(checked) });
  input.dataset.group = group;
  input.addEventListener("change", updateEstimate);
  return el("label", { className: "check" }, input,
    el("span", {}, el("span", { textContent: label }), meta ? el("span", { className: "meta", textContent: meta }) : null));
}

const picked = (group) => [...document.querySelectorAll(`input[data-group="${group}"]:checked`)].map((i) => i.value);

function updateEstimate() {
  const models = picked("models").length;
  const tiers = picked("tiers");
  const efforts = picked("efforts").length;
  let cases = 0;
  for (const battery of picked("batteries")) {
    cases += (state.benchmarks[battery] ?? []).filter((c) => tiers.includes(c.tier)).length;
  }
  const steps = models * cases * efforts;
  $("#estimate").textContent = steps
    ? `${steps} model calls. Reckon on 10 to 60 seconds each depending on the model, so allow ${Math.round(steps * 20 / 60)} to ${Math.round(steps * 45 / 60)} minutes.`
    : "Pick at least one of each.";
  $("#start").disabled = steps === 0;
}

async function loadModels() {
  const data = await api("/api/models");
  $("#host").textContent = data.ok ? `Ollama at ${data.host}` : `Ollama unreachable at ${data.host}`;
  state.models = data.models ?? [];
  state.inventory = data.inventory ?? null;
  state.rolesFrom = data.rolesFrom ?? null;

  const box = $("#pick-models");
  box.replaceChildren();
  if (!data.ok) {
    $("#run-warning").replaceChildren(el("div", { className: "warnbox" },
      `Cannot reach Ollama at ${data.host}. Start it (open the Ollama app, or run "ollama serve") and reload this page.`));
    box.append(el("p", { className: "empty", textContent: "No models to show." }));
    return;
  }
  $("#run-warning").replaceChildren();
  if (!state.models.length) {
    box.append(el("p", { className: "empty", textContent: "Ollama is running but has no models installed." }));
    return;
  }
  for (const model of state.models) {
    const bits = [model.parameterSize, model.quantization, bytes(model.totalBytes)].filter(Boolean);
    if (model.derivedFrom) bits.push(`from ${model.derivedFrom}`);
    if (model.roles?.length) bits.push(`role: ${model.roles.join(", ")}`);
    box.append(checkbox("models", model.name, model.name, bits.join(" · ")));
  }
}

async function loadBenchmarks() {
  state.benchmarks = await api("/api/benchmarks");
  const health = await api("/api/health");
  state.meta = { batteries: health.batteries, tiers: health.tiers, efforts: health.efforts };
  state.usingLocal = health.usingLocal ?? {};
  const localParts = Object.entries(state.usingLocal).filter(([, on]) => on).map(([name]) => name);
  const banner = $("#local-banner");
  if (localParts.length) {
    banner.replaceChildren(el("div", { className: "warnbox", textContent: `Running your own local files for: ${localParts.join(", ")}. These are gitignored and will not be pushed.` }));
  } else {
    banner.replaceChildren();
  }

  const bBox = $("#pick-batteries");
  bBox.replaceChildren();
  for (const battery of state.meta.batteries) {
    const cases = state.benchmarks[battery] ?? [];
    const human = cases.filter((c) => c.humanScored).length;
    bBox.append(checkbox("batteries", battery, battery,
      `${cases.length} cases${human ? `, ${human} you score` : ", scored mechanically"}`, true));
  }
  const tBox = $("#pick-tiers");
  tBox.replaceChildren();
  for (const tier of state.meta.tiers) tBox.append(checkbox("tiers", tier, tier, null, true));

  const eBox = $("#pick-efforts");
  eBox.replaceChildren();
  for (const effort of state.meta.efforts) {
    eBox.append(checkbox("efforts", effort, effort, EFFORT_HELP[effort], effort === "default"));
  }
  updateEstimate();
  renderBenchmarks();
}

$("#start").addEventListener("click", async () => {
  const config = { models: picked("models"), batteries: picked("batteries"), tiers: picked("tiers"), efforts: picked("efforts") };
  try {
    const run = await api("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    state.currentRunId = run.id;
    $("#progress-card").hidden = false;
    $("#start").disabled = true;
    $("#cancel").hidden = false;
    pollStatus();
  } catch (error) {
    alert(error.message);
  }
});

$("#cancel").addEventListener("click", async () => {
  await api("/api/run/cancel", { method: "POST" });
  $("#cancel").disabled = true;
});

async function pollStatus() {
  clearInterval(state.poll);
  state.poll = setInterval(async () => {
    let status;
    try { status = await api("/api/run/status"); } catch { return; }
    if (status.idle) return;
    const percent = status.total ? (status.done / status.total) * 100 : 0;
    $("#progress-bar").style.width = `${percent}%`;
    const step = status.currentStep;
    $("#progress-text").textContent = status.status === "running"
      ? `${status.done} of ${status.total} · currently ${step ? `${step.model} · ${step.battery} · ${step.caseId} · ${step.effort}` : "finishing"}`
      : `${status.status} · ${status.done} of ${status.total} completed`;

    const rows = $("#progress-rows");
    rows.replaceChildren();
    for (const r of [...(status.lastResults ?? [])].reverse()) {
      rows.append(el("tr", {},
        el("td", { textContent: r.model }),
        el("td", { textContent: r.battery }),
        el("td", { textContent: r.caseId }),
        el("td", { textContent: r.effort }),
        el("td", {}, meter(r.score)),
        el("td", {}, r.gateFailed ? el("span", { className: "pill critical", textContent: "✕ gate failed" })
          : r.error ? el("span", { className: "pill warning", textContent: `⚠ ${r.error.slice(0, 60)}` })
          : el("span", { className: "muted", textContent: "" }))));
    }

    if (status.status !== "running") {
      clearInterval(state.poll);
      $("#start").disabled = false;
      $("#cancel").hidden = true;
      $("#cancel").disabled = false;
      state.currentRunId = status.id;
      await loadRuns();
      showTab("scoreboard");
    }
  }, 1500);
}

/* ---------------------------- scoreboard ---------------------------- */
async function loadRuns() {
  const runs = await api("/api/runs");
  const picker = $("#run-picker");
  picker.replaceChildren();
  if (!runs.length) {
    $("#scoreboard-body").replaceChildren(el("p", { className: "empty", textContent: "No runs yet. Start one on the Run tab." }));
    return;
  }
  for (const run of runs) {
    picker.append(el("option", {
      value: run.id,
      textContent: `${new Date(run.startedAt).toLocaleString("en-GB")} · ${run.models.join(", ")} · ${run.cases} cases${run.status === "finished" ? "" : ` (${run.status})`}`,
      selected: run.id === state.currentRunId,
    }));
  }
  if (!state.currentRunId) state.currentRunId = runs[0].id;
  picker.value = state.currentRunId;
  await renderScoreboard();
}
$("#run-picker").addEventListener("change", (e) => { state.currentRunId = e.target.value; renderScoreboard(); });

async function loadDetail() {
  if (!state.currentRunId) return null;
  state.detail = await api(`/api/run/detail?id=${encodeURIComponent(state.currentRunId)}`);
  return state.detail;
}

async function renderScoreboard() {
  const data = await loadDetail();
  const body = $("#scoreboard-body");
  body.replaceChildren();
  if (!data) return;
  const { summary, run } = data;

  const gated = summary.filter((s) => s.gateFailures.length);
  if (gated.length) {
    const card = el("div", { className: "card" },
      el("h2", { textContent: "Disqualifying failures" }),
      el("p", { className: "hint", textContent: "These are reported outside the averages on purpose. A model that called a forbidden tool or claimed to do something it has no tool for is not redeemed by scoring well elsewhere." }));
    for (const s of gated) {
      for (const g of s.gateFailures) {
        card.append(el("div", { className: "gate" },
          el("strong", { textContent: `${s.model}` }), ` — ${g.caseId} (${g.effort}): ${g.gates.join("; ")}`));
      }
    }
    body.append(card);
  }

  for (const battery of Object.keys(state.benchmarks)) {
    const rows = summary.filter((s) => s.byBattery[battery]);
    if (!rows.length) continue;
    const tiers = run.config.tiers;
    const efforts = run.config.efforts;

    const head = el("tr", {}, el("th", { textContent: "Model" }), el("th", { textContent: "Overall" }));
    for (const tier of tiers) head.append(el("th", { textContent: tier }));
    for (const effort of efforts) head.append(el("th", { className: "num", textContent: `${effort} tok/s` }));
    head.append(el("th", { textContent: "Flags" }));

    const tbody = el("tbody");
    const ranked = [...rows].sort((a, b) => (b.byBattery[battery].score ?? 0) - (a.byBattery[battery].score ?? 0));
    for (const s of ranked) {
      const b = s.byBattery[battery];
      const tr = el("tr", {}, el("td", { textContent: s.model }), el("td", {}, meter(b.score)));
      for (const tier of tiers) tr.append(el("td", {}, meter(b.byTier[tier])));
      for (const effort of efforts) {
        const e = b.byEffort[effort];
        tr.append(el("td", { className: "num", textContent: e?.tokensPerSecond ? e.tokensPerSecond.toFixed(1) : "—" }));
      }
      const flags = el("td");
      // Gates belong to the battery that produced them: a tool-calling failure must
      // not appear as a red flag against this model's coding row.
      const batteryGates = s.gateFailures.filter((g) => g.battery === battery);
      if (batteryGates.length) flags.append(el("span", { className: "pill critical", textContent: `✕ ${batteryGates.length} gate` }));
      if (b.pendingHumanScores) flags.append(el("span", { className: "pill warning", textContent: `⚠ ${b.pendingHumanScores} unscored` }));
      const batteryErrors = run.results.filter((r) => r.model === s.model && r.battery === battery && r.failed).length;
      if (batteryErrors) flags.append(el("span", { className: "pill warning", textContent: `⚠ ${batteryErrors} errored` }));
      // Neutral, not green: "no rules broken" is not the same as "scored well".
      if (!flags.childNodes.length) flags.append(el("span", { className: "pill", textContent: "no flags" }));
      tr.append(flags);
      tbody.append(tr);
    }

    const card = el("div", { className: "card" },
      el("h2", { textContent: battery }),
      el("p", { className: "hint", textContent: battery === "general"
        ? "Blends the automatic checks with your blind scores. Cases you have not scored yet count on the automatic half only."
        : "Scored mechanically. No judgement involved." }),
      el("div", { className: "tablewrap" }, el("table", {}, el("thead", {}, head), tbody)));

    // Score by category, where the battery has them.
    const cats = [...new Set(rows.flatMap((s) => Object.keys(s.byBattery[battery].byCategory ?? {})))];
    if (cats.length > 1) {
      const catHead = el("tr", {}, el("th", { textContent: "Model" }), ...cats.map((c) => el("th", { textContent: c })));
      const catBody = el("tbody");
      for (const s of ranked) {
        catBody.append(el("tr", {}, el("td", { textContent: s.model }),
          ...cats.map((c) => el("td", {}, meter(s.byBattery[battery].byCategory[c])))));
      }
      card.append(el("details", {}, el("summary", { textContent: "Break down by what is being tested" }),
        el("div", { className: "tablewrap" }, el("table", {}, el("thead", {}, catHead), catBody))));
    }
    body.append(card);
  }

  // Per-case detail, for when a number looks wrong and you want to see why.
  const caseCard = el("div", { className: "card" }, el("h2", { textContent: "Every case" }));
  const caseBody = el("tbody");
  const humanKey = (r) => `${r.model}|${r.battery}|${r.caseId}|${r.effort}`;
  for (const r of run.results) {
    const human = data.humanScores[humanKey(r)];
    const shown = typeof human === "number"
      ? (typeof r.score === "number" ? (r.score + human) / 2 : human)
      : r.score;
    const notes = [];
    if (r.error) notes.push(r.error);
    if (r.requirements) notes.push(r.requirements.filter((q) => !q.pass).map((q) => `${q.label}${q.detail ? ` (${q.detail})` : ""}`).join("; "));
    if (r.detail?.length) notes.push(`${r.passed}/${r.total} tests`);
    if (r.checks?.length) notes.push(r.checks.filter((c) => !c.pass).map((c) => `${c.label}${c.detail ? ` (${c.detail})` : ""}`).join("; "));
    if (typeof human === "number") notes.push(`your score: ${pct(human)}`);
    else if (r.needsHumanScore) notes.push("awaiting your score");
    caseBody.append(el("tr", {},
      el("td", { textContent: r.model }),
      el("td", { textContent: r.caseId }),
      el("td", { textContent: r.effort }),
      el("td", {}, meter(shown)),
      el("td", { className: "num", textContent: r.tokensPerSecond ? r.tokensPerSecond.toFixed(1) : "—" }),
      el("td", { className: "num", textContent: r.completionTokens ?? "—" }),
      el("td", { textContent: notes.filter(Boolean).join(" · ").slice(0, 200) })));
  }
  caseCard.append(el("div", { className: "tablewrap" }, el("table", {},
    el("thead", {}, el("tr", {}, ...["Model", "Case", "Effort", "Score", "tok/s", "Out tokens", "What went wrong"].map((h, i) =>
      el("th", { className: i === 4 || i === 5 ? "num" : "", textContent: h })))), caseBody)));
  body.append(caseCard);
}

/* ---------------------------- blind scoring ---------------------------- */
async function renderScoring() {
  const data = await loadDetail();
  const body = $("#score-body");
  body.replaceChildren();
  if (!data) { body.append(el("p", { className: "empty", textContent: "Run something first." })); return; }

  const pending = data.run.results.filter((r) => r.needsHumanScore);
  const key = (r) => `${r.model}|${r.battery}|${r.caseId}|${r.effort}`;
  const unscored = pending.filter((r) => typeof data.humanScores[key(r)] !== "number");
  $("#score-progress").textContent = `${pending.length - unscored.length} of ${pending.length} scored`;

  if (!pending.length) { body.append(el("p", { className: "empty", textContent: "This run has nothing needing your judgement." })); return; }

  // Shuffled so consecutive answers are not all from the same model.
  const queue = [...unscored, ...pending.filter((r) => typeof data.humanScores[key(r)] === "number")];
  for (const r of queue.slice(0, 40)) {
    const already = data.humanScores[key(r)];
    const revealed = typeof already === "number";
    const card = el("div", { className: "card" });
    card.append(el("p", { className: "muted", textContent: `${r.caseId} · ${r.tier} · ${r.category ?? ""} · effort: ${r.effort}` }));
    card.append(el("h2", { textContent: r.prompt }));

    if (r.checks?.length) {
      const list = el("ul", { className: "rubric" });
      for (const c of r.checks) {
        list.append(el("li", {},
          el("span", { className: `pill ${c.pass ? "good" : "critical"}`, textContent: c.pass ? "✓ pass" : "✕ fail" }),
          el("span", { textContent: `${c.label}${c.detail ? ` — ${c.detail}` : ""}` })));
      }
      card.append(el("p", { className: "muted", textContent: "Automatic checks", style: "margin:14px 0 0" }), list);
    }

    card.append(el("div", { className: "answer", textContent: r.reply || "(empty answer)" }));

    if (r.rubric?.length) {
      card.append(el("p", { className: "muted", textContent: "What you are looking for", style: "margin:14px 0 0" }),
        el("ul", { className: "rubric" }, ...r.rubric.map((item) => el("li", {}, el("span", { textContent: "·" }), el("span", { textContent: item })))));
    }

    const buttons = el("div", { className: "scorebtns" });
    const options = [["Fails it", 0], ["Partly", 0.5], ["Meets it", 1]];
    const name = el("span", { className: revealed ? "pill" : "muted", textContent: revealed ? r.model : "model hidden until scored" });
    for (const [label, value] of options) {
      const button = el("button", { type: "button", textContent: label });
      button.setAttribute("aria-pressed", String(already === value));
      button.addEventListener("click", async () => {
        await api("/api/score", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key(r), value }) });
        for (const sibling of buttons.querySelectorAll("button")) sibling.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-pressed", "true");
        name.className = "pill";
        name.textContent = r.model;
        data.humanScores[key(r)] = value;
        $("#score-progress").textContent = `${pending.filter((x) => typeof data.humanScores[key(x)] === "number").length} of ${pending.length} scored`;
      });
      buttons.append(button);
    }
    buttons.append(el("span", { style: "flex:1" }), name);
    card.append(buttons);
    body.append(card);
  }
}

/* ---------------------------- inventory ---------------------------- */
async function renderInventory() {
  if (!state.models.length) await loadModels();
  const stats = $("#inventory-stats");
  stats.replaceChildren();
  const inv = state.inventory;
  if (inv?.available && inv.totals) {
    stats.append(
      el("div", { className: "stat" }, el("span", { className: "n", textContent: bytes(inv.totals.uniqueBytes) }), el("span", { className: "l", textContent: "Actually on disk" })),
      el("div", { className: "stat" }, el("span", { className: "n", textContent: bytes(inv.totals.naiveSumBytes) }), el("span", { className: "l", textContent: "What adding up the list would tell you" })),
      el("div", { className: "stat" }, el("span", { className: "n", textContent: bytes(inv.totals.overcountBytes) }), el("span", { className: "l", textContent: "Overcount from shared layers" })),
      el("div", { className: "stat" }, el("span", { className: "n", textContent: String(state.models.length) }), el("span", { className: "l", textContent: "Models installed" })));
    if (inv.totals.modelCount !== state.models.length) {
      stats.append(el("div", { className: "warnbox", style: "grid-column:1/-1", textContent: `The manifests on disk describe ${inv.totals.modelCount} models but Ollama lists ${state.models.length}. Sizes for anything missing from one side will show as a dash.` }));
    }
  } else {
    stats.append(el("div", { className: "warnbox", textContent: `Could not read the Ollama manifests${inv?.reason ? ` (${inv.reason})` : ""}, so sizes below come from Ollama's own figures and will overcount shared layers.` }));
  }

  const rows = $("#inventory-rows");
  rows.replaceChildren();
  const sorted = [...state.models].sort((a, b) => (b.exclusiveBytes ?? b.totalBytes ?? 0) - (a.exclusiveBytes ?? a.totalBytes ?? 0));
  for (const m of sorted) {
    rows.append(el("tr", {},
      el("td", {}, el("strong", { textContent: m.name }), m.hasSystemPrompt ? el("span", { className: "meta", textContent: " (tuned)" }) : null),
      el("td", { textContent: m.derivedFrom ?? "—" }),
      el("td", {}, m.roles?.length ? el("span", { className: "pill good", textContent: `✓ ${m.roles.join(", ")}` })
        : el("span", { className: "pill", textContent: state.rolesFrom ? "no role in config" : "unknown" })),
      el("td", { className: "num", textContent: bytes(m.totalBytes) }),
      el("td", { className: "num", textContent: m.exclusiveBytes === null ? "—" : bytes(m.exclusiveBytes) }),
      el("td", { className: "muted", textContent: m.sharedWith?.length ? m.sharedWith.join(", ") : "nothing" })));
  }
  if (!state.rolesFrom) {
    rows.append(el("tr", {}, el("td", { colSpan: 6, className: "muted", textContent: "Set MODELBENCH_AGENT_CONFIG to your agent's config.json to see which models are actually wired up to a role." })));
  }
}

/* ---------------------------- benchmarks ---------------------------- */
function renderBenchmarks() {
  const body = $("#benchmarks-body");
  body.replaceChildren();
  for (const [battery, cases] of Object.entries(state.benchmarks)) {
    const tbody = el("tbody");
    for (const c of cases) {
      tbody.append(el("tr", {},
        el("td", { textContent: c.tier }),
        el("td", { textContent: c.category ?? "—" }),
        el("td", { textContent: c.prompt }),
        el("td", {}, c.humanScored ? el("span", { className: "pill warning", textContent: "⚠ you score" }) : el("span", { className: "pill good", textContent: "✓ automatic" }))));
    }
    body.append(el("div", { className: "card" }, el("h2", { textContent: `${battery} · ${cases.length} cases` }),
      el("div", { className: "tablewrap" }, el("table", {},
        el("thead", {}, el("tr", {}, ...["Tier", "Tests", "Prompt", "Scoring"].map((h) => el("th", { textContent: h })))), tbody))));
  }
}

/* ---------------------------- boot ---------------------------- */
(async function boot() {
  try {
    await loadBenchmarks();
    await loadModels();
    updateEstimate();
    const status = await api("/api/run/status");
    if (!status.idle && status.status === "running") {
      $("#progress-card").hidden = false;
      $("#start").disabled = true;
      $("#cancel").hidden = false;
      pollStatus();
    }
  } catch (error) {
    $("#host").textContent = `Error: ${error.message}`;
  }
})();
