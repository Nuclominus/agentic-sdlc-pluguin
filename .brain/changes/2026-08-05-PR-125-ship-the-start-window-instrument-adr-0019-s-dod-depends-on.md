---
pr: 125
date: 2026-08-05
author: Nuclominus
type: feat
plugins: []
roadmap: null
files_changed: 8
---

# PR #125 — ship the start-window instrument ADR-0019's DoD depends on

> `feat` · merged 2026-08-05 · by @Nuclominus

## Summary

`sdlc-lint start-window` — the measurement ADR-0019 turns on, as committed, tested code.

## Changed areas

- _Repo-level change (no plugin under `plugins/` touched)._ `tools/sdlc-lint/` gains
  `lib/start-window.mjs` + the `start-window` verb; `lib/transcript-facts.mjs` gains two
  wire-format fields (`timestamp`, `skill`).
- **Vault, in the same PR:** [[decisions/ADR-0019-the-run-start-is-one-command]] corrected, with
  unit banners added to [[planning/h5-prompt-surface]],
  [[planning/h5-d2-start-resolution-command]] and [[planning/h-instruction-fidelity]].

## Why an instrument, and not another script

The number ADR-0019 rests on — *"median 24 turns / 14 tool calls / $1.31, 11.8% of run cost"* — was
produced by a script that was **never committed**. It is quoted in the ADR, in two planning notes
and in the descriptions of #119 and #121, and nobody but its author could re-derive it.

The DoD is a **before/after on that number**. A before/after needs both halves out of the same
code, or a change in the instrument is indistinguishable from a change in the thing measured. Same
class as issue #116 (mtime-derived run dates): the finding survives, its provenance does not.

`sdlc-lint start-window [--runs <glob>] [--config-dir <path>]` measures from the
`pipeline-orchestrator` `Skill` invocation to the **first** agent dispatch, split at the
`.checkpoint/_started_at` write so Steps 0→1d are separated from Step 2's workspace creation, which
is real work and stays. It composes rather than re-implements: `transcript-facts.mjs` owns the wire
format, `compliance.mjs` owns run→session mapping, `usage.mjs` owns tokens and pricing.

## What measuring found

**It reproduces the published figure exactly in that figure's own unit** — whole window median 31,
range **16–48**, against the published median 33, range 16–48.

**And that reproduction exposed the unit.** The published counts are assistant **JSONL lines**;
Claude Code writes one line per content block of a turn, each repeating the same `message.usage`.
Deduped by `message.id` — real API calls — the same corpus is median **13** whole / **9**
collapsible. Measured on `s5-presence`: 21 lines / 10 calls = **2.10×**.

Neither number is wrong. They are different units, and the published figure never said which. It
matters because *"24 turns → 2–3"* compared a line count against a target anyone reads as API
calls, implying ~8–12× where the honest claim is ~3×. Both units are now reported side by side.

## What review found

Six findings, every one about a **boundary** — which is the only thing this module contributes:

- **Two counters, two conventions.** The JSDoc claimed `[since, until)` while `extractUsage`
  compares `t < s || t > u`: `tool_calls` was half-open, `turns`/`cost` closed. Kept closed
  deliberately (the turn that emits the dispatch spent its tokens deciding to), with the bias now
  named — one turn, the most expensive, cancelling in a before/after but **not** in a quoted
  absolute.
- **A read could become the split.** `ANCHOR` matched `cat …_started_at` as readily as a write, and
  `locateWindow` takes the first match — a future step inspecting the anchor would have fabricated
  the number being measured.
- **A silent measured zero.** Sessions concatenate in **mtime** order, not chronology, so a resumed
  run could yield `since > until`, match nothing, and report `measurable: true` with 0 turns and
  $0.00 — the one shape this file refuses everywhere else. Same shape as #116 again.
- **The aggregator broke `measureRun`'s own rule.** A run with no priced total stayed in the turn
  medians but left the cost medians, under a single `19 run(s)` header — *"a median over a
  denominator nobody can see"*. `n` is now per metric and printed when it differs; live on the
  parlor corpus it reads `[n=18]`.
- No test placed a turn **on** a boundary, which is how the wrong JSDoc survived. Two now do.
- `measureRun` and the CLI had no coverage at all; one fixture run directory closed it.

## Decisions & rationale

- **[[decisions/ADR-0019-the-run-start-is-one-command]] is corrected in this PR, not a follow-up.**
  The ADR still asserted a figure this instrument had just re-expressed. It now leads with a unit
  table, carries **both** corrections labelled rather than replaced (its own precedent), and fixes
  the DoD in **API calls: 9 → 2–3**. The deeper point is recorded there too: *a projection stated
  in an unnamed unit cannot be checked against a run at all.*
- **Historical figures are annotated, not rewritten.** The planning notes keep their measurements
  and gain a unit banner. Rewriting them in place would destroy the record of what was measured
  when, which is what the vault is for.
- **Composition over re-implementation, enforced on myself.** A first draft of `priceWindow`
  re-derived cost from `lookupPricing` and silently dropped cache writes — a second implementation
  of the one thing ADR-0011 centralised, written *inside the tool built to defend ADR-0019*. It
  calls `priceUsage` now, and the comment says what was there.

## Planning

- Advances **Track H** ([[planning/h-instruction-fidelity]]) by making H5's Direction 2 verifiable
  rather than merely argued.
- Filed #126 — `sdlc-lint --json` emits no envelope on some error paths. Deliberately out of scope
  here; surveying it before filing showed it is an inconsistency across five paths (`report` and
  `rollup` already do it right), not the uniform convention I first claimed in review.
- **Still open, and unchanged:** the "after". It needs real runs of `/sdlc:start` on the prose
  collapsed in #121. The instrument is ready for them, and the unit it will report is now fixed.

---
_Auto-generated by `tools/brain-sync`. Frontmatter is machine-owned; prose below "Summary" is safe to enrich._
