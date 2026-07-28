# H2 — Collapse the run tail into one command (design)

**Date:** 2026-07-28
**Track:** H2 (instruction fidelity) — see `.brain/planning/h-instruction-fidelity.md`
**Status:** designed
**Depends on:** H1 (`sdlc-lint compliance`, landed on `track-h`) — see
`.brain/planning/h1-compliance-auditor.md`

## Problem

H1 measured what Track H had only asserted. Across 15 auditable runs the orchestrator executed
**82.3%** of its own mandated steps, and the spread is the finding:

| contract | shape of the step | rate |
|---|---|---|
| `2-4-anchor` | one `Bash` line | 100% |
| `5b-2-report`, `6-journal` | one call / one dispatch | 87% |
| `5b-0-enrich` | one call behind a session-resolution sub-procedure | 80% |
| `5-clock` | read the anchor, compute, render with a BSD/GNU fallback | **67%** |

`5-clock` carries the most emphatic prose in the entire 2509-line file — *"Do **not**
hand-transcribe these from your own sense of the time"* — and is skipped most often. Compliance
tracks how many separate things an instruction asks for, not how firmly it asks.

The run tail is where the multi-step prose is concentrated. Today it mandates **three** tool
invocations across two steps:

| step | what the model must do |
|---|---|
| 5 | read `.checkpoint/_started_at`, take `date -u +%s`, subtract, render both epochs ISO-8601 with a BSD-vs-GNU flag fallback, write three keys |
| 5b-0a | glob `{CONFIG_DIR}/projects/*/*/subagents/agent-<id>.jsonl`, walk two directories up, append `.jsonl`, decide whether to pass `--session` at all |
| 5b-0b | `usage/cli.mjs enrich <slug> [--session …]` |
| 5b-0c | re-read `_telemetry.json`, compare `cost_basis`, print a WARN |
| 5b-0d/e | surface the tool's cap-breach and clock-drift WARNs |
| 5b-2 | `report/cli.mjs report <slug>` |

Six sub-steps, three commands, one chance each to be skipped silently.

## Goal

One command seals the run. The model's remaining obligation is to invoke it and echo its output —
a single point of deviation instead of six, and no machine-known value transcribed by hand.

Non-goals: Step 6's journal entry (its note is LLM-written prose, so a deterministic CLI cannot own
it); the `Stop`-hook tail (H6, which this design makes a one-liner but does not implement); the
`sdlc-lint` machine-value invariant check (H3).

## Design

### New tool — `plugins/sdlc/tools/run/`

A third shipped tool beside `usage/` and `report/`, composing them without changing either.
Dependency-free, node builtins only, same `${CLAUDE_PLUGIN_ROOT}` invocation convention as its
siblings (paths resolve against the consumer's cwd; only the script loads from the plugin root).

| unit | responsibility | depends on |
|---|---|---|
| `clock.mjs` | `sealRunClock(runDir, opts)` — the only writer of the run clock | node builtins |
| `finish.mjs` | `finishRun(runDir, opts)` — clock → enrich → report, fail-open per stage | `clock.mjs`, `usage.mjs`, `report.mjs` |
| `cli.mjs` | `finish <slug-or-dir> [--no-report] [--json]` — argv, printing, exit code | `finish.mjs` |

`tools/sdlc-lint/lib/run.mjs` re-exports `finishRun` / `sealRunClock` as a dev/CI shim, following
the existing `lib/usage.mjs` and `lib/report.mjs` pattern, so the test suite exercises the code that
actually ships.

### `clock.mjs` — the run clock, from the anchor only

```
sealRunClock(runDir, { now = Date.now() }) -> {
  anchored: boolean,        // .checkpoint/_started_at was readable
  started_at, completed_at, // ISO-8601 UTC, or null
  wall_clock_seconds,       // integer >= 0, or null
  changed: boolean,         // telemetry was rewritten
  degraded: null | "no-anchor" | "no-anchor-no-values"
}
```

Behaviour:

1. Read `<runDir>/.checkpoint/_started_at` (a single integer, epoch seconds UTC, written write-once
   by Step 2). Non-finite or `<= 0` counts as unreadable.
2. `wall_clock_seconds = max(0, floor(now/1000) - start)`. `started_at` / `completed_at` are the two
   epochs rendered with `new Date(ms).toISOString()` — no `date(1)`, therefore no BSD/GNU fallback
   and no shell at all.
3. Write the three keys into `_telemetry.json`.
4. **No anchor:** never invent a clock. If telemetry already carries timestamps (an old run, a
   backfill), leave them untouched and return `degraded: "no-anchor"`. If it carries none, write
   `started_at: null`, `wall_clock_seconds: null`, `completed_at` = now, and return
   `degraded: "no-anchor-no-values"`. `null` and `0` mean different things here for the same reason
   they do for `total_cost_usd` and `cache_hit_ratio`: an unknown must not be encoded as a
   measurement.

`sealRunClock` runs **before** enrichment. That ordering is load-bearing: `enrichTelemetry` bounds
the orchestrator's main-loop turns by `overheadWindow()`, which reads the anchor plus
`wall_clock_seconds` — so on the first pass the window is already correct rather than repaired
afterwards. `reconcileRunWindow` stays in `usage.mjs` unchanged; after H2 it serves old runs and
`enrich`-only backfills, and for `finish`-sealed runs it is a no-op by construction (the values it
would compare against are the ones `clock.mjs` just wrote).

### `finish.mjs` — the composition

```
finishRun(runDir, { now, noReport, registryPath, projectsRoot }) -> {
  runDir, telPath,
  clock:   <sealRunClock result>,
  enrich:  { ok, ...enrichTelemetry result } | { ok: false, error },
  report:  { ok, html_path, cap_unverified } | { ok: false, error } | { skipped: "--no-report" },
  warnings: string[],     // every WARN line, in order, ready to echo
}
```

Rules:

- **Fail-open per stage.** A throwing stage is recorded and the next stage still runs — a failed
  render must not cost the run its enriched cost record. The one hard error is a missing run
  directory or `_telemetry.json`: nothing to seal, exit 2.
- **`warnings` is assembled, not printed** by this unit. It collects, in order: the clock's
  degradation, enrich's `timestamps_corrected` / `session_mismatch` / `overhead_window_fallback` /
  `cap_breach_usd`, the "cost enrichment incomplete" condition (`skipped_all`, non-empty `skipped`,
  or `cost_basis !== "transcript"` after the pass), and the report's `cap_unverified`.
- **No `--session`.** The 5b-0a sub-procedure disappears rather than moving: `enrichTelemetry`
  already recovers the session from a resolved phase transcript
  (`…/<sid>/subagents/agent-<id>.jsonl` → `…/<sid>.jsonl`), from the same `agent_id` the model would
  have globbed with. Removing the flag from the contract also removes the worktree trap it warned
  about — a wrong `--session` can no longer be supplied.
- **Idempotent.** Re-running `finish` on a sealed run re-derives the clock from the same anchor
  (only `completed_at` / `wall_clock_seconds` advance), and `enrichTelemetry` is already
  single-count per subagent transcript. This is the property H6's `Stop` hook will depend on.

### `cli.mjs` — output shaped for echoing

```
finish: docs/plans/<slug>
  clock:   2026-07-28T11:04:17Z → 2026-07-28T14:31:02Z  (12405s, anchored)
  cost:    $15.38  (phases $2.11 + overhead $13.27)   basis: transcript
  cap:     $0.60 — exceeded-undetected (breach $1.51)
  report:  docs/plans/<slug>/report.html
WARN: phase spend exceeded the cost cap by $1.51 (cap_status: exceeded-undetected) — …
```

`WARN:` lines go to stderr (as they do today from `enrich` and `report`); the block goes to stdout.
`--json` emits one line: `{"command":"finish","ok":…,"clock":…,"enrich":…,"report":…,"warnings":[…]}`
for headless consumers. Exit code is `0` whenever the run directory was readable, whatever the
stages did — sealing never fails a run that already succeeded — and `2` on a usage error or an
unreadable run.

### Contracts — retire without losing history

`contracts.mjs` gains an optional `until: YYYY-MM-DD` (validated like `since`, plus `until >= since`),
and `compliance.mjs` gains one rule beside the existing `predates`:

```js
if (date && contract.since > date) return na("predates");
if (date && contract.until && contract.until < date) return na("retired");
```

`parseContracts()` starts accepting an array of paths, sharing its `seen` set for duplicate ids, and
the `compliance` verb reads two files: the live `SKILL.md` and
`plugins/sdlc/skills/pipeline-orchestrator/contracts-retired.md`.

The archive does not violate H1's "contracts live next to the prose they describe" constraint: that
constraint exists because a contract can drift from a step that is still being edited. A retired
contract describes a procedure that no longer exists and therefore cannot drift. The archive file
states this in its header, and holds nothing but retired blocks.

| contract | file | window |
|---|---|---|
| `2-4-anchor`, `3d-1b-phase-cost`, `6-journal` | `SKILL.md` | unchanged |
| **`5b-finish`** (new) | `SKILL.md` | `since: 2026-07-29` |
| `5-clock`, `5b-0-enrich`, `5b-2-report` | `contracts-retired.md` | `until: 2026-07-28` |

```sdlc-contract
id: 5b-finish
requires: bash_match
pattern: run/cli\.mjs"?\s+finish
cardinality: once-per-run
since: 2026-07-29
```

The boundary is a date because that is the only version signal the historical corpus carries. It is
approximate in one direction: a run on or after 2026-07-29 from an install that predates this change
is judged against a contract its `SKILL.md` never stated, and reads as a miss. H1's `plugin_version`
stamp is the durable fix — once runs carry it, contract windows can key on the version that actually
executed rather than on the calendar. Until then the audit's `provisional` caveat covers this, and
the retired-contract window is deliberately closed on the last day of the measured corpus so the
published rates stay exactly reproducible.

### `SKILL.md` — what the prose becomes

**Step 5** loses the whole clock sub-procedure and gains one prohibition: `started_at`,
`completed_at` and `wall_clock_seconds` are not written by the orchestrator at all — `finish` writes
them from the anchor. Everything else in Step 5 (phase assembly, aggregates, `cap_status`,
`touched_files`, the final summary) is untouched.

**Step 5b** becomes one command plus one obligation:

```
node "${CLAUDE_PLUGIN_ROOT}/tools/run/cli.mjs" finish {task_slug}
```

…then echo its block into the final summary, including every `WARN:` line verbatim. The
explanatory prose is compressed, not deleted: why an `exceeded-undetected` has two distinct causes,
why overhead sits outside the gate, and why relabelling `cost_basis` by hand is the failure the step
exists to prevent — all of that is knowledge about *reading the result*, and it stays. What goes is
the procedure for *producing* it.

Unchanged: `--dry-run` skips the tail entirely; `--resume` re-seals from the reassembled telemetry;
`--no-report` (flag or `report: false` profile) becomes `finish --no-report` instead of a skipped
step, so an unreported run still gets its clock and its cost.

## Testing

`tools/sdlc-lint/test/run.test.mjs`, against temp-dir fixtures, dependency-free like its siblings:

- `sealRunClock`: anchored run → three keys derived from the anchor and a fixed `now`; missing
  anchor with existing timestamps → untouched, `degraded: "no-anchor"`; missing anchor with none →
  nulls plus `completed_at`; negative delta (clock skew) → clamped to 0; anchor with trailing
  whitespace / garbage → treated as unreadable.
- `finishRun`: happy path over the existing enrich fixtures (clock written before enrichment —
  asserted by the resulting `orchestration_overhead` window, not by call order); enrich throws →
  report still runs and `warnings` carries both; `--no-report` → report skipped, telemetry still
  enriched; missing `_telemetry.json` → throws; idempotence (two consecutive runs leave the same
  `total_cost_usd`).
- `contracts`: `until` parsed and validated; `until < since` rejected; array-of-paths parsing with a
  duplicate id across files reported once.
- `compliance`: a run dated after `until` → `na("retired")`; a run inside the window → still judged;
  fixture runs added under `tools/sdlc-lint/fixtures/compliance/runs/`.

Wired into CI through the existing `npm test --prefix tools/sdlc-lint`. The `compliance` verb stays
out of `sdlc-lint all` for the reason H1 set: it reads transcripts that exist only on a developer's
machine.

## Consequences

- Mandated tool invocations in the run tail: **3 → 1**. Steps 5/5b lose their procedural prose; the
  exact line delta is reported in the PR.
- `5-clock`'s 67% stops being a rate to improve and becomes a step that no longer exists. The
  BSD/GNU `date` fallback — a portability hazard the model had to remember — leaves the prose.
- The published 82.3% stays reproducible: the retired contracts still audit runs from their era.
  `5b-finish` will honestly report `n=0 (predates)` until runs exist on the new version; the
  before/after comparison is a later measurement, as H1's own rates were.
- H6 (`Stop`-hook tail) becomes a call to one idempotent command instead of a re-implementation of
  the sequence in bash.
- `usage/cli.mjs enrich` and `report/cli.mjs report` keep working unchanged for backfills and for
  anyone auditing an old run.

The decision that the orchestrator no longer authors the run clock is a contract, not an
implementation detail, and is recorded as an ADR in `.brain/decisions/` alongside this spec.

## Related

- `.brain/planning/h-instruction-fidelity.md` — the track; H2's DoD
- `.brain/planning/h1-compliance-auditor.md` — the measurement this design acts on
- `.brain/decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict.md` — the incident
- `.brain/decisions/ADR-0007-overhead-window-authoritative-anchor.md` — machine anchor over model prose
- `.brain/decisions/ADR-0005-transcript-derived-cost.md` — why enrichment is the authoritative cost path
