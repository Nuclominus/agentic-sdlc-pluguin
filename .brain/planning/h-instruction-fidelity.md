---
status: planned
---

# Track H — instruction fidelity

> Design spec for [[planning/roadmap]] **Track H**. Goal: make the orchestrator's own procedure
> execute as written, instead of as paraphrased. Motivated by a measured incident, not a
> hypothesis. See [[planning/_moc-planning]].

## The problem, as measured

`pipeline-orchestrator/SKILL.md` is 2453 lines of prose that an LLM reads and executes. Prose read
by a model is a **probabilistic** instruction: better wording raises the odds of compliance but
never reaches 1. On the Android run `native-chat-engine-s2-thread-list` (2026-07-28) four separate
mandated steps were silently not executed, all in the same run:

| Mandated step | What happened | Cost of the miss |
|---|---|---|
| 3d-1b — price each phase in-run | never invoked | cap gate blind on all 6 phases |
| 5b-0 — enrich cost from transcripts | never invoked | run reported `$—` against a real $15.38 |
| 5b(c) — `WARN: cost enrichment incomplete` | never printed | the two misses above stayed invisible |
| 5 — render timestamps from `.checkpoint/_started_at` via `date -u -r` | hand-transcribed local clock stamped `Z` | run window off by 3h20m |

Ground truth: across 42 `Bash` calls in that session, `tools/usage/cli.mjs` appears **zero** times.
Nothing failed — the steps simply did not run, and the run reported success.
[[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]] records the incident and the
mitigations shipped in #92, which make these misses *loud* but do not make them *impossible*.

This is the same lesson as
[[decisions/ADR-0008-read-discipline-contract]] and the "machine contracts cannot live in prose"
finding from the G1 validation runs, generalised: **the failure is not that the prose was unclear.
It is that prose is the wrong medium for a procedure.**

## The principle

Four levels of reliability. The work of this track is moving load-bearing steps *down* the table.

| Level | Form | Reliability |
|---|---|---|
| 1 | prose in `SKILL.md` ("do X") | probabilistic — what broke |
| 2 | prose + machine verification after the fact | deviation becomes visible, but only afterwards |
| 3 | one command replacing N prose steps | far smaller surface to skip |
| 4 | code (deterministic runner / tool) | total — but only where no judgement is needed |

Corollary: **the instruction that cannot be executed wrongly is the one that does not exist.** The
target is not a more emphatic `SKILL.md`; it is a smaller one.

## Phases

### H1 — Transcript compliance auditor (do first)

A new `sdlc-lint compliance <session.jsonl> --run <slug>` verb: check a machine-readable manifest of
required steps against what the session transcript shows the orchestrator actually did. The
transcript is the only ground truth for "was the instruction followed" — this is precisely the
manual analysis that found the incident (grep for `usage/cli.mjs` across the run's Bash calls),
turned into a tool.

Manifest entries are observable facts, not intentions — e.g. `usage/cli.mjs phase-cost` invoked once
per phase; `usage/cli.mjs enrich` invoked once per run; `report/cli.mjs` invoked; a `date` call
between reading `_started_at` and writing telemetry.

**DoD:** run over every historical run in `docs/plans/` and `bench/results*` that still has a
transcript, and publish a **compliance rate per step**. That number decides H4's scope — right now
we do not know whether this run was an outlier or whether the orchestrator routinely skips ~20% of
its own procedure. Diagnostic value first; CI gating second.

**Implementation spec: [[planning/h1-compliance-auditor]].** Two findings from designing it change
what H1 can deliver. `bench/` holds no telemetry, so the corpus is the downstream Android project:
18 runs, of which only **12** carry an `agent_id` to anchor a transcript. And the steps are younger
than the corpus — `usage/cli.mjs phase-cost` became mandatory on 2026-07-28, ~7.5h before the
incident run, so `3d-1b` gets a denominator of ~3 and yields no usable rate. With `n=12` and no
`plugin_version` in telemetry (this item adds it), every published rate is **provisional**, and a
result near the 80/95% boundary is a reason to keep measuring rather than a decision on H4.

### H2 — Collapse multi-step prose into single commands ✅

Step 5b was four separate prose sub-steps (enrich → verify → cap reconcile → render). One
`cli.mjs finish <slug>` doing all of it end-to-end leaves the model one chance to deviate instead of
four. Same treatment for any other multi-call sequence the audit in H1 flags as frequently partial.

**DoD:** the count of *mandated tool invocations* in `SKILL.md` drops measurably; H1's compliance
rate for the collapsed steps rises.

**Shipped.** The collapse went one step further than the item as written: it took Step 5's clock
with it, because H1 named `5-clock` — not 5b — as the worst-scoring step in the set. A new shipped
tool `plugins/sdlc/tools/run/` composes the two existing ones without changing either;
`clock.mjs` became the sole writer of `started_at` / `completed_at` / `wall_clock_seconds`, derived
from the machine anchor through `Date`, so the BSD-vs-GNU `date` fallback left the prose along with
the step. `--session` was not moved but **deleted**: the enricher already recovers the orchestrator
session from a phase transcript, so the model can no longer supply the wrong one. See
[[decisions/ADR-0014-the-run-tail-is-one-command]].

**Measured (2026-07-29):**

| | before | after |
|---|---|---|
| mandated tool invocations in the run tail | 3 | **1** |
| `SKILL.md` lines | 2509 | **2436** |
| live contracts | 6 | **4** (3 retired) |

The historical rates **reproduce exactly** after the collapse — `2-4-anchor` 100%, `5b-2-report`
87%, `6-journal` 87%, `5b-0-enrich` 80%, `5-clock` 67%, overall 82.3% over the same 15 auditable
runs. That is what the retirement window buys: replacing a step no longer costs the baseline it was
measured against. Every rate stays **provisional** for H1's original reason — no run in the corpus
carries `plugin_version`, so step availability is dated from commits rather than from evidence.

`5b-finish` currently reports `n=0` (`na: predates` on all 15 runs), not `0%`. **H2's own effect is
therefore not yet measured**, and cannot be until real runs exist on the new version. The next
measurement is the one that matters: does a step that is now a single command beat the 67% it
replaced? Re-run `sdlc-lint compliance` once ~10 runs carry the new tail.

### H3 — The machine-value invariant ✅

A rule with lint teeth: **the model never transcribes a value a machine already holds.** Timestamps,
costs, token counts, agent ids, iteration counters. Three of the four defects above are instances of
this. Where a value exists on disk, the contract must pass the *path*, never the number.

**DoD:** an audit of `SKILL.md` for every place it asks the model to produce a machine-known value,
each one either removed or justified in writing; a `sdlc-lint` check that fails on new ones.

**Shipped.** `plugins/sdlc/MACHINE-VALUES.md` is the contract, the audit and the lint's own input at
once — a fenced ` ```machine-values ` registry of `key: owner` lines, read by the new
`sdlc-lint machine-values` verb. The check anchors on the **left-hand side** of a computation, which
is what keeps it silent on the dozens of lines that legitimately discuss these keys. See
[[decisions/ADR-0015-the-machine-value-invariant]].

The argument for a lint over firmer wording came from the audit itself: the two definitions of
`cache_hit_ratio` had already diverged — `SKILL.md` said `cached / max(input, 1)`, `usage.mjs:628`
says `cached / (input + cached)` — with no symptom, because the tool overwrites the model's answer.

**Measured (2026-07-29):**

| | before | after |
|---|---|---|
| formulas over machine-owned keys in `SKILL.md` | 6 | **0** |
| machine-owned telemetry keys the model computes | 21 | **0** |
| escape-hatch exemptions in the tree | — | **0** |
| `SKILL.md` lines | 2436 | 2441 |

The line count **rose by five**, against this item's own expectation. Recorded as a wrong
prediction rather than dropped: H3 removes arithmetic, and the replacement text explains *why* a
value is not the model's. The first two rows are the real metric. H3 adds no mandated step, so it
produces no compliance rate of its own — its effect is a smaller surface under the rates
[[planning/h1-compliance-auditor]] already tracks.

Two honest limits. The check is **lexical**: a stale Step 5 summary that still described all three
retired envelope shapes, char/4 estimation included, passed it and was found by reading instead. And
`total_subagent_tokens` is deliberately **not** in the registry — `finish` never writes it, so
removing the model's sum would delete the value rather than move it. That the lint stays silent on
exactly that one sum is the contract's machine-owned/model-owned split validating itself.

### H4 — Deterministic control flow

The largest lever and the largest cost. Today "the orchestrator" is an LLM reading 2453 lines and
deciding phase sequencing, gates, checkpoints and telemetry assembly for itself. The alternative is a
real runner: control flow in code, LLM agents only for the phases that need judgement. Then
compliance stops being a property to measure and becomes a property of the program.

**Gated on H1's numbers.** If compliance is ~95%, H2 + H3 + H6 are enough and this is not worth the
rewrite. If it is ~80%, this is the only real fix. Do not start it before that data exists.

**H1 answered this on 2026-07-28: 82.3%** over 15 auditable runs
([[planning/h1-compliance-auditor]]). Near-boundary, and `provisional` — but the aggregate is not
what decides. The **spread** does: steps that are a single command score 87–100% (`2-4-anchor` 100%,
`5b-2-report` and `6-journal` 87%, `5b-0-enrich` 80%), while the one genuinely multi-step
procedure — `5-clock`, which reads the anchor, computes, and renders with a BSD/GNU fallback —
scores **67%**, the worst in the set, despite carrying the most emphatic prose in the whole file.

Compliance tracks the number of separate things an instruction asks for, not how firmly it asks.
H4 would fix the 67%; so would collapsing that step into one command (H2), at a fraction of the
cost. **H4 stays gated — now on evidence rather than intuition.** Revisit after H2 and H3 have
landed and 10 runs carry `plugin_version`: if compliance has not moved above ~90% by then, this
becomes the answer.

**H2 landed 2026-07-29** ([[decisions/ADR-0014-the-run-tail-is-one-command]]), which removed the
67% step rather than improving it. **H3 landed the same day**
([[decisions/ADR-0015-the-machine-value-invariant]]), removing the six remaining formulas rather
than adding a step to check them.

Both halves of the *work* this gate waited on are therefore done. What remains is only the
**measurement**: ~10 runs carrying `plugin_version` on the new tail, then `sdlc-lint compliance`
again. Do not revisit before that data exists — the whole point of the gate is that it is decided
by a number, not by how the prose reads. Note that neither H2 nor H3 can be credited in advance:
H2's own contract (`5b-finish`) still reports `n=0`, and H3 adds no contract at all, so the next
run of the auditor is the first evidence either way.

**Re-measured 2026-08-04 — the threshold is met, the sample size is not.** The audit now runs over
**two** downstream corpora: `~/parlor-android` (19 auditable, was 16) and a second, previously
unaudited project `~/work/Citrus-Android` (9 auditable). Combined **28 auditable, 6 excluded**.

| rate | contract | n | was (2026-07-29) |
|---:|---|---:|---|
| 100% | `2-4-anchor` | 28 | 100% |
| 100% | `5b-finish` | **5** | 100% · n=1 |
| 93% | `6-journal` | 28 | 88% |
| 67% | `3d-1b-phase-cost` | 9 | 40% · n=5 |

Overall on **live** contracts: **92.9%** (parlor alone 90.0%, Citrus alone 100.0%); 87.8% including
the three retired ones. `seal:stop-hook`: orchestrator 5, stop-hook 4, unrecorded 19.

Against this gate's own wording — *"if compliance has not moved above ~90% by then, this becomes the
answer"* — **92.9% clears it**, and the step that motivated H4 in the first place is gone: `5-clock`
at 67% was replaced by `5b-finish`, which is **5/5**. That is the first real evidence H2 worked.

But the gate's *other* half is unmet. Nine runs carry `plugin_version`; only **five** are on the new
tail, so `5b-finish` has `n=5` and a single failure drops it to 80%. The gate asked for ~10 for
exactly this reason.

**H4 stays gated, but the reading has changed from undecided to leaning against.** Nothing measured
here argues for the deterministic-runner rewrite; the aggregate cleared the bar and the one step it
was going to fix no longer exists. Roughly five more runs on the new tail settle it.

Note also that H5's re-measurement found the **start window** (Steps 0→1d, before any phase work) is
**17% of run cost** and growing, and that it is now being collapsed into one shipped command —
[[decisions/ADR-0019-the-run-start-is-one-command]], specified in
[[planning/h5-d2-start-resolution-command]]. That is a larger, separately-gated lever and is
explicitly **not** what this gate waited on: H4 concerns phase sequencing, gates and telemetry
assembly being model-owned, while resolution is deterministic input-gathering. Shipping ADR-0019
must not be read as evidence about H4 in either direction.

### H5 — Prompt surface reduction

`SKILL.md` is itself a compliance risk, on two claims the original wording ran together and this
revision separates — because they are different mechanisms with different evidence and different
fixes:

- **Volume.** Adherence degrades as the file grows. Plausible, and consistent with H1's spread, but
  **untested**: no measurement here isolates size from complexity.
- **Distance.** Adherence degrades with the gap between where a rule is written and the moment it
  applies. Also untested, and *not* the same claim — a short file can still state a rule 400 lines
  from its use.

Just-in-time loading of procedure fragments addresses the second and only incidentally the first.

#### The cost argument: compute it, do not benchmark it

The original text said "measure both effects together" alongside Track E. Sizing that showed
benchmarking the cost half is **futile**, and the arithmetic says so before a single run is spent.

Measured on `native-chat-engine-s4-unread` (2026-07-28): the orchestrator main loop ran **47 turns**
against **7,850,973** cached input tokens — an average prefix of ~167k per turn. `SKILL.md` at
156,080 chars is roughly **39k tokens** (a `chars/4` estimate; no machine holds the real number),
i.e. ~23% of that prefix, ~$1.27 of the run's $12.81, or **~10% of total run cost**. Across the
corpus the orchestrator loop is 22–69% of run cost, median 43%.

Now hold that against the noise floor already recorded in [[planning/backlog]]: run-to-run spread on
total cache-read is **55.6–64.2%**, and anything below ~50% is unverifiable at n≈10. **Even deleting
the file outright lands an order of magnitude under the detection bar.** An A/B here reproduces
[[architecture/benchmark-e2-read-discipline]] — 20 runs to conclude −10.65% inside 64% noise.

The correct instrument is arithmetic, not experiment. Unlike E2's, this mechanism is
**deterministic**: a token removed from the stable prefix is not billed on every turn, so the saving
is `removed_prefix_tokens × turns × 0.1 × input_price`, computable from one run's telemetry. Report
that number; do not spend a campaign failing to detect it.

#### The risk the item did not name

JIT loading means the orchestrator must **read** a fragment mid-run. Every such read is a step that
can be skipped — and H1's finding is precisely that compliance tracks how many separate things an
instruction asks for. H5 therefore threatens to trade one monolith, present by construction, for N
fragments each carrying its own chance of never being loaded. **It can lower compliance while
lowering cost**, which would invert the track's purpose. Any design must say which fragments are
load-bearing at what moment, and how a missed load is detected rather than silently tolerated.

A hard boundary comes with it: [[decisions/ADR-0008-read-discipline-contract]] puts the read
contract inside `=== STABLE PREFIX ===` deliberately, so it is served as a cache hit on every
subagent turn. That content cannot move, and neither can anything else whose value is being present
without being fetched.

**DoD:** a fragment map naming what stays in the prefix and what loads on demand, each with the
moment it applies; the deterministic cost saving computed rather than benchmarked; and a compliance
re-measurement showing the rate did **not** fall — H5 is refuted, not merely unproven, if
fragmentation costs more compliance than volume was costing. That last part shares the corpus H4
waits on, so H5's *design* is unblocked while its *acceptance* is not.

**Measured 2026-07-29; nothing cut. [[planning/h5-prompt-surface]].** The arithmetic this item
demanded instead of a benchmark came back and **inverted the item's premise** — twice over.

*Text volume:* deleting `SKILL.md` outright saves $0.79–$0.95 on a $9.50–$13.29 run (7–8%); the
largest realistic cut — the 926 judgement-free lines of Steps 0→1d — saves **~3%**. Shrinking the
prompt does not pay for itself.

*Turn count:* the same formula has a second factor the first pass omitted. The orchestrator's
overhead is **72% cache read**, because the prefix is re-billed in full on every turn. Over 24
sessions, the window from skill invocation to the first `Agent` dispatch — Steps 0→2, before any
phase work exists — is a median **27 turns costing $1.42** (range 6–47 turns, $0.18–$2.84). On
`s5-presence` it is 34 turns and **$2.21, 23% of the run**, spent on 18 `ls`/`cat`/`Read` calls.
(Those 34 are assistant JSONL lines; in API calls the same window is 13 — unit correction in
[[decisions/ADR-0019-the-run-start-is-one-command]], PR #125. The cost is unaffected.)
Collapsing that into one command is worth **~12–15% of run cost, ~5× the text-volume term**.

Both terms point the same way: **the lever is removing the model's steps, not its words.**

Two findings arrived with it. First, the same measurement pass sharpened H1's spread along a second
axis — see the track-level note below. Second, the risk this item named in the abstract now has a
number: the most obvious JIT candidate (the 196 lines of per-phase base prompts) would convert 4.9%
of the prefix, worth ~$0.04/run, into a **once-per-phase read** — the shape measuring 40%. **Any H5
design must forbid moving per-dispatch payload out of the prefix.** What is safe to remove is prose
that is never needed at runtime at all (rationale, history, worked examples), and what is safe to
*replace* is a deterministic block whose replacement is invoked **once per run**.

## Track-level finding — cardinality, not just complexity (2026-07-29)

H1 established that compliance tracks how many separate things an instruction asks for, not how
firmly it asks. The 2026-07-29 measurement adds a second axis, from a cell H1 could not yet read:

| rate | contract | shape | cardinality | n (2026-07-29) | n (2026-08-04) |
|---:|---|---|---|---:|---:|
| 100% | `2-4-anchor` | one Bash line | once-per-run | 16 → 100% | 28 → **100%** |
| 40% | `3d-1b-phase-cost` | **one Bash line** | **once-per-phase** | 5 → 40% | 9 → **67%** |

Same command, same length, same emphasis. The only variable is **how many times it must be
re-remembered inside one run**. `5-clock` at 67% was one step asking for three things; `3d-1b` at
40% is one thing asked for seven times. The `partial 6/7` run scores decay, not a clean miss.

**Updated 2026-08-04.** The thin cell was re-measured on a corpus nearly twice the size and moved
**40% → 67%** — against the finding. The direction survives (`3d-1b` is still the worst live
contract and the only failing one, still the same one-line shape as the 28/28 `2-4-anchor`), but a
60-point gap became a 33-point one at `n=9`, still one run short of the `n≈10` bar the measurement
set itself. **Treat "collapse cardinality, not lines" as directional, not established.** Details,
method and the resume point: [[planning/h5-prompt-surface]].

### H6 — Hooks as the deterministic tail ✅

A `Stop` hook (`plugins/sdlc/hooks/seal-run.sh`) that runs `enrich` + report rendering itself, so
the sealing of a run is not a step the model owns at all. Idempotent via a `.checkpoint/_sealed`
marker, scoped by recency, failing open. Only possible *because* the enricher became self-sufficient
in #92 (agent-id-anchored session lookup — it needs no argument the model would have had to supply).

Explicit limits, so this is not oversold: a hook enforces **state**, never intent; it cannot fire if
the session is killed before `Stop`; and it repairs after the fact, so it can do nothing for a value
consumed *during* the run (the 3d-1b cap gate stays the orchestrator's responsibility).

**Implementation spec: [[planning/h6-hook-deterministic-tail]].** Sizing it settled the one question
the item as written left open — *when* is a run finished? Recency cannot tell a paused run from a
completed one, so the gate is **completeness**: every phase in the resolved DAG carries a terminal
checkpoint. Measured over the 19-run corpus, that gate opens for 10 runs, including the ADR-0012
incident run (H6's known-positive), and stays shut for the three H1 named as carrying most of the
damage. Two consequences fall out: the completeness rule must **move into the plugin** — it lives in
the repo-root `sdlc-lint` today and so does not ship to the consumer running the hook — and the
clock must come from the run's newest mtime rather than `Date.now()`, or a late hook charges the run
for the time the user spent chatting afterwards.

**Shipped.** [[decisions/ADR-0017-the-tail-has-a-net]]. The gate turned out to be the whole design
question, and it is settled by measurement rather than by a timeout: completeness (every phase in
the resolved DAG terminal) opens for 10 of the 19 corpus runs including the ADR-0012 incident run,
and stays shut for the three H1 named as carrying most of the damage. Two things fell out of sizing
it — the completeness rule had to **ship** (it lived in the repo-root `sdlc-lint`, which the hook
cannot reach), and the clock had to come from the run's newest mtime, since a hook is late by
construction and `now - anchor` would bill the run for the time after it finished.

H6 adds no mandated step, so like H3 it produces no compliance rate of its own. What it adds is
`sealed_by`, an orthogonal signal: how often the net had to fire. `5b-finish` is deliberately
untouched — a hook leaves no `tool_use` block, so it cannot flatter the number that decides H4.

## Order and dependencies

```
H1 (diagnose) ──► decides scope of H4
   │
   ├─► H2 (collapse) ✅ ─┐
   ├─► H3 (invariant) ✅ ├─► re-measure with H1
   └─► H6 (hook tail) ✅ ─┘
H5 runs alongside, shared with Track E
```

H1 is deliberately first and cheap. Everything after it is sized by its output rather than by
intuition.

## Out of scope — what this track cannot deliver

Steps requiring judgement stay probabilistic: writing an honest summary, choosing the right ADR,
noticing the fail-open defect the reviewer missed in the same run. For those, detection after the
fact is the only instrument. The guarantee this track offers extends exactly as far as the part of
the procedure a machine can perform or verify — and not one step further.

## Related

- Incident and the shipped mitigations: [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]] (#92)
- Same medium/message failure, earlier instance: [[decisions/ADR-0008-read-discipline-contract]]
- Machine anchor over model prose: [[decisions/ADR-0007-overhead-window-authoritative-anchor]]
- Shares the prompt-size goal with Track E in [[planning/backlog]]
