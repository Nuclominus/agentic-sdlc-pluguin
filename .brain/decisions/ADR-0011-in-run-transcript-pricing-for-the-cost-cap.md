---
adr: 11
status: accepted
date: 2026-07-28
supersedes: null
---

# ADR-0011 — Price each phase from its transcript in-run, so the cost cap can actually fire

## Context

`caps.max_total_cost_usd` is a workflow recipe's spending limit. The orchestrator's Step 3d-cap gate
accumulates `CONTEXT.running_cost_usd` from each finished phase's `cost_usd` and, before dispatching
the next phase, pauses (interactive) or aborts (headless) once the total passes the cap.

That gate has never been able to fire on this harness.

Its only input was the per-phase price computed in Step 3d-1 from the **Agent tool result
envelope**. Per [[decisions/ADR-0004-aggregate-token-telemetry-crash-recovery]], that envelope
exposes a single aggregate `subagent_tokens` count with no input/output/cache split, so a phase
**cannot be priced from it** — 3d-1 correctly sets `cost_usd: null`. Step 3d-cap then counts a
`null`-priced phase as `$0`. Since the aggregate shape is the *ordinary* envelope here, every phase
contributed `$0`, `running_cost_usd` stayed at `0` for the entire run, and the comparison
`running_cost_usd > cost_cap` was unreachable at any cap value. The gate was dead code.

[[decisions/ADR-0005-transcript-derived-cost]] had already solved the pricing problem — the real
input/output/cache split lives in each subagent's own transcript — but wired the fix into **Step
5b**, which runs after the last phase. Cost accounting became accurate while cost *control* stayed
broken, and the two facts sat in the same file without contradicting each other visibly.

Observed on the Android run `flutter-to-native-migration-plan`: recipe cap `$0.75`, actual phase
spend `$3.37` across two phases (`$2.97` BA + `$0.40` security), no pause, and
`cap_status: "within"` written into `_telemetry.json`. The breach was found by hand afterwards and
recorded in a prose `cap_note`. Re-pricing the first phase's transcript in isolation yields `$2.97`
from a file whose last write preceded the second phase's dispatch — the number that would have
tripped the gate was **already on disk, unread**, at the moment the gate ran.

A second failure compounds it: `cap_status` reported what the gate *observed*, not what the run
*cost*, so the telemetry actively asserted "within" about a 4.5× overspend. Every downstream
consumer (report, rollup, AAR metrics) reads that field as the breach signal.

## Decision

**Move transcript pricing into the run loop, and make a missed breach impossible to record as
"within".** Two layers:

1. **In-run pricing (Step 3d-1b) — the fix.** A new `phaseCost()` in
   `plugins/sdlc/tools/usage/usage.mjs`, exposed as `cli.mjs phase-cost <agent-id>[,...]`, prices one
   finished phase from its own subagent transcript(s) and returns the split + cost as JSON. The
   orchestrator runs it immediately after every phase, before the gate, and overwrites the phase's
   `cost_usd` / token split with `usage_source: "transcript"`. The gate now spends real money. It is
   the same computation Step 5b performs — only earlier, where it can still change the outcome.
   `--exclude` carries the ids already priced this run, so a resumed subagent serving two passes is
   charged once (the rule Step 5b enforces with its `pricedIds` set; both now share one resolver).

2. **Post-run reconciliation (Step 5b(d)) — defense in depth.** `phaseCost` can still come up blind
   (transcript unresolvable, no `node`, model absent from the registry). Those phases are flagged
   `cap_gate_blind: true` and still enter the gate as `$0`, so the original failure remains
   *reachable*, just rare. `enrichTelemetry` therefore compares enriched **phase** spend against
   `cost_cap_usd` and, on a breach, records `cap_breach_usd` and rewrites a `"within"` verdict to a
   new fourth status **`"exceeded-undetected"`**. It never overwrites `"exceeded-continued"` /
   `"exceeded-aborted"` — those had a user in the loop and mean more than arithmetic can
   reconstruct. The comparison uses phase spend only: orchestration overhead is deliberately outside
   the gate, and folding it in would retroactively re-tighten every recipe's cap.

   `"exceeded-undetected"` covers two cases, told apart by whether any phase carries
   `cap_gate_blind`: a gate that genuinely went blind (blind phases present), or an overage that
   landed on the run's **last dispatch**, where 3d-cap by construction has nothing left to stop —
   including any single-phase recipe, which has no gate boundary at all. The second is not a
   malfunction but a property of a pre-dispatch gate; it surfaces an undersized cap rather than a
   broken one. Both are reported, because in both the run exceeded its cap and nobody was asked.

`resolved: false` always pairs with `cost_usd: null`, never `0` — an unknown cost must not reach a
gate as a measured zero. Pricing never fails the pipeline: a miss degrades to the pre-existing
aggregate path plus a `WARN`, because a cost-accounting read must not be able to kill real work.

The reconciliation lives in the **tool**, not in `SKILL.md` prose. A rule the orchestrator is merely
told to follow is a rule it can paraphrase away; this one must hold on every run, so it is
deterministic tested code operating on `_telemetry.json`.

TDD: 11 failing tests first (in-run pricing incl. multi-pass, exclusion, the two unresolved modes,
the CLI machine contract; reconciliation incl. the overhead carve-out and not clobbering a caught
breach; report rendering), then the implementation — full sdlc-lint suite green (192 tests).

Rejected alternatives: **fabricating a split from `subagent_tokens`** (ADR-0005 already rejected
this — the aggregate ignores per-turn cache reads and understates real spend severalfold, so the gate
would fire late and wrongly); **capping on token count instead of dollars** (recipes are authored in
USD, and tokens are not comparable across model tiers); **gating on the pre-run `--dry-run`
estimate** (an estimate cannot observe an overrun in progress — that is the entire job of this gate);
**leaving pricing at 5b and only reporting breaches after the fact** (layer 2 alone: honest, but it
never *stops* spending, which is what a cap is for).

## Consequences

- The cost cap enforces for the first time. On the observed run the gate now sees `$2.97 > $0.75`
  after phase 1 and pauses before dispatching phase 2, instead of silently reaching `$3.37`.
- Per-phase telemetry is transcript-accurate *during* the run, not only after Step 5b — checkpoints
  written by 3d-3 now carry real costs, so `--resume` resumes with an accurate running total.
- New `cap_status` value `"exceeded-undetected"` and new field `cap_breach_usd`. No consumer change
  was needed: `aar/metrics.mjs` treats any non-`"within"` value as a breach, and report/rollup render
  the string. The HTML report additionally names the overage and the `cap_gate_blind` phases.
- New per-phase field `cap_gate_blind` (added to `schemas/checkpoint.schema.json`, which is
  `additionalProperties:false`). Absent on a fully-sighted run.
- Backfillable: re-running `enrich <slug>` on any past run whose transcripts survive re-labels an
  undetected breach. Replaying the observed run reproduces `cap_breach_usd: 2.62` — the figure its
  hand-written `cap_note` had recorded.
- One extra `Bash` call per phase (a dependency-free local JSONL read), against the alternative of an
  unbounded overspend.

## Related
- Implemented by: `plugins/sdlc/tools/usage/usage.mjs` (`phaseCost`, `resolvePhaseTranscripts`, `reconcileCapStatus`), `plugins/sdlc/tools/usage/cli.mjs` (`phase-cost`), `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (Steps 3d-1b, 3d-cap, 5b(d)), `plugins/sdlc/tools/report/report.mjs`, `schemas/checkpoint.schema.json`; PR pending.
- Builds on: [[decisions/ADR-0005-transcript-derived-cost]]
- Closes the control-side gap left by: [[decisions/ADR-0004-aggregate-token-telemetry-crash-recovery]]
- Same failure shape as: [[decisions/ADR-0007-overhead-window-authoritative-anchor]] (a cost value silently reading as zero/`null` instead of unknown)
- Relates to: [[architecture/pipeline-orchestrator]] / [[components/sdlc]]
