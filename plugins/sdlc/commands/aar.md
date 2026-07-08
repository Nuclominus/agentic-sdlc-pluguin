---
description: Run an After Action Review of the last SDLC pipeline run — token cost + agent cooperation, then apply approved improvements and persist lessons. User-triggered.
argument-hint: "[slug]"
---

# /sdlc:aar

Retrospective for a completed pipeline run. Invoke the **`sdlc:aar`** skill.

- `[slug]` (optional) — the run under `docs/plans/{slug}/` to review. Omitted →
  the most recently modified `docs/plans/*/` run.

The skill: resolves the run + session transcript, computes the deterministic
metrics dashboard (`tools/aar/metrics.mjs`), dispatches a READ-ONLY analyst
(`aar-analyst`, or the active profile's `aar_analyst` override), presents the
findings, writes a durable `docs/plans/{slug}/_aar.md`, and applies only what you
approve — appending curated lessons to `.claude/sdlc-lessons.md`. Never automatic;
no auto-apply.
