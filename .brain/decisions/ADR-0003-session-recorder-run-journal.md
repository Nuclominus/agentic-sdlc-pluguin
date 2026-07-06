---
adr: 3
status: accepted
date: 2026-07-06
supersedes: null
---

# ADR-0003 — Session-recorder closing agent + real run clock

## Context

The pipeline orchestrator (`plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`) finalizes every
run inline at Step 5 by writing `docs/plans/{slug}/_telemetry.json` and rendering `report.html`.
Two gaps followed from that:

1. **No cumulative, human-readable ledger.** Per-run telemetry existed, but nothing answered "what
   has the pipeline done lately, and how long did each run take?" at a glance across runs.
2. **Elapsed time was estimated, not measured.** `_telemetry.json` already carried
   `started_at` / `completed_at` / `wall_clock_seconds`, but no real clock was captured at run
   start — the orchestrator model filled those fields by estimation. `sdlc:report`, `sdlc:aar`, and
   the HTML report all consumed that unreliable number.

## Decision

Add a top-level (orchestrator-level) closing agent and wire a real clock:

- **`session-recorder` agent** (`plugins/sdlc/agents/session-recorder.md`, `haiku`/`low`,
  read-only base + `Write`/`Edit`). It reads the finished run's `_telemetry.json` (numbers verbatim)
  plus `_brief.md`/`05-pr.md` for grounding, composes a factual ~20–30 word note, and
  **creates-or-appends** one newest-first entry — `date · slug · note · elapsed · cost · phase
  count` — to the cumulative journal `docs/plans/_journal.md`. Same-day + same-slug entries are
  replaced in place (resume-safe). It writes ONLY the journal and never fails the pipeline.
- **Real start clock.** Orchestrator Step 2 captures a write-once epoch anchor
  `docs/plans/{slug}/.checkpoint/_started_at` (`date -u +%s`); Step 5 computes
  `wall_clock_seconds` = now − start and renders `started_at`/`completed_at` from it, degrading
  gracefully when the anchor is absent. This makes timing real for `report`/`rollup`/`aar` too.
- **Wiring** is a built-in orchestrator step (new **Step 6**), not a workflow phase — so it always
  runs on every stack/workflow, skips under `--dry-run`, and needs no `agents_per_phase` binding.

Rejected alternatives: a `run_note` field inside `_telemetry.json` (machine-readable but no single
human ledger); adding the closer as a declared final phase in every workflow YAML (opt-out-able,
must be repeated per workflow); reusing the global `end-task`/claude-stats SQLite (session-scoped,
outside the repo, not keyed by `task_slug`).

## Consequences

- Every run now leaves a one-glance trail in `docs/plans/_journal.md`, and elapsed time reflects a
  measured clock rather than a guess — improving `sdlc:report` / `sdlc:aar` accuracy for free.
- One extra cheap (`haiku`) agent dispatch per run; best-effort, so it can never fail a run.
- `_journal.md` is human-owned prose (not machine-validated telemetry); it grows one entry per run.
- Deferred: an overridable `session_recorder:` manifest slot (mirroring `aar_analyst:`) so a
  foundation could swap in its own closer — not built to avoid resolver churn.

## Related
- Implemented by: #<pr>   <!-- fill on merge -->
- Relates to: [[architecture/pipeline-orchestrator]]
