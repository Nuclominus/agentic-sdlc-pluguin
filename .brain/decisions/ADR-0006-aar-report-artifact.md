---
adr: 6
status: accepted
date: 2026-07-08
supersedes: null
---

# ADR-0006 — Persist the After Action Review as a durable `_aar.md` artifact

## Context

`/sdlc:aar` (the learning-loop skill) rendered its analyst report **in-session** and persisted only
curated one-line lessons to `.claude/sdlc-lessons.md`. It produced **no run-folder artifact**. In
practice users expected the review to live alongside the run (some manually saved `_aar-*.md`
files), and a review that exists only in a transcript is neither discoverable nor diffable after the
session ends. The run's `_telemetry.json` and the journal (see
[[decisions/ADR-0003-session-recorder-run-journal]]) are the only durable per-run records, and
neither carries the cost/cooperation analysis the AAR produces.

## Decision

`/sdlc:aar` now writes the analyst's rendered report verbatim (the `report.md` shape) to
`docs/plans/{slug}/_aar.md`, under an `# AAR — {slug}` heading, as the review's single durable
run-folder artifact. The analyst stays READ-ONLY; the main session writes the file. Lessons continue
to append to `.claude/sdlc-lessons.md`. The AAR remains **user-triggered, never automatic** — the
pipeline does not invoke it. `_telemetry.json` stays machine-owned and is not touched.

## Consequences

- AARs are discoverable and diffable next to the run they review; parity with the ad-hoc `_aar-*`
  files users were already saving by hand.
- One more prose artifact per reviewed run; it is regenerated (overwritten) on re-run, not appended.
- No change to cost/telemetry ownership or to the "never automatic" trigger contract.

## Related
- Implemented by: this cost-pipeline + AAR-artifact release
- Relates to: [[decisions/ADR-0003-session-recorder-run-journal]] / [[decisions/ADR-0005-transcript-derived-cost]]
