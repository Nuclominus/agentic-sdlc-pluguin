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

  const by_phase = phases.map((p) => ({
    phase: p.phase,
    aspect: p.aspect ?? null,
    agent: p.agent ?? null,
    model: p.model ?? null,
    status: p.status ?? null,
    input_tokens: num(p.input_tokens),
    output_tokens: num(p.output_tokens),
    cached_input_tokens: num(p.cached_input_tokens),
    cost_usd: p.cost_usd ?? null,
  }));

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
      total_tokens: p.input_tokens + p.output_tokens,
      cost_usd: p.cost_usd ?? null,
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
    .slice(0, 5);

  const qa_iterations = phases.reduce((s, p) => s + num(p.qa_iterations_used), 0);
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
      cost_usd: tel.total_cost_usd ?? null,
      cost_cap_usd: tel.cost_cap_usd ?? null,
      cap_status: tel.cap_status ?? null,
      cache_hit_ratio: tel.cache_hit_ratio ?? null,
      wall_clock_seconds: tel.wall_clock_seconds ?? null,
    },
    by_phase,
    by_model,
    top_consumers,
    qa_iterations,
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
