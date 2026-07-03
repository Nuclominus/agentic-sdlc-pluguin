// SSOT for the SDLC cross-run rollup (/sdlc:report).
//
// Lives INSIDE the shipped `sdlc` plugin payload so the /sdlc:report command can
// run it via `${CLAUDE_PLUGIN_ROOT}/tools/rollup/cli.mjs`. Dependency-free (node
// builtins only). Deterministic: no Date.now()/new Date()/Math.random(). The
// dev/CI copy at tools/sdlc-lint/lib/rollup.mjs re-exports from here.
import { computeMetrics } from "../aar/metrics.mjs";

const num = (n) => (typeof n === "number" && isFinite(n) ? n : 0);
const byNameAsc = (a, b, k) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0);

// dated asc, undated last, slug-asc tiebreak
function cmpStartedAt(a, b) {
  if (a.started_at && b.started_at) {
    if (a.started_at !== b.started_at) return a.started_at < b.started_at ? -1 : 1;
    return byNameAsc(a, b, "slug");
  }
  if (a.started_at && !b.started_at) return -1;
  if (!a.started_at && b.started_at) return 1;
  return byNameAsc(a, b, "slug");
}

export function computeRollup(runs) {
  const rows = (Array.isArray(runs) ? runs : []).map(({ slug, telemetry }) => {
    const m = computeMetrics(telemetry);
    return {
      slug: slug ?? m.task_slug ?? "(unknown)",
      started_at: telemetry.started_at ?? null,
      stack: m.stack,
      resumed: m.resumed === true,
      cost_usd: m.totals.cost_usd,
      input_tokens: num(m.totals.input_tokens),
      output_tokens: num(m.totals.output_tokens),
      cached_input_tokens: num(m.totals.cached_input_tokens),
      cache_hit_ratio: m.totals.cache_hit_ratio,
      cap_status: m.totals.cap_status,
      cost_cap_usd: m.totals.cost_cap_usd,
      cap_breach: m.cap_breach,
      qa_iterations: num(m.qa_iterations),
      skip_rules_count: num(m.skip_rules_count),
      phase_count: m.by_phase.length,
      unpriced: m.unpriced_phase_count > 0,
      _by_phase: m.by_phase,
      _by_model: m.by_model,
      _skips: Array.isArray(telemetry.skip_rules_applied) ? telemetry.skip_rules_applied : [],
    };
  }).sort(cmpStartedAt);

  let costSum = 0, anyCost = false, inSum = 0, outSum = 0, cachedSum = 0;
  let capBreaches = 0, skipRules = 0, qaIters = 0, unpricedRuns = 0;
  for (const r of rows) {
    if (r.cost_usd != null) { costSum += r.cost_usd; anyCost = true; }
    inSum += r.input_tokens;
    outSum += r.output_tokens;
    cachedSum += r.cached_input_tokens;
    if (r.cap_breach) capBreaches += 1;
    skipRules += r.skip_rules_count;
    qaIters += r.qa_iterations;
    if (r.unpriced) unpricedRuns += 1;
  }

  const modelMap = new Map();
  for (const r of rows) {
    for (const m of r._by_model) {
      const e = modelMap.get(m.model) ?? { model: m.model, runs: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0, unpriced: 0 };
      e.runs += 1;
      e.cost_usd += num(m.cost_usd);
      e.input_tokens += num(m.input_tokens);
      e.output_tokens += num(m.output_tokens);
      e.unpriced += num(m.unpriced);
      modelMap.set(m.model, e);
    }
  }
  const by_model = [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd || byNameAsc(a, b, "model"));

  const phaseMap = new Map();
  for (const r of rows) {
    for (const p of r._by_phase) {
      const e = phaseMap.get(p.phase) ?? { phase: p.phase, runs: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 };
      e.runs += 1;
      e.cost_usd += num(p.cost_usd);
      e.input_tokens += num(p.input_tokens);
      e.output_tokens += num(p.output_tokens);
      phaseMap.set(p.phase, e);
    }
  }
  const by_phase = [...phaseMap.values()].sort((a, b) => b.cost_usd - a.cost_usd || byNameAsc(a, b, "phase"));

  let cum = 0;
  const cost_over_time = rows.map((r) => { cum += num(r.cost_usd); return { slug: r.slug, started_at: r.started_at, cost_usd: r.cost_usd, cumulative_usd: cum }; });
  const cache_trend = rows.map((r) => ({ slug: r.slug, started_at: r.started_at, cache_hit_ratio: r.cache_hit_ratio }));

  const qa_distribution = {};
  for (const r of rows) { const k = String(r.qa_iterations); qa_distribution[k] = (qa_distribution[k] ?? 0) + 1; }

  const cap_breach_incidents = rows.filter((r) => r.cap_breach).map((r) => ({ slug: r.slug, cap_status: r.cap_status, cost_usd: r.cost_usd, cost_cap_usd: r.cost_cap_usd }));
  const skips = [];
  for (const r of rows) for (const s of r._skips) skips.push({ slug: r.slug, phase_skipped: s.phase_skipped, rule: s.rule });

  const publicRows = rows.map(({ _by_phase, _by_model, _skips, cost_cap_usd, cached_input_tokens, ...pub }) => pub);

  return {
    run_count: rows.length,
    runs: publicRows,
    totals: {
      cost_usd: anyCost ? costSum : null,
      input_tokens: inSum,
      output_tokens: outSum,
      cache_hit_ratio_weighted: inSum > 0 ? cachedSum / inSum : null,
      cap_breaches: capBreaches,
      skip_rules: skipRules,
      qa_iterations: qaIters,
      unpriced_runs: unpricedRuns,
    },
    by_model,
    by_phase,
    cost_over_time,
    cache_trend,
    qa_distribution,
    incidents: { cap_breaches: cap_breach_incidents, skips },
  };
}
