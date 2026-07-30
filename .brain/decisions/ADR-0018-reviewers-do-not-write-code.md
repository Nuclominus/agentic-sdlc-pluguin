---
adr: 18
status: accepted
date: 2026-07-30
supersedes: null
---

# ADR-0018 — Reviewing agents do not write code, and their findings reach it through a gate

## Context

An agent definition's `tools:` frontmatter key is an allowlist. Omitting it does not mean "the
defaults" — it means **every** tool. Ten of the eleven `android-foundation` agents omitted it, so
each one held the full toolset regardless of what its prompt said it was for. `android-reviewer`
declared itself "READ-ONLY by default — analyzes and reports, does NOT write code" and could `Edit`
any file in the repository. `android-debugger` routed "Writing the fix → `android-developer`" in its
scope boundaries and then instructed itself, four sections later, to "Fix root cause". The prose was
the only thing holding the boundary, and prose does not hold boundaries.

The same audit found the opposite defect in the core plugin. `business-analyst` and
`document-writer` carried restrictive lists that omitted `Write` while the orchestrator instructed
both to write their phase deliverable, and **no** agent carried `Skill` even though the orchestrator
injects `Convention skills to consider invoking:` into every phase prompt — so on any agent with a
restricted list, every mandatory skill invocation in
`plugins/android-foundation/rules/skills.md` silently failed.

Granting `Edit` to a reviewer is not merely untidy. It removes the independent verifier: the agent
that judges the change becomes the agent that makes it, and its edits arrive **after** the review
loop that guards every other change in the run, unreviewed by anything. The orchestrator's security
phase prompt actively required this — "Fix Critical and High severity issues directly (Edit/Write)"
— while `android-foundation/rules/workflow.md` had already specified the opposite for the same
phase ("Output: findings with severity ratings + handoff envelope"). Two source-of-truth documents
disagreed, and the tool grant sided with the wrong one.

## Decision

**1. Every shipped agent declares an explicit `tools:` allowlist.** No agent inherits the full
toolset. An agent that must invoke a Skill lists `Skill`; an agent that must produce a deliverable
lists `Write`.

**2. No agent may dispatch agents.** `Agent`, `Task`, `SendMessage`, and `Workflow` are the
orchestrator's exclusively — it runs in the main loop as a skill, so it holds them by default while
no subagent declares them. A subagent that spawns its own children puts that work outside phase
accounting entirely: the children reach no checkpoint, no `_telemetry.json` entry, and no cost-cap
contribution, so the run's measured cost quietly stops being the run's real cost. Blocking `Agent`
alone would not do it — `Task` is the legacy spelling, `SendMessage` resumes an existing agent, and
`Workflow` fans out to many.

**3. Reviewing agents have no `Edit` tool.** This covers `android-reviewer`, `android-security`,
`security-analyst`, `android-debugger`, `android-aar`, and `aar-analyst`. Where such an agent still
needs `Write`, it is for exactly one artifact — its own report under `docs/plans/{task_slug}/` — and
its prompt says so. A reviewer classifies findings and writes a remediation concrete enough to apply
without re-deriving the analysis; it does not apply it.

**4. Findings reach the codebase through a gated `remediation` phase.** A new generic control-flow
block, `gate: {after, min_severity}` (`schemas/workflow.schema.json`, orchestrator step `3-gate`),
parses the machine-contract line `ISSUES_FOUND: critical=N high=N medium=N low=N` from each phase in
`after`. Below the threshold the gated phase is never dispatched and is recorded `status: "skipped"`
at zero cost; at or above it, the development agent runs with the reporting phases' reports injected.

The gate is a **one-way hand-off, not a loop** — it never re-runs the phases in `after`. It is a
separate construct from `loop:` because `security` runs inside `parallel: [security, test]`, and a
parallel member is a bare string that cannot carry control flow. Putting the hand-off in a phase
*after* the group is what lets the group stay concurrent.

**5. The gate fails open.** A phase in `after` that ran but emitted no parsable `ISSUES_FOUND` line
opens the gate and warns. One needless dispatch is cheaper than a Critical finding dropped silently.

## Consequences

- `security` loses its `heal:` block in every recipe. Healing re-dispatches the phase's own agent to
  repair a build break; an agent with no `Edit` can only report the same failure at full price. The
  `remediation` phase carries the heal guard instead, because it is the one that writes code.
- Cost caps rise on the six recipes that gained the phase. A gated phase enters `base_total` at
  `0.5·est` and is restored to full weight in `worst_total`: when the gate opens, `remediation` is a
  full development dispatch, and a cap that never anticipated it would halt the run at precisely the
  moment a Critical vulnerability was found.
- `analysis.yaml` is the deliberate exception — a read-only BA+security assessment that ships no
  code has nothing to remediate. `sdlc-lint` enforces the rule and the exception together: every
  recipe running `security` must route it to a gated `remediation`.
- `resume` is unaffected. A closed gate writes the same `status: "skipped"` checkpoint that
  skip-rules already write, so `tools/sdlc-lint/lib/resume.mjs` needs no change and must not get one.
- Restricting tools is only half the fix. `plugins/*/README.md` now carries an "Edits code?" column
  per agent, so the boundary is legible without opening frontmatter.
- `sdlc-lint agent-tools` enforces all three invariants in CI over `plugins/*/agents/*.md`: a
  declared non-empty `tools:`, no dispatch tool, no `Edit` on a reviewer, plus a `description:`
  (whose absence renders the agent as "Agent from `<plugin>`" and makes it unreachable by trigger
  words — `android-cicd` and `android-devops` had shipped that way). Prose in a plugin README cannot
  hold this boundary; the original defect was invisible precisely because every agent's prompt
  *said* the right thing.
- The check covers **shipped** agents only. A project-local agent under `.claude/agents/` that omits
  `tools:` still inherits everything, and `sdlc.local.yaml` can bind one to a phase via
  `agents_per_phase`. That gap is the project owner's to close.

## Related
- Implemented by: #110
- Relates to: [[decisions/ADR-0010-self-healing-micro-loop]] / [[architecture/pipeline-orchestrator]]
