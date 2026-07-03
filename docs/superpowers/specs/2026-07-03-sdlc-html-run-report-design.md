# Spec: HTML run-report (Roadmap D) — 2026-07-03

> Status: **design, awaiting user approval.** Drafted on best-judgment defaults while the user
> was away (first clarifying question timed out). Every locked decision below is annotated so the
> user can veto individual points before `writing-plans`.
>
> Parent: `docs/superpowers/specs/2026-07-03-plugin-improvements-roadmap-design.md` → Напрямок D,
> bullet 1 ("HTML-звіт запуску").

## Problem

The pipeline's final deliverable to a human is a terminal text block (SKILL.md Step 5) plus a
scatter of `docs/plans/{slug}/*.md` files and one machine `_telemetry.json`. To understand *what a
run did and what it cost*, a person greps JSON and opens five markdown files. There is no single,
shareable, skimmable view: no phase timeline, no cost-by-phase/by-model breakdown, no at-a-glance
findings/post-check panel.

## Goal

At the end of a pipeline run, deterministically render one **self-contained HTML file**
(`docs/plans/{slug}/report.html`) from the already-written `_telemetry.json` (+ sibling phase
summaries and post-checks). Significantly more readable than the terminal summary; a single file
you can open in a browser or attach to a PR.

Non-goals (explicitly out for v1):
- Cross-run rollup / trends — that is **B2 `/sdlc:report`**, a different, later spec.
- Live/streaming status — that is **D `/sdlc:status`**, a different, later spec.
- Uploading anywhere / the harness `Artifact` tool. The plugin ships to third parties who run it
  headless; the deliverable must be a plain on-disk file, not a claude.ai-hosted page.

## Locked decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Renderer location | **Canonical dep-free renderer shipped IN the plugin** (`plugins/sdlc/tools/report/{report,cli}.mjs`), invoked at runtime via `${CLAUDE_PLUGIN_ROOT}`; the dev/CI `tools/sdlc-lint` re-exports it (SSOT) for its `report` verb + tests | **Corrected after PR #26 review.** Original plan invoked the repo-root `tools/sdlc-lint/cli.mjs`, which is NOT in the shipped payload (`source: ./plugins/sdlc`) — the feature would never run on a consumer install. The renderer is dependency-free so it needs no `node_modules` on install. |
| D2 | Rendering model | **Deterministic Node ESM**, not LLM-inline | Testable against fixtures, zero per-run token cost, byte-stable output. |
| D3 | Authoritative input | **`_telemetry.json`** (structured), enriched by sibling files | It is the SSOT the orchestrator already writes. The report never re-derives costs. |
| D4 | Output | **Self-contained HTML**: inline CSS, **zero** external refs, theme-aware (light/dark via `prefers-color-scheme`), every interpolated value HTML-escaped | Portable + shareable + XSS-safe (phase summaries are untrusted text). |
| D5 | Determinism | No `Date.now()`/`new Date()` in render; "generated" stamp comes from `telemetry.completed_at` | Stable output → snapshot-testable. |
| D6 | Trigger | Orchestrator **Step 5b**, auto after telemetry write; node-gated; skipped on `--dry-run`; opt-out via `--no-report` or `report: false` profile key | Cheap + deterministic ⇒ on by default; degrade gracefully where node is absent. |
| D7 | Touched files | New **optional** `touched_files[]` in telemetry (orchestrator persists `git diff --name-status`); report renders **if present, omits if absent** | Keeps `lib/report.mjs` pure (no shelling git); backward-compatible with old runs. |

## Architecture

```
tools/sdlc-lint/
  cli.mjs              # + case "report": renderReportFile(dir) — mirrors the `resume <dir>` verb
  lib/report.mjs       # PURE: renderReport(telemetry, extras) -> htmlString  (+ thin file I/O wrapper)
  test/report.test.mjs # snapshot + invariant assertions
  fixtures/report-basic/_telemetry.json     # golden input
  fixtures/report-basic/05-post-checks.md   # optional enrichment sample
```

**`lib/report.mjs` — two layers:**

1. `renderReport(telemetry, extras) -> string` — **pure**. Input: the parsed telemetry object +
   `extras = { postChecksMarkdown?, phaseSummaries?: {phase: markdownExcerpt} }`. Output: a complete
   HTML document string. No filesystem, no clock, no network. This is what the test drives.
2. `renderReportFile(dir) -> { htmlPath, ok }` — thin wrapper: reads `<dir>/_telemetry.json`
   (required; error if missing/unparseable), best-effort reads `<dir>/05-post-checks.md` and phase
   `NN-*.md` first-lines for excerpts, calls `renderReport`, writes `<dir>/report.html`.

**CLI verb** (in `cli.mjs`, matching the existing `resume` shape):
```
sdlc-lint report <slug-or-dir> [--json]
```
Resolves `<slug-or-dir>` to `docs/plans/<slug>/` (or treats it as a direct dir, like `resume`).
`--json` prints `{ command:"report", ok, html_path }`. Exit `0` on success, `2` on
missing/unparseable telemetry. Non-destructive: only writes `report.html`.

## HTML content (v1 sections)

All fed from `_telemetry.json` unless noted. Sections whose source data is absent are omitted
(never rendered empty).

1. **Header** — `task_slug`, stack + `primary_profile` (+ `additive_profiles`), a `RESUMED` badge
   when `resumed`, started→completed timestamps, `wall_clock_seconds`.
2. **KPI row** (stat tiles) — total cost `+ cap $X (cap_status)`, total input/output tokens,
   `cache_hit_ratio` as %, phases-run count, `model_enforcement_corrections`.
3. **Phase timeline** — ordered rows (as in `phases[]`, already `completed_at`-ordered): status icon
   (✅ completed / ⏩ skipped / ⏸ aborted), phase name (+ aspect), agent, model, tokens, `cost_usd`,
   `origin` badge (`resumed`/`fresh`), a horizontal cost bar sized to the run's max phase cost.
4. **Cost breakdown** — (a) by-phase bar list; (b) by-model aggregate table (group `phases[]` by
   `model` → sum tokens + cost). Footnote when any phase is `null`-priced (mirror the
   "(partial — n unpriced)" rule).
5. **Signals panel** — QA (`qa_status`, `qa_iterations_used`), skip-rules applied
   (`skip_rules_applied[]`), `cap_status`, `aborted_at_phase` if set.
6. **Post-pipeline checks** — from `post_pipeline_checks[]` (command + exit_code, ✅/❌/⏭ skipped),
   with the tail excerpt from `05-post-checks.md` if readable.
7. **Touched files** — from `touched_files[]` (status A/M/D + path) **if present**; else omitted (D7).
8. **Dependency preflight** — `deps_preflight` per-plugin status.
9. **Artifact links** — relative `<a href="01-business-analysis.md">…` to each phase `.md` +
   `_telemetry.json` (clickable when the HTML is opened from its folder).

**Security-severity findings** are deferred: today they live only in phase prose, not structured
telemetry. v1 renders a `security` phase row like any other; a future enrichment can persist
severity counts and this spec's Signals panel will pick them up (render-if-present). Not blocking.

## Orchestrator wiring (SKILL.md)

- **Step 5 (telemetry):** persist a new optional key `touched_files` — reuse the git already run in
  Step 0c; `git diff --name-status <merge-base>...HEAD` → `[{status, path}]`. On git error, omit the
  key (never fabricate). (D7)
- **New Step 5b (render report):** after `_telemetry.json` is written, and unless `--no-report` /
  `report: false`:
  - If `command -v node` fails → print `HTML report: skipped (node unavailable)` and continue.
  - Else `Bash: node tools/sdlc-lint/cli.mjs report {task_slug}` → writes `report.html`.
  - Add `docs/plans/{task_slug}/report.html` to the **Artifacts** block of the final summary and
    print `HTML report: docs/plans/{task_slug}/report.html`.
- **`--dry-run`:** no report (consistent with "Do NOT run Step 5" for dry runs, SKILL.md:767).
- **Resume:** the report is regenerated each run from the reassembled telemetry, so a resumed run's
  report reflects the full (multi-session) picture automatically.

## Error handling

- Missing/unparseable `_telemetry.json` → CLI exits `2` with a clear message; orchestrator treats a
  non-zero as a soft warning (`HTML report: failed — {msg}`) and does **not** fail the pipeline (the
  run already succeeded; the report is a convenience).
- Unreadable enrichment files (`05-post-checks.md`, phase `.md`) → their sections degrade to
  "structured-only", never throw.
- All interpolation via a single `esc()` helper; a test asserts an injected `<script>` in a phase
  summary is escaped.

## Testing (`test/report.test.mjs`, node:test — matches existing suite)

Against `fixtures/report-basic/_telemetry.json` (a golden telemetry with ≥2 phases, one skip-rule,
one post-check, `touched_files`, a `null`-priced phase, and a `<script>`-laced summary):

1. **Content invariants** — output contains each phase name, the total cost, cache-hit %, each
   post-check command.
2. **Self-contained** — output matches **no** `https?://`, `src=`, `<link`, `<script src`, or
   `@import url(` (fully offline).
3. **Escaping** — the injected `<script>alert(1)</script>` appears only as `&lt;script&gt;…`.
4. **Determinism** — calling `renderReport` twice on the same input yields byte-identical output.
5. **Graceful omission** — telemetry without `touched_files` renders without a Touched-files section
   and without throwing.
6. **Unpriced footnote** — the `null`-priced phase triggers the "(partial — n unpriced)" note.

CI: `tools/sdlc-lint` tests already run in `.github/workflows/ci.yml`; the new test rides along. No
new CI wiring.

## YAGNI / deferred

- Cross-run trends, charts-over-time → B2.
- Live status → `/sdlc:status`.
- JS interactivity (sortable tables, collapsibles) — v1 is static CSS only; add later only if asked.
- Structured security severity persistence — separate enrichment; report is forward-compatible.

## Open questions for the user

1. **D1** (renderer location) was chosen by timeout as the `sdlc-lint` subcommand. Confirm, or prefer
   a standalone `tools/sdlc-report`?
2. **Trigger default (D6):** auto-on with `--no-report` opt-out (drafted) vs. opt-in `--report` only?
3. **Touched files (D7):** OK to add the small `touched_files` field to the orchestrator's telemetry
   write, or keep v1 strictly to existing fields and drop the Touched-files section?
