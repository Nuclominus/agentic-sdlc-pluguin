// SSOT for the SDLC AAR metrics dashboard.
//
// Lives INSIDE the shipped `sdlc` plugin payload (marketplace source
// `./plugins/sdlc`) so the sdlc:aar skill can run it via
// `${CLAUDE_PLUGIN_ROOT}/tools/aar/metrics.mjs`. Dependency-free (node builtins
// only) so it needs no `node_modules` on a consumer install. The dev/CI copy at
// `tools/sdlc-lint/lib/aar-metrics.mjs` re-exports from here, so the tests
// exercise the exact code that ships.
//
// Deterministic: no Date.now()/new Date()/Math.random(). Same telemetry in →
// byte-identical dashboard out.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const num = (n) => (typeof n === "number" && isFinite(n) ? n : 0);

export function computeMetrics(tel) {
  const phases = Array.isArray(tel.phases) ? tel.phases : [];

  const by_phase = phases.map((p) => {
    const hasSplit = p.usage_source !== "subagent_aggregate";
    const billed = hasSplit
      ? (num(p.billed_tokens) || num(p.input_tokens) + num(p.output_tokens) + num(p.cached_input_tokens) + num(p.cache_creation_tokens))
      : num(p.input_tokens) + num(p.output_tokens) + num(p.subagent_tokens);
    return {
      phase: p.phase,
      aspect: p.aspect ?? null,
      agent: p.agent ?? null,
      model: p.model ?? null,
      status: p.status ?? null,
      input_tokens: num(p.input_tokens),
      output_tokens: num(p.output_tokens),
      cached_input_tokens: num(p.cached_input_tokens),
      cache_creation_tokens: num(p.cache_creation_tokens),
      subagent_tokens: num(p.subagent_tokens),
      billed_tokens: billed,
      cost_usd: p.cost_usd ?? null,
      turns: num(p.turns),
      peak_prefix_tokens: num(p.peak_prefix_tokens),
      reads_per_turn: num(p.turns) > 0 ? Math.round(num(p.cached_input_tokens) / num(p.turns)) : 0,
      cache_pressure: p.cache_pressure === true,
      heal_attempts_used: num(p.heal_attempts_used),
      heal_status: p.heal_status ?? null,
    };
  });

  // by_model — group, sum, flag unpriced; sorted by model name asc for determinism.
  const modelMap = new Map();
  for (const p of by_phase) {
    const key = p.model ?? "(unknown)";
    const m = modelMap.get(key) ?? { model: key, phases: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0, unpriced: 0 };
    m.phases += 1;
    m.cost_usd += num(p.cost_usd);
    m.input_tokens += p.input_tokens;
    m.output_tokens += p.output_tokens;
    if (p.cost_usd == null) m.unpriced += 1;
    modelMap.set(key, m);
  }
  const by_model = [...modelMap.values()].sort((a, b) => a.model < b.model ? -1 : a.model > b.model ? 1 : 0);

  // top_consumers — by total (input+output) tokens desc, label asc tiebreak, top 5.
  const top_consumers = by_phase
    .map((p) => ({
      label: p.aspect ? `${p.phase}:${p.aspect}` : p.phase,
      total_tokens: p.billed_tokens,
      cost_usd: p.cost_usd ?? null,
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
    .slice(0, 5);

  // Phases whose worst-case prefix tripped the cache-pressure flag (set at enrich
  // time). Ordered by peak desc for stable, most-severe-first reporting.
  const cache_pressure_phases = by_phase
    .filter((p) => p.cache_pressure)
    .map((p) => ({ phase: p.phase, peak_prefix_tokens: p.peak_prefix_tokens, reads_per_turn: p.reads_per_turn }))
    .sort((a, b) => b.peak_prefix_tokens - a.peak_prefix_tokens || (a.phase < b.phase ? -1 : a.phase > b.phase ? 1 : 0));

  const qa_iterations = phases.reduce((s, p) => s + num(p.qa_iterations_used), 0);
  const heal_attempts = phases.reduce((s, p) => s + num(p.heal_attempts_used), 0);
  // Phases that burned their whole heal budget without going green. These are the
  // actionable AAR finding: a mechanical failure the loop could not close.
  const heal_exhausted_phases = by_phase
    .filter((p) => p.heal_status === "exhausted")
    .map((p) => ({ phase: p.phase, heal_attempts_used: p.heal_attempts_used }))
    .sort((a, b) => (a.phase < b.phase ? -1 : a.phase > b.phase ? 1 : 0));
  const unpriced_phase_count = by_phase.filter((p) => p.cost_usd == null).length;
  const cap_breach = tel.cap_status != null && tel.cap_status !== "within";
  const post_check_failures = (Array.isArray(tel.post_pipeline_checks) ? tel.post_pipeline_checks : [])
    .filter((c) => num(c.exit_code) !== 0).length;
  const skip_rules_count = Array.isArray(tel.skip_rules_applied) ? tel.skip_rules_applied.length : 0;

  return {
    task_slug: tel.task_slug ?? null,
    stack: tel.stack ?? null,
    resumed: tel.resumed === true,
    totals: {
      input_tokens: num(tel.total_input_tokens),
      output_tokens: num(tel.total_output_tokens),
      cached_input_tokens: num(tel.total_cached_input_tokens),
      cache_creation_tokens: num(tel.total_cache_creation_tokens),
      subagent_tokens: num(tel.total_subagent_tokens),
      cost_usd: tel.total_cost_usd ?? null,
      cost_cap_usd: tel.cost_cap_usd ?? null,
      cap_status: tel.cap_status ?? null,
      cache_hit_ratio: tel.cache_hit_ratio ?? null,
      wall_clock_seconds: tel.wall_clock_seconds ?? null,
    },
    by_phase,
    by_model,
    top_consumers,
    cache_pressure_phases,
    qa_iterations,
    heal_attempts,
    heal_exhausted_phases,
    cap_breach,
    unpriced_phase_count,
    skip_rules_count,
    post_check_failures,
  };
}

export function computeMetricsFile(dirOrSlug, root = process.cwd()) {
  const direct = resolve(root, dirOrSlug);
  const dir = existsSync(join(direct, "_telemetry.json")) ? direct : join(root, "docs", "plans", dirOrSlug);
  const telPath = join(dir, "_telemetry.json");
  if (!existsSync(telPath)) {
    throw new Error(`_telemetry.json not found under ${dir}`);
  }
  return computeMetrics(JSON.parse(readFileSync(telPath, "utf8")));
}

// Direct-invocation CLI (does NOT fire on import). Prints the dashboard as JSON.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const target = process.argv[2];
  if (!target) {
    console.error("usage: metrics.mjs <slug-or-dir>");
    process.exit(2);
  } else {
    try {
      const d = computeMetricsFile(target);
      console.log(JSON.stringify(d, null, 2));
    } catch (e) {
      console.log(JSON.stringify({ ok: false, error: e.message }));
      process.exit(2);
    }
  }
}
