---
name: aar
description: "Run an After Action Review of the last SDLC pipeline run — analyze token cost and agent cooperation, then apply approved workflow improvements and persist lessons. User-triggered, never automatic. Trigger words: after action review, AAR, retrospective, review the workflow, analyze the run, post-mortem, what went well, what to improve."
---

# SDLC After Action Review (`sdlc:aar`)

Closes the learning loop for one pipeline run: **gather → report → apply →
persist**. You (the main session) orchestrate; a READ-ONLY analyst subagent does
the measurement; you apply only what the user approves.

## Step 1 — Resolve the target run

1. If a slug argument was given, use `docs/plans/{slug}/`. Else pick the most
   recently modified `docs/plans/*/` directory (by mtime). If none exists, STOP:
   `⛔ No pipeline run found under docs/plans/. Run /sdlc:start first.`
2. Confirm `docs/plans/{slug}/_telemetry.json` exists. If not, STOP:
   `⛔ {slug} has no _telemetry.json — nothing to review.`

## Step 2 — Resolve the transcript

The current session transcript is the only durable record of cooperation
(handoff envelopes are not persisted). Locate it at
`~/.claude/projects/<encoded-cwd>/<session>.jsonl`, where `<encoded-cwd>` is the
project cwd with `/` replaced by `-`. If it cannot be found, continue in
**telemetry-only** mode and state that degradation in the report (cooperation
findings will be limited).

## Step 3 — Compute deterministic metrics

Run: `node ${CLAUDE_PLUGIN_ROOT}/tools/aar/metrics.mjs {slug}`

Capture the JSON dashboard. These numbers are authoritative — never recompute
costs by hand.

## Step 4 — Resolve and dispatch the analyst

1. Determine the active foundation profile (reuse the orchestrator's Step 0b
   detection). If its `manifest.yaml` declares `aar_analyst: <agent>`, dispatch
   that agent; otherwise dispatch `aar-analyst` (the neutral default).
2. Dispatch it with a single `Task` call, passing: `slug`, `transcript_path` (or
   a note that it's unavailable), and the `metrics_json` from Step 3. Instruct it
   to follow this skill's `gather.md` and return exactly the `report.md` shape.
   The analyst is READ-ONLY.

## Step 5 — Present, persist, approve, apply

Render the analyst's report to the user. Then:

- **Persist the report.** Write the analyst's rendered report (the `report.md`
  shape) verbatim to `docs/plans/{slug}/_aar.md`, under a `# AAR — {slug}` heading
  with the run date, so the review is durable and discoverable alongside the run.
  The analyst is READ-ONLY — **you** (the main session) write this file. Overwrite any
  prior `_aar.md` for this run. This is the AAR's only run-folder artifact; the run's
  `_telemetry.json` is machine-owned and stays untouched.

Then run the approval + apply loop defined in `apply.md`:

- The user multi-selects which findings to apply.
- For each approved finding, follow the tiered gate in `apply.md`.
- Lessons the user approves are appended to `.claude/sdlc-lessons.md`.

## Contracts

- `gather.md` — what the analyst extracts and from where.
- `report.md` — the exact report format the analyst returns.
- `apply.md` — the approval tiers and how you apply each finding.

## Non-negotiable

- The analyst never edits files; YOU apply, only after explicit approval.
- No auto-apply. `settings.json` edits require an extra explicit confirm.
- Workflow scope only — never edit product code or code-derived docs.
- Evidence before completion (`superpowers:verification-before-completion`)
  before you claim anything was applied.
