---
adr: 8
status: accepted
date: 2026-07-25
supersedes: null
---

# ADR-0008 — Read discipline as a prefix-level contract, not per-agent prose

> **Landed but UNVALIDATED.** A 20-run A/B could not demonstrate a cost win — see
> [Validation](#validation--unvalidated-measured-2026-07-26-effect-not-demonstrable) before citing
> this ADR as evidence of one.

## Context

Prompt caching bills every token at 0.1× **but on every turn**, so `cache_read ≈ turns ×
avg_prefix` — the same arithmetic [[decisions/ADR-0007-overhead-window-authoritative-anchor]]'s
sibling track (Track E, [[planning/backlog]]) has been measuring since #46/#48. The measured
baseline, from a real 7-phase Android run (`change-matches-filter-logic-gender`): **6.65M
cache-read tokens across 117 subagent turns**, of which ~73% is accumulated context that grows the
per-turn prefix to a **101k peak** by the end of a phase, and ~27% a fixed floor of 12k–21k re-read
every turn regardless of growth.

The growth component is driven by agent behaviour, not the harness: agents re-read files already in
context, pull whole files where a targeted read would do, and echo verbose tool output back into
their own prefix. Auditing the five agent `.md` files that touch the file system surfaced an
outright **contradiction** in the guidance itself: `aar-analyst.md` already recommended surgical
reads in its own retrospective findings, while `developer.md`, `qa-engineer.md`,
`security-analyst.md` (two separate lines), and `document-writer.md` instructed re-reads or
whole-file reads — five lines across four files pulling the opposite direction from the one agent
that had already worked out the right answer from experience. Fixing this per-agent, in prose, would
mean restating the same guidance five times with no shared enforcement point and no way to check it
stayed consistent as new foundations and framework plugins add their own agents.

## Decision

**Read discipline is a prefix-level contract, injected once into the orchestrator's
`=== STABLE PREFIX ===` block, not per-agent prose — and it is checked mechanically, not just
written down.**

1. **One injection point.** The contract lives in
   `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`, inside the cache-stable prefix so it is
   served as a cache hit on every subagent turn instead of being repeated as fresh, agent-specific
   text. It draws one explicit line: "read from the file system rather than trusting what's already
   in the prompt" is **kept** (a correctness concern — stale prompt state is a real bug source), while
   "read the same file twice in one phase" or "pull a whole file when a narrower read would do" is
   **forbidden** (a pure cost concern with no correctness benefit).
2. **Mechanical enforcement of the contract's presence, not of runtime behaviour.** A new
   `read-discipline` verb in `tools/sdlc-lint` (`tools/sdlc-lint/lib/read-discipline.mjs`) checks
   the 1 orchestrator SKILL only for the anchor — is the contract present, and is it inside the
   stable prefix — and scans all 18 agent definitions across `plugins/*/agents/**/*.md` for the
   anti-patterns the contract forbids, with an escape-hatch marker an agent author can use to
   justify a deliberate exception inline rather than the lint just being worked around silently.
   It is wired into `sdlc-lint all` and reports `19/19 clean`.
   `plugins/android-foundation/agents/*.md` was scanned as part of this and needed no changes — it
   was already clean.
3. **Four agent contracts de-contradicted.** `developer.md`, `qa-engineer.md`,
   `security-analyst.md`, and `document-writer.md` had their conflicting re-read / whole-file
   instructions reworded to defer to the stable-prefix contract instead of restating (and
   contradicting) it locally.

## Consequences

- One place to change read guidance; zero incremental per-agent prompt cost to add or update it;
  every current and future agent — including framework/foundation plugins not yet written — inherits
  it automatically because it rides in the prefix every subagent turn shares.
- The contract is **advisory to the model** — there is no runtime enforcement that stops an agent
  from re-reading a file mid-turn. `sdlc-lint read-discipline` checks that the agent `.md` files
  *say* the right thing and don't contradict it, not that a given run *complied*. Non-compliance is
  instead detected after the fact via the existing E5 cache-pressure signal — the `cache_pressure`
  flag keyed on `CACHE_PRESSURE_PEAK_TOKENS = 80_000`, surfaced per phase in the HTML run report and
  in the AAR — which is the feedback loop that would catch a regression or a foundation plugin that
  ships an agent violating the contract.
- The behavioural half of Track E2's Definition of Done — `peak_prefix_tokens` on a comparable run
  dropping below 60k from the 101k baseline — is **deferred and unmeasured** by this change. The
  baseline telemetry (6.65M cache-read / 117 turns / 101k peak) lives in a downstream Android
  project's run history, not in this repo, so it can only be re-measured on the next real downstream
  SDLC run. This ADR records the contract as landed; it does not claim the cost win. **It was
  subsequently measured and the win could not be demonstrated — see Validation below.**
- Escape-hatch marker cost: one justified inline comment where an agent genuinely needs to reread
  (e.g. after an edit, to verify the resulting state) — a deliberate, auditable exception rather than
  the lint becoming unworkable and getting disabled.

## Validation — UNVALIDATED (measured 2026-07-26, effect not demonstrable)

> **Read this before citing ADR-0008 as a cost win. There is no cost win on record.**

The contract was A/B-tested against its own absence with a purpose-built harness
(`bench/`, #69): **20 headless runs, 10 per arm, strictly alternating, $7.55**. Arm A = `sdlc@1.9.1`
(no contract), arm B = `sdlc@1.10.0` (this ADR). Full record: `bench/RESULTS.md` and
[[architecture/benchmark-e2-read-discipline]].

**Result: no measurable effect.** Corrected for composition, arm B's cache-read median was −10.65%
against a **64.2% within-arm spread**. As runs accumulated the reading was −22.7 → +22.6 → −5.5 →
+9.9 → +6.8 → −4.0 → −10.65: the sign reversed four times, and the magnitude shrank as the standard
error shrank. That is the shape of a null, not of an effect emerging.

**The DoD threshold does not discriminate.** Both arms met `<60k peak prefix` — arm A's worst run
was 58,184 *without* the contract. On a specimen this size the criterion cannot be the acceptance
test it was written to be.

**The one asymmetry, recorded as a hypothesis and not as evidence.** Across 10 runs arm B's peak
prefix never exceeded **37,191**, while arm A exceeded it twice (58,184 / 51,571); arm B's peak
spread was 33% against arm A's 92%. The direction matches what the contract targets — the ceiling,
not the middle. But under a null of exchangeable peaks, the chance that the top two of the 19
vanilla runs both land in arm A is (9/19)·(8/18) ≈ **21%**. One experiment in five produces this
pattern by chance.

**Measured cost of the contract itself:** 13 lines ≈ 230 tokens, re-read every turn in the stable
prefix ⇒ ≈ 11,800 cache-read tokens per run, **≈1.4%** of arm B's median. So the contract costs a
measurable ~1.4% of the metric it is meant to reduce, for a benefit that could not be measured.

**Why it merged anyway.** Arm B was not worse on any metric measured (cache-read −10.65%, peak
−9.4%, turns −2.8%, none significant); the guidance is defensible on engineering grounds
independently of measurement; and the specimen — 67 files / 64k tokens against a 21k floor — is
where read discipline has the *least* surface to act on. A null there does not transfer to a
500k-token production codebase. Holding correct guidance indefinitely for evidence this instrument
cannot produce was judged worse than landing it labelled.

**What would change this verdict:** the same A/B on a corpus where the addressable surface is 5–10×
the fixed floor, designed around **peak prefix** rather than totals, run on an orchestrator with
issue #70 fixed — that fix has since landed
([[decisions/ADR-0009-plugin-root-resolution]]), so the precondition is met and only the corpus and
metric design remain. Until such a re-test runs, ADR-0008 is landed-but-unvalidated.

## Related
- Relates to: [[decisions/ADR-0007-overhead-window-authoritative-anchor]] / [[components/sdlc]] / [[planning/backlog]]
- Validated (negatively) by: [[architecture/benchmark-e2-read-discipline]]
