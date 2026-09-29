// ADR-0036 — skill sets: the per-role matrix a plugin authors for an EXTERNAL skill catalog.
//
// A foundation declares `skill_sets: [{ file }]` in its manifest; each file assigns catalog
// skills to core roles (policy + dispatch-scoped `when`, optionally gated by `applies_if`). This
// module turns those files into ordinary `role_expertise` skill rows, so everything downstream —
// dedupe, downgrade, rendering, compliance — treats them exactly like hand-written rows.
//
// The core knows nothing about any particular catalog. What it learns here is generic:
//
//   - rows are BARE ids (a catalog CLI installs `r8-analyzer`, not `android-skills:r8-analyzer`),
//     so ownership travels explicitly as `requires: <set>` instead of being inferred from a prefix;
//   - a gated-off row is not rendered at all, so a project without CameraX never carries the
//     `camerax` line in its stable prefix;
//   - the same file tells deps.mjs which skills the dependency actually uses here
//     (`applicableSkills` — gated like the rows, so a skill no role receives in this project is
//     not "missing") and which host tools each one needs (`skillTools`) — one file, two readers.
//
// The authoring invariants (scope guard, triage markers, render drift) are lint's job
// (tools/sdlc-lint/lib/skill-sets.mjs). This module is lenient on purpose: a malformed row is
// skipped, never fatal, because a typo in one plugin's matrix must not abort every run.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml } from "./yaml.mjs";
import { evalRule, dependencyPresent } from "./detect.mjs";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Parse one skill-set file. `null` (with a WARN) when unreadable or not a skill set. */
export function readSkillSet(file, warnings = []) {
  let doc;
  try { doc = parseYaml(readFileSync(file, "utf8")); }
  catch (e) { warnings.push(`WARN: skill set ${file} unreadable: ${e.message} — ignored`); return null; }
  if (!isObj(doc) || typeof doc.set !== "string" || !Array.isArray(doc.skills)) {
    warnings.push(`WARN: ${file} is not a skill set (needs \`set\` and \`skills\`) — ignored`);
    return null;
  }
  return doc;
}

/** A manifest's `skill_sets` declarations, loaded relative to the manifest's directory. */
export function loadSkillSets(manifestDir, decls, warnings = []) {
  const out = [];
  for (const d of Array.isArray(decls) ? decls : []) {
    const rel = typeof d === "string" ? d : d?.file;
    if (typeof rel !== "string" || !rel.trim()) continue;
    const doc = readSkillSet(join(manifestDir ?? "", rel), warnings);
    if (doc) out.push(doc);
  }
  return out;
}

/** Ids of a set's skills that at least one role receives — what the dependency actually uses. */
export function assignedSkills(doc) {
  return (doc?.skills ?? [])
    .filter((s) => isObj(s) && typeof s.id === "string" && isObj(s.roles) && Object.keys(s.roles).length > 0)
    .map((s) => s.id);
}

/** `{ skillId: [tool, …] }` for every assigned skill that declares `requires_tools`. */
export function skillTools(doc) {
  const out = {};
  for (const s of doc?.skills ?? []) {
    if (!isObj(s) || !isObj(s.roles) || !Array.isArray(s.requires_tools) || s.requires_tools.length === 0) continue;
    out[s.id] = s.requires_tools.filter((t) => typeof t === "string" && t);
  }
  return out;
}

/**
 * Directories a gate never walks. A gate asks about the project's OWN sources; build outputs and
 * vendored trees are the slowest part of a `**` walk and the likeliest false match — a React
 * Native checkout carries `build.gradle` files under `node_modules` pinning an AGP the app itself
 * left behind.
 */
export const GATE_SKIP_DIRS = new Set(["build", ".gradle", ".kotlin", ".cxx", ".git", ".idea", "node_modules"]);

/**
 * Evaluate an `applies_if` gate: detect.mjs's closed grammar plus `{ dependency: <coord> }`,
 * which is looked up where the foundation says to look (`framework_detection`) — the same
 * place, and the same substring rule, a framework's own `dependency` uses.
 *
 * `cache` (a Map) memoizes by rule: 25 skills share about a dozen distinct gates, and the preflight
 * and the role rows ask the same questions of the same tree in one run. Pass one Map per run —
 * never a module-level one, which would outlive a project edit.
 */
export function evalGate(rule, { projectRoot, detectionPaths = [], cache = null }) {
  if (rule == null) return true;
  if (!isObj(rule)) return false;
  const key = cache ? `${projectRoot}\0${detectionPaths.join("\0")}\0${JSON.stringify(rule)}` : null;
  if (key !== null && cache.has(key)) return cache.get(key);
  const ctx = { projectRoot, detectionPaths, cache };
  const opts = { skipDirs: GATE_SKIP_DIRS };
  let v;
  if ("dependency" in rule) v = dependencyPresent(projectRoot, detectionPaths, rule.dependency, opts);
  else if ("any" in rule) v = Array.isArray(rule.any) && rule.any.some((r) => evalGate(r, ctx));
  else if ("all" in rule) v = Array.isArray(rule.all) && rule.all.every((r) => evalGate(r, ctx));
  else v = evalRule(rule, projectRoot, opts);
  if (key !== null) cache.set(key, v);
  return v;
}

/** The gate one role's row answers to: its own `applies_if` when it has one, else the skill's. */
const roleGate = (s, a) => (isObj(a) && "applies_if" in a ? a.applies_if : s.applies_if);

/**
 * Ids of the assigned skills at least one role receives IN THIS PROJECT — what the dependency
 * needs installed here. A skill gated off for every role (no CameraX → no `camerax`) is not
 * needed, so its absence must not mark the catalog degraded.
 */
export function applicableSkills(doc, gateCtx) {
  return (doc?.skills ?? [])
    .filter((s) => isObj(s) && typeof s.id === "string" && isObj(s.roles))
    .filter((s) => Object.values(s.roles).some((a) => isObj(a) && evalGate(roleGate(s, a), gateCtx)))
    .map((s) => s.id);
}

/**
 * `{ role: [{ skill, policy, when, requires }] }` for the rows that apply to THIS project.
 *
 * `policy` defaults to `recommended` in a skill set (a manifest row defaults to `mandatory`): a
 * catalog is mostly optional knowledge, and a mandate there has to be written out. A role-level
 * `applies_if` replaces the skill-level one for that role, so a skill can be ungated for the
 * analyst who decides whether to adopt a library and gated for the developer who only needs it
 * once the library is in the build.
 */
export function skillSetRoleRows(sets, { projectRoot, detectionPaths = [], cache = new Map() } = {}) {
  const out = {};
  for (const doc of sets ?? []) {
    for (const s of doc.skills ?? []) {
      if (!isObj(s) || typeof s.id !== "string" || !isObj(s.roles)) continue;
      for (const [role, a] of Object.entries(s.roles)) {
        if (!isObj(a)) continue;
        if (!evalGate(roleGate(s, a), { projectRoot, detectionPaths, cache })) continue;
        (out[role] ??= []).push({
          skill: s.id,
          policy: a.policy === "mandatory" ? "mandatory" : "recommended",
          when: typeof a.when === "string" ? a.when : "",
          requires: doc.set,
        });
      }
    }
  }
  return out;
}
