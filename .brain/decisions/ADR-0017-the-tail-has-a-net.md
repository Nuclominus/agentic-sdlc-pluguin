---
adr: 17
status: accepted
date: 2026-07-29
supersedes: null
---

# ADR-0016 — The run tail has a net, and the net enforces state rather than intent

## Context

[[decisions/ADR-0014-the-run-tail-is-one-command]] collapsed the end of a run from three mandated
invocations into one, on H1's finding that compliance tracks how many separate things an instruction
asks for. That moved the tail from level 1 of Track H's reliability table (prose) to level 3 (one
command). It could not reach level 4, because a single command is still a command someone has to
type — and H1 measured the previous version of that step at 67%, the worst rate in the audited set.

## Decision

A `Stop` hook (`plugins/sdlc/hooks/seal-run.sh`) seals a run the orchestrator finished but did not
seal. Three commitments make it safe to have always on.

**1. The gate is completeness, not recency.** A run is sealable only when every phase in the
resolved DAG carries a terminal checkpoint, `_telemetry.json` exists, and `.checkpoint/_sealed` does
not. Recency cannot tell a paused run from a finished one. Measured over the 19-run downstream
corpus, this gate opens for 10 runs — including `native-chat-engine-s2-thread-list`, the ADR-0012
incident run and the case the hook exists for — and stays shut for the three runs H1 named as
carrying most of the compliance damage. A run that cannot prove it finished (no
`.checkpoint/_run.json`) is never sealed: the gate fails closed.

**2. The clock comes from the run's last activity.** `wall_clock_seconds` is `now - anchor`, and the
hook is late by construction, so passing the wall clock would bill a run for the time the user spent
chatting afterwards — ADR-0014 measured that at 3522s → 11144s and $12.81 → $13.71. `finishRun`
receives the newest mtime across `_telemetry.json` and `.checkpoint/*` through `opts.now`, a seam
that already existed for tests.

**3. The hook exits 0 unconditionally.** For `Stop`, exit code 2 is not "error" — it blocks the
agent from stopping and feeds stderr back as an instruction. A sealing net that can trap a user in a
loop is worse than no net.

The completeness rule moves from `tools/sdlc-lint/lib/resume.mjs` into
`plugins/sdlc/tools/run/reentry.mjs`, which ships; the repo-root file becomes a re-export shim, the
pattern `lib/run.mjs` and `lib/usage.mjs` already follow. `--resume` and the seal gate now share one
definition of "done" rather than two that can drift.

## Consequences

- A forgotten seal is repaired instead of lost, and `sealed_by` records which path did it — so the
  rate at which the net fires is measurable beside H1's compliance rate rather than hidden behind it.
- **The compliance contract `5b-finish` is unchanged, deliberately.** The auditor reads transcripts
  and a hook leaves no `tool_use` block, so the hook is invisible to it. That is the correct
  outcome: the contract measures the *model*, and H6 must not be able to flatter it.
- `WARN:` lines reach the user through `systemMessage`. On the hook path the orchestrator is not
  there to echo them, and a silent net would reproduce ADR-0012's incident with better hygiene.
- The pre-filter is a plain shell loop rather than `find -newermt`: the same BSD-vs-GNU hazard
  ADR-0014 removed from the prose must not re-enter through the hook.
- **What a hook cannot do.** It enforces state, never intent. It cannot fire if the session is killed
  before `Stop`. It repairs after the fact, so it does nothing for a value consumed *during* the run
  — the 3d-1b cap gate stays the orchestrator's responsibility. And if every phase completes but the
  model dies before assembling `_telemetry.json`, there is nothing to seal: authoring that envelope
  would mean inventing the judgement the machine does not hold.
- **No credit yet.** Like H2 and H3, this ships into a measurement gap: no run in the corpus carries
  `plugin_version`, and the re-measurement that decides H4 still needs ~10 runs on the new tail.

## Related
- Implemented by: `plugins/sdlc/tools/run/` (`reentry.mjs`, `seal.mjs`, `finish.mjs`, `clock.mjs`,
  `cli.mjs`), `plugins/sdlc/hooks/seal-run.sh`, `plugins/sdlc/hooks/hooks.json`,
  `plugins/sdlc/MACHINE-VALUES.md`, `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`
- Makes the tail one idempotent command, which this calls: [[decisions/ADR-0014-the-run-tail-is-one-command]]
- Registers `sealed_by` under: [[decisions/ADR-0015-the-machine-value-invariant]]
- The incident this must keep loud: [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]]
- The measurement it must not flatter: [[planning/h1-compliance-auditor]]
- Spec and track: [[planning/h6-hook-deterministic-tail]] / [[planning/h-instruction-fidelity]]
- Relates to: [[architecture/pipeline-orchestrator]] / [[components/sdlc]]
