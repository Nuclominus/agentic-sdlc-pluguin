// Step 1 — merge the active profiles, then apply the project's local overrides.
//
// Covers 1a (profile merge), 1b (sdlc.local.yaml), 1b-caps, 1b-ext and 1b-models. Workflow
// resolution (1c) follows RESOLVER.md and lives in its own module — it is a different
// problem (locate, validate, order) and folding it in here would make one unit own two.
//
// THE RULE THAT SHAPES EVERYTHING BELOW: local override parsing is **graceful — never
// abort**. A project's optional configuration file must not be able to stop a run; the
// plugin profile is always a usable fallback. Every validation failure here therefore drops
// the offending entry, records a warning, and continues. The one exception the prose does
// make — a conflicting `extra_phases` name — is a plugin-authoring error, not a project one.

const ASPECT_AGNOSTIC = ["business_analysis", "security", "documentation"];
const DEFAULT_TIERS = ["opus", "sonnet", "haiku", "fable"];

const uniq = (xs) => [...new Set(xs)];
const arr = (x) => (Array.isArray(x) ? x : []);
const isPlainObject = (x) => x != null && typeof x === "object" && !Array.isArray(x);

/**
 * 1a — build EFFECTIVE_PROFILE from the primary profile, the per-aspect winners and the
 * additive framework providers.
 *
 * `active` maps aspect -> profile doc. `additive` are framework providers, which never supply
 * agents (guarded in 0b) and are ordered alphabetically by `stack` wherever their contributions
 * concatenate, so the merged result does not depend on filesystem order.
 */
export function mergeProfiles({ primary, active = {}, additive = [], vanilla = null } = {}) {
  const errors = [];
  const orderedAdditive = [...additive].sort((a, b) => String(a.stack).localeCompare(String(b.stack)));
  const stackProfiles = uniq([primary, ...Object.values(active)].filter(Boolean));

  // Agents: aspect-agnostic phases come from the primary, falling back to vanilla. Additive
  // profiles are never consulted for agent selection.
  const agents = {};
  for (const phase of ASPECT_AGNOSTIC) {
    const fromPrimary = primary?.agents_per_phase?.[phase];
    const fromVanilla = vanilla?.agents_per_phase?.[phase];
    const chosen = fromPrimary ?? fromVanilla;
    if (chosen != null) agents[phase] = chosen;
  }
  // Aspect-aware phases: collect each aspect's own agent for that phase.
  for (const [aspect, profile] of Object.entries(active)) {
    for (const [phase, mapping] of Object.entries(profile?.agents_per_phase ?? {})) {
      if (ASPECT_AGNOSTIC.includes(phase)) continue;
      const agent = isPlainObject(mapping) ? mapping[aspect] : mapping;
      if (agent == null) continue;
      if (!isPlainObject(agents[phase])) agents[phase] = {};
      agents[phase][aspect] = agent;
    }
  }
  // Any remaining phase the primary declares flatly and no aspect claimed.
  for (const [phase, mapping] of Object.entries(primary?.agents_per_phase ?? {})) {
    if (phase in agents) continue;
    agents[phase] = mapping;
  }
  for (const [phase, mapping] of Object.entries(vanilla?.agents_per_phase ?? {})) {
    if (!(phase in agents)) agents[phase] = mapping;
  }

  const conventionSkills = uniq([...stackProfiles, ...orderedAdditive].flatMap((p) => arr(p?.convention_skills)));

  const injections = {};
  for (const p of [...stackProfiles, ...orderedAdditive]) {
    for (const [phase, text] of Object.entries(p?.phase_injections ?? {})) {
      if (typeof text !== "string" || text.trim() === "") continue;
      injections[phase] = injections[phase] ? `${injections[phase]}\n\n${text}` : text;
    }
  }

  const extraPhases = [];
  const seenPhaseNames = new Set();
  for (const p of [...stackProfiles, ...orderedAdditive]) {
    for (const ph of arr(p?.extra_phases)) {
      if (!ph?.name) continue;
      if (seenPhaseNames.has(ph.name)) {
        errors.push({ code: "extra_phase_conflict", message: `extra_phases declares '${ph.name}' more than once` });
        continue;
      }
      seenPhaseNames.add(ph.name);
      extraPhases.push(ph);
    }
  }

  // PRIMARY first, then the other stack profiles, then additive — de-duplicated, order kept.
  const ordered = [primary, ...stackProfiles.filter((p) => p !== primary), ...orderedAdditive].filter(Boolean);
  const postChecks = uniq(ordered.flatMap((p) => arr(p?.post_pipeline_checks)));
  const healChecks = uniq(ordered.flatMap((p) => arr(p?.heal_checks)));

  return {
    profile: {
      agents_per_phase: agents,
      convention_skills: conventionSkills,
      phase_prompts_injection: injections,
      extra_phases: extraPhases,
      post_pipeline_checks: postChecks,
      heal_checks: healChecks,
      phase_command_overrides: {},
      skip_phases: [],
      extension_skills: [],
      cost_caps: {},
      profile_default_workflow: primary?.workflow ?? null,
    },
    errors,
  };
}

/**
 * 1b-caps — a per-recipe cap override.
 *
 * `null` is a VALUE, not an absence: it is the only way a project can opt a recipe out of a
 * shipped cap, so it must survive parsing intact. An unknown recipe name is not an error —
 * recipes come from every installed plugin plus the project, the set is open, and a project
 * may legitimately carry entries for recipes this run does not use.
 */
export function parseCostCaps(raw, warnings = []) {
  const out = {};
  if (raw === undefined) return out;
  if (!isPlainObject(raw)) {
    warnings.push("WARN: cost_caps must be a mapping — ignored");
    return out;
  }
  for (const [name, value] of Object.entries(raw)) {
    if (value === null) { out[name] = null; continue; }
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) { out[name] = value; continue; }
    warnings.push(`WARN: cost_caps.${name} must be a number or null — ignored, using the recipe's own cap`);
  }
  return out;
}

/**
 * 1b-ext — the Project Extension Manifest's per-agent skill mapping.
 *
 * A missing skill DOWNGRADES the row to `recommended` rather than dropping or blocking it: a
 * project must never be stopped because an optional extension skill is absent.
 */
export function parseExtensionSkills(raw, { availableSkills = null, unavailablePlugins = {} } = {}, warnings = []) {
  const rows = [];
  if (raw === undefined) return rows;
  if (!isPlainObject(raw) || !Array.isArray(raw.skills)) {
    if (raw !== null) warnings.push("WARN: extensions must be a mapping with a 'skills' array — ignored");
    return rows;
  }
  raw.skills.forEach((row, i) => {
    const skill = typeof row?.skill === "string" ? row.skill.trim() : "";
    if (!skill) { warnings.push(`WARN: extensions.skills[${i}] missing 'skill' — dropped`); return; }

    const agentsRaw = row.agents;
    const agents = agentsRaw === "all" ? "all" : arr(agentsRaw).filter((a) => typeof a === "string" && a.trim());
    if (agents !== "all" && agents.length === 0) {
      warnings.push(`WARN: extensions.skills[${i}] (${skill}) has no 'agents' — dropped`);
      return;
    }

    let policy = "recommended";
    if (row.policy != null && row.policy !== "") {
      if (row.policy === "mandatory" || row.policy === "recommended") policy = row.policy;
      else warnings.push(`WARN: extensions.skills[${i}] (${skill}) unknown policy '${row.policy}' — using recommended`);
    }

    let when = typeof row.when === "string" ? row.when : "";
    const pluginOf = skill.includes(":") ? skill.split(":")[0] : null;
    const pluginDown = pluginOf ? unavailablePlugins[`${pluginOf}_unavailable`] === true : false;
    const notListed = availableSkills ? !availableSkills.has(skill) : false;
    if (pluginDown || notListed) {
      policy = "recommended";
      when = `${when}${when ? " " : ""}(skill not installed — best-effort)`;
      warnings.push(`WARN: extensions.skills ${skill} not installed — downgraded to recommended`);
    }

    rows.push({ skill, agents, when, policy });
  });
  return rows;
}

/**
 * 1b — apply the project's overrides to a merged profile.
 *
 * Returns a NEW profile; the caller keeps the plugin profile intact so a parse failure can
 * fall back to it without having to undo a partial mutation.
 */
export function applyLocalOverrides(profile, local, opts = {}) {
  const warnings = [];
  const applied = {};
  const next = {
    ...profile,
    convention_skills: [...profile.convention_skills],
    phase_prompts_injection: { ...profile.phase_prompts_injection },
    post_pipeline_checks: [...profile.post_pipeline_checks],
    heal_checks: [...profile.heal_checks],
    phase_command_overrides: { ...profile.phase_command_overrides },
  };
  if (local == null) return { profile: next, warnings, applied };
  if (!isPlainObject(local)) {
    warnings.push("⚠️ .claude/sdlc.local.yaml is not a mapping. Continuing with plugin defaults.");
    return { profile: next, warnings, applied };
  }

  if (Array.isArray(local.post_pipeline_checks)) {
    next.post_pipeline_checks = local.post_pipeline_checks.filter((c) => typeof c === "string");
    applied.post_pipeline_checks = `replaced (${next.post_pipeline_checks.length} items)`;
  }
  if (Array.isArray(local.heal_checks)) {
    next.heal_checks = local.heal_checks.filter((c) => typeof c === "string");
    applied.heal_checks = `replaced (${next.heal_checks.length} items)`;
  }
  if (isPlainObject(local.phase_command_overrides)) {
    const paths = [];
    for (const [phase, keys] of Object.entries(local.phase_command_overrides)) {
      if (!isPlainObject(keys)) { warnings.push(`WARN: phase_command_overrides.${phase} must be a mapping — ignored`); continue; }
      next.phase_command_overrides[phase] = { ...(next.phase_command_overrides[phase] ?? {}), ...keys };
      for (const k of Object.keys(keys)) paths.push(`${phase}.${k}`);
    }
    if (paths.length) applied.phase_command_overrides = paths.join(", ");
  }
  if (isPlainObject(local.extra_phase_prompts)) {
    const phases = [];
    for (const [phase, text] of Object.entries(local.extra_phase_prompts)) {
      if (typeof text !== "string" || text.trim() === "") continue;
      const base = next.phase_prompts_injection[phase];
      next.phase_prompts_injection[phase] = base ? `${base}\n\n${text}` : text;
      phases.push(phase);
    }
    if (phases.length) applied.extra_phase_prompts = phases.join(", ");
  }
  if (Array.isArray(local.skip_phases)) {
    next.skip_phases = local.skip_phases.filter((p) => typeof p === "string");
    if (next.skip_phases.length) applied.skip_phases = next.skip_phases.join(", ");
  }
  if (Array.isArray(local.convention_skills_extra)) {
    const extra = local.convention_skills_extra.filter((s) => typeof s === "string");
    next.convention_skills = uniq([...next.convention_skills, ...extra]);
    if (extra.length) applied.convention_skills_extra = extra.join(", ");
  }
  if ("extensions" in local) {
    next.extension_skills = parseExtensionSkills(local.extensions, opts, warnings);
    if (next.extension_skills.length) {
      const mandatory = next.extension_skills.filter((r) => r.policy === "mandatory").length;
      applied["extensions.skills"] = `${next.extension_skills.length} rule(s); ${mandatory} mandatory, ${next.extension_skills.length - mandatory} recommended`;
    }
  }
  if ("cost_caps" in local) {
    next.cost_caps = parseCostCaps(local.cost_caps, warnings);
    const n = Object.keys(next.cost_caps).length;
    if (n) applied.cost_caps = `${n} override(s)`;
  }

  return { profile: next, warnings, applied };
}

/** The verbatim 1b block — emitted only when something was actually overridden. */
export function renderOverridesPrint(applied) {
  const keys = Object.keys(applied ?? {});
  if (keys.length === 0) return null;
  return ["🔧 Local overrides applied from .claude/sdlc.local.yaml:", ...keys.map((k) => `   ${k}: ${applied[k]}`)].join("\n");
}

/**
 * 1b-models — project-local model tier overrides.
 *
 * Fail-open in the strongest sense: ONE bad tier discards the whole file, because a partially
 * applied tier map is harder to reason about than none at all, and the agent frontmatter tiers
 * are always usable.
 */
export function parseModelOverrides(raw, { validTiers = DEFAULT_TIERS } = {}) {
  const warnings = [];
  const empty = { overrides: {}, warnings };
  if (raw == null) return empty;
  if (!isPlainObject(raw)) {
    warnings.push("⚠️ Failed to parse .claude/model.local.json: not an object. Continuing with agent frontmatter tiers.");
    return empty;
  }
  const out = {};
  if (raw.default !== undefined) {
    if (!validTiers.includes(raw.default)) {
      warnings.push(`⚠️ Failed to parse .claude/model.local.json: unknown tier '${raw.default}'. Continuing with agent frontmatter tiers.`);
      return empty;
    }
    out.default = raw.default;
  }
  if (raw.agents !== undefined) {
    if (!isPlainObject(raw.agents)) {
      warnings.push("⚠️ Failed to parse .claude/model.local.json: 'agents' is not an object. Continuing with agent frontmatter tiers.");
      return empty;
    }
    const agents = {};
    for (const [agent, tier] of Object.entries(raw.agents)) {
      if (!validTiers.includes(tier)) {
        warnings.push(`⚠️ Failed to parse .claude/model.local.json: unknown tier '${tier}' for '${agent}'. Continuing with agent frontmatter tiers.`);
        return empty;
      }
      agents[agent] = tier;
    }
    out.agents = agents;
  }
  return { overrides: out, warnings };
}

/** The verbatim 1b-models block. */
export function renderModelPrint(overrides) {
  if (!overrides || (overrides.default === undefined && Object.keys(overrides.agents ?? {}).length === 0)) return null;
  const lines = ["🔧 Model tier overrides loaded from .claude/model.local.json:", `   default: ${overrides.default ?? "(none)"}`];
  for (const [agent, tier] of Object.entries(overrides.agents ?? {})) lines.push(`   ${agent}: ${tier}`);
  return lines.join("\n");
}
