---
adr: 7
status: accepted
date: 2026-07-08
supersedes: null
---

# ADR-0007 — Orchestration-overhead window from the machine anchor, not model timestamps

## Context

[[decisions/ADR-0005-transcript-derived-cost]] added an `orchestration_overhead` block to
`_telemetry.json`: the orchestrator's own main-loop turns, priced from the session transcript and
**bounded to the run window** so a long-lived interactive session's pre/post-run activity does not
inflate the run. `enrichTelemetry` (`plugins/sdlc/tools/usage/usage.mjs`) computed that window from
the telemetry's `started_at` / `completed_at` ISO strings.

Those two fields are **authored by the LLM orchestrator** in Step 5 — it is instructed to render the
epoch anchor `.checkpoint/_started_at` via `date -u -r <epoch>`, but nothing enforces it. On the
real Android run `cit-478-batch-editor-animations` the orchestrator wrote
`started_at: 2026-07-08T00:14:19Z` while the machine-written anchor (`_started_at = 1783522459`)
and the actual transcript turns were at **`14:54:19Z`** — the same wall-clock *duration* (2776 s,
so `completed_at` was internally consistent) but an absolute start **off by ~14 h 40 m**.

`priceMainLoop` filters main-loop turns to `[since, until]`. The bogus window
(`00:14:19Z → 01:00:35Z`) did not overlap the real turns (`14:51Z → 15:43Z`), so **every one of the
~34 orchestrator turns was excluded** and `orchestration_overhead.main_loop` collapsed to
`{ model: null, turns: 0, cost_usd: null }`. Per-phase costs were unaffected (per-phase pricing
applies no window), so the failure was invisible in the phase table — but the run's single largest
cost bucket was silently dropped: reported `total_cost_usd: $8.15` versus a true **~$13.2**
(the missing $5.05 is 34 `claude-opus-4-8` main-loop turns). Step 5b's verify check did not catch
it — it only inspects `cost_basis` / skipped phases, not a resolved-but-zero overhead.

The root cause is a **dependency on a fallible LLM transcription** for a value that already exists
authoritatively on disk. The machine writes `.checkpoint/_started_at` (epoch, via `date +%s` in
Step 2) and the exact `wall_clock_seconds`; the window should come from those, not from prose.

## Decision

**Source the overhead window from the authoritative machine-written anchor, and never let a bad
window silently zero the cost.**

1. **Anchor-derived window** — a new `overheadWindow(runDir, tel)` reads
   `<runDir>/.checkpoint/_started_at` (epoch) and uses `[epoch, epoch + wall_clock_seconds]` as the
   window, rendered ISO. It falls back to the telemetry `started_at`/`completed_at` **only** when no
   readable anchor exists (older runs), preserving prior behaviour there.
2. **Unbounded fallback + signal** — if the window still excludes *every* main-loop turn while the
   transcript genuinely has some, `enrichTelemetry` reprices the **full** transcript, uses that, and
   returns `overhead_window_fallback: true`. `cli.mjs` prints a `WARN:` on that flag so the loss is
   loud in the run log instead of surfacing as a quiet `$0` later in the report/journal.

The run-window bound from ADR-0005 is kept (out-of-window session activity is still excluded); only
its **source** changes from model-authored ISO to the machine anchor. TDD: two failing tests first
(anchor overrides a wrong telemetry window; fallback flags a zeroed window), then the fix — full
sdlc-lint suite green (106 tests).

Rejected alternatives: **hardening only the Step 5 prompt** to always shell out to `date -u -r`
(still trusts the model to copy the result faithfully — the exact step that failed here; keep cost
accounting in tested deterministic code, per ADR-0005); **dropping the window entirely** and always
pricing the whole transcript (re-introduces the long-session inflation the window exists to prevent);
**deriving the window from the subagents' own min/max turn timestamps** (works, but adds a second
heuristic when an exact machine anchor is already on disk).

## Consequences

- Orchestration overhead is priced from the real run window regardless of what the orchestrator
  wrote into `started_at`/`completed_at`; `cit-478-batch-editor-animations` re-enriches from
  `$8.15` to **$13.22** ($8.15 phases + $5.07 overhead), with no `--session` and no hand-editing.
- A wrong window can no longer produce a silent `$0` overhead — it either self-corrects via the
  anchor or emits a `WARN` on the unbounded fallback.
- The model-authored `started_at`/`completed_at` remain the human-facing display timestamps; their
  correctness no longer affects cost. (Fixing *their* accuracy is a separate Step 5 prompt concern.)
- New `enrichTelemetry` return field `overhead_window_fallback`; no telemetry **schema** change.
- Backfillable: re-running `enrich <slug>` on any past run whose `.checkpoint/_started_at` survives
  now recovers overhead priced against the correct window.

## Related
- Implemented by: `plugins/sdlc/tools/usage/usage.mjs` (`overheadWindow` + unbounded fallback), `plugins/sdlc/tools/usage/cli.mjs` (WARN); PR pending.
- Builds on: [[decisions/ADR-0005-transcript-derived-cost]]
- Relates to: [[architecture/pipeline-orchestrator]] / [[components/sdlc]]
