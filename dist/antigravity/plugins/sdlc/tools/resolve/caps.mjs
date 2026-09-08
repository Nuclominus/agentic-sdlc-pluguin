// Step 1d — resolve the cost cap, and (under --dry-run) estimate what the resolved plan costs.
//
// TWO PROPERTIES THE PROSE INSISTS ON, AND THIS MODULE PRESERVES:
//
// 1. The cap is resolved in exactly ONE place. Everything downstream reads the resolved value.
//    That single-source property is what makes the Step 3d-cap gate auditable, and an override
//    applied twice would break it — so resolveCostCap is the only function that decides.
//
// 2. An estimate and an actual differ only in their TOKEN COUNTS, never in how those tokens
//    are valued. The pricing formula here mirrors priceUsage in tools/usage/usage.mjs, and the
//    baselines come from config/models.json rather than being restated — the registry is their
//    single source of truth, and a second copy would drift the moment either is retuned.
//
// The estimate is an ESTIMATE. Real cost comes from the transcript (ADR-0005/0011). The
// baselines exist because the pre-2026-07 model was wrong in SHAPE, not magnitude: it assumed
// one dispatch was one API call, when a phase is a multi-turn loop whose every turn re-reads
// the accumulated prefix. It under-reported by 6–10×, which is how shipped recipe caps came to
// sit below their own median run.

const ASPECT_ORDER = ["database", "backend", "frontend", "testing"];
const DEV_MULTIPLIER = 5.4;      // measured: median development spend vs. the tier baseline, 9 runs
const GATE_WEIGHT = 0.5;         // a gated phase costs est(G) or exactly $0; weight it half
const LOOP_EXPECTED_ROUNDS = 0.5;  // ~1.5 rounds -> one extra half-pass of (L + R)
const HEAL_EXPECTED_RATE = 0.3;
const isPlainObject = (x) => x != null && typeof x === "object" && !Array.isArray(x);

/**
 * 1d-0 — the cap, resolved once.
 *
 * The project override uses an OWN-KEY test, never truthiness: `cost_caps: {hotfix: null}` is a
 * deliberate "uncapped in this project" and must beat a shipped cap, while a missing key must
 * not. An override REPLACES the recipe's number; it is never combined with it, because a
 * "safest of the two" rule would silently ignore half of what the project asked for.
 */
export function resolveCostCap({ recipe, workflowName, costCaps = {} } = {}) {
  let value = recipe?.caps?.max_total_cost_usd;
  if (typeof value !== "number") value = null;
  let source = "recipe";

  if (Object.prototype.hasOwnProperty.call(costCaps, workflowName)) {
    value = costCaps[workflowName];
    source = `project:${workflowName}`;
  } else if (Object.prototype.hasOwnProperty.call(costCaps, "*")) {
    value = costCaps["*"];
    source = "project:*";
  }
  return { cost_cap: value ?? null, cost_cap_source: source };
}

/** The verbatim 1d-0 line — printed only when the project, not the recipe, decided the cap. */
export function renderCapOverridePrint({ cost_cap, cost_cap_source }, recipe) {
  if (cost_cap_source === "recipe") return null;
  const was = typeof recipe?.caps?.max_total_cost_usd === "number" ? recipe.caps.max_total_cost_usd : "none";
  return `🔧 Cost cap overridden by .claude/sdlc.local.yaml: ${cost_cap ?? "none (uncapped)"} (was ${was}) — via ${cost_cap_source}`;
}

/** Price one dispatch's baseline with the registry's own rates — the usage.mjs formula. */
export function priceBaseline(registry, tier) {
  const baseline = registry?.estimation_baselines?.[tier];
  const model = (registry?.models ?? []).find((m) => m.tag === tier);
  if (!baseline || !model?.pricing) return null;
  const p = model.pricing;
  const mult = registry?.cache_write_multipliers?.ephemeral_5m ?? 1.25;
  return (baseline.input / 1e6) * p.input
    + (baseline.cache_read / 1e6) * p.cached_input
    + (baseline.cache_write / 1e6) * p.input * mult
    + (baseline.output / 1e6) * p.output;
}

/**
 * Step 3b-3's tier precedence, as a pure lookup. No agent is spawned.
 * per-agent override -> project default -> agent frontmatter -> sonnet.
 */
export function resolveTier(agent, { modelOverrides = {}, frontmatterTiers = {} } = {}) {
  const bare = String(agent ?? "").includes(":") ? String(agent).split(":").pop() : agent;
  return modelOverrides.agents?.[bare]
    ?? modelOverrides.default
    ?? frontmatterTiers[bare]
    ?? "sonnet";
}

/**
 * 1d-1 step 2 — expand the resolved plan into one row per DISPATCH.
 *
 * Parallelism saves wall-clock, not tokens, so a parallel group expands to its members. An
 * aspect-aware phase expands to one row per aspect in canonical order. Loop and heal produce
 * no extra rows — their cost enters through the totals, not the table.
 */
export function expandRows(phases, { agentsPerPhase = {}, aspects = [], modelOverrides, frontmatterTiers, resumedDone = new Set() } = {}) {
  const rows = [];
  const push = (phase, agent, extra = {}) => {
    const tier = resolveTier(agent, { modelOverrides, frontmatterTiers });
    const key = extra.aspect ? `${phase}:${extra.aspect}` : phase;
    rows.push({ phase, agent, tier, resumed: resumedDone.has(key) || resumedDone.has(phase), ...extra });
  };

  const aspectsOf = (mapping) =>
    ASPECT_ORDER.filter((a) => a in mapping)
      .concat(Object.keys(mapping).filter((a) => !ASPECT_ORDER.includes(a)).sort());

  for (const entry of phases) {
    if (Array.isArray(entry.parallel)) {
      // A parallel member is a bare phase name in the schema, but the phase it names can still
      // be aspect-aware — so it fans out here too. Missing that printed the agent map itself as
      // `[object Object]` in a real dry run.
      for (const member of entry.parallel) {
        const mapping = agentsPerPhase[member];
        if (isPlainObject(mapping)) for (const aspect of aspectsOf(mapping)) push(member, mapping[aspect], { aspect, parallel: true });
        else push(member, mapping, { parallel: true });
      }
      continue;
    }
    const mapping = agentsPerPhase[entry.name];
    if (isPlainObject(mapping)) {
      for (const aspect of aspectsOf(mapping)) push(entry.name, mapping[aspect], { aspect, loop: entry.loop, gate: entry.gate, heal: entry.heal });
      continue;
    }
    push(entry.name, mapping, { loop: entry.loop, gate: entry.gate, heal: entry.heal });
  }
  return rows;
}

/**
 * 1d-1 steps 3–4 — per-row estimates and the two totals.
 *
 * `healEnabled` is not a style choice: healing cannot fire without a check to run, so a `heal:`
 * block over an empty `heal_checks` list must add exactly $0 rather than a phantom estimate for
 * work that can never happen. That is the vanilla-stack case, and it is why generic recipes'
 * heal blocks do not inflate an estimate on a stack that cannot use them.
 */
export function estimate(rows, registry, { healEnabled = false } = {}) {
  const priced = rows.map((row) => {
    const base = priceBaseline(registry, row.tier);
    if (base == null) return { ...row, est: null, unpriced: true };
    if (row.resumed) return { ...row, est: 0, raw: base };
    let est = base;
    if (row.phase === "development") est *= DEV_MULTIPLIER;
    if (row.gate) est *= GATE_WEIGHT;
    return { ...row, est, raw: base };
  });

  const baseTotal = priced.reduce((s, r) => s + (r.est ?? 0), 0);
  const estOf = (name) => priced.filter((r) => r.phase === name && !r.resumed).reduce((s, r) => s + (r.est ?? 0), 0);

  let loopExpected = 0, loopWorst = 0;
  for (const r of priced) {
    if (!r.loop?.return_to || r.resumed) continue;
    const pair = estOf(r.phase) + estOf(r.loop.return_to);
    loopExpected += LOOP_EXPECTED_ROUNDS * pair;
    loopWorst += Math.max(0, (r.loop.max_rounds ?? 1) - 1) * pair;
  }

  let healExpected = 0, healWorst = 0;
  const loopedPhases = new Set(priced.flatMap((r) => (r.loop ? [r.phase, r.loop.return_to] : [])));
  if (healEnabled) {
    for (const r of priced) {
      if (!r.heal || r.resumed) continue;
      // est(H) is the SINGLE-dispatch raw baseline of one aspect's agent — never the phase
      // multiplier, never summed across aspects. A heal attempt is one implement-only dispatch.
      const single = r.raw ?? 0;
      const looped = loopedPhases.has(r.phase);
      const avgRounds = looped ? 1.5 : 1;
      const worstRounds = looped ? (priced.find((x) => x.loop && (x.phase === r.phase || x.loop.return_to === r.phase))?.loop.max_rounds ?? 1) : 1;
      const weight = r.gate ? GATE_WEIGHT : 1;
      healExpected += weight * avgRounds * HEAL_EXPECTED_RATE * single;
      healWorst += worstRounds * (r.heal.max_attempts ?? 2) * single;
    }
  }

  const gatedRestore = priced.reduce((s, r) => s + (r.gate && !r.resumed ? (r.est ?? 0) : 0), 0);

  return {
    rows: priced,
    base_total: baseTotal,
    expected_total: baseTotal + loopExpected + healExpected,
    worst_total: baseTotal + loopWorst + healWorst + gatedRestore,
    unpriced: priced.filter((r) => r.unpriced).length,
  };
}

/** The `WITHIN` / `EXCEEDS` verdict, computed from expected_total only. */
export function capVerdict(expectedTotal, cap) {
  if (cap == null) return { verdict: "WITHIN", cap_estimate: "within", over: 0 };
  return expectedTotal <= cap
    ? { verdict: "WITHIN", cap_estimate: "within", over: 0 }
    : { verdict: `⚠️ EXCEEDS by $${(expectedTotal - cap).toFixed(2)}`, cap_estimate: "exceeds", over: expectedTotal - cap };
}

const money = (n) => `$${(n ?? 0).toFixed(2)}`;

/** 1d-2 — the human dry-run block. Segments concatenate; only `‖ parallel` is exclusive. */
export function renderDryRun({ estimate: est, slots, stack, workflow, autoselected, skipRules = [], cap, healEnabled, healBlocks = 0 }) {
  const lines = [
    "🔎 DRY RUN — no agents dispatched, no code written.",
    `Stack: ${stack} | Workflow: ${workflow}${autoselected ? " (auto-selected)" : ""}`,
    `Phases (${slots}):`,
  ];
  est.rows.forEach((r, i) => {
    if (r.resumed) {
      lines.push(`   ${i + 1}. ⏩ ${r.phase}${r.aspect ? ` — ${r.aspect}` : ""}   → skipped (resumed from checkpoint)   $0.00`);
      return;
    }
    const flags = [
      r.parallel ? "  ‖ parallel" : "",
      r.loop ? `  loops ⇄ ${r.loop.return_to}, ≤${r.loop.max_rounds}×` : "",
      r.heal && healEnabled ? `  🔧 heals ≤${r.heal.max_attempts}×` : "",
      r.gate ? "  (gated)" : "",
    ].join("");
    lines.push(`   ${i + 1}. ${r.phase}${r.aspect ? ` — ${r.aspect}` : ""}    → ${r.agent} (${r.tier})   ~${money(r.est)}${flags}`);
  });
  lines.push(`Skip-rules applied: ${skipRules.length ? skipRules.map((s) => s.rule).join(", ") : "none"}`);
  if (healBlocks > 0 && !healEnabled) {
    lines.push(`⚙ Healing inactive on this stack — ${healBlocks} guarded phase(s) carry a heal: block, but the active profile supplies no heal_checks. Set heal_checks in .claude/sdlc.local.yaml to enable it.`);
  }
  lines.push(`Estimated cost: ~${money(est.expected_total)}  (worst-case ${money(est.worst_total)})`);
  const v = capVerdict(est.expected_total, cap);
  lines.push(`Cap: ${cap == null ? "none" : money(cap)}  → ${v.verdict}`);
  return lines.join("\n");
}

/**
 * 1d-3 — the headless line.
 *
 * The key is `cap_estimate`, deliberately NOT `cap_status`: this is a verdict on the pre-run
 * ESTIMATE, while `cap_status` in _telemetry.json records what enforcement actually did. One
 * key carrying two vocabularies would force every CI consumer to disambiguate them.
 */
export function renderHeadlessDryRun({ estimate: est, slots, workflow, cap, resumed = false, reenterAt = null }) {
  const v = capVerdict(est.expected_total, cap);
  const payload = {
    dry_run: true,
    workflow,
    phases: slots,
    estimated_cost_usd: Number(est.expected_total.toFixed(2)),
    worst_case_usd: Number(est.worst_total.toFixed(2)),
    cap_usd: cap ?? null,
    cap_estimate: v.cap_estimate,
    ...(resumed ? { resumed: true, reenter_at: reenterAt } : {}),
  };
  return JSON.stringify(payload);
}
