---
pr: 69
date: 2026-07-26
author: Nuclominus
type: feat
plugins: []
roadmap: null
files_changed: 100
---

# PR #69 — E2 benchmark harness — reference task for cache-read measurement

> `feat` · merged 2026-07-26 · by @Nuclominus

## Summary

PR #68 shipped the read-discipline contract with its behavioural Definition of Done **explicitly
unmeasured**: `peak_prefix_tokens` below **60k** against a recorded **101k peak / 6.65M cache reads /
117 turns** baseline. That baseline lives in a downstream Android project, so this repository could
not check it. This branch builds the instrument that can — and E1, E3 and E4 have the same
measurement problem, so it is built once for all four.

The harness (`bench/`) is a two-arm A/B rig. `prepare.mjs` copies a Kotlin/JVM specimen to a
disposable scratch tree, makes it a real git repo, and records provenance **before** the run;
`harvest.mjs` archives the scratch tree **first** — before any check that can abort, so a failed
run's forensic evidence is never discarded — then validates recorded provenance against live state
and rejects telemetry that cannot answer the question; `compare.mjs` reports medians, ranges and an
engineering verdict. Arms are isolated by `CLAUDE_CONFIG_DIR`, with the marketplace ref-pinned per
arm and `autoUpdate: false`.

Three design constraints are load-bearing and easy to lose later:

- **No p-values, ever.** At a handful of runs per arm no significance test is reachable, so the
  tool refuses the vocabulary — a negative test asserts the word "significant" never appears in a
  verdict. The output is a delta between two arms of one experiment, not a statistical result.
- **Strict arm alternation.** `compare.mjs` verifies it and warns when broken; running all of one
  arm then the other would let anything that drifts over hours — machine load, cache warmth —
  correlate perfectly with arm.
- **Provenance is recorded before the run, not inferred after.** Task and answer files are hashed
  into every manifest; a mismatch between recorded and live state suppresses the verdict rather
  than quietly averaging two different experiments together.

Arm isolation also broke the pipeline's own cost enrichment: `usage.mjs` resolves transcripts from
`homedir()`, so every arm-isolated run would have landed as `subagent_aggregate` with no peaks or
turns. `harvest.mjs` therefore re-runs that enrichment itself against `manifest.config_dir`.

This branch also carries the **result of the first campaign** — 20 headless runs, 10 per arm,
$7.55 — in `bench/RESULTS.md`, the raw per-run evidence in `bench/results-headless/`, the driver
that produced it, and the vault write-up.

## Changed areas

- _Repo-level change (no plugin under `plugins/` touched)._ New top-level `bench/` tree.
- [[architecture/benchmark-e2-read-discipline]] — the campaign record: method, result, noise floor,
  defects, and the design brief for the next attempt.

## Decisions & rationale

- Validates (negatively) [[decisions/ADR-0008-read-discipline-contract]]. **The effect the
  instrument was built to detect could not be measured**: arm B's cache-read median came in at
  −10.65% against a **64.2% within-arm spread**, with the sign reversing four times as runs
  accumulated. The 3-run pilot had already returned STOP at 42% spread; the 20-run campaign
  confirmed the pilot rather than overturning it.
- **The reusable output is the noise floor, not the delta.** Two runs of an *identical*
  configuration — same arm, task, specimen and machine — differ by 55.6–64.2% on total cache-read.
  Therefore a single run proves nothing, and any improvement below ~50% is unverifiable by this
  instrument at n≈10. Recorded at the top of Track E in [[planning/backlog]] so it is read before
  the next experiment is designed, not after it is paid for. `compare.mjs`'s own `recommendN`
  ladder is miscalibrated by 2.5× against this and should be trusted only for its STOP.
- **The campaign's highest-value output was a product defect, not a measurement.** Issue #70: the
  orchestrator globs a hard-coded `~/.claude/plugins/cache/**` instead of honouring
  `CLAUDE_CONFIG_DIR`, so stack detection reads the operator's real plugin tree — one run in twenty
  silently ran a 7-phase Android pipeline inside an arm where only `sdlc` was enabled. The same
  hard-coded path also resolves `models.json` (tiers **and pricing**) and workflow recipes. See
  [[architecture/pipeline-orchestrator]].

## Planning

- Builds the instrument named under **Track E — pipeline cache/cost efficiency** in
  [[planning/backlog]]. It is not E2-specific: E1, E3 and E4 were expected to reuse it, and that
  expectation now comes with a measured caveat about what it can and cannot resolve.
- Known gaps for a follow-up: `compare.mjs` reports composition mismatches (a run with a different
  phase count) but still counts them into the median instead of dropping them; the campaign driver's
  wall-clock counter stalls while the machine sleeps; and unattended campaigns must survive the
  account session limit — the driver's skip-if-harvested logic is what let this one resume with no
  repeated spend.

---
_Auto-generated by `tools/brain-sync`. Frontmatter is machine-owned; prose below "Summary" is safe to enrich._
