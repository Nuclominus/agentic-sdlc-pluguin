---
adr: 37
status: accepted
date: 2026-09-29
supersedes: null
---

# ADR-0037 — Off-matrix skill use is audited, not blocked

## Context

[[decisions/ADR-0036-a-skill-catalog-is-a-runtime-dependency-a-skill-set-is-its-matrix]] assigns
each catalog skill to the roles that may use it, and point 5 of that decision leaves enforcement to
"prompt plus audit". The prompt half shipped with the resolver: a role's skills block lists only its
own rows. That half is advisory by construction:

- Claude Code has no per-subagent skill ACL. A skill installed for the user can be loaded by every
  subagent, so a security-analyst *can* load `adaptive`, a UI skill.
- A PreToolUse hook could refuse the `Skill` call. But the hook sees a tool call, not the
  dispatching role. It would have to guess the role from the session, and a wrong guess aborts a
  legitimate step in the middle of a run. That is the same trade
  [[decisions/ADR-0034-phase-boundary-lint-feedback-never-blocks]] declined for lint feedback.

Without the audit half, a leak is invisible. The prompt tells each role what it may use, and nothing
checks what it actually used.

## Decision

1. **Measure after the run, from each subagent's own transcript.** The seal (`run/finish.mjs`,
   Step 5b) reads the `Skill` calls in every phase's own transcript and judges each catalog call
   against the static matrix. A catalog call is one whose id is a skill-set key: either bare, or
   namespaced with the set's own name. Each catalog call lands in exactly one bucket:
   - `in_scope`: the dispatching role is assigned the skill.
   - `off_role`: another role is assigned the skill, and this role is not.
   - `unassigned`: no role is assigned the skill.

   Calls to skills outside the catalog are not the matrix's concern and are not counted. A
   transcript that cannot be read leaves its dispatch unjudged, not clean.
2. **The matrix is static.** Scope is not gated: `applies_if` decides what a prompt carries, not
   who may use a skill.
3. **The seal computes; nobody copies.** The seal resolves the matrix itself, read-only
   (`resolve/plan.mjs` `resolveSkillScope`). It then writes both `skill_scope` and
   `skill_scope_audit` into `_telemetry.json`. The orchestrator is not asked to copy anything,
   following [[decisions/ADR-0015-the-machine-value-invariant]].
4. **Three readers share one judgement.** All three use the shipped `auditSkillScope`, so they
   cannot disagree about a call:
   - The seal prints an advisory WARN.
   - The compliance contract `3b-1a-skill-scope` (`requires: agent_skill_scope`, cardinality
     `every-skill-call`) re-scores the corpus as in-scope calls over catalog calls. It judges
     against the matrix *the run recorded*, so a later edit to a skill set cannot re-judge an old
     run.
   - The AAR dashboard's `skill_scope` turns each off-role or unassigned call into a
     **scope-leak** finding.
5. **Never blocked.** A leak is a mismatch to resolve, never a run failure. The AAR offers two
   remedies:
   - a tighter `when`, when the agent strayed;
   - a re-triaged row in the plugin's skill set, when the matrix was wrong.

## Consequences

- Scope leaks become visible per run (AAR) and as a rate across runs (compliance), without adding a
  single failure mode to the run itself.
- The seal gains one read-only resolve and one transcript read per phase. Both are fail-open, and
  an exception becomes a WARN, never a lost seal.
- A run sealed before this ADR, or on a project with no skill set installed, records no
  `skill_scope`. Compliance scores it `n/a` (`no-skill-scope`), and the AAR reports "no audit"
  rather than "clean".
- The audit catches a leak after the fact. A role can still load an off-scope skill mid-run, and
  that guidance still shapes its output; this is the accepted cost of not blocking.

## Related
- Implemented by: #227 (seal-stage audit, compliance contract, AAR finding).
- Relates to: [[decisions/ADR-0036-a-skill-catalog-is-a-runtime-dependency-a-skill-set-is-its-matrix]],
  [[decisions/ADR-0015-the-machine-value-invariant]], [[decisions/ADR-0014-the-run-tail-is-one-command]],
  [[components/sdlc]]
