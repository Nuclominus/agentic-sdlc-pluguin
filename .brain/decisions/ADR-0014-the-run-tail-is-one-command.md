---
adr: 14
status: accepted
date: 2026-07-29
supersedes: null
---

# ADR-0014 — The run tail is one command, and the model does not author the clock

## Context

[[planning/h1-compliance-auditor]] measured how often the orchestrator executes its own mandated
steps: **82.3%** over 15 auditable runs. The aggregate was near the boundary the track had set for
deciding H4, but the **spread** carried the finding:

| contract | shape of the instruction | rate |
|---|---|---|
| `2-4-anchor` | one `Bash` line | 100% |
| `5b-2-report`, `6-journal` | one call / one dispatch | 87% |
| `5b-0-enrich` | one call behind a session-resolution sub-procedure | 80% |
| `5-clock` | read the anchor, compute, render with a BSD/GNU fallback | **67%** |

`5-clock` carried the most emphatic prose in the entire file — *"Do **not** hand-transcribe these
from your own sense of the time"* — and was skipped most often. Compliance tracks how many separate
things an instruction asks for, not how firmly it asks.

The end of a run was where that cost concentrated: three mandated invocations across six sub-steps
(clock arithmetic; resolve the session; enrich; re-read telemetry to verify; surface the cap and
window reconciliations; render). Each was a separate opportunity to deviate, and
[[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]] records what one such deviation
cost: a run reported `$—` against a real $15.38, with a clean `within` verdict beside it.

## Decision

Two commitments, both structural rather than rhetorical.

**1. The orchestrator does not author the run clock.** `started_at`, `completed_at` and
`wall_clock_seconds` are omitted from `_telemetry.json` at assembly time and written only by
`plugins/sdlc/tools/run/clock.mjs`, from the machine anchor `.checkpoint/_started_at`. Rendering
happens through `Date`, so the BSD-vs-GNU `date` flag fallback leaves the prose along with the step.
This generalises [[decisions/ADR-0007-overhead-window-authoritative-anchor]] from cost accounting to
the record itself: where a value exists on disk, the contract passes the path, never the number.

**2. Sealing a run is exactly one invocation.**
`node "${CLAUDE_PLUGIN_ROOT}/tools/run/cli.mjs" finish {slug}` performs clock → enrich → report,
fail-open per stage, and prints a block the orchestrator echoes. The model's remaining obligation is
to echo it, reproducing every `WARN:` line verbatim. There is no `--session` parameter: the enricher
already recovers the orchestrator session from a resolved phase transcript, so the glob the model
used to run is gone — and with it the ability to supply the *wrong* session, which is how a
worktree-isolated run once priced its overhead at $0.55 instead of $5.21.

Contracts gain an `until` date. The three replaced ones (`5-clock`, `5b-0-enrich`, `5b-2-report`)
move to `contracts-retired.md` with `until: 2026-07-28`, so runs from their era are still audited
against the procedure that was actually in force.

## Consequences

- Mandated invocations in the run tail: **3 → 1**. `SKILL.md` 2509 → 2436 lines; live contracts
  6 → 4.
- The historical rates stay reproducible: re-running the audit after the collapse returns the same
  100 / 87 / 80 / 87 / 67 and the same 82.3%. Without the retirement window, replacing a step would
  have meant either deleting its contract (losing the baseline) or leaving it live (failing forever
  against a procedure that no longer contains it).
- What was prose about *producing* the record is gone; what was prose about *reading* it stays. The
  two causes of `exceeded-undetected`, why overhead sits outside the gate, why relabelling
  `cost_basis` by hand is the failure the step exists to prevent — all judgement, all still
  probabilistic.
- H6's `Stop` hook becomes a call to one idempotent command rather than a re-implementation of the
  sequence in bash.
- `usage/cli.mjs enrich` and `report/cli.mjs report` keep working unchanged, for backfills and for
  auditing old runs.
- **The limit, stated plainly:** this removes a procedure, not the judgement around it. `5b-finish`
  will not be measurable until real runs exist on the new version, and a step that is now one call
  can still be skipped — just once instead of three times.

## Related
- Implemented by: `plugins/sdlc/tools/run/` (`clock.mjs`, `finish.mjs`, `cli.mjs`),
  `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (Steps 5, 5b, 3d-1b),
  `plugins/sdlc/skills/pipeline-orchestrator/contracts-retired.md`,
  `tools/sdlc-lint/lib/contracts.mjs`, `tools/sdlc-lint/lib/compliance.mjs`,
  `tools/sdlc-lint/lib/compliance-report.mjs`; PR pending.
- Acts on the measurement in: [[planning/h1-compliance-auditor]]
- Motivated by the incident in: [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]]
- Generalises the anchor's authority from: [[decisions/ADR-0007-overhead-window-authoritative-anchor]]
- Preserves the cost path of: [[decisions/ADR-0005-transcript-derived-cost]]
- Same medium/message failure, earlier instance: [[decisions/ADR-0008-read-discipline-contract]]
- Relates to: [[planning/h-instruction-fidelity]] / [[architecture/pipeline-orchestrator]] / [[components/sdlc]]
