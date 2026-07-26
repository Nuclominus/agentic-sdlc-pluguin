---
status: planned
---

# Backlog

> Open items to promote to a [[planning/roadmap]] track when scheduled.

## Track E — pipeline cache/cost efficiency

Grounded in a real 7-phase Android run (`change-matches-filter-logic-gender`), measured with the
transcript-derived usage tool after the #48 over-count fix. **Baseline: 6.65M cache-read tokens
across 117 subagent turns**, plus ~2.19M more on the orchestrator main-loop. Cost is dominated by
cache reads because prompt caching bills every token at 0.1× **but on every turn** — each subagent
turn re-reads its entire accumulated prompt prefix, so `cache_read ≈ turns × avg_prefix`.

Measured anatomy of the 6.65M (deduped, per `message.id`):

| Component | Share | What it is | Per-turn size |
|-----------|-------|-----------|---------------|
| Fixed floor | ~27% (1.77M) | Boilerplate re-read every turn: harness system prompt + tool schemas + agent `.md` + injected `_brief`/prior-phase context | sonnet ~12k, opus ~14k, docs ~21k |
| Growth | ~73% (4.88M) | Accumulated file reads, tool outputs, thinking, Edit/Write bodies — re-read on every later turn; prefix grows to 100k+ (dev) | rises 15k → 101k |

Only part of the floor is addressable by the plugin (agent `.md` + what the orchestrator injects
into each Task prompt); the harness system prompt + tool schemas are fixed. Growth is fully
addressable via agent behavior guidance.

Ordered by leverage (measure first, then the two cheap high-impact guidance items, then structural):

### Benchmark harness (`bench/`)

The instrument that closes E2's deferred behavioural DoD lives in `bench/`: a Kotlin
specimen, a corpus power check, and `prepare.mjs` / `harvest.mjs` / `compare.mjs`
scripts driving a two-arm (before/after) comparison under isolated
`CLAUDE_CONFIG_DIR` environments (procedure and runbook in `bench/README.md`). It is
not E2-specific — E1, E3 and E4 are expected to reuse the same instrument to validate
their own DoDs once implemented. Its output is medians, ranges and an engineering
verdict over a **delta between the two arms of one experiment**; it is not a
statistical result, and its numbers are not comparable to the 101k-token figure
recorded above from the downstream Android application run — different codebase,
different tool, different purpose.

**Measured noise floor (2026-07-26, 20 runs) — read this before designing any Track E
experiment.** Within-arm, identical-configuration run-to-run spread on total cache-read is
**55.6%–64.2%**; peak prefix varies 33%–92%; turn count runs 46–64 on the same 5-phase
pipeline. Therefore: a single run proves nothing, and **any improvement below ~50% is
unverifiable by this instrument at n≈10**. Check the expected effect against that bar before
spending. `compare.mjs`'s `recommendN` ladder (<10% → N=3, <25% → N=4, ≥25% → STOP) is
miscalibrated — reality exceeded its STOP threshold by 2.5× — so treat its STOP as real and the
rungs below it as fiction. Full campaign record:
[[architecture/benchmark-e2-read-discipline]].

### E5 — Cache-pressure signal in report + AAR *(enabler, low effort)*
Add a per-phase **reads-per-turn** and **peak-prefix** signal to `tools/report` and surface it in
the `sdlc:aar` findings, so cache regressions are visible and heavy phases get flagged. The report
already carries the billed split (#46); this adds `cache_read / turns` and `max(cache_read per turn)`.
Turns E1–E3 from guesswork into a tracked, regression-testable metric. Connects Track C1 (AAR) + D
(report). **DoD:** report shows reads/turn + peak-prefix per phase; AAR flags any phase whose
reads/turn exceeds a threshold. No ADR needed.

### E2 — Surgical reads + terse tool output *(guidance, targets the 73% growth)* — **done, 1.10.0**
Instruct pipeline agents (in their `.md` and/or the orchestrator brief) to: read with `offset/limit`
and grep-first instead of whole large files; never re-read a file already in context; keep Bash/
verification output terse. Growth is 73% of reads and the prefix balloons to 100k+ when agents pull
whole files; flattening growth is the single biggest lever. **DoD:** peak-prefix on a comparable run
drops (target <60k from 101k); no quality regression in review/test/qa verdicts. Guidance-only, no
code. May warrant an ADR if it changes agent contracts materially.

**Landed in 1.10.0:** the read-discipline contract now lives once in the orchestrator's
`=== STABLE PREFIX ===` rather than per-agent prose, enforced by `sdlc-lint read-discipline`
(19/19 clean across the orchestrator SKILL + all agent `.md` files); see
[[decisions/ADR-0008-read-discipline-contract]].

**Measured 2026-07-26 — UNVALIDATED.** The behavioural half of the DoD is no longer deferred; it
was A/B-tested over 20 runs and **the win could not be demonstrated**: cache-read median −10.65%
against a 64.2% within-arm spread, sign reversing four times as n grew. **The DoD as written is
dead** — both arms met `<60k peak`, arm A's worst run reaching 58,184 *without* the contract, so
the threshold never discriminated on a specimen this size. The contract itself costs ~230 tokens
re-read every turn, ≈1.4% of a median run. It stays merged on engineering judgement (never worse
on any metric measured; the specimen gave read discipline the least surface to act on), not on
evidence. Any re-test needs a corpus with 5–10× the fixed floor, must measure **peak prefix**
rather than totals, and must run on an orchestrator with issue #70 fixed — now landed, see
[[decisions/ADR-0009-plugin-root-resolution]], so that precondition is met. The original 101k peak / 6.65M cache-read /
117-turn baseline still lives in a downstream Android project's run history, not this repo, and
remains the only production-scale reference point. Full record:
[[architecture/benchmark-e2-read-discipline]].

### E1 — Trim the addressable fixed prefix (floor) *(structural)*
Shrink what rides in **every** subagent turn: agent `.md` verbosity, and the `_brief`/prior-phase
context the orchestrator injects into each Task prompt (pass a compact digest, not full prior
outputs). Every 1k shaved off the floor saves ~turn-count reads per phase (117 turns/run). `docs`
is the worst offender — 21k floor, 50% of its reads. **DoD:** floor per turn ≤10k avg (from
12–21k); est. ~0.5M reads/run saved. Likely needs an ADR (touches the orchestrator↔subagent
contract) — see [[decisions/_moc-decisions]].

### E3 — Reduce turn count *(multiplier on both floor and growth; quality-risky)*
Fewer tool round-trips per phase: batch parallel reads, collapse edit→re-verify loops, avoid
redundant tool calls. `development` (39 turns) and `documentation` (23) are the outliers. Turn count
multiplies both the floor and the growth, so cuts compound. Highest risk of hurting output quality —
schedule after E5 gives a safety metric. **DoD:** turns/phase down on the outliers with review/test/
qa verdicts unchanged.

### E4 — Model routing for cache-heavy context *(low leverage; note only)*
Cache-read costs 0.5 (opus) / 0.2 (sonnet) / 0.1 (haiku) per MTok — 5× spread. Most phases are
already tiered sensibly (docs=haiku, most=sonnet, BA=opus). Residual: the **orchestrator main-loop**
runs on opus and its own context re-reads cost ~$1.10/run; and confirm no opus is placed on a
cache-heavy, low-reasoning phase. Low expected savings vs. E1–E3 — track but do not over-invest.
Depends on the `config/models.json` pricing SSOT in [[components/sdlc]].

### E6 — Deterministic prefix ordering for max prompt-cache hits *(structural; from plan §1.1)*
Guarantee that every agent's stable prefix — harness system prompt, loaded Second Brain context,
and framework rule injections (Retrofit/Room/etc.) — is assembled in a **byte-identical sequence**
across all phases and runs, so the static bulk is served as cache hits rather than fresh input.
Today AAR lessons are appended to the stable prefix; ordering elsewhere is not contractually fixed.
This is the write-side complement to E5's read-side measurement and to E1's floor-trimming. **DoD:**
a documented canonical prefix order enforced by the orchestrator; cache-hit ratio on a comparable
run rises vs. the E5 baseline. Likely needs an ADR (defines the orchestrator↔subagent prefix
contract) — see [[decisions/_moc-decisions]].

### E7 — Dynamic context pruning in review loops *(guidance + code; from plan §1.2)*
In `Review(⇄Dev ×N)` cycles the prompt grows every iteration with the full text of prior failed
attempts. Insert a cheap intermediate step where a faster model (Haiku) **summarizes the previous
failed attempt** — isolating the root cause and the distilled requirement — before the next Dev
iteration, so the developer receives the lesson without the conversational noise. Targets the 73%
growth component (complements E2/E3). **DoD:** peak-prefix inside a 3-iteration review loop drops
materially with no regression in the eventual review/test verdict; the summarization step is itself
cheap (Haiku-tiered). May warrant an ADR (changes the review-loop contract).

### E8 — Micro-task batching (shared session for 3–5 bugfixes) *(feature; from plan §1.3)*
Extend the existing `/sdlc:batch` parallel command with a mode that **auto-groups 3–5 trivial
bugfixes into a single agent session**, so project context (system prompt + Second Brain load +
framework rules) is initialized once and its cost amortized across every resolved ticket instead of
paid per-ticket. Pairs with F2 (fast-track) for the trivial-change lane. **DoD:** a batch of N small
fixes costs measurably less than N independent runs (init cost paid once); each fix still gets its
own verification. Flagged in the plan summary as one of the two highest-ROI next steps.

---

## Track F — time optimization & parallelism

Deeper concurrent workflows to cut **absolute** completion time, building on the shipped
`[security ‖ test]` parallel group. Derived from the Roadmap Development Plan §2.

### F1 — Speculative TDD (QA ∥ Dev) *(from plan §2.1)*
Immediately after BA plan approval, launch the QA test-writing phase **concurrently** with the Dev
implementation phase (leveraging the superpowers TDD capability), then merge and verify both outputs
in the following step. Targets up to a ~40% cut in the Dev→QA lifecycle. Risk: tests and
implementation may diverge from the same spec — the merge/verify step must reconcile them. **DoD:** a
workflow recipe expressing `Dev ∥ QA` after BA; measured wall-clock reduction on a representative
feature with review/test verdicts unchanged. Likely needs an ADR (new concurrency contract).

### F2 — Fast-track bugfix DAG (LOC-gated) *(from plan §2.2)*
An ultra-short micro-fix recipe that trims the pipeline DAG for trivial changes. The orchestrator
uses telemetry (`/sdlc:doctor`, `LOC_TOUCHED`) to classify a change and, when
`LOC_TOUCHED < 20 AND NO_ARCHITECTURE_CHANGES`, bypasses the heavy analytical phases and runs
`Dev → QA → Docs`. Pairs with E8 (batching) and G1 (self-healing) for the trivial-change lane.
**DoD:** a gated workflow recipe with an explicit, logged trigger threshold; trivial fixes skip
BA/Security while non-trivial changes still take the full pipeline (no silent under-review).

---

## Track G — quality & autonomy

Reduce human intervention and raise code quality without inflating prompt cost. Derived from the
Roadmap Development Plan §3.

### G1 — Self-healing compiler/lint micro-loops *(from plan §3.1)*
Instead of a full, expensive Review-loop for mechanical compile/lint failures, add local build hooks:
run build/lint validation, intercept `stderr` on failure, and feed the raw output **directly back to
the Dev agent** — **hard-capped at 2 attempts** — escalating to the Reviewer only if self-healing
fails. Flagged in the plan summary as the highest-ROI next step (eliminates trivial blockers).
**DoD:** a build/detekt failure is auto-fixed within ≤2 Dev attempts without invoking the reviewer;
the 2-attempt cap is enforced and logged; genuine logic failures still escalate. Aligns with the
existing QA 3-attempt-cap discipline.

### G2 — Contextual classification of AAR lessons *(from plan §3.2)*
Prevent `.claude/sdlc-lessons.md` from bloating every prompt over time: the AAR agent applies a
semantic tag (`[UI]`, `[Network]`, `[Security]`, …) to each new lesson, and at phase initialization
the orchestrator **selectively loads only the lessons whose tags match the incoming task's domain**.
Keeps contextual awareness concentrated and impactful, and directly reduces the fixed-floor cost E1
targets. Extends Track C1 (AAR learning cycle). **DoD:** new lessons are tagged; a phase loads only
domain-relevant lessons rather than the whole file; floor contribution of lessons scales sub-linearly
with lesson count.

---

## Track H — plugin discovery correctness

### H1 — Filter foundation discovery to *enabled* plugins
[[decisions/ADR-0009-plugin-root-resolution]] fixed **which tree** gets globbed (issue #70), but
discovery still reads the plugin **cache**, which holds every plugin ever installed under that
config dir — enabled or not. `enabledPlugins` in the config is never consulted, so a cached but
disabled foundation can still satisfy its `detect` block, outscore the vanilla default on
`priority`, and change the pipeline's phase composition, agent set and cost. The #70 fix bounds the
blast radius to one config tree; it does not close this.

Open design questions, which is why it is not folded into the fix: where enablement lives
(`plugins/installed_plugins.json` vs. per-project settings), whether a plugin the project
legitimately detects but has not enabled should warn rather than be skipped, and what a
development checkout (plugin loaded from a local path, never "installed") should mean.
**DoD:** foundation selection considers only plugins enabled for the active config dir; a detected
but disabled foundation is reported, not silently used; a local-path development plugin still works.

---

_All other `CORE-TODO.md` sections are `DONE`/`DROPPED` — no legacy remainder to carry forward._
_Tracks E6–E8, F, and G derive from the repo-root `Roadmap Development Plan.md`._
