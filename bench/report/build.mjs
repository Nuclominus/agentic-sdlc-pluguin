#!/usr/bin/env node
// Build bench/report/e2.html — the visual twin of bench/RESULTS.md.
// Recomputes every statistic from bench/results-headless/*.json using the
// instrument's own semantics (median midpoint, spread=(max-min)/min, peak=max
// over phases, turns=sum over phases), asserts every number named in
// RESULTS.md, then injects the data into template.html. Exits nonzero on any
// mismatch, so the page can never silently disagree with the record.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { median, spread, runMetrics } from "../compare.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = join(HERE, "..");

let failures = 0;
function check(label, actual, expected) {
  const ok = typeof expected === "number" ? Math.abs(actual - expected) < 1e-9 : actual === expected;
  if (!ok) { failures++; console.error(`ASSERT FAIL ${label}: actual=${actual} expected=${expected}`); }
  else console.log(`ok  ${label} = ${actual}`);
}

function loadDir(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

// ---- per-run rows ----------------------------------------------------------
const raw = loadDir(join(BENCH, "results-headless"));
const runs = raw.map((r) => {
  const m = runMetrics(r);
  const excluded = m.phase_count !== 5;
  return {
    id: `${r.manifest.arm}-${r.manifest.run}`,
    arm: r.manifest.arm,
    run: r.manifest.run,
    prepared_at: r.manifest.prepared_at,
    phase_count: m.phase_count,
    phase_names: r.telemetry.phases.map((p) => p.phase),
    cache_read: m.total_cache_read,
    peak_prefix: m.peak_prefix,
    turns: m.turns,
    cost_usd: m.cost_usd,
    wall_s: r.telemetry.wall_clock_seconds,
    excluded,
    exclude_reason: excluded ? "7-phase composition — config-dir leak, issue #70" : null,
  };
}).sort((x, y) => new Date(x.prepared_at) - new Date(y.prepared_at));
runs.forEach((r, i) => { r.seq = i + 1; });

check("runs total", runs.length, 20);
check("excluded runs", runs.filter((r) => r.excluded).map((r) => r.id).join(","), "a-4");

// ---- arm stats -------------------------------------------------------------
const statsOf = (rs) => {
  const cr = rs.map((r) => r.cache_read), pk = rs.map((r) => r.peak_prefix);
  return {
    n: rs.length,
    cache_read: { median: median(cr), min: Math.min(...cr), max: Math.max(...cr), spread: spread(cr) },
    peak_prefix: { median: median(pk), min: Math.min(...pk), max: Math.max(...pk), spread: spread(pk) },
    turns_median: median(rs.map((r) => r.turns)),
    turns_min: Math.min(...rs.map((r) => r.turns)),
    turns_max: Math.max(...rs.map((r) => r.turns)),
    cost_total: +rs.reduce((s, r) => s + r.cost_usd, 0).toFixed(2),
  };
};
const armRuns = (arm, includedOnly) => runs.filter((r) => r.arm === arm && (!includedOnly || !r.excluded));
const arm_stats = {
  a: { all: statsOf(armRuns("a", false)), included: statsOf(armRuns("a", true)) },
  b: { all: statsOf(armRuns("b", false)), included: statsOf(armRuns("b", true)) },
};

// RESULTS.md "Verbatim compare.mjs output" block
check("A all cache median", arm_stats.a.all.cache_read.median, 993935);
check("A all cache spread %", +(arm_stats.a.all.cache_read.spread * 100).toFixed(1), 64.2);
check("A all cache min", arm_stats.a.all.cache_read.min, 812137);
check("A all cache max", arm_stats.a.all.cache_read.max, 1333334);
check("A all peak median", arm_stats.a.all.peak_prefix.median, 35873.5);
check("A all turns median", arm_stats.a.all.turns_median, 53);
check("B cache median", arm_stats.b.all.cache_read.median, 875481.5);
check("B cache spread %", +(arm_stats.b.all.cache_read.spread * 100).toFixed(1), 55.6);
check("B cache min", arm_stats.b.all.cache_read.min, 697117);
check("B cache max", arm_stats.b.all.cache_read.max, 1084970);
check("B peak median", arm_stats.b.all.peak_prefix.median, 32449);
check("B peak min", arm_stats.b.all.peak_prefix.min, 27990);
check("B peak max (ceiling)", arm_stats.b.all.peak_prefix.max, 37191);
check("B turns median", arm_stats.b.all.turns_median, 51.5);
// RESULTS.md "Corrected for composition" table
check("A included n", arm_stats.a.included.n, 9);
check("A included cache median", arm_stats.a.included.cache_read.median, 979820);
check("A included peak median", arm_stats.a.included.peak_prefix.median, 35822);
check("A included peak min", arm_stats.a.included.peak_prefix.min, 30366);
check("A included peak max", arm_stats.a.included.peak_prefix.max, 58184);
check("A included peak spread %", Math.round(arm_stats.a.included.peak_prefix.spread * 100), 92);
check("B peak spread %", Math.round(arm_stats.b.all.peak_prefix.spread * 100), 33);
check("total cost", +(runs.reduce((s, r) => s + r.cost_usd, 0)).toFixed(2), 7.55);

// ---- deltas (included runs) ------------------------------------------------
const dOf = (k) => (arm_stats.b.included[k].median - arm_stats.a.included[k].median) / arm_stats.a.included[k].median;
const delta = {
  cache_read: dOf("cache_read"),
  peak_prefix: dOf("peak_prefix"),
  turns: (arm_stats.b.included.turns_median - arm_stats.a.included.turns_median) / arm_stats.a.included.turns_median,
};
check("delta cache %", +(delta.cache_read * 100).toFixed(2), -10.65);
check("delta peak %", +(delta.peak_prefix * 100).toFixed(1), -9.4);
check("delta turns %", +(delta.turns * 100).toFixed(1), -2.8);

// ---- convergence replay ----------------------------------------------------
// Included runs in prepared_at order; after each run, once both arms have >=1,
// delta of cache-read medians. Recorded readings from RESULTS.md marked by value.
const RECORDED = [-22.7, 22.6, -5.5, 9.9, 6.8, -4.0, -10.65];
const convergence = [];
const acc = { a: [], b: [] };
for (const r of runs.filter((x) => !x.excluded)) {
  acc[r.arm].push(r.cache_read);
  if (acc.a.length && acc.b.length) {
    const d = (median(acc.b) - median(acc.a)) / median(acc.a);
    convergence.push({
      after: r.id, seq: r.seq, nA: acc.a.length, nB: acc.b.length,
      delta: +(d * 100).toFixed(2),
      recorded: RECORDED.some((v) => Math.abs(d * 100 - v) < 0.1),
    });
  }
}
check("convergence first", convergence[0].delta, -22.65);
check("convergence last", convergence[convergence.length - 1].delta, -10.65);

// ---- per-phase stats (19 vanilla runs only) --------------------------------
const PHASES = ["business_analysis", "development", "qa", "security", "documentation"];
const vanilla = raw.filter((r) => r.telemetry.phases.length === 5);
const phase_stats = PHASES.map((name) => {
  const peaks = [], cache = [];
  for (const r of vanilla) {
    const p = r.telemetry.phases.find((x) => x.phase === name);
    peaks.push(p.peak_prefix_tokens); cache.push(p.cached_input_tokens);
  }
  return {
    phase: name, n: peaks.length,
    peak: { median: median(peaks), min: Math.min(...peaks), max: Math.max(...peaks) },
    cache_median: median(cache),
  };
});
check("phase rows n=19 each", phase_stats.every((p) => p.n === 19), true);
check("security phase max peak", phase_stats.find((p) => p.phase === "security").peak.max, 58184);

// ---- pilot (interactive, bench/results) ------------------------------------
const pilotRaw = loadDir(join(BENCH, "results"));
const pilotA = pilotRaw.filter((r) => r.manifest.arm === "a").map((r) => runMetrics(r).total_cache_read);
const pilot = { nA: pilotA.length, spread_pct: +(spread(pilotA) * 100).toFixed(1) };
check("pilot arm-a spread %", pilot.spread_pct, 42.3);

// ---- meta ------------------------------------------------------------------
const contractPct = 11800 / arm_stats.b.all.cache_read.median;
const meta = {
  date: "2026-07-26",
  arms: {
    a: { version: "sdlc@1.9.1", label: "no contract" },
    b: { version: "sdlc@1.10.0", label: "PR #68 read-discipline contract" },
  },
  n_per_arm: 10,
  total_cost_usd: 7.55,
  specimen: { files: 67, chars: 256273, tokens: 64069, ratio: 3.05 },
  dod_threshold: 60000,
  b_ceiling: arm_stats.b.all.peak_prefix.max,
  p_top_two_pct: +(((9 / 19) * (8 / 18)) * 100).toFixed(0),
  contract_cost: { tokens_per_turn: 230, est_tokens_per_run: 11800, pct_of_b_median: +(contractPct * 100).toFixed(1) },
  pilot,
  turns_range_included: (() => { const t = runs.filter((r) => !r.excluded).map((r) => r.turns); return [Math.min(...t), Math.max(...t)]; })(),
};
check("p top-two ≈21%", meta.p_top_two_pct, 21);
check("contract ≈1.3%", meta.contract_cost.pct_of_b_median, 1.3);

// ---- inject into template --------------------------------------------------
const DATA = { meta, runs, arm_stats, delta, convergence, phase_stats };
if (failures) { console.error(`\n${failures} assertion(s) FAILED — not writing output`); process.exit(1); }
const tpl = readFileSync(join(HERE, "template.html"), "utf8");
if (!tpl.includes("/*__DATA__*/")) { console.error("template placeholder missing"); process.exit(1); }
const out = join(HERE, "e2.html");
writeFileSync(out, tpl.replace("/*__DATA__*/", JSON.stringify(DATA)));
console.log(`\nwrote ${out}`);
