// ADR-0037 — off-matrix skill use is audited, not blocked: the static matrix, the per-dispatch
// judgement from each subagent's own transcript, and the seal stage that records both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { skillScope } from "../../../plugins/sdlc/tools/resolve/skillsets.mjs";
import { auditSkillScope, auditRunSkillScope, skillCallsIn, roleOf } from "../../../plugins/sdlc/tools/usage/skill-scope.mjs";
import { finishRun } from "../lib/run.mjs";

const SCOPE = {
  "intent-sec": { set: "cat", roles: ["developer", "security-analyst"] },
  adaptive: { set: "cat", roles: ["developer", "qa-engineer"] },
  glasses: { set: "cat", roles: [] },
};

function scratch() { return mkdtempSync(join(tmpdir(), "sdlc-skill-scope-")); }

/** A subagent transcript holding the given Skill calls (plus noise that must be ignored). */
function transcript(root, agentId, skills) {
  const dir = join(root, "proj", "sess", "subagents");
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a" } }] } }),
    ...skills.map((s) => JSON.stringify({ message: { content: [{ type: "tool_use", name: "Skill", input: { skill: s } }] } })),
    "{ truncated",
  ];
  writeFileSync(join(dir, `agent-${agentId}.jsonl`), lines.join("\n"));
}

test("skillScope: every skill of every set, ungated, unassigned ones with no roles", () => {
  const sets = [{ set: "cat", skills: [
    { id: "cam", applies_if: { dependency: "androidx.camera" }, roles: { developer: { when: "w" }, "business-analyst": { when: "w" } } },
    { id: "glasses", unassigned: "niche" },
    "not-a-skill",
  ] }];
  assert.deepEqual(skillScope(sets), {
    cam: { set: "cat", roles: ["business-analyst", "developer"] },
    glasses: { set: "cat", roles: [] },
  }, "a gate decides what a prompt carries, not who may use the skill");
});

test("audit: in scope, off-role and unassigned — non-catalog skills are none of its business", () => {
  const r = auditSkillScope({ scope: SCOPE, dispatches: [
    { agent: "sdlc:security-analyst", agent_id: "a1", skills: ["intent-sec", "adaptive", "adaptive", "superpowers:brainstorming"] },
    { agent: "developer", agent_id: "a2", skills: ["cat:adaptive", "glasses", "other-plugin:adaptive"] },
    { agent: "reviewer", agent_id: "a3", skills: null },
  ] });
  assert.equal(r.dispatches_judged, 2);
  assert.equal(r.dispatches_unjudged, 1, "an unreadable transcript is unjudged, never clean");
  assert.equal(r.catalog_calls, 4, "a repeat within one dispatch is one decision; foreign ids are not catalog calls");
  assert.equal(r.in_scope, 2);
  assert.deepEqual(r.off_role, [{ agent: "security-analyst", agent_id: "a1", skill: "adaptive", set: "cat", allowed_roles: ["developer", "qa-engineer"] }]);
  assert.deepEqual(r.unassigned, [{ agent: "developer", agent_id: "a2", skill: "glasses", set: "cat" }]);
  assert.equal(auditSkillScope({ scope: {}, dispatches: [] }), null, "no matrix → no audit, not a clean one");
  assert.equal(roleOf("sdlc:qa-engineer"), "qa-engineer");
});

test("skillCallsIn reads Skill calls in order and survives a truncated tail", () => {
  const dir = scratch();
  try {
    transcript(dir, "x1", ["adaptive", "intent-sec"]);
    assert.deepEqual(skillCallsIn(join(dir, "proj", "sess", "subagents", "agent-x1.jsonl")), ["adaptive", "intent-sec"]);
    assert.equal(skillCallsIn(join(dir, "missing.jsonl")), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("run audit: one verdict per agent id, even when a resumed subagent serves two phases", () => {
  const dir = scratch();
  try {
    transcript(dir, "dev1", ["adaptive"]);
    transcript(dir, "sec1", ["adaptive"]);
    const tel = { phases: [
      { phase: "development", agent: "developer", agent_id: "dev1" },
      { phase: "remediation", agent: "developer", agent_id: ["dev1"] },
      { phase: "security", agent: "security-analyst", agent_id: "sec1" },
      { phase: "documentation", agent: "document-writer", agent_id: "gone0" },
    ] };
    const r = auditRunSkillScope(join(dir, "run"), tel, { scope: SCOPE, projectsRoot: dir });
    assert.equal(r.dispatches_judged, 2);
    assert.equal(r.dispatches_unjudged, 1);
    assert.equal(r.in_scope, 1);
    assert.deepEqual(r.off_role.map((x) => `${x.agent}→${x.skill}`), ["security-analyst→adaptive"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("seal: finishRun records the matrix and the verdict, warns on a leak, and never fails over it", () => {
  const dir = scratch();
  try {
    transcript(dir, "sec1", ["adaptive"]);
    const run = join(dir, "run");
    mkdirSync(join(run, ".checkpoint"), { recursive: true });
    writeFileSync(join(run, ".checkpoint", "_started_at"), "1785236400\n");
    writeFileSync(join(run, "_telemetry.json"), JSON.stringify({ task_slug: "x", phases: [{ phase: "security", agent: "security-analyst", agent_id: "sec1" }] }));
    const opts = { now: (1785236400 + 60) * 1000, noReport: true, projectsRoot: dir, enrich: () => ({ skipped_all: true }) };

    const r = finishRun(run, { ...opts, skillScope: () => SCOPE });
    const tel = JSON.parse(readFileSync(join(run, "_telemetry.json"), "utf8"));
    assert.deepEqual(tel.skill_scope, SCOPE, "the matrix travels with the run, so compliance can re-judge it offline");
    assert.equal(tel.skill_scope_audit.off_role.length, 1);
    assert.equal(r.skill_scope_audit.off_role[0].skill, "adaptive");
    assert.ok(r.warnings.some((w) => /1 skill call\(s\) outside the role skill matrix — security-analyst→adaptive/.test(w)));
    assert.equal(tel.sealed_by, "orchestrator");

    const quiet = join(dir, "quiet");
    mkdirSync(quiet);
    writeFileSync(join(quiet, "_telemetry.json"), JSON.stringify({ task_slug: "q", phases: [] }));
    finishRun(quiet, { ...opts, skillScope: () => null });
    assert.equal("skill_scope" in JSON.parse(readFileSync(join(quiet, "_telemetry.json"), "utf8")), false, "no matrix → no keys");

    const broken = join(dir, "broken");
    mkdirSync(broken);
    writeFileSync(join(broken, "_telemetry.json"), JSON.stringify({ task_slug: "b", phases: [] }));
    const b = finishRun(broken, { ...opts, skillScope: () => { throw new Error("boom"); } });
    assert.equal(b.sealed.by, "orchestrator", "an audit failure never costs the seal");
    assert.ok(b.warnings.some((w) => /skill-scope audit skipped — boom/.test(w)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
