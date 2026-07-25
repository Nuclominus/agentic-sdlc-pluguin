# E2 benchmark harness — reference task for measuring cache-read cost (design)

- **Date:** 2026-07-25
- **Status:** approved (rev. 2 — incorporates review of rev. 1)
- **Track:** E — pipeline cache/cost efficiency (see `.brain/planning/backlog.md`)
- **Purpose:** close the deferred behavioural half of E2's Definition of Done, and give E1/E3/E4 a
  reusable measurement instead of the same problem again.
- **Related:** `2026-07-25-e2-read-discipline-design.md` (the change being measured, PR #68)

## Context

E2 shipped with its Definition of Done deliberately split. The in-repo half is enforced by CI. The
behavioural half — `peak_prefix_tokens` dropping below **60k**, from a recorded baseline of **101k
peak / 6.65M cache reads / 117 turns** — is **unmeasured**, because the baseline telemetry lives in
a downstream Android project and this repository holds only synthetic fixtures. The roadmap,
backlog and ADR-0008 all say so plainly. This harness is what makes that claim checkable.

E1 (trim the fixed floor), E3 (reduce turn count) and E4 (model routing) have the same measurement
problem. Building the instrument once serves all four.

### Why not Docker

The obvious first instinct is to isolate the run in a container. It isolates the wrong variable.

`peak_prefix_tokens` is derived from Claude Code subagent transcripts, which live on the **host**
under `~/.claude/projects/…`, and its value depends on what the model *chose to read* — not on the
filesystem it read from. Ranked by how much each threatens the measurement:

| Threat | Docker | Remedy used here |
|--------|--------|------------------|
| **Run-to-run nondeterminism** | no help | N runs, medians, spread treated as a floor |
| **Time-correlated drift confounded with arm** | no help | interleaved run order |
| **Global config drift** (settings, memory, MCP servers) | partial | one frozen config dir per arm |
| Pipeline mutates the target project between runs | yes | disposable copy per run |
| Ambiguity about which arm produced a run | partial | manifest written at prepare, checked at harvest |

The top two are dominant and Docker touches neither. A single run per arm cannot separate a real
change from noise: if spread is ±30% and the target effect is −40%, one pair can show anything,
including an apparent regression where there was an improvement. Docker also adds Claude Code auth
inside the container and transcript plumbing back out, for none of the protection that matters.

So: **arm = a frozen Claude Code config, project state = a fresh git repo per run, confidence =
run count and run order.**

### Verified facts this design depends on

```
~/.claude/plugins/marketplaces/agentic-sdlc   git clone, on develop @ 9d1af30
~/.claude/plugins/cache/agentic-sdlc/sdlc/    1.9.0/ and 1.9.1/ coexist
known_marketplaces.json                       autoUpdate: true
```

`develop @ 9d1af30` is exactly the merge-base of PR #68, so the currently-installed `sdlc@1.9.1`
**is** arm A. `autoUpdate: true` is a hazard — the clone can refresh mid-experiment and silently
change an arm between runs.

## Goals / Non-goals

**Goals**
- A reference project and a fixed task brief that produce comparable pipeline runs on demand.
- A run protocol whose known confounds are either eliminated by design or recorded explicitly.
- A committed baseline artifact for E1/E3/E4, carrying an honest statement of its own strength.
- Reuse of the existing metric code — no second implementation of the cache-pressure math.

**Non-goals**
- Reproducing the 101k absolute figure. That came from a large real app. This harness
  re-establishes its own baseline and measures the **delta between arms**. Anything else repeats
  the mistake E2 was careful to avoid.
- Automating the pipeline invocation. `/sdlc:start` runs inside Claude Code; a shell script cannot
  call it. Preparation, harvesting and comparison are scripted; the runs are human-triggered.
- Statistical significance. At the run counts this budget allows, it is unreachable — see
  *Statistical honesty* below. The harness produces engineering judgment, clearly labelled.
- Containerisation, CI integration, or scheduled regression runs. Each run costs real money.

## Architecture

```
bench/
  reference-app/            the specimen — committed, NEVER mutated by a run
  task.md                   the brief, byte-identical across arms
  answers.md                scripted human responses to approval gates / questions
  prepare.mjs               copy → scratch, git init, write manifest, print run command
  harvest.mjs               telemetry + manifest → results/, archive scratch
  compare.mjs               medians, spread, verdict
  results/                  harvested runs, committed — the evidence
  archive/                  per-run tarballs of the whole scratch tree
  baseline.json             agreed reference numbers for E1/E3/E4
  test/                     unit tests + fixtures for the three scripts
```

### The mutation problem, and the git repo that solves it

The pipeline **writes to the project it runs on**: development edits code, QA adds tests,
documentation writes `docs/plans/{slug}/`. Run 2 would start from a different state than run 1, and
the harness would measure accumulated drift rather than the contract.

`bench/reference-app/` is never run against. `prepare.mjs` copies it into the session scratch
directory. **The copy must then be `git init`-ed with a single initial commit**, because the
pipeline's development, QA and documentation phases expect a working git repository — branches,
commits, and diffs for review. A bare file tree would either fail a phase or behave differently
from real use, and in both cases the harness would be measuring the wrong thing.

Consequence for testing: the copy is *not* byte-identical to the specimen. The assertion is "file
tree identical to the specimen, plus a fresh single-commit git repository".

### The reference app, and why it must be large enough

Stack detection for `android-foundation` requires only:

```yaml
detect:
  all:
    - any: [file_exists: settings.gradle.kts, file_exists: settings.gradle]
    - file_glob: "**/*.kt"
```

**No Android SDK is required.** A pure Kotlin/JVM Gradle project wins `android-foundation` at
priority 300 — the heavy agent set that produced the original baseline — while building and testing
with plain `./gradlew test` in seconds.

**Sizing is a power question, not an aesthetic one.** Read discipline can only move the part of the
prefix that consists of file content the agent chose to pull in. The fixed floor — harness system
prompt, tool schemas, agent `.md`, injected context — is 12–21k per turn and is untouchable by E2
(that is E1's job). If the readable corpus is small relative to the floor, the design cannot detect
the effect even if it is real.

Envelope, on the measured floor:

```
floor (android-docs, worst case)     ≈ 21k tokens/turn
corpus of an 18-file app             ≈ 27k tokens   → addressable ≈ 27/(21+27) ≈ 45%
corpus target: ~3× floor             ≈ 60k tokens   → addressable ≈ 60/(21+60) ≈ 74%
```

The original 18-file sketch was undersized. **Target ~45–60 Kotlin files, ~60k tokens of readable
corpus** — an order library with several bounded contexts, not a toy. This is also the correct
response to a noisy pilot: **enlarge the task, never shrink it.** Shrinking reduces the very effect
being measured and yields a quiet benchmark that sees nothing.

Shape:

- `domain/model/` — order, product, customer, pricing and inventory models
- `domain/Result.kt` — typed result with a `ValidationError` case
- `domain/usecase/` — ~10 use cases; only `CreateOrder` is the task's target, the rest are
  realistic read-noise an agent must navigate past
- `domain/repository/` — repository interfaces
- `data/` — in-memory implementations
- `app/src/test/kotlin/` — passing tests for several use cases, so the QA phase follows an existing
  convention rather than inventing one

`gradle/libs.versions.toml` declares **no** framework coordinates, so no additive provider
activates (`additive: []`). Framework injection is not what is being measured, and excluding it
removes a variance source.

### The reference task and the scripted human

`bench/task.md`, passed byte-identically to `/sdlc:start` in every run:

> Add input validation to the `CreateOrder` use case. Reject an empty customer id, a non-positive
> quantity on any order line, and a product id that does not exist in `ProductRepository`. Surface
> each failure as a `ValidationError` through the existing `Result` type rather than throwing.
> Follow the existing test conventions.

Chosen because it reads far more than it writes: the agent must consult the models, the `Result`
type, the repository interfaces and the existing tests, while editing essentially one file. That is
exactly the profile where read discipline either helps or does not.

**The human is a variance source too.** The pipeline has approval gates and may ask clarifying
questions. `bench/answers.md` scripts those responses verbatim — the same discipline as the brief.
Anything not covered by `answers.md` is answered with the literal string `proceed`, and the
deviation is noted in the run's manifest.

### Metrics — two primaries, deliberately

`peak_prefix_tokens` is a **maximum**. Maxima have worse dispersion than sums and are biased
upward. It is the noisiest detector available, and it is the primary only because E2's DoD is
worded in terms of it.

So the harness reports **two co-primary metrics**:

| Metric | Role |
|--------|------|
| `total cache-read tokens` (a sum) | **decides whether anything moved.** Quieter, and it is the actual cost driver. Baseline: 6.65M subagent + 2.19M orchestrator. |
| `peak_prefix_tokens` (a max) | **scores E2's DoD as written** (<60k from 101k). Reported with its full range, never as a point estimate. |

Secondary: `reads_per_turn`, `turns`, `total_cost_usd`, and the same figures for the `development`
and `documentation` phases alone — the two heaviest.

`compare.mjs` imports `computeMetrics` from `plugins/sdlc/tools/aar/metrics.mjs`, the same code that
already produces these for the HTML report and the AAR. One source of truth; the harness cannot
drift from what the pipeline reports.

## Run protocol

### Step 0 — freeze the environment (once, before any run)

**One config directory per arm, each containing exactly one installed plugin version.** Arms are
selected by launching Claude Code with `CLAUDE_CONFIG_DIR` (falling back to `HOME` if that variable
is not honoured) pointed at the arm's directory:

```
bench/env/arm-a/    sdlc@1.9.1  (develop @ 9d1af30)
bench/env/arm-b/    sdlc@1.10.0 (feat/e2-read-discipline)
```

This is stronger than relying on deterministic version selection inside a shared cache, and it
pins the rest of the global state that is otherwise unrecorded and free to drift between runs:
settings, memory files, MCP servers, and the marketplace clone itself. Set `autoUpdate: false` in
each.

**This step is verification, not assumption.** If arms cannot be isolated this way, the protocol is
void and the design needs revisiting *before* any money is spent.

Also in Step 0: pre-warm `GRADLE_USER_HOME` by running `./gradlew test` once in a throwaway copy.
The first Gradle invocation downloads a distribution, which would otherwise inflate run 1's wall
time and possibly its turn count.

### Step 0.5 — power check on the envelope

Before spending, confirm from the numbers above that the addressable share of the expected peak is
comfortably above 20%. If the reference app as built does not reach that, enlarge it. Record the
computed share in `baseline.json` so later tracks know how much headroom the instrument has.

### Step 1 — pilot: three runs, ordered A, B, A

The noise estimate comes from runs 1 and 3 — **two arm-A runs separated in time by an arm-B run**,
so the estimate absorbs some time drift instead of being two adjacent samples. The arm-B run is not
wasted; it is the first observation of that arm.

```
spread = |A₁ − A₃| / min(A₁, A₃)   on total cache-read tokens

spread < 10%   → N = 3 per arm
spread < 25%   → N = 4 per arm
spread ≥ 25%   → STOP and remediate before continuing
```

**Remediation on STOP, in order of preference:** raise N; pin model tiers to remove routing
variance; **enlarge** the task so the signal grows. Never shrink the task — that shrinks the effect
along with the noise and produces a benchmark that cannot see anything.

**The spread is a lower bound, not a point estimate.** Two observations give one range from an
unknown distribution; drawing two nearby points from a wide distribution is easy and would licence
a confidently-too-small N. Treat the thresholds as the minimum defensible response to the observed
range, not as a measurement of the true spread.

### Step 2 — continue interleaved to N per arm

`A B A | B A B | A B …` — never all of one arm then all of the other. Any factor that varies with
time (a server-side model update, time-of-day routing, an incidental change to the environment)
would otherwise correlate perfectly with arm, and this design is specifically looking for a
moderate delta against noise. Interleaving costs exactly the same and removes it.

Fix the inter-run gap and apply it identically to every run, recording it in each manifest.
**Prompt-cache warmth is a real confound**: within the cache TTL, a later run's `cache_read` and
`cache_creation` split differs from a cold run's. Interleaving helps by distributing warmth across
both arms rather than concentrating it in the second one, but the gap must still be constant, and
each manifest records whether the run started cold.

### Step 3 — decide

- **"Did anything move?"** is answered by median **total cache-read tokens**, and only if the
  between-arm difference exceeds the observed spread.
- **E2's DoD as written** is scored on median `peak_prefix_tokens` against the <60k target,
  reported with its full range.
- If the medians differ by less than the spread, the honest result is **"no measurable effect at
  this task size"**, and that is what the roadmap records. A null result is a real result: it would
  mean the lever is smaller than the analysis predicted, and E1/E3 deserve the next investment.

### Step 4 — freeze `baseline.json`

Arm B's numbers, plus the observed spread, N, run order, the addressable-share estimate, and the
statistical-honesty statement below.

## Statistical honesty

At N = 3 per arm, the smallest achievable two-sided p from an exact rank test is ≈ 0.10 — **no
result at this budget can reach p < 0.05, whatever the data show.** At N = 4 it is still ≈ 0.03 only
in the case of perfect separation. This is not a defect to be fixed by choosing a different test; it
is a property of the sample size the budget allows.

Therefore: the harness reports **medians, ranges and an explicit engineering verdict**, never a
p-value or the word "significant". `baseline.json` carries this statement inline, so E1/E3/E4
inherit the number together with an accurate account of how strong it is. A number that outlives
the caveat that qualified it is how a benchmark becomes folklore.

## Budget

Derived from `plugins/sdlc/config/models.json` and the recorded baseline run:

```
6.65M subagent cache-read  @ sonnet cached $0.20/MTok  ≈ $1.33
2.19M orchestrator         @ opus   cached $0.50/MTok  ≈ $1.10
                                    cache-read subtotal ≈ $2.43
```

The $1.10 orchestrator figure independently reproduces the number already recorded in
`backlog.md`, which corroborates the model. Adding non-cached input and output puts a
baseline-scale run in the order of **$3–6**. The reference app is smaller than that application, so
expect roughly **$1.5–3 per run**, i.e. **~$12–25 for a 6–8 run experiment**.

These are envelopes, not measurements. The pilot's first run produces the real per-run figure, and
N is re-confirmed against it before Step 2 proceeds.

## Data flow

```
bench/reference-app/  ──prepare.mjs──►  scratch copy + git init + _bench-manifest.json
                                            │
                                    human runs /sdlc:start
                                    (answers from bench/answers.md)
                                            │
                                            ▼
                              scratch/docs/plans/{slug}/_telemetry.json
                                            │
                                      harvest.mjs
                                    (reads manifest, cross-checks live state,
                                     tarballs the whole scratch tree)
                                            │
                            ┌───────────────┴───────────────┐
                            ▼                               ▼
              bench/results/<arm>-<n>.json      bench/archive/<arm>-<n>.tar.gz
                            │
                      compare.mjs
                            │
       computeMetrics (plugins/sdlc/tools/aar/metrics.mjs)
                            │
                            ▼
                medians · ranges · spread · verdict
```

## Error handling

- **Provenance is captured at prepare time, not harvest time.** `prepare.mjs` writes
  `_bench-manifest.json` into the scratch directory: arm, plugin version, marketplace
  `gitCommitSha`, config-dir path, model tier configuration, SHA-256 of `task.md` and `answers.md`,
  inter-run gap, and timestamp. Reading provenance at harvest would record the state *after* the
  run — and since arms are switched between runs by design, a plausible and wrong record is the
  likely outcome. That is the worst class of error: silent, and it looks verified.
- **`harvest.mjs` reads the manifest from the scratch directory and additionally compares it
  against live state**, failing loudly on divergence rather than preferring either value.
- **`harvest.mjs` rejects telemetry whose `cost_basis` is not `"transcript"`.** An aggregate-only
  telemetry carries no meaningful `peak_prefix_tokens`, and harvesting one would poison the median.
- **`prepare.mjs` refuses to overwrite an existing scratch run directory** — a silent overwrite
  destroys an unharvested run. It exits non-zero and names the directory.
- **The scratch tree is archived unconditionally**, before any decision about whether it is
  interesting. Storage is far cheaper than a repeat run, and a run that has already been paid for
  should never be discarded because its value was judged prematurely.
- **Partial runs** (aborted pipeline, skipped phase, unscripted human answer) are harvested but
  flagged; `compare.mjs` excludes flagged runs from medians and reports how many it dropped. A
  silently smaller N is indistinguishable from a clean one.
- **`compare.mjs` never issues a verdict from fewer than 3 runs per arm**, and never issues one at
  all when the between-arm difference is within the observed spread. It prints the numbers and says
  no verdict is available.

## Testing

The harness is measurement equipment: if it is wrong, every conclusion drawn from it is wrong.

- `bench/test/compare.test.mjs` over committed synthetic result fixtures: median of even and odd
  counts, spread calculation, the three pilot thresholds **at their boundaries**, flagged-run
  exclusion, refusal to verdict below 3 runs per arm, and refusal when the difference is within
  spread.
- `bench/test/harvest.test.mjs` against fixture telemetry: the `cost_basis != "transcript"`
  rejection, the missing-file case, manifest/live-state divergence detection, and archive creation.
- `bench/test/prepare.test.mjs`: refusal to overwrite; the copied tree matches the specimen file
  for file; a git repository exists in the copy with exactly one commit; the manifest is present
  and complete.
- The reference app must build and test clean before it is committed — `./gradlew test` green — so
  no run ever starts from a broken specimen.
- Tests run as `node --test bench/test/*.test.mjs`. They stay **out** of `tools/sdlc-lint/test/`
  because `sdlc-lint all` is a CI merge gate and the harness is not: a benchmark script has no
  business turning CI red.

## Non-obvious consequences

- **The harness measures a delta, not the 101k figure.** Its numbers are not comparable to the
  original baseline and must never be presented as if they were.
- **A null result is a real result** and redirects investment to E1/E3.
- **`baseline.json` will outlive this conversation.** Everything qualifying it — spread, N, run
  order, addressable share, the statistical-honesty statement — lives inside the file, not in a
  document beside it.

## Open items

- Step 0's per-arm config isolation is unverified and is the first thing the implementation plan
  must establish. If `CLAUDE_CONFIG_DIR` is not honoured, the fallback is a per-arm `HOME`; if
  neither isolates cleanly, the design needs revisiting before the pilot.
- The exact inter-run gap is set in Step 0 from the observed prompt-cache TTL behaviour, and
  recorded. It is fixed for the whole experiment once chosen.
- Qualitative comparison of the two arms' deliverables (did arm B produce worse code or docs?) is
  deferred — but the material for it is archived unconditionally by `harvest.mjs`, so the decision
  costs nothing later.
