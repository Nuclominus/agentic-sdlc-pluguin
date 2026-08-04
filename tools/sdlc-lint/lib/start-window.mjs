// The start window: everything the orchestrator spends between being loaded and dispatching
// its first agent. This is the instrument for ADR-0019's Definition of Done.
//
// WHY THIS EXISTS AS A COMMITTED TOOL. The measurement that motivated ADR-0019 — "median 24
// turns / 14 tool calls / $1.31, 11.8% of run cost" — was produced by an ad-hoc script that was
// never committed. The number is quoted in the ADR, in planning/h5-prompt-surface and in two
// PR descriptions, and until now nobody but its author could re-derive it. An instrument whose
// results outlive the instrument is the same class of defect as issue #116 (the mtime-derived
// run dates): the finding survives, its provenance does not, and nobody can tell a real change
// from a change in how it was measured. The whole point of the DoD is a BEFORE/AFTER comparison,
// which requires both halves to come out of the same code.
//
// It re-parses nothing. `extractFactsFrom` owns the wire format, `resolveRunSessions` owns which
// transcripts belong to a run, and `extractUsage`/`priceUsage` own tokens and money. This module
// contributes exactly one thing: where the window starts, splits and ends.

import { readFileSync } from "node:fs";
import { extractFactsFrom } from "./transcript-facts.mjs";
import { resolveRunSessions } from "./compliance.mjs";
import { extractUsage, priceUsage, loadRegistry } from "../../../plugins/sdlc/tools/usage/usage.mjs";

/** The orchestrator skill, by the name a `Skill` tool_use carries. */
const ORCHESTRATOR = /(^|:)pipeline-orchestrator$/;

/** Dispatch is `Agent` in this harness and `Task` in older transcripts. Both end the window. */
const DISPATCH = new Set(["Agent", "Task"]);

/**
 * Where Step 2 begins: the machine anchor's write.
 *
 * ADR-0014 made `.checkpoint/_started_at` the run's only clock, and Step 2 writes it. That makes
 * it the one boundary in the window that is not a judgement call — everything before it is
 * resolution (Steps 0→1d, the collapsible part), everything after is workspace creation, which is
 * real work and stays. Quoting the whole window as "collapsible" overstates the lever by ~45%.
 */
const ANCHOR = /_started_at/;

const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };

/**
 * Locate the window inside an ordered fact stream.
 *
 * Returns fact indices, never timestamps — the caller converts. `end` is EXCLUSIVE: the dispatch
 * itself is the first thing the window is not.
 *
 * A run that dispatched no agent (aborted at a gate, or a `--dry-run`) has no `end`, and is
 * reported as unmeasurable rather than silently measured to the end of the transcript: a window
 * with no closing boundary is a different quantity, and averaging it in would drag the median
 * toward whatever the session did afterwards.
 */
export function locateWindow(facts) {
  const start = facts.findIndex((f) => f.tool === "Skill" && f.skill && ORCHESTRATOR.test(f.skill));
  if (start < 0) return { start: null, split: null, end: null, reason: "no pipeline-orchestrator Skill invocation" };

  const end = facts.findIndex((f, i) => i > start && DISPATCH.has(f.tool));
  if (end < 0) return { start, split: null, end: null, reason: "no agent dispatch after the Skill invocation" };

  const split = facts.findIndex((f, i) =>
    i > start && i < end && f.tool === "Bash" && f.command && ANCHOR.test(f.command));
  return { start, split: split < 0 ? null : split, end, reason: null };
}

/** Tool-use counts inside `[from, to)`, highest first — the shape of the work, not just its size. */
export function toolHistogram(facts, from, to) {
  const counts = {};
  for (let i = from; i < to; i++) {
    const t = facts[i].tool ?? "unknown";
    counts[t] = (counts[t] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

/**
 * Assistant JSONL lines in `[since, until]` — the OTHER unit, reported so published figures stay
 * reconcilable.
 *
 * Claude Code writes one line per content block of an assistant turn (a thinking block, each
 * parallel `tool_use`), every one repeating the same `message.usage`. `extractUsage` dedups on
 * `message.id`, so its `turns` is the count of real API calls. The ad-hoc script that produced
 * ADR-0019's "median 24 turns" did not dedup, and on the same corpus this instrument measures a
 * median of 9–10: **measured inflation 2.1× on `native-chat-engine-s5-presence` (21 lines / 10
 * calls).** Neither number is wrong — they are different units — but a DoD that compares "24
 * before" against an after measured in API calls would book a 2× win that never happened.
 *
 * This counts lines; it extracts no meaning from them. The wire format stays owned by
 * `transcript-facts.mjs`, which has no reason to expose a raw line count.
 */
export function countAssistantLines(sessionPaths, since, until) {
  const s = Date.parse(since), u = Date.parse(until);
  let lines = 0;
  for (const p of sessionPaths) {
    let raw;
    try { raw = readFileSync(p, "utf8"); } catch { continue; }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let d;
      try { d = JSON.parse(line); } catch { continue; }
      if (d.isSidechain) continue;
      const m = d.message;
      if (!m || m.role !== "assistant" || !m.usage || m.model === "<synthetic>") continue;
      const t = Date.parse(d.timestamp);
      if (!Number.isFinite(t) || t < s || t > u) continue;
      lines++;
    }
  }
  return lines;
}

/**
 * Price the assistant turns whose timestamp falls in `[since, until)`.
 *
 * Cache-read dominates a window like this by construction: every turn re-reads the whole prefix,
 * so the bill is (prefix size × turn count), which is exactly why removing TURNS is worth more
 * than removing TEXT. Each model's cache-read is priced with its OWN `cached_input` rate rather
 * than opus's flat $0.50/MTok — the original ad-hoc measurement assumed opus throughout, which
 * was true of its corpus and is not a property of the method.
 */
export function priceWindow(sessionPaths, since, until, registry) {
  let turns = 0, cacheRead = 0, output = 0, input = 0, cost = 0;
  let unpriced = null;
  for (const p of sessionPaths) {
    const { byModel } = extractUsage(p, { onlyMainLoop: true, since, until });
    for (const [model, u] of Object.entries(byModel)) {
      turns += u.turns;
      cacheRead += u.cache_read_tokens;
      output += u.output_tokens;
      input += u.input_tokens;
      // `priceUsage`, not arithmetic of my own. A first draft here re-derived the sum from
      // `lookupPricing` and silently omitted cache WRITES — a second implementation of the one
      // thing ADR-0011 put in one place, introduced inside the tool built to defend ADR-0019.
      const c = priceUsage(u, model, registry);
      if (c == null) { unpriced = model; continue; }
      cost += c;
    }
  }
  // An unpriceable model must not reach a comparison as a measured $0 — the same rule
  // ADR-0012 applies to a run's cap verdict.
  return { turns, cache_read_tokens: cacheRead, output_tokens: output, input_tokens: input, cost_usd: unpriced ? null : cost, unpriced_model: unpriced };
}

/**
 * Measure one run directory.
 *
 * `measurable: false` is a first-class outcome, always with a `reason`. A run whose transcripts
 * have been rotated away, or that never dispatched, is not a zero — H1's own audit learned that
 * the hard way, and a start-window corpus that silently drops such runs reports a median over a
 * denominator nobody can see.
 */
export function measureRun(runDir, { projectsRoot, registry } = {}) {
  const slug = runDir.split("/").filter(Boolean).pop();
  const tel = readJson(`${runDir}/_telemetry.json`);
  if (!tel) return { slug, dir: runDir, measurable: false, reason: "no _telemetry.json" };

  const sessions = resolveRunSessions(runDir, tel.phases ?? [], { projectsRoot });
  if (!sessions.length) return { slug, dir: runDir, measurable: false, reason: "no session transcript resolves for this run" };

  const facts = extractFactsFrom(sessions);
  const w = locateWindow(facts);
  if (w.end == null) return { slug, dir: runDir, measurable: false, reason: w.reason, sessions: sessions.length };

  const t = (i) => facts[i]?.timestamp ?? null;
  if (!t(w.start) || !t(w.end)) {
    return { slug, dir: runDir, measurable: false, reason: "window boundary carries no timestamp — cannot bound the token window" };
  }

  const reg = registry ?? loadRegistry();
  const whole = priceWindow(sessions, t(w.start), t(w.end), reg);
  whole.assistant_lines = countAssistantLines(sessions, t(w.start), t(w.end));
  const collapsible = w.split == null ? null : priceWindow(sessions, t(w.start), t(w.split), reg);
  if (collapsible) collapsible.assistant_lines = countAssistantLines(sessions, t(w.start), t(w.split));

  const runTotal = Number.isFinite(tel.total_cost_usd) && tel.total_cost_usd > 0 ? tel.total_cost_usd : null;
  const share = (c) => (runTotal != null && c != null ? c / runTotal : null);

  return {
    slug,
    dir: runDir,
    measurable: true,
    sessions: sessions.length,
    plugin_version: tel.plugin_version ?? null,
    run_total_cost_usd: runTotal,
    window: {
      tool_calls: w.end - w.start,
      ...whole,
      share_of_run: share(whole.cost_usd),
      histogram: toolHistogram(facts, w.start, w.end),
    },
    // The part ADR-0019 claims to remove. `null` when the anchor write is absent — Step 2 either
    // did not run or did not use the anchor, and guessing a split would fabricate the number the
    // whole measurement exists to establish.
    collapsible: collapsible == null ? null : {
      tool_calls: w.split - w.start,
      ...collapsible,
      share_of_run: share(collapsible.cost_usd),
      histogram: toolHistogram(facts, w.start, w.split),
    },
  };
}

function median(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

const range = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null;
};

/** Medians, ranges and a pooled histogram over the measurable runs, plus what was excluded. */
export function aggregate(rows) {
  const ok = rows.filter((r) => r.measurable);
  const pick = (sel) => ({ median: median(ok.map(sel)), range: range(ok.map(sel)) });
  const pool = (sel) => {
    const out = {};
    for (const r of ok) for (const [k, v] of Object.entries(sel(r) ?? {})) out[k] = (out[k] ?? 0) + v;
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  };
  const summary = (key) => ({
    runs: ok.filter((r) => r[key]).length,
    turns: pick((r) => r[key]?.turns),
    assistant_lines: pick((r) => r[key]?.assistant_lines),
    tool_calls: pick((r) => r[key]?.tool_calls),
    cost_usd: pick((r) => r[key]?.cost_usd),
    share_of_run: pick((r) => r[key]?.share_of_run),
    histogram: pool((r) => r[key]?.histogram),
  });
  return {
    measurable: ok.length,
    total: rows.length,
    excluded: rows.filter((r) => !r.measurable).map((r) => ({ slug: r.slug, reason: r.reason })),
    window: summary("window"),
    collapsible: summary("collapsible"),
  };
}

const money = (x) => (x == null ? "—" : `$${x.toFixed(2)}`);
const pct = (x) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const span = (r, fmt = (v) => v) => (r ? `${fmt(r.min)}–${fmt(r.max)}` : "—");

export function renderText(agg, rows) {
  const out = [];
  out.push(`start-window: ${agg.measurable}/${agg.total} run(s) measurable`);
  for (const [label, s] of [["Skill → first dispatch", agg.window], ["Steps 0→1d (before the _started_at anchor)", agg.collapsible]]) {
    if (!s.runs) { out.push(``, `  ${label}: no run carried this boundary`); continue; }
    out.push(``, `  ${label} — ${s.runs} run(s)`);
    out.push(`    turns        median ${s.turns.median ?? "—"}   range ${span(s.turns.range)}   (API calls)`);
    out.push(`    jsonl lines  median ${s.assistant_lines.median ?? "—"}   range ${span(s.assistant_lines.range)}   (the unit ADR-0019's "24" was measured in)`);
    out.push(`    tool calls   median ${s.tool_calls.median ?? "—"}   range ${span(s.tool_calls.range)}`);
    out.push(`    cost         median ${money(s.cost_usd.median)}   range ${span(s.cost_usd.range, money)}`);
    out.push(`    share of run median ${pct(s.share_of_run.median)}   range ${span(s.share_of_run.range, pct)}`);
    const hist = Object.entries(s.histogram).map(([k, v]) => `${k} ${v}`).join(", ");
    if (hist) out.push(`    tools        ${hist}`);
  }
  if (rows) {
    const ok = rows.filter((r) => r.measurable)
      .sort((a, b) => (b.collapsible?.share_of_run ?? b.window.share_of_run ?? 0) - (a.collapsible?.share_of_run ?? a.window.share_of_run ?? 0));
    if (ok.length) {
      out.push(``, `  per run, worst first:`);
      for (const r of ok) {
        const c = r.collapsible ?? r.window;
        out.push(`    ${r.slug.padEnd(28)} ${String(c.turns).padStart(3)} turns  ${String(c.tool_calls).padStart(3)} calls  ${money(c.cost_usd).padStart(7)}  ${pct(c.share_of_run).padStart(6)} of ${money(r.run_total_cost_usd)}`);
      }
    }
  }
  for (const e of agg.excluded) out.push(`  ✗ ${e.slug}: ${e.reason}`);
  return out.join("\n");
}
