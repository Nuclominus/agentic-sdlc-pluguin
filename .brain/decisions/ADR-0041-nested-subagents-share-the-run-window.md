---
adr: 41
status: accepted
date: 2026-10-27
supersedes: null
---

# ADR-0041 — Nested subagents share the run window

## Context

[[decisions/ADR-0005-transcript-derived-cost]] prices a run's `orchestration_overhead` as two
buckets: the orchestrator's own **main-loop** turns, and **nested subagents** — every
`agent-*.jsonl` in the session's subagents dir that is not one of the run's phase agents.
[[decisions/ADR-0007-overhead-window-authoritative-anchor]] bounded the main loop to the run window
from the machine anchor (`.checkpoint/_started_at` + `wall_clock_seconds`). The nested bucket was
never windowed at all.

That was harmless while a session held one run. It stops being harmless the moment several runs are
chained in one session, because they share one subagents dir: each later run priced every earlier
run's phase agents and helpers as its own nested overhead. The AAR of three chained Android runs
(sdlc 3.2.2, 2026-10-26) measured it: the second run reported $8.63 against about $5.31 real
(+$3.32), the third $13.98 against about $8.19 (+$5.79). The error grows with every run in the
chain, so a fourth run could report a cost-cap breach that never happened. Issue #240.

## Decision

**A nested subagent is attributed to a run only for the turns it spent inside that run's window.**

1. **Same window, per turn.** The nested bucket is filtered by the window `overheadWindow(runDir,
   tel)` already computes for the main loop, turn by turn (`priceTranscripts(paths, registry,
   window)` → `extractUsage`). Per-turn, not first-turn: it matches `priceMainLoop`, and a helper
   whose turns straddle two runs is split between them by time instead of billed whole to one.
2. **Sibling phase agents are excluded by identity.** Every agent id recorded as a phase agent by
   another run under the same parent dir (`docs/plans/<sibling>/_telemetry.json` and its
   checkpoints, via `knownRunAgentIds`) is never nested overhead of this run. This is defense in
   depth behind the window: it covers a sibling's agent whose turns ran late into this window, and
   it still holds when there is no window to filter by.
3. **One window, one verdict.** If the window excludes every main-loop turn, ADR-0007 already treats
   the window as wrong and reprices the main loop unbounded. The nested bucket now falls back with
   it — it was filtered by the same wrong window, and repricing only half the overhead would hide
   the loss behind `overhead_window_fallback`.
4. **Say when there is no complete window.** With no anchor and no `started_at`/`completed_at`,
   overhead is priced over the whole session (minus sibling phase agents). With only one bound
   (e.g. an anchor but neither `wall_clock_seconds` nor `completed_at`) the window is open-ended,
   and on a chained session it takes in every run past the missing bound. Both cases return
   `overhead_window_missing: true`, and both `usage/cli.mjs enrich` and `run/cli.mjs finish` WARN.
   The fallback WARN in (3) also says the overhead may include other runs. The overhead block
   records where its window came from: `orchestration_overhead.window = { source: "anchor" |
   "telemetry" | "open-ended" | "none" | "unbounded-fallback", since, until }`, and the HTML
   report badges any overhead row that is not bounded on both sides as `not run-windowed`.
5. **Phase dispatches are attributed to their run too.** With `--session`, `deriveDispatchMap`
   lists every `Phase N/M: <phase>` dispatch in the session, and chained runs reuse phase names, so
   the name alone handed a later run the earlier run's `development` transcript as well. That
   doubled its phase cost, which does feed `reconcileCapStatus`. A dispatch is now kept for a phase
   only when it is not a sibling run's recorded agent and, under an anchored window, was made inside
   this run's window (each dispatch carries its line's `timestamp`). A phase left with no dispatch
   falls through to its recorded `agent_id` / checkpoint, as before. Every phase dispatch in the
   session, whichever run made it, stays excluded from nested overhead.

Rejected alternatives: **sibling-id exclusion alone** (catches sibling *phase* agents but not their
nested helpers — a reviewer's research agent, an AAR, a session-recorder — so a chain still
over-bills); **windowing on a transcript's first turn** (simpler, but bills a straddling helper
wholly to whichever run it started in, and disagrees with how the main loop is windowed);
**dropping nested subagents from overhead** (they are real spend of the run that dispatched them).

## Consequences

- A chained run's overhead covers its own window only; the inflation reported in #240 is gone, and
  so is the false cap-breach risk it carried (the cap gate itself never read overhead —
  `reconcileCapStatus` compares phase spend only).
- Backfillable: re-running `enrich <slug>` on a past chained run whose anchor survives reprices its
  nested bucket against the right window.
- `orchestration_overhead` gains a `window` sub-object and `enrichTelemetry` a
  `overhead_window_missing` return field; no telemetry schema exists to change. Older telemetry has
  no `window` and renders as before.
- The report's overhead row now counts nested-subagent tokens in its billed total — it already
  counted their cost.
- Known limit: **concurrent** runs in one session (a `/sdlc:batch` dispatching worktree-isolated
  pipelines in parallel) have overlapping windows, and their telemetry lives under other
  worktrees' `docs/plans/`, which the sibling scan cannot see. Time cannot separate them. That
  takes per-dispatch lineage (which agent dispatched which) and is not recorded in the transcripts
  today, so it is left out of this decision rather than approximated.

## Related
- Implemented by: #245 (closes issue #240).
- Amends: [[decisions/ADR-0007-overhead-window-authoritative-anchor]]
- Builds on: [[decisions/ADR-0005-transcript-derived-cost]]
- Relates to: [[components/sdlc]]
