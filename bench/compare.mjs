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
    phase_count: m.by_phase.length,
  };
}

/**
 * Per-arm provenance consistency: a "clean" run is only comparable with
 * another run of the same arm if both actually came from the same build. With
 * fewer than two runs there is nothing to disagree, so it is trivially
 * consistent.
 */
export function checkProvenance(runs) {
  if (runs.length < 2) return { consistent: true, versions: [], shas: [] };
  const versions = [...new Set(runs.map((r) => r.manifest.plugin_version))];
  const shas = [...new Set(runs.map((r) => r.manifest.marketplace_sha))];
  return { consistent: versions.length <= 1 && shas.length <= 1, versions, shas };
}

/**
 * True when clean runs, sorted by prepared_at, alternate arms throughout —
 * i.e. no run-order block like A A A B B B, which would let anything that
 * drifts over time (machine load, cache warmth, fatigue) masquerade as an
 * arm effect.
 */
export function isInterleaved(runs) {
  const sorted = [...runs].sort((a, b) => new Date(a.manifest.prepared_at) - new Date(b.manifest.prepared_at));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].manifest.arm === sorted[i - 1].manifest.arm) return false;
  }
  return true;
}

/** Count of loaded results harvested with the live provenance check turned off. */
export function countSkippedLiveCheck(results) {
  return results.filter((r) => r.live_check === "skipped").length;
}

/**
 * The `--pilot` recommendation. Fewer than two clean runs means no spread was
 * ever observed — that is absence of evidence, not perfect stability, and
 * must not be rendered as a green light to proceed at N=3.
 */
export function pilotAdvice(cacheReads) {
  if (cacheReads.length < 2) return { available: false, runs: cacheReads.length };
  const s = spread(cacheReads);
  return { available: true, spread: s, ...recommendN(s) };
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

  const skippedLiveCheck = countSkippedLiveCheck(all);
  if (skippedLiveCheck) {
    console.log(`WARNING: ${skippedLiveCheck} of ${all.length} loaded result(s) were harvested with the live ` +
                `provenance check skipped (BENCH_SKIP_LIVE_CHECK=1) and are unvalidated against live state.`);
  }

  for (const [name, rs] of [["a", A], ["b", B]]) {
    if (!rs.length) { console.log(`arm ${name}: no clean runs`); continue; }
    const cr = rs.map((m) => m.total_cache_read), pk = rs.map((m) => m.peak_prefix);
    console.log(`arm ${name}  n=${rs.length}`);
    console.log(`  cache-read  median ${median(cr).toLocaleString()}  range ${Math.min(...cr).toLocaleString()}..${Math.max(...cr).toLocaleString()}  spread ${(spread(cr) * 100).toFixed(1)}%`);
    console.log(`  peak-prefix median ${median(pk).toLocaleString()}  range ${Math.min(...pk).toLocaleString()}..${Math.max(...pk).toLocaleString()}`);
    console.log(`  turns       median ${median(rs.map((m) => m.turns))}`);
    console.log(`  phases      per-run ${rs.map((m) => m.phase_count).join(", ")} (a run count mismatch means the difference may be composition, not the thing under test)`);
  }

  const noise = Math.max(spread(A.map((m) => m.total_cache_read)), spread(B.map((m) => m.total_cache_read)));

  if (pilot) {
    const advice = pilotAdvice(A.map((m) => m.total_cache_read));
    if (!advice.available) {
      console.log(`\npilot: arm a has ${advice.runs} clean run(s) — no recommendation available. ` +
                  `A spread needs at least two runs to observe; zero or one is absence of evidence, not stability.`);
      return;
    }
    console.log(`\npilot: observed arm-a spread ${(advice.spread * 100).toFixed(1)}% (a LOWER BOUND, not a point estimate)`);
    console.log(`       ${advice.action}`);
    return;
  }

  // Provenance guards. A verdict is only as good as the claim that each arm's
  // clean runs actually came from the same build, run in an order that does
  // not let time confound arm.
  let suppressVerdict = false;
  for (const [name, rs] of [["a", byArm.a], ["b", byArm.b]]) {
    const prov = checkProvenance(rs);
    if (!prov.consistent) {
      suppressVerdict = true;
      console.log(`\nWARNING: arm ${name}'s clean runs do not share provenance — a mixed arm is not an arm.`);
      if (prov.versions.length > 1) console.log(`  plugin_version varies: ${prov.versions.join(", ")}`);
      if (prov.shas.length > 1) console.log(`  marketplace_sha varies: ${prov.shas.join(", ")}`);
    }
  }
  if (clean.length > 1 && !isInterleaved(clean)) {
    console.log(`\nWARNING: run order is not interleaved when sorted by prepared_at — arm is confounded ` +
                `with time (machine load, cache warmth, drift). Treat the verdict below with corresponding suspicion.`);
  }

  if (suppressVerdict) {
    console.log(`\nverdict suppressed: at least one arm's clean runs disagree on provenance — fix that before comparing.`);
    return;
  }

  const v = verdict(A.map((m) => m.total_cache_read), B.map((m) => m.total_cache_read), noise);
  console.log(`\nverdict (engineering judgement, not a statistical test): ${v.reason}`);
  const pkB = B.map((m) => m.peak_prefix);
  if (pkB.length) console.log(`E2 DoD (<60k peak prefix): arm b median ${median(pkB).toLocaleString()}, range ${Math.min(...pkB).toLocaleString()}..${Math.max(...pkB).toLocaleString()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
