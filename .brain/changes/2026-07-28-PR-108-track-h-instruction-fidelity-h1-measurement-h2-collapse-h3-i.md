---
pr: 108
date: 2026-07-28
author: Nuclominus
type: other
plugins: [sdlc]
roadmap: null
files_changed: 90
---

# PR #108 — Track H — instruction fidelity: H1 measurement, H2 collapse, H3 invariant, H6 hook

> `other` · merged 2026-07-28 · by @Nuclominus

## Summary

The **track landing**: `track-h` merged into `develop` as a fast-forward, 49 commits carrying four
items of [[planning/h-instruction-fidelity]]. The per-item detail lives in its own note — this one
records what only the merge itself carries.

| item | | result |
|---|---|---|
| **H1** | measure compliance from transcripts | **82.3%** over 15 auditable runs |
| **H2** | collapse the run tail into one command | mandated invocations 3 → **1** |
| **H3** | the machine-value invariant | 6 formulas and 21 machine-owned keys → **0** |
| **H6** | a `Stop` hook seals a run the orchestrator forgot | gate chosen by measurement over 19 runs |

One premise underneath all four: prose read by a model is a **probabilistic** instruction, so
load-bearing steps move *out* of prose rather than getting worded more firmly. H1's finding is what
ordered everything after it — **compliance tracks how many separate things an instruction asks for,
not how firmly it asks.** Single-command steps scored 87–100%; the one genuinely multi-step
procedure scored **67%** while carrying the most emphatic prose in the file. That inversion is why
H2 and H3 shipped ahead of H4, at a fraction of its cost.

### The version bump is load-bearing, not bookkeeping

`sdlc` `1.14.1` → **`1.15.0`**. `plugin_version` in `_telemetry.json` is read from
`plugins/sdlc/.claude-plugin/plugin.json`, and it is the field that lets the compliance auditor tell
a run on the **new** tail apart from one on the **old**. H2, H3 and H6 all merged into `track-h`
without touching it; releasing under `1.14.1` would have put both eras on the same string and
defeated the one signal the remaining Track H work depends on. Caught by the release command's
warn-only per-plugin gate before the release, not after.

### What the merge itself surfaced

`develop` had moved 10 commits ahead and carried **its own `ADR-0016`**
([[decisions/ADR-0016-amend-the-spec-and-the-plan-together]]). The H6 ADR written on this track had
taken the same number — two different decisions numbered 16, which no test or lint would have
caught, since each vault half was internally consistent. `develop`'s was already merged, so ours was
renumbered to [[decisions/ADR-0017-the-tail-has-a-net]] across eight files, down to the hook's own
header comment.

Both indexes conflicted, and were resolved by **different rules, because they have different
owners**:

- `changes/_moc-changes.md` is machine-owned → took `develop`'s copy, re-ran `reindex` (67 notes).
  Never `sync --backfill`, which rewrites every note from its PR and would have destroyed the prose
  enriched hours earlier.
- `decisions/_moc-decisions.md` is hand-curated → rebuilt deterministically from the ADR files on
  disk, newest first, both `0016`s distinct.

Change notes for #103, #104 and #107 were generated individually with `sync --pr <n>` **before** this
merge, because those PRs targeted `track-h` and brain-sync's backfill filters merged PRs by base
(`lib/pr.mjs:27`). Without that, one merge would have collapsed three items into this single note.

### What is not claimed

**None of the three shipped items can be credited yet.** H2's own contract `5b-finish` reports
`n=0`; H3 adds no contract; H6 adds none either. The re-measurement that decides **H4** needs ~10
runs on the new tail carrying `plugin_version` — which this merge's version bump is what makes
possible. H4 stays gated on that number by design.

**H5** was sharpened rather than built: its cost argument is unbenchmarkable — `SKILL.md` is ~10% of
run cost against a measured 55.6–64.2% noise floor — so the saving must be *computed*, not A/B'd.
The amendment also records the risk the item never named: just-in-time fragments turn one
always-present monolith into N loads that can each be skipped, so H5 can lower compliance while
lowering cost.

## Changed areas

- [[components/sdlc]] — `1.14.1` → `1.15.0`; new `tools/run/` (`clock.mjs`, `finish.mjs`,
  `reentry.mjs`, `seal.mjs`, `cli.mjs`), new hook `hooks/seal-run.sh`, new `MACHINE-VALUES.md`.
- [[architecture/pipeline-orchestrator]] — the run tail is one command, the clock and the cost
  totals are not the model's to write, and sealing is no longer only the model's to do.

## Decisions & rationale

- Lands [[decisions/ADR-0014-the-run-tail-is-one-command]],
  [[decisions/ADR-0015-the-machine-value-invariant]] and
  [[decisions/ADR-0017-the-tail-has-a-net]] into `develop`.
- Per-item detail: [[changes/2026-07-28-PR-103-h2-collapse-the-run-tail-into-one-command]],
  [[changes/2026-07-28-PR-104-h3-the-machine-value-invariant]],
  [[changes/2026-07-28-PR-107-h6-a-stop-hook-seals-a-finished-run]].
- The incident that opened the track:
  [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]].

## Planning

- Closes **H1**, **H2**, **H3** and **H6** of [[planning/h-instruction-fidelity]] on
  [[planning/roadmap]]. **H4** remains gated on the re-measurement; **H5** is designable but not
  acceptable until the same corpus exists. The next Track H step needs no code at all — accumulate
  ~10 runs on the new tail and re-run `sdlc-lint compliance`.

---
_Auto-generated by `tools/brain-sync`. Frontmatter is machine-owned; prose below "Summary" is safe to enrich._
