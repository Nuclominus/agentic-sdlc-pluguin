// The ADR-0019 DoD instrument. Most of these test a BOUNDARY, because the boundaries are the
// whole measurement: move `end` by one dispatch and the number changes by more than the change
// being measured. The synthetic transcripts below are the real wire format — one JSONL line per
// content block, `message.usage` repeated on each — so the dedup in extractUsage is exercised
// rather than assumed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locateWindow, toolHistogram, priceWindow, countAssistantLines, measureRun, aggregate, renderText } from "../lib/start-window.mjs";

// The registry in its NORMALISED shape — what loadRegistry() returns and priceUsage() consumes.
// Building it by hand here rather than through a temp models.json keeps the pricing path under
// test identical to production: the same priceUsage, the same multipliers, no local arithmetic.
const REGISTRY = {
  byId: new Map([
    ["m-opus", { input: 5, cached_input: 0.5, output: 25 }],
    ["m-haiku", { input: 1, cached_input: 0.1, output: 5 }],
    ["m-unpriced", null],
  ]),
  multipliers: { ephemeral_5m: 1.25, ephemeral_1h: 2.0 },
};

const fact = (tool, extra = {}) => ({ tool, command: null, subagent_type: null, skill: null, timestamp: null, ...extra });

/** The stream a normal run produces: skill, resolution work, the anchor write, more work, dispatch. */
function stream() {
  return [
    fact("Read", { path: "/x" }),                                    // 0 — before the skill
    fact("Skill", { skill: "sdlc:pipeline-orchestrator", timestamp: "2026-08-05T10:00:00Z" }), // 1 — start
    fact("Bash", { command: "node …/resolve/cli.mjs plan --json", timestamp: "2026-08-05T10:00:05Z" }),
    fact("Bash", { command: "date -u +%s > docs/plans/x/.checkpoint/_started_at", timestamp: "2026-08-05T10:00:09Z" }), // 3 — split
    fact("Write", { path: "/docs/plans/x/_brief.md", timestamp: "2026-08-05T10:00:12Z" }),
    fact("Agent", { subagent_type: "sdlc:business-analyst", timestamp: "2026-08-05T10:00:20Z" }), // 5 — end
    fact("Agent", { subagent_type: "sdlc:developer", timestamp: "2026-08-05T10:05:00Z" }),
  ];
}

test("the window runs from the orchestrator Skill to the FIRST dispatch, exclusive", () => {
  const w = locateWindow(stream());
  assert.equal(w.start, 1, "work before the skill loads is not the orchestrator's");
  assert.equal(w.end, 5, "the second dispatch must not extend it — that is a phase, not the start");
  assert.equal(w.split, 3);
  assert.equal(w.reason, null);
});

test("a bare skill name matches as well as a namespaced one", () => {
  const f = [fact("Skill", { skill: "pipeline-orchestrator" }), fact("Agent")];
  assert.equal(locateWindow(f).start, 0);
});

test("another plugin's skill does not open the window", () => {
  const f = [fact("Skill", { skill: "superpowers:brainstorming" }), fact("Agent")];
  assert.equal(locateWindow(f).start, null);
  assert.match(locateWindow(f).reason, /no pipeline-orchestrator Skill invocation/);
});

test("a run that dispatched nothing is unmeasurable, not measured to the end of the session", () => {
  // A --dry-run, or a run aborted at a gate. Without a closing boundary the quantity is
  // different in kind; averaging it in would drag the median toward whatever came next.
  const f = [fact("Skill", { skill: "pipeline-orchestrator" }), fact("Bash"), fact("Read")];
  const w = locateWindow(f);
  assert.equal(w.end, null);
  assert.match(w.reason, /no agent dispatch/);
});

test("an anchor write AFTER the dispatch is not a split", () => {
  const f = [
    fact("Skill", { skill: "pipeline-orchestrator" }),
    fact("Agent"),
    fact("Bash", { command: "cat .checkpoint/_started_at" }),
  ];
  assert.equal(locateWindow(f).split, null, "the split must lie inside the window it splits");
});

test("no anchor write means no collapsible figure — the split is never guessed", () => {
  const f = [fact("Skill", { skill: "pipeline-orchestrator" }), fact("Bash", { command: "ls" }), fact("Agent")];
  assert.equal(locateWindow(f).split, null);
});

test("the legacy Task tool closes the window too", () => {
  const f = [fact("Skill", { skill: "pipeline-orchestrator" }), fact("Task")];
  assert.equal(locateWindow(f).end, 1);
});

test("the histogram counts the window's tools, highest first, Skill included", () => {
  const h = toolHistogram(stream(), 1, 5);
  assert.deepEqual(h, { Bash: 2, Skill: 1, Write: 1 });
});

// ---- pricing -------------------------------------------------------------------------

function session(lines) {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-sw-"));
  const p = join(dir, "s.jsonl");
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n"));
  return { dir, path: p };
}
const turn = (id, ts, model, usage, sidechain = false) => ({
  timestamp: ts, isSidechain: sidechain,
  message: { id, role: "assistant", model, usage, content: [{ type: "text", text: "x" }] },
});

test("cache-read dominates and is priced at the model's OWN cached rate", () => {
  const s = session([
    turn("a", "2026-08-05T10:00:01Z", "m-opus", { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1_000_000 }),
    turn("b", "2026-08-05T10:00:02Z", "m-haiku", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 }),
  ]);
  try {
    const r = priceWindow([s.path], "2026-08-05T10:00:00Z", "2026-08-05T10:00:10Z", REGISTRY);
    assert.equal(r.turns, 2);
    assert.equal(r.cache_read_tokens, 2_000_000);
    // opus 1M×$0.50 + haiku 1M×$0.10 + opus input 10×$5/M + output 100×$25/M
    assert.ok(Math.abs(r.cost_usd - (0.5 + 0.1 + 0.00005 + 0.0025)) < 1e-9,
      `each model pays its own cached rate, not opus's flat $0.50 — got ${r.cost_usd}`);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("turns outside the window are excluded at both ends", () => {
  const s = session([
    turn("early", "2026-08-05T09:59:00Z", "m-opus", { cache_read_input_tokens: 1_000_000 }),
    turn("in", "2026-08-05T10:00:05Z", "m-opus", { cache_read_input_tokens: 1_000_000 }),
    turn("late", "2026-08-05T10:01:00Z", "m-opus", { cache_read_input_tokens: 1_000_000 }),
  ]);
  try {
    const r = priceWindow([s.path], "2026-08-05T10:00:00Z", "2026-08-05T10:00:10Z", REGISTRY);
    assert.equal(r.turns, 1, "a window that leaks at either end measures the session, not the start");
    assert.equal(r.cache_read_tokens, 1_000_000);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("one API call spread over several JSONL lines counts as ONE turn", () => {
  // The harness writes a line per content block, each repeating the same message.usage.
  const s = session([
    turn("same", "2026-08-05T10:00:01Z", "m-opus", { cache_read_input_tokens: 1_000_000 }),
    turn("same", "2026-08-05T10:00:01Z", "m-opus", { cache_read_input_tokens: 1_000_000 }),
    turn("same", "2026-08-05T10:00:01Z", "m-opus", { cache_read_input_tokens: 1_000_000 }),
  ]);
  try {
    const r = priceWindow([s.path], "2026-08-05T10:00:00Z", "2026-08-05T10:00:10Z", REGISTRY);
    assert.equal(r.turns, 1, "summing per line multiplies a single call by its block count");
    assert.equal(r.cache_read_tokens, 1_000_000);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("subagent turns never enter the window — the window is the orchestrator's own spend", () => {
  const s = session([
    turn("main", "2026-08-05T10:00:01Z", "m-opus", { cache_read_input_tokens: 1_000 }),
    turn("sub", "2026-08-05T10:00:02Z", "m-opus", { cache_read_input_tokens: 9_000_000 }, true),
  ]);
  try {
    const r = priceWindow([s.path], "2026-08-05T10:00:00Z", "2026-08-05T10:00:10Z", REGISTRY);
    assert.equal(r.cache_read_tokens, 1_000);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("an unpriceable model yields null cost, never a measured zero", () => {
  const s = session([turn("u", "2026-08-05T10:00:01Z", "m-unpriced", { cache_read_input_tokens: 5_000_000 })]);
  try {
    const r = priceWindow([s.path], "2026-08-05T10:00:00Z", "2026-08-05T10:00:10Z", REGISTRY);
    assert.equal(r.cost_usd, null, "ADR-0012's rule: an unknown must not reach a comparison as $0");
    assert.deepEqual(r.unpriced_models, ["m-unpriced"]);
    assert.equal(r.cache_read_tokens, 5_000_000, "the tokens are still real and still reported");
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

// ---- aggregation ---------------------------------------------------------------------

const row = (slug, turns, calls, cost, share) => ({
  slug, measurable: true, run_total_cost_usd: cost / share,
  window: { turns: turns + 7, tool_calls: calls + 4, cost_usd: cost + 0.45, share_of_run: share + 0.05, histogram: { Bash: 3 } },
  collapsible: { turns, tool_calls: calls, cost_usd: cost, share_of_run: share, histogram: { Bash: 2, Read: 1 } },
});

test("medians and ranges are reported over the measurable runs only", () => {
  const agg = aggregate([
    row("a", 16, 9, 0.90, 0.085),
    row("b", 24, 14, 1.31, 0.118),
    row("c", 36, 20, 1.90, 0.172),
    { slug: "gone", measurable: false, reason: "no session transcript resolves for this run" },
  ]);
  assert.equal(agg.measurable, 3);
  assert.equal(agg.total, 4);
  assert.equal(agg.collapsible.turns.median, 24);
  assert.deepEqual(agg.collapsible.turns.range, { min: 16, max: 36 });
  assert.equal(agg.collapsible.tool_calls.median, 14);
  assert.ok(Math.abs(agg.collapsible.cost_usd.median - 1.31) < 1e-9);
});

test("an unmeasurable run is named, not silently dropped from the denominator", () => {
  // H1's audit learned this: a median over a denominator nobody can see is not a measurement.
  const agg = aggregate([row("a", 24, 14, 1.31, 0.118), { slug: "gone", measurable: false, reason: "rotated away" }]);
  assert.deepEqual(agg.excluded, [{ slug: "gone", reason: "rotated away" }]);
  assert.match(renderText(agg, null), /1\/2 run\(s\) measurable/);
  assert.match(renderText(agg, null), /✗ gone: rotated away/);
});

test("the pooled histogram sums across runs", () => {
  const agg = aggregate([row("a", 1, 1, 1, 0.1), row("b", 2, 2, 2, 0.2)]);
  assert.deepEqual(agg.collapsible.histogram, { Bash: 4, Read: 2 });
});

test("the text report separates the whole window from the collapsible part", () => {
  const out = renderText(aggregate([row("a", 24, 14, 1.31, 0.118)]), [row("a", 24, 14, 1.31, 0.118)]);
  assert.match(out, /Skill → first dispatch/);
  assert.match(out, /Steps 0→1d \(before the _started_at anchor\)/,
    "quoting the whole window as collapsible overstates the lever — the split is the point");
  assert.match(out, /share of run median 11\.8%/);
});

test("a corpus where no run carries the anchor says so instead of printing an empty table", () => {
  const noSplit = { slug: "x", measurable: true, run_total_cost_usd: 10, window: { turns: 30, tool_calls: 18, cost_usd: 1.8, share_of_run: 0.18, histogram: {} }, collapsible: null };
  const out = renderText(aggregate([noSplit]), [noSplit]);
  assert.match(out, /no run carried this boundary/);
});

test("assistant lines are reported alongside turns, because they are a different unit", () => {
  // ADR-0019's "median 24 turns" was measured in JSONL lines, of which the harness writes one per
  // content block. Reporting only deduped API calls would make the DoD book a ~2x win that never
  // happened; reporting only lines would misprice the window. Both, always.
  const s = session([
    turn("one", "2026-08-05T10:00:01Z", "m-opus", { cache_read_input_tokens: 1_000 }),
    turn("one", "2026-08-05T10:00:01Z", "m-opus", { cache_read_input_tokens: 1_000 }),
    turn("two", "2026-08-05T10:00:02Z", "m-opus", { cache_read_input_tokens: 1_000 }),
    turn("sub", "2026-08-05T10:00:03Z", "m-opus", { cache_read_input_tokens: 1_000 }, true),
  ]);
  try {
    const win = "2026-08-05T10:00:00Z", end = "2026-08-05T10:00:10Z";
    assert.equal(priceWindow([s.path], win, end, REGISTRY).turns, 2, "API calls");
    assert.equal(countAssistantLines([s.path], win, end), 3, "JSONL lines, subagent lines still excluded");
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

// ---- the boundary convention, pinned at both ends -------------------------------------
//
// Review finding on #125: every pricing test above sat strictly INSIDE its window, so nothing
// encoded whether an end was open or closed — which is exactly how the JSDoc came to say
// `[since, until)` while extractUsage compares `t < s || t > u`. These two are the convention.

test("a turn exactly ON `since` is INSIDE the window", () => {
  const s = session([turn("edge", "2026-08-05T10:00:00Z", "m-opus", { cache_read_input_tokens: 1_000 })]);
  try {
    assert.equal(priceWindow([s.path], "2026-08-05T10:00:00Z", "2026-08-05T10:00:10Z", REGISTRY).turns, 1);
    assert.equal(countAssistantLines([s.path], "2026-08-05T10:00:00Z", "2026-08-05T10:00:10Z"), 1);
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("a turn exactly ON `until` is ALSO inside — the window is closed at both ends", () => {
  // Deliberate, not inherited: the turn that emits the dispatch spent its tokens deciding to
  // dispatch, i.e. on the window's own work. It biases the figure up by one turn — the most
  // expensive one, since cache-read grows across a window — and that bias cancels in a
  // before/after measured the same way. It does NOT cancel when an absolute number is quoted.
  const s = session([turn("edge", "2026-08-05T10:00:10Z", "m-opus", { cache_read_input_tokens: 1_000 })]);
  try {
    assert.equal(priceWindow([s.path], "2026-08-05T10:00:00Z", "2026-08-05T10:00:10Z", REGISTRY).turns, 1,
      "if this ever flips to exclusive, the header's boundary convention must flip with it");
    assert.equal(countAssistantLines([s.path], "2026-08-05T10:00:00Z", "2026-08-05T10:00:10Z"), 1,
      "lines and turns must agree with each other even where they disagree with tool_calls");
  } finally { rmSync(s.dir, { recursive: true, force: true }); }
});

test("the anchor SPLIT needs a write — a read of the same path is not Step 2", () => {
  // locateWindow takes the FIRST match, so a future step that merely inspects the anchor before
  // Step 2 would silently become the split and fabricate the number being measured.
  const read = [
    fact("Skill", { skill: "pipeline-orchestrator" }),
    fact("Bash", { command: "cat docs/plans/x/.checkpoint/_started_at" }),
    fact("Agent"),
  ];
  assert.equal(locateWindow(read).split, null, "a read must not open Step 2");

  // Step 2's real command carries BOTH forms in one Bash call, and must still match.
  const real = [
    fact("Skill", { skill: "pipeline-orchestrator" }),
    fact("Bash", { command: "[ -f docs/plans/x/.checkpoint/_started_at ] || date -u +%s > docs/plans/x/.checkpoint/_started_at" }),
    fact("Agent"),
  ];
  assert.equal(locateWindow(real).split, 1);

  const teed = [
    fact("Skill", { skill: "pipeline-orchestrator" }),
    fact("Bash", { command: "date -u +%s | tee docs/plans/x/.checkpoint/_started_at" }),
    fact("Agent"),
  ];
  assert.equal(locateWindow(teed).split, 1, "tee writes too");
});

// ---- measureRun end to end, over a run directory on disk ------------------------------

/** A consumer's run: telemetry naming one agent, a session transcript, its subagent transcript. */
function world({ startAt = "2026-08-05T10:00:00Z", dispatchAt = "2026-08-05T10:00:20Z", anchorAt = "2026-08-05T10:00:09Z", total = 10 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-swrun-"));
  const runDir = join(dir, "docs", "plans", "add-billing");
  const projects = join(dir, "projects");
  const sid = "sess-1";
  const subagents = join(projects, "proj", sid, "subagents");
  mkdirSync(runDir, { recursive: true });
  mkdirSync(subagents, { recursive: true });
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
    task_slug: "add-billing", total_cost_usd: total,
    phases: [{ phase: "business_analysis", agent_id: "aaaa111122223333" }],
  }));
  writeFileSync(join(subagents, "agent-aaaa111122223333.jsonl"), "");

  const tool = (ts, name, input) => JSON.stringify({
    timestamp: ts, message: { role: "assistant", content: [{ type: "tool_use", name, input }] },
  });
  const priced = (id, ts) => JSON.stringify({
    timestamp: ts, message: { id, role: "assistant", model: "m-opus", usage: { cache_read_input_tokens: 1_000_000 }, content: [{ type: "text", text: "x" }] },
  });
  writeFileSync(join(projects, "proj", `${sid}.jsonl`), [
    tool("2026-08-05T09:59:00Z", "Read", { file_path: "/before" }),
    priced("m0", "2026-08-05T09:59:00Z"),
    tool(startAt, "Skill", { skill: "sdlc:pipeline-orchestrator" }),
    priced("m1", startAt),
    tool("2026-08-05T10:00:05Z", "Bash", { command: "node …/resolve/cli.mjs plan --json" }),
    priced("m2", "2026-08-05T10:00:05Z"),
    tool(anchorAt, "Bash", { command: "date -u +%s > docs/plans/add-billing/.checkpoint/_started_at" }),
    priced("m3", anchorAt),
    tool("2026-08-05T10:00:12Z", "Write", { file_path: "/brief" }),
    priced("m4", "2026-08-05T10:00:12Z"),
    tool(dispatchAt, "Agent", { subagent_type: "sdlc:business-analyst" }),
    priced("m5", dispatchAt),
    priced("m6", "2026-08-05T10:10:00Z"),
  ].join("\n"));
  return { dir, runDir, projects };
}

test("measureRun walks a real run directory to a priced window", () => {
  const w = world();
  try {
    const r = measureRun(w.runDir, { projectsRoot: w.projects, registry: REGISTRY });
    assert.equal(r.measurable, true);
    assert.equal(r.slug, "add-billing");
    assert.equal(r.window.tool_calls, 4, "Skill, Bash, Bash, Write — the dispatch is excluded");
    assert.equal(r.window.turns, 5, "m1..m5 — the dispatch's own turn IS priced (closed window)");
    assert.ok(!("m0" in (r.window.histogram ?? {})), "work before the Skill invocation is not the orchestrator's");
    assert.deepEqual(r.window.histogram, { Bash: 2, Skill: 1, Write: 1 });
    assert.equal(r.collapsible.tool_calls, 2, "Skill and the resolve call; the anchor write starts Step 2");
    assert.equal(r.collapsible.turns, 3, "m1, m2, and m3 — the anchor turn is the closing bound and IS counted");
    // 5 turns x 1M cache-read x $0.50 = $2.50 of a $10.00 run.
    assert.ok(Math.abs(r.window.cost_usd - 2.5) < 1e-9, `got ${r.window.cost_usd}`);
    assert.ok(Math.abs(r.window.share_of_run - 0.25) < 1e-9);
    assert.equal(r.run_total_cost_usd, 10);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a run whose bounds run backwards is unmeasurable, not a silent $0", () => {
  // resolveRunSessions orders sessions by file MTIME, not chronology (compliance.mjs). A run
  // resumed into an older-mtime session can put the dispatch before the Skill invocation.
  const w = world({ dispatchAt: "2026-08-05T09:00:00Z" });
  try {
    const r = measureRun(w.runDir, { projectsRoot: w.projects, registry: REGISTRY });
    assert.equal(r.measurable, false);
    assert.match(r.reason, /bounds run backwards/);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a run with no telemetry, and one with no resolvable session, are both named", () => {
  const w = world();
  try {
    rmSync(join(w.runDir, "_telemetry.json"));
    assert.match(measureRun(w.runDir, { projectsRoot: w.projects, registry: REGISTRY }).reason, /no _telemetry\.json/);
    const empty = mkdtempSync(join(tmpdir(), "sdlc-swempty-"));
    writeFileSync(join(empty, "_telemetry.json"), JSON.stringify({ phases: [] }));
    assert.match(measureRun(empty, { projectsRoot: w.projects, registry: REGISTRY }).reason, /no session transcript/);
    rmSync(empty, { recursive: true, force: true });
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a run with no priced total reports no share, and the report says the median lost a run", () => {
  const w = world({ total: 0 });
  try {
    const r = measureRun(w.runDir, { projectsRoot: w.projects, registry: REGISTRY });
    assert.equal(r.run_total_cost_usd, null, "a zero total is unknown, not free");
    assert.equal(r.window.share_of_run, null);
    const agg = aggregate([r, { ...r, slug: "other", run_total_cost_usd: 10, window: { ...r.window, share_of_run: 0.25 } }]);
    assert.equal(agg.window.turns.n, 2);
    assert.equal(agg.window.share_of_run.n, 1, "the share median has a smaller denominator");
    assert.match(renderText(agg, null), /\[n=1\]/, "and the report must say so rather than print 2 run(s) above it");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});
