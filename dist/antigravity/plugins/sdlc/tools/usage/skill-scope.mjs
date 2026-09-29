// ADR-0037 — off-matrix skill use is AUDITED, not blocked.
//
// Claude Code has no per-subagent skill ACL: a skill installed for the user is invocable by every
// subagent, whatever the matrix says. The matrix (ADR-0036) therefore decides only what each role
// is TOLD to use. This module measures what each role actually used, after the fact, from the one
// record that cannot be argued with — the subagent's own transcript.
//
// A `Skill` call is judged only when it names a catalog skill (a key of the scope). Everything
// else — superpowers, a convention skill, a user's own skill — is none of the matrix's business
// and is not counted either way. A catalog call then lands in exactly one bucket:
//
//   in_scope    the dispatching role is assigned that skill;
//   off_role    another role is, this one is not (a security-analyst loading `adaptive`);
//   unassigned  no role is (the matrix triaged it out, e.g. a niche form factor).
//
// Shipped, dependency-free, fail-open: an unresolvable transcript makes a dispatch unjudged,
// never a violation.

import { readFileSync } from "node:fs";
import { findAgentTranscript, checkpointAgentId } from "./usage.mjs";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Every `Skill` tool call in one transcript, in order — the skill id exactly as invoked. */
export function skillCallsIn(jsonlPath) {
  let raw;
  try { raw = readFileSync(jsonlPath, "utf8"); } catch { return null; }
  const out = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const content = d?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type === "tool_use" && b.name === "Skill" && typeof b.input?.skill === "string") out.push(b.input.skill);
    }
  }
  return out;
}

/** `sdlc:developer` → `developer`: a dispatch names the agent; the prefix is an install detail. */
export const roleOf = (agent) => String(agent ?? "").slice(String(agent ?? "").lastIndexOf(":") + 1);

/**
 * The catalog skill an invocation refers to, or null. A catalog installs bare (`r8-analyzer`) or,
 * through its plugin route, under the set's own name (`android-skills:r8-analyzer`). Another
 * plugin's `foo:styles` is NOT the catalog's `styles` — a namespaced id matches only its own set.
 */
function catalogSkill(invoked, scope) {
  const i = invoked.lastIndexOf(":");
  if (i < 0) return isObj(scope[invoked]) ? invoked : null;
  const id = invoked.slice(i + 1);
  return isObj(scope[id]) && scope[id].set === invoked.slice(0, i) ? id : null;
}

/**
 * Judge each dispatch's catalog calls against the static matrix.
 *
 * @param {object} args
 * @param {object} args.scope       `{ skillId: { set, roles[] } }` (resolve/skillsets.mjs `skillScope`)
 * @param {Array}  args.dispatches  `[{ agent, agent_id?, skills: string[] | null }]` — `null` skills
 *                                  means the transcript could not be read: unjudged, not clean.
 */
export function auditSkillScope({ scope, dispatches }) {
  const res = { dispatches_judged: 0, dispatches_unjudged: 0, catalog_calls: 0, in_scope: 0, off_role: [], unassigned: [] };
  if (!isObj(scope) || Object.keys(scope).length === 0) return null;
  for (const d of dispatches ?? []) {
    if (!Array.isArray(d?.skills)) { res.dispatches_unjudged += 1; continue; }
    res.dispatches_judged += 1;
    const role = roleOf(d.agent);
    // One verdict per (dispatch, skill): loading the same skill twice is one decision, not two.
    for (const id of new Set(d.skills.map((s) => catalogSkill(s, scope)).filter(Boolean))) {
      res.catalog_calls += 1;
      const entry = scope[id];
      const who = { agent: role, agent_id: d.agent_id ?? null, skill: id, set: entry.set };
      if (entry.roles.includes(role)) res.in_scope += 1;
      else if (entry.roles.length === 0) res.unassigned.push(who);
      else res.off_role.push({ ...who, allowed_roles: entry.roles });
    }
  }
  return res;
}

/**
 * The run-level audit the seal records: each phase's subagent(s), their own `Skill` calls, judged.
 * An agent id shared by two phases (a resumed subagent) is one transcript and is judged once.
 */
export function auditRunSkillScope(runDir, tel, { scope, projectsRoot } = {}) {
  const seen = new Set();
  const dispatches = [];
  for (const p of Array.isArray(tel?.phases) ? tel.phases : []) {
    if (!p?.agent) continue;
    const a = p.agent_id ?? checkpointAgentId(runDir, p);
    for (const id of Array.isArray(a) ? a : a ? [a] : []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const path = findAgentTranscript(id, { projectsRoot });
      dispatches.push({ agent: p.agent, agent_id: id, skills: path ? skillCallsIn(path) : null });
    }
  }
  return auditSkillScope({ scope, dispatches });
}
