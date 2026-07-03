# SDLC cross-run rollup — `/sdlc:report` (Roadmap B2)

**Date:** 2026-07-03
**Roadmap item:** B2 (`docs/superpowers/specs/2026-07-03-plugin-improvements-roadmap-design.md`)
**Depends on:** A (sdlc-lint CLI, SSOT+CI discipline), C1 (`tools/aar/metrics.mjs` per-run
`computeMetrics`), D (HTML-artifact renderer convention).

## Problem

Each pipeline run writes `docs/plans/{slug}/_telemetry.json` and (via D) a per-run
`docs/plans/{slug}/report.html`. There is **no cross-run view**: a maintainer cannot see
total spend across all runs, how cost trends over time, which models/phases dominate, whether
cache hit-rate is improving, how often the cost-cap is breached, how often phases are skipped,
or how QA iterations distribute. B2 adds a **deterministic, dependency-free rollup** that globs
every run's telemetry and renders both an HTML artifact and a terminal digest.

## Goals

- One command `/sdlc:report` produces a **cross-run rollup** over `docs/plans/*/_telemetry.json`.
- Render **both**: a self-contained `docs/plans/rollup/index.html` artifact **and** a compact
  terminal digest to stdout.
- **Reuse** `computeMetrics` from `plugins/sdlc/tools/aar/metrics.mjs` for per-run reduction —
  no new per-run math.
- **Deterministic**: no `Date.now()` / `new Date()` / `Math.random()`. Same telemetry set →
  byte-identical HTML and text.
- **Dependency-free** (node builtins only), shipped inside the plugin payload, runnable via
  `${CLAUDE_PLUGIN_ROOT}`.
- Same **SSOT + CI** discipline as A/B1/D/C1: dev/CI re-export shim, an `sdlc-lint` verb, a
  fixture, and a unit-test suite exercising the shipped code.

## Non-goals (YAGNI)

- No LLM narrative/interpretation. B2 is a pure deterministic script — a **thin command, no
  skill** (contrast `sdlc:aar`, which dispatches an analyst).
- No filtering/date-range flags, no CSV/JSON export beyond a `--json` debug dump of the
  aggregate. (Future work if asked.)
- No charts requiring JS/canvas — trends render as inline SVG/CSS bars so the HTML stays
  self-contained and static.
- Does not modify D's `report.mjs` renderer; the rollup has its own small CSS block.

## Architecture

New tool directory `plugins/sdlc/tools/rollup/`, parallel to `tools/report/` and `tools/aar/`:

### `plugins/sdlc/tools/rollup/rollup.mjs` (SSOT, dep-free)

Pure functions + a thin I/O wrapper:

- **`computeRollup(runs)`** — `runs` is an array of `{ slug, telemetry }`. Returns a plain,
  deterministic aggregate object (shape below). Internally calls `computeMetrics(telemetry)`
  (imported from `../aar/metrics.mjs`) per run, then folds cross-run. No I/O.
- **`renderRollupHtml(agg)`** — returns a complete self-contained `<!doctype html>` string. Own
  CSS block (mirrors `report.mjs` tokens for visual consistency; light+dark via
  `prefers-color-scheme`). Escapes all untrusted fields.
- **`renderRollupText(agg)`** — returns the terminal digest string (fixed-width tables).
- **`rollupWorkspace(root)`** — I/O wrapper: globs `docs/plans/*/_telemetry.json` under `root`
  (builtin `readdirSync`, no `tinyglobby` — dep-free), parses each (skipping unreadable/malformed
  with a captured warning), builds `runs`, calls `computeRollup`, writes
  `docs/plans/rollup/index.html` (creating the dir), and returns
  `{ htmlPath, agg, text, warnings }`. Empty set → `agg.run_count === 0`, still writes a valid
  "no runs yet" page and returns cleanly.

### Aggregate shape (`computeRollup` return)

```jsonc
{
  "run_count": 7,
  "runs": [                       // per-run row, sorted by started_at asc (undated runs last, slug asc)
    { "slug": "billing", "started_at": "...", "stack": "android", "resumed": true,
      "cost_usd": 0.20, "input_tokens": 75000, "output_tokens": 6000,
      "cache_hit_ratio": 0.6, "cap_status": "within", "cap_breach": false,
      "qa_iterations": 2, "skip_rules_count": 1, "phase_count": 3, "unpriced": true }
  ],
  "totals": { "cost_usd": 3.14, "input_tokens": ..., "output_tokens": ...,
              "cache_hit_ratio_weighted": 0.61,   // token-weighted, not naive mean
              "cap_breaches": 1, "skip_rules": 4, "qa_iterations": 9,
              "unpriced_runs": 2 },               // runs with any unpriced phase → cost partial
  "by_model": [ { "model": "claude-opus-4-8", "runs": 5, "cost_usd": 2.10,
                  "input_tokens": ..., "output_tokens": ..., "unpriced": 0 } ], // cost desc, model asc tiebreak
  "by_phase": [ { "phase": "development", "runs": 6, "cost_usd": 1.40,
                  "input_tokens": ..., "output_tokens": ... } ],               // cost desc, phase asc tiebreak
  "cost_over_time": [ { "slug": "billing", "started_at": "...", "cost_usd": 0.20,
                        "cumulative_usd": 0.20 } ],                            // ordered as runs[]
  "cache_trend": [ { "slug": "billing", "started_at": "...", "cache_hit_ratio": 0.6 } ],
  "qa_distribution": { "0": 3, "1": 1, "2": 2, "3": 1 },   // iteration-count → run frequency
  "incidents": {
    "cap_breaches": [ { "slug": "auth", "cap_status": "over", "cost_usd": 0.55, "cost_cap_usd": 0.50 } ],
    "skips": [ { "slug": "billing", "phase_skipped": "qa", "rule": "config-only" } ]
  }
}
```

**Unpriced handling:** a run is `unpriced: true` if any of its phases has `cost_usd == null`.
Totals still sum the priced portion; the HTML + digest show a "cost partial — N run(s) unpriced"
note (same convention as D).

**Weighted cache hit:** `totals.cache_hit_ratio_weighted` = Σ(cached_input) / Σ(input) across
runs (falls back to `null` when no input tokens), not a naive mean of per-run ratios.

### `plugins/sdlc/tools/rollup/cli.mjs`

Dep-free entry, mirrors `tools/report/cli.mjs`. `node cli.mjs report [--json]`:
- resolves `root = process.cwd()` (the consumer project),
- calls `rollupWorkspace(root)`,
- writes the HTML (done inside the wrapper), prints `renderRollupText` digest to stdout (or the
  raw `agg` as JSON under `--json`),
- non-zero exit only on real failure (e.g. `docs/plans` unreadable); empty run-set is exit 0.

### `plugins/sdlc/commands/report.md`

Thin, no skill. Frontmatter `description` + `argument-hint`-less. Body instructs a single Bash
call:
```
node ${CLAUDE_PLUGIN_ROOT}/tools/rollup/cli.mjs report
```
then surfaces the digest and the written path to the user. Zero LLM tokens for the computation.

## SSOT + CI

- **`tools/sdlc-lint/lib/rollup.mjs`** — re-export shim:
  `export { computeRollup, renderRollupHtml, renderRollupText, rollupWorkspace } from "../../../plugins/sdlc/tools/rollup/rollup.mjs";`
- **`sdlc-lint` gains verb `rollup`** — `sdlc-lint rollup [<root>] [--json]`: runs
  `rollupWorkspace` against `<root>` (default cwd) and prints the digest / JSON. Wired into the
  `switch` in `tools/sdlc-lint/cli.mjs`; **not** added to `all` (that verb is for fixture-diff
  checks, and rollup has no single pass/fail — its correctness is covered by the unit suite).
- **Fixture** `tools/sdlc-lint/fixtures/rollup-multi/` with `docs/plans/{run-a,run-b,run-c}/_telemetry.json`:
  three runs spanning ≥2 models, one `cap_status: "over"`, at least one `skip_rules_applied`
  entry, one `resumed: true`, one run with an unpriced phase, differing `started_at`, and varied
  `qa_iterations_used`. Enough to exercise every aggregate branch.
- **`tools/sdlc-lint/test/rollup.test.mjs`** — imports from the re-export shim (exercises shipped
  code). Assertions:
  - totals sum across runs; weighted cache-hit is token-weighted, not mean;
  - `runs[]` ordered by `started_at` asc (undated last, slug tiebreak);
  - `by_model` / `by_phase` sorted cost desc with asc name tiebreak, aggregate correctly;
  - `cost_over_time` cumulative is monotonic and matches `runs[]` order;
  - `qa_distribution` counts iteration frequencies;
  - incidents capture the cap breach and the skip;
  - unpriced run flagged; totals still sum priced portion;
  - `renderRollupHtml` is a complete self-contained doc (no `http(s)://`, no `src=`, no `<link`,
    no `@import`), escapes injected markup, deterministic (byte-identical across calls);
  - `renderRollupText` deterministic;
  - `rollupWorkspace` on a tmp dir writes `docs/plans/rollup/index.html` and returns matching
    `agg`; empty `docs/plans` → `run_count: 0`, valid page, exit-clean;
  - malformed `_telemetry.json` → captured in `warnings`, other runs still aggregate.

## Data flow

```
/sdlc:report
  → commands/report.md  →  node tools/rollup/cli.mjs report
      → rollupWorkspace(cwd)
          glob docs/plans/*/_telemetry.json
          for each: JSON.parse → computeMetrics()  (reused, aar/metrics.mjs)
          computeRollup(runs)  → aggregate
          renderRollupHtml(agg) → write docs/plans/rollup/index.html
          renderRollupText(agg) → stdout digest
      → user sees digest + path to the HTML artifact
```

## Edge cases

- **No runs**: `docs/plans` absent or has no telemetry → `run_count: 0`, page reads "No pipeline
  runs recorded yet", digest says the same, exit 0.
- **Malformed telemetry**: skip that run, record a warning; never abort the whole rollup.
- **All-unpriced**: totals show `$—` for cost with the partial note; other dimensions still work.
- **Undated runs** (`started_at` missing): sorted after dated runs, slug-asc among themselves;
  excluded from the cumulative line's date axis but still counted in totals.
- **`rollup/` self-exclusion**: the glob targets `docs/plans/*/_telemetry.json`; `rollup/` holds
  only `index.html`, so it is naturally excluded.

## Testing

- Unit suite `rollup.test.mjs` via `node --test` (existing `npm test` in `tools/sdlc-lint`), run
  by the existing CI `all` job. No new CI wiring beyond the test file living in the suite dir.
- Determinism asserted for both renderers.

## Packaging lesson applied

Runtime `node` invocation ships **inside** the plugin (`plugins/sdlc/tools/rollup/`) and is
invoked via `${CLAUDE_PLUGIN_ROOT}` — never a repo-root path (the D distribution-gap lesson).
The dev/CI copy is a thin re-export so tests exercise the exact shipped bytes.
