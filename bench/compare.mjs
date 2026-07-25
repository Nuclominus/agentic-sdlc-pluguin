#!/usr/bin/env node
// Compare the two benchmark arms.
//
// Reports medians, ranges and a labelled engineering verdict — never a
// p-value. At N=3 per arm the smallest achievable two-sided p from an exact
// rank test is about 0.10; at N=4 about 0.03 and only under perfect
// separation. No result at this budget can reach p<0.05, whatever the data
// show, so claiming significance would be false precision.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeMetrics } from "../plugins/sdlc/tools/aar/metrics.mjs";

export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function spread(xs) {
  if (xs.length < 2) return 0;
  const min = Math.min(...xs);
  return min === 0 ? 0 : (Math.max(...xs) - min) / min;
}

/** Per-run metrics: a sum for cost, a max for the DoD figure. */
export function runMetrics(result) {
  const m = computeMetrics(result.telemetry);
  return {
    total_cache_read: m.totals.cached_input_tokens,
    peak_prefix: Math.max(0, ...m.by_phase.map((p) => p.peak_prefix_tokens)),
    turns: m.by_phase.reduce((n, p) => n + p.turns, 0),
    cost_usd: m.totals.cost_usd,
  };
}

/**
 * Map an observed within-arm spread to a run count.
 * The spread is a LOWER BOUND — two observations give one range from an
 * unknown distribution — so these are the minimum defensible response, not a
 * measurement of the true spread.
 */
export function recommendN(observedSpread) {
  if (observedSpread < 0.10) return { n: 3, action: "proceed with N=3 per arm" };
  if (observedSpread < 0.25) return { n: 4, action: "proceed with N=4 per arm" };
  return {
    n: null,
    action: "STOP. Remediate before continuing: raise N, pin model tiers, or enlarge the task. " +
            "Never reduce the task — that erodes the effect along with the noise.",
  };
}

/** Engineering verdict. `moved: null` means no verdict is available. */
export function verdict(armA, armB, noise) {
  if (armA.length < 3 || armB.length < 3) {
    return { moved: null, delta: null, reason: `no verdict: need at least 3 unflagged runs per arm, have ${armA.length} and ${armB.length}` };
  }
  const a = median(armA), b = median(armB);
  const delta = a === 0 ? 0 : (b - a) / a;
  if (Math.abs(delta) <= noise) {
    return { moved: false, delta, reason: `no measurable effect at this task size: the ${(delta * 100).toFixed(1)}% difference is within the observed ${(noise * 100).toFixed(1)}% run-to-run spread` };
  }
  return { moved: true, delta, reason: `arms differ by ${(delta * 100).toFixed(1)}%, beyond the observed ${(noise * 100).toFixed(1)}% run-to-run spread` };
}

function loadResults(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

function main() {
  const i = process.argv.indexOf("--results");
  const dir = resolve(i === -1 ? "bench/results" : process.argv[i + 1]);
  const pilot = process.argv.includes("--pilot");

  const all = loadResults(dir);
  const dropped = all.filter((r) => r.flags?.length);
  const clean = all.filter((r) => !r.flags?.length);
  const byArm = { a: [], b: [] };
  for (const r of clean) byArm[r.manifest.arm]?.push(r);

  const metricsOf = (rs) => rs.map(runMetrics);
  const A = metricsOf(byArm.a), B = metricsOf(byArm.b);

  if (dropped.length) console.log(`dropped ${dropped.length} flagged run(s): ${dropped.map((r) => `${r.manifest.arm}-${r.manifest.run}`).join(", ")}`);

  for (const [name, rs] of [["a", A], ["b", B]]) {
    if (!rs.length) { console.log(`arm ${name}: no clean runs`); continue; }
    const cr = rs.map((m) => m.total_cache_read), pk = rs.map((m) => m.peak_prefix);
    console.log(`arm ${name}  n=${rs.length}`);
    console.log(`  cache-read  median ${median(cr).toLocaleString()}  range ${Math.min(...cr).toLocaleString()}..${Math.max(...cr).toLocaleString()}  spread ${(spread(cr) * 100).toFixed(1)}%`);
    console.log(`  peak-prefix median ${median(pk).toLocaleString()}  range ${Math.min(...pk).toLocaleString()}..${Math.max(...pk).toLocaleString()}`);
    console.log(`  turns       median ${median(rs.map((m) => m.turns))}`);
  }

  const noise = Math.max(spread(A.map((m) => m.total_cache_read)), spread(B.map((m) => m.total_cache_read)));

  if (pilot) {
    const rec = recommendN(spread(A.map((m) => m.total_cache_read)));
    console.log(`\npilot: observed arm-a spread ${(spread(A.map((m) => m.total_cache_read)) * 100).toFixed(1)}% (a LOWER BOUND, not a point estimate)`);
    console.log(`       ${rec.action}`);
    return;
  }

  const v = verdict(A.map((m) => m.total_cache_read), B.map((m) => m.total_cache_read), noise);
  console.log(`\nverdict (engineering judgement, not a statistical test): ${v.reason}`);
  const pkB = B.map((m) => m.peak_prefix);
  if (pkB.length) console.log(`E2 DoD (<60k peak prefix): arm b median ${median(pkB).toLocaleString()}, range ${Math.min(...pkB).toLocaleString()}..${Math.max(...pkB).toLocaleString()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
