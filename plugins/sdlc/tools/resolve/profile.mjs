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

import { existsSync } from "node:fs";
import { join } from "node:path";

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
  const warnings = [];
  const orderedAdditive = [...additive].sort((a, b) => String(a.stack).localeCompare(String(b.stack)));
  const stackProfiles = uniq([primary, ...Object.values(active)].filter(Boolean));

  // ADR-0021: agents live in the core. A foundation that still binds its own roster is IGNORED —
  // the schema now forbids the key outright, so reaching here means a stale or third-party manifest.
  // Honoring it would dispatch a roster that no longer ships — a retired name resolves to no agent
  // file, so the failure would land at dispatch rather than here. `rosterOf` is what enforces the
  // rule; this loop is only the report.
  const rosterIgnored = new Set();
  for (const p of stackProfiles) {
    if (p === vanilla || p?.stack === "vanilla") continue;
    if (isPlainObject(p?.agents_per_phase) && Object.keys(p.agents_per_phase).length) {
      rosterIgnored.add(p);
      warnings.push(`WARN: foundation '${p.stack}' declares agents_per_phase — ignored (ADR-0021): the roster and its phase bindings live only in the core manifest; declare role_expertise instead. Run /sdlc:doctor if this project's own config still names the retired agents.`);
    }
  }
  /** The roster a profile may contribute: none, unless it is the core. */
  const rosterOf = (p) => (p && !rosterIgnored.has(p) ? p.agents_per_phase ?? {} : {});

  // Agents: aspect-agnostic phases come from the primary, falling back to vanilla. Additive
  // profiles are never consulted for agent selection.
  const agents = {};
  for (const phase of ASPECT_AGNOSTIC) {
    const fromPrimary = rosterOf(primary)[phase];
    const fromVanilla = vanilla?.agents_per_phase?.[phase];
    const chosen = fromPrimary ?? fromVanilla;
    if (chosen != null) agents[phase] = chosen;
  }
  // Aspect-aware phases fan out per aspect; everything else stays a flat agent name.
  //
  // The set is NOT "anything not aspect-agnostic". Step 1a names it exactly: `development`
  // always, plus any phase a profile declares AS a per-aspect mapping. An earlier draft made
  // every remaining phase an aspect map, which turned a flat `test: <agent>` into
  // `{android: <agent>}` — harmless in the merge, and printed as `[object Object]` the moment a
  // dry-run row read the agent. Real project data caught it; synthetic fixtures did not.
  const isAspectAware = (phase, mapping) => phase === "development" || isPlainObject(mapping);
  for (const [aspect, profile] of Object.entries(active)) {
    for (const [phase, mapping] of Object.entries(rosterOf(profile))) {
      if (ASPECT_AGNOSTIC.includes(phase)) continue;
      if (!isAspectAware(phase, mapping)) continue;
      const agent = isPlainObject(mapping) ? mapping[aspect] : mapping;
      if (agent == null) continue;
      if (!isPlainObject(agents[phase])) agents[phase] = {};
      agents[phase][aspect] = agent;
    }
  }
  // Any remaining phase the primary declares flatly and no aspect claimed.
  for (const [phase, mapping] of Object.entries(rosterOf(primary))) {
    if (phase in agents) continue;
    agents[phase] = mapping;
  }
  for (const [phase, mapping] of Object.entries(vanilla?.agents_per_phase ?? {})) {
    if (!(phase in agents)) agents[phase] = mapping;
  }
  // A core (vanilla) FLAT binding for the always-aspect-aware phase still fans out over the
  // active aspects — `development — android → developer` keeps the row shape dry-run, telemetry
  // and the per-call `aspect:` trailer have always had, now that the foundation binds nothing.
  const activeAspects = Object.keys(active);
  if (typeof agents.development === "string" && activeAspects.length) {
    agents.development = Object.fromEntries(activeAspects.map((a) => [a, agents.development]));
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
      // An extra phase names the CORE role that runs it — the only way a foundation adds a
      // phase now that it binds no agents of its own.
      if (typeof ph.agent === "string" && ph.agent && !(ph.name in agents)) agents[ph.name] = ph.agent;
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
    warnings,
  };
}

const POLICY_RANK = { mandatory: 2, recommended: 1 };

/** One `role_expertise.<role>.skills[]` row, normalised. `policy` defaults to mandatory. */
function normalizeSkillRow(row) {
  if (typeof row === "string") return { skill: row, policy: "mandatory", when: "" };
  if (!isPlainObject(row) || typeof row.skill !== "string" || !row.skill.trim()) return null;
  return {
    skill: row.skill.trim(),
    policy: row.policy === "recommended" ? "recommended" : "mandatory",
    when: typeof row.when === "string" ? row.when : "",
  };
}

/**
 * Collapse rows to one per skill id — strictest policy wins and brings its own `when`.
 *
 * Two rows of EQUAL policy are the common case (an `agents: [developer]` row plus an
 * `agents: "all"` row naming the same skill), and resolving them by arrival order would let the
 * order of `sdlc.local.yaml` change the prompt — the stable prefix is cache-keyed on its bytes.
 * The tie-break is therefore stated: a row that says WHEN beats one that does not, then the
 * alphabetically-first `when` wins.
 */
function dedupeSkills(rows) {
  const out = new Map();
  for (const row of rows) {
    if (!row) continue;
    const prev = out.get(row.skill);
    if (!prev) { out.set(row.skill, { ...row }); continue; }
    if (POLICY_RANK[row.policy] > POLICY_RANK[prev.policy]) { out.set(row.skill, { ...row }); continue; }
    if (POLICY_RANK[row.policy] < POLICY_RANK[prev.policy]) continue;
    const a = prev.when ?? "", b = row.when ?? "";
    if (a === b) continue;
    if (!a || (b && b < a)) out.set(row.skill, { ...row });
  }
  return [...out.values()];
}

/**
 * 1a-expertise (ADR-0021) — merge every active manifest's `role_expertise` into one map keyed
 * by CORE role name.
 *
 * `sources` is `[{stack, dir, role_expertise}]`; the first entry is the primary foundation and
 * stays first, the rest are ordered alphabetically by `stack` — the same order `phase_injections`
 * concatenate in, so an Android developer reads the foundation's invariants before Dagger's
 * before Room's regardless of filesystem order. Rule paths are relative to the manifest's own
 * directory and come out absolute: the core agent that reads them lives in a different plugin,
 * where `${CLAUDE_PLUGIN_ROOT}` would resolve to the wrong root. A rule file that does not exist
 * is dropped with a warning rather than handed to an agent as a dead `Read`.
 */
export function mergeRoleExpertise(sources = []) {
  const warnings = [];
  const roleExpertise = {};
  const [first, ...rest] = sources.filter(Boolean);
  const ordered = [first, ...rest.sort((a, b) => String(a.stack).localeCompare(String(b.stack)))].filter(Boolean);

  for (const src of ordered) {
    for (const [role, decl] of Object.entries(src.role_expertise ?? {})) {
      if (!isPlainObject(decl)) continue;
      const acc = roleExpertise[role] ?? (roleExpertise[role] = { invariants: "", rules: [], skills: [] });

      if (typeof decl.invariants === "string" && decl.invariants.trim()) {
        acc.invariants = acc.invariants ? `${acc.invariants}\n\n${decl.invariants.trim()}` : decl.invariants.trim();
      }

      for (const r of arr(decl.rules)) {
        const rel = typeof r === "string" ? r : r?.path;
        if (typeof rel !== "string" || !rel.trim()) continue;
        const abs = join(src.dir ?? "", rel);
        if (!existsSync(abs)) {
          warnings.push(`WARN: role_expertise.${role}.rules: ${rel} not found under ${src.stack} — dropped`);
          continue;
        }
        if (acc.rules.some((x) => x.path === abs)) continue;
        acc.rules.push({ path: abs, note: typeof r === "object" && typeof r?.note === "string" ? r.note : "" });
      }

      acc.skills = dedupeSkills([...acc.skills, ...arr(decl.skills).map(normalizeSkillRow)]);
    }
  }
  return { role_expertise: roleExpertise, warnings };
}

/**
 * The `Stack expertise for <role>` block the orchestrator pastes into the stable prefix, and
 * `resolve/cli.mjs expertise --role` prints for an on-demand agent. `null` when the role has
 * neither invariants nor rule files — an empty header would break prefix byte-stability for the
 * roles a stack says nothing about.
 */
export function renderRoleExpertiseBlock(role, exp, { stack = "unknown" } = {}) {
  if (!isPlainObject(exp)) return null;
  const invariants = typeof exp.invariants === "string" ? exp.invariants.trim() : "";
  const rules = arr(exp.rules).filter((r) => isPlainObject(r) && r.path);
  if (!invariants && rules.length === 0) return null;
  const lines = [`Stack expertise for ${role} (${stack}):`];
  if (invariants) lines.push(invariants);
  if (rules.length) {
    lines.push("Rule files (Read the ones your task touches):");
    for (const r of rules) lines.push(r.note ? `- ${r.path} — ${r.note}` : `- ${r.path}`);
  }
  return lines.join("\n");
}

/**
 * The single definition of "this skill cannot be invoked here, so stop calling it MANDATORY".
 *
 * Both authors of a skill row go through this: the project's `extensions.skills` (1b-ext) and the
 * stack profile's `role_expertise.<role>.skills` (3b-1a). Keeping one copy is deliberate — the
 * defect PR-1's review found was two copies of one rule disagreeing about which spelling a step
 * was keyed on, and a downgrade rule that lived twice would rot the same way.
 *
 * Returns the row unchanged when there is no availability data to judge it by.
 */
function downgradeIfMissing(row, { availableSkills = null, unavailablePlugins = null, warnings = [], where = "role_expertise" } = {}) {
  if (!availableSkills && !unavailablePlugins) return row;
  const pluginOf = row.skill.includes(":") ? row.skill.split(":")[0] : null;
  const pluginDown = pluginOf && unavailablePlugins ? unavailablePlugins[`${pluginOf}_unavailable`] === true : false;
  const notListed = availableSkills ? !availableSkills.has(row.skill) : false;
  if (!pluginDown && !notListed) return row;
  warnings.push(`WARN: ${where} ${row.skill} not installed — downgraded to recommended`);
  return {
    ...row,
    policy: "recommended",
    when: `${row.when}${row.when ? " " : ""}(skill not installed — best-effort)`,
  };
}

/**
 * Step 3b-1a as code — the one deduped skill list an agent receives: the stack profile's
 * `role_expertise.<role>.skills` plus the project's `extensions.skills` rows that target it
 * (`agents` contains the name, or is `"all"`). Strictest policy wins per skill id, mandatory
 * rows render first, alphabetical within each group; `null` when nothing targets the agent.
 *
 * A role row whose plugin the deps preflight flagged unavailable is DOWNGRADED to `recommended`,
 * the same way `parseExtensionSkills` downgrades a project's own row: a MANDATORY line for a skill
 * that cannot be invoked either stalls the agent or teaches it that MANDATORY is negotiable — the
 * compliance damage H1 measured.
 *
 * `unavailablePlugins` (the preflight's `<name>_unavailable` flags) is the ONLY signal used here,
 * deliberately — NOT the enumerated `availableSkills` that judges an extension row. The enumeration
 * describes the INSTALLED plugin cache, while a `role_expertise` row is authored by a manifest in
 * the tree being resolved: on any checkout whose cache lags the tree (a marketplace working copy,
 * a fresh clone, `--mode tree` in CI) every one of the foundation's own skills enumerates as
 * missing and would be downgraded, while a genuinely-absent external dependency that happens to be
 * installed stays MANDATORY — precisely inverted. The preflight flag is plugin-scoped and derived
 * from `runtime-dependencies.json`, so it answers the question actually being asked: "is the
 * plugin this row depends on usable in this session?" A plugin's own skills ship with it and are
 * never in question. With no flags at all the rows render exactly as authored — absent evidence is
 * not evidence of absence.
 */
export function renderSkillsBlock(agent, {
  roleSkills = [], extensionRows = [], unavailablePlugins = null, warnings = [],
} = {}) {
  const targeted = extensionRows.filter((r) => r && (r.agents === "all" || arr(r.agents).includes(agent)));
  // Extension rows arrive already downgraded (1b-ext); only the profile's own rows need it here.
  const own = roleSkills.map(normalizeSkillRow).map((r) => downgradeIfMissing(r, { unavailablePlugins, warnings }));
  const rows = dedupeSkills([...own, ...targeted.map(normalizeSkillRow)]);
  if (rows.length === 0) return null;
  rows.sort((a, b) => (POLICY_RANK[b.policy] - POLICY_RANK[a.policy]) || a.skill.localeCompare(b.skill));
  const lines = ["Skills for this role (from the active stack profile and this project's .claude/sdlc.local.yaml):"];
  for (const r of rows) {
    const when = r.when ? ` — ${r.when}` : "";
    lines.push(r.policy === "mandatory"
      ? `- MANDATORY — invoke \`${r.skill}\`${when}. Do not skip; this project requires it.`
      : `- RECOMMENDED — consider invoking \`${r.skill}\`${when}.`);
  }
  return lines.join("\n");
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
 *
 * An agent name that matches nothing is REPORTED, never translated (ADR-0021). The roster was
 * renamed and ships no aliases; a rewrite here would have to agree with the dispatch name, the
 * tier lookup and the model-enforcement hook, and every place those disagreed was a defect.
 * `/sdlc:doctor` migrates the file instead. Validation is skipped when no roster is supplied —
 * the parser must never guess which names are real.
 */
export function parseExtensionSkills(raw, { availableSkills = null, unavailablePlugins = {}, knownAgents = null } = {}, warnings = []) {
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
    let agents = agentsRaw === "all" ? "all" : uniq(arr(agentsRaw).filter((a) => typeof a === "string" && a.trim()));
    if (agents !== "all" && agents.length === 0) {
      warnings.push(`WARN: extensions.skills[${i}] (${skill}) has no 'agents' — dropped`);
      return;
    }
    if (agents !== "all" && knownAgents && knownAgents.size) {
      const kept = agents.filter((a) => {
        if (knownAgents.has(a)) return true;
        warnings.push(`WARN: extensions.skills[${i}] targets unknown agent '${a}' — no agent by that name is dispatched; run /sdlc:doctor to migrate this file`);
        return false;
      });
      if (kept.length === 0) {
        warnings.push(`WARN: extensions.skills[${i}] (${skill}) targets no known agent — dropped`);
        return;
      }
      agents = kept;
    }

    let policy = "recommended";
    if (row.policy != null && row.policy !== "") {
      if (row.policy === "mandatory" || row.policy === "recommended") policy = row.policy;
      else warnings.push(`WARN: extensions.skills[${i}] (${skill}) unknown policy '${row.policy}' — using recommended`);
    }

    const when = typeof row.when === "string" ? row.when : "";
    const judged = downgradeIfMissing({ skill, when, policy },
      { availableSkills, unavailablePlugins, warnings, where: "extensions.skills" });

    rows.push({ skill, agents, when: judged.when, policy: judged.policy });
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
    // The roster to validate against is what this run can actually dispatch, plus the core's own
    // on-demand roles — a name matching neither matches nothing, and that is the only case worth
    // reporting. Supplied by the caller so this module stays free of manifest knowledge.
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
/**
 * 0b — the active-profile contract print.
 *
 * The deleted prose called this "a contract with the user": without it nobody can verify which
 * foundation won, at what priority, or which frameworks attached. Restored here because the
 * command is now the only thing that knows those values — a run that prints nothing about its
 * stack leaves the user unable to tell a wrong detection from a right one.
 *
 * The per-aspect rows the prose carried are deliberately NOT reproduced: this command resolves
 * one foundation, so five rows reading either "android" or "—" would state a per-aspect
 * resolution that did not happen. The aspects the winner declares are listed instead.
 */
export function renderStackPrint(stack) {
  if (!stack || !stack.foundation) return null;
  const source = stack.source ?? "unknown";
  const list = (xs) => (arr(xs).length ? arr(xs).join(", ") : "—");
  return [
    "🎯 Active stack profiles:",
    `   primary:  ${stack.foundation} (priority ${stack.priority ?? 0}, from ${source})`,
    `   aspects:  ${list(stack.aspects)}`,
    `   additive: ${list(stack.additive)}`,
    `   forced via --stack: ${stack.forced ? "yes" : "no"}`,
  ].join("\n");
}

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
export function parseModelOverrides(raw, { validTiers = DEFAULT_TIERS, knownAgents = null } = {}) {
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
      // An unknown agent NAME is a no-op entry, not a corrupt file: it cannot mis-tier anything,
      // so it is dropped and reported rather than failing the whole map closed the way a bad tier
      // does. Never translated — see parseExtensionSkills and ADR-0021.
      if (knownAgents && knownAgents.size && !knownAgents.has(agent)) {
        warnings.push(`WARN: .claude/model.local.json names unknown agent '${agent}' — no agent by that name is dispatched; run /sdlc:doctor to migrate this file`);
        continue;
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
