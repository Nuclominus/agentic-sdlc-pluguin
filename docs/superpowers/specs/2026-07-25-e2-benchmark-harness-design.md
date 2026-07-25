# E2 benchmark harness — reference task for measuring cache-read cost (design)

- **Date:** 2026-07-25
- **Status:** approved
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

E1 (trim the fixed floor), E3 (reduce turn count) and E4 (model routing) have exactly the same
measurement problem. Building the instrument once serves all four.

### Why not Docker

The obvious first instinct is to isolate the run in a container. It isolates the wrong variable.

`peak_prefix_tokens` is derived from Claude Code subagent transcripts, which live on the **host**
under `~/.claude/projects/…`, and its value depends on what the model *chose to read* — not on the
filesystem it read from. Ranked by how much they threaten the measurement:

| Threat | Docker | Cheaper remedy |
|--------|--------|----------------|
| **Run-to-run nondeterminism** | no help at all | N runs, compare medians |
| The pipeline mutates the target project between runs | yes | run from a disposable copy |
| Ambiguity about which plugin version produced a run | partial | arm = installed plugin version, recorded per run |

The first is dominant and Docker does nothing for it. A single run per arm cannot separate a real
change from noise: if spread is ±30% and the target effect is −40%, one pair can show anything,
including an apparent regression where there was an improvement. Docker also adds real costs —
Claude Code auth inside the container, plumbing the transcript path back out, and a full priced
pipeline run per arm regardless.

So: **arm = plugin version, project state = a fresh copy per run, confidence = number of runs.**

### Two facts verified on this machine, which the design depends on

```
~/.claude/plugins/marketplaces/agentic-sdlc   git clone, on develop @ 9d1af30
~/.claude/plugins/cache/agentic-sdlc/sdlc/    1.9.0/ and 1.9.1/ coexist
known_marketplaces.json                       autoUpdate: true
```

Plugin versions coexist in the cache, so both arms can be installed simultaneously. `develop @
9d1af30` is exactly the merge-base of PR #68, so the currently-installed `sdlc@1.9.1` **is** arm A —
no special preparation needed for the control.

`autoUpdate: true` is a hazard: the marketplace clone can be refreshed mid-experiment, silently
changing an arm between runs. It must be pinned before the pilot.

## Goals / Non-goals

**Goals**
- A reference project and a fixed task brief that produce comparable pipeline runs on demand.
- A run protocol that measures its own noise floor *before* spending runs on a comparison.
- A committed baseline artifact so E1/E3/E4 compare against a stored number, not prose.
- Reuse of the existing metric code — no second implementation of the cache-pressure math.

**Non-goals**
- Reproducing the 101k absolute figure. That came from a large real app. This harness
  re-establishes its own baseline and measures the **delta between arms**. The roadmap must say
  exactly that; anything else repeats the mistake E2 was careful to avoid.
- Automating the pipeline invocation. `/sdlc:start` runs inside Claude Code; a shell script cannot
  call it. The runs are human-triggered; only preparation, harvesting and comparison are scripted.
- Containerisation, CI integration, or scheduled regression runs. Each run costs real money; this
  is an instrument you pick up deliberately, not a gate.
- Measuring anything but cache/cost metrics. Output quality is judged by the pipeline's own review
  phases, as it already is.

## Architecture

```
bench/
  reference-app/            the specimen — committed, NEVER mutated by a run
    settings.gradle.kts
    gradle/libs.versions.toml
    app/build.gradle.kts
    app/src/main/kotlin/…
    app/src/test/kotlin/…
  task.md                   the fixed brief, byte-identical across arms
  prepare.mjs               copy specimen → scratch, print the exact run command
  harvest.mjs               scratch/_telemetry.json → results/<arm>-<n>.json
  compare.mjs               medians, spread, verdict
  results/                  harvested runs, committed — this is the evidence
  baseline.json             the agreed reference numbers for E1/E3/E4
```

### The mutation problem, and the copy that solves it

The pipeline **writes to the project it runs on**: the development phase edits code, QA adds tests,
the documentation phase writes `docs/plans/{slug}/`. Run 2 would therefore start from a different
state than run 1, and the harness would be measuring accumulated drift rather than the contract.

`bench/reference-app/` is never run against. `prepare.mjs` copies it into the session scratch
directory, and the pipeline runs there. The copy is disposable; the specimen in git is the
invariant. This delivers the isolation Docker was reached for, at the cost of a directory copy.

### The reference app

Deliberately shaped, not scavenged. Stack detection for `android-foundation` requires only:

```yaml
detect:
  all:
    - any: [file_exists: settings.gradle.kts, file_exists: settings.gradle]
    - file_glob: "**/*.kt"
```

**No Android SDK is required.** A pure Kotlin/JVM Gradle project wins `android-foundation` at
priority 300 — so the run uses the heavy agent set that produced the original baseline
(`android-docs` alone is 258 lines and carries a 21k floor across 23 turns) while building and
testing with plain `./gradlew test` in seconds.

Shape — roughly 18 Kotlin files, enough that an agent must read several to act, small enough that a
run stays cheap:

- `domain/model/` — `Order`, `OrderLine`, `Product`, `Customer`, `Money`
- `domain/Result.kt` — a typed result with a `ValidationError` case
- `domain/usecase/` — `CreateOrder`, `CancelOrder`, `ApplyDiscount`, `ListOrders`
  (the last three exist as realistic read-noise; only `CreateOrder` is the task's target)
- `domain/repository/` — `OrderRepository`, `ProductRepository` interfaces
- `data/` — in-memory implementations of both
- `app/src/test/kotlin/` — existing passing tests for `CancelOrder` and `ApplyDiscount`, so the QA
  phase has a real convention to follow rather than inventing one

`gradle/libs.versions.toml` declares **no** framework coordinates. No additive framework provider
activates (`additive: []`), which keeps the injected prompt minimal and removes a variance source.
Framework injection is not what is being measured.

### The reference task

`bench/task.md`, passed byte-identically to `/sdlc:start` in every run:

> Add input validation to the `CreateOrder` use case. Reject an empty customer id, a non-positive
> quantity on any order line, and a product id that does not exist in `ProductRepository`. Surface
> each failure as a `ValidationError` through the existing `Result` type rather than throwing.
> Follow the existing test conventions.

Chosen because it reads far more than it writes — the agent must consult the models, the `Result`
type, both repository interfaces, and the existing tests, while editing essentially one file. That
is precisely the profile where read discipline either helps or does not.

### Comparison

`compare.mjs` imports `computeMetrics` from `plugins/sdlc/tools/aar/metrics.mjs` — the same code
that already produces `peak_prefix_tokens`, `reads_per_turn` and `cache_pressure` for the HTML
report and the AAR. One source of truth; the harness cannot drift from what the pipeline reports.

Reported per arm: median and range of `peak_prefix_tokens` (overall and for the `development` and
`documentation` phases), median `reads_per_turn`, median `turns`, and total cost.

## Run protocol

**Step 0 — pin the environment (once, before any run).**
Set `autoUpdate: false` for the `agentic-sdlc` marketplace, and record `gitCommitSha` for the
installed `sdlc` plugin. Verify the arm-switch procedure works — install arm B and confirm both
`1.9.1` and `1.10.0` are present and that the active one can be selected deterministically. This
step is **verification, not assumption**: if arms cannot be switched cleanly, the rest of the
protocol is void and the design needs revisiting before any money is spent.

**Step 1 — measure the noise floor. Two runs of arm A only.**
This is the pilot, and it exists because run-to-run spread is the one quantity that decides whether
any comparison is meaningful, and we currently have no estimate of it.

```
spread = |run1 − run2| / min(run1, run2)   on peak_prefix_tokens

spread < 10%   → N = 2 per arm
spread < 25%   → N = 3 per arm
spread ≥ 25%   → STOP. The benchmark is unusable as designed.
                 Shrink the task, pin the model tiers, or reduce phase count,
                 then re-run the pilot. Do not proceed to arm B.
```

**Step 2 — complete arm A to N, then run arm B to N.**

**Step 3 — decide.** E2's behavioural DoD is met when arm B's median `peak_prefix_tokens` is below
arm A's median by a margin larger than the measured spread. If the medians differ by less than the
spread, the honest result is "no measurable effect at this task size", and the roadmap says that.

**Step 4 — freeze `baseline.json`** with arm B's numbers, as the reference E1/E3/E4 compare against.

## Data flow

```
bench/reference-app/  ──prepare.mjs──►  scratch copy
                                            │
                                    human runs /sdlc:start
                                            │
                                            ▼
                              scratch/docs/plans/{slug}/_telemetry.json
                                            │
                                      harvest.mjs
                                            │
                                            ▼
                        bench/results/<arm>-<n>.json   (+ arm, plugin version,
                                            │           gitCommitSha, timestamp)
                                      compare.mjs
                                            │
                       computeMetrics (plugins/sdlc/tools/aar/metrics.mjs)
                                            │
                                            ▼
                                  medians · spread · verdict
```

## Error handling

- **`prepare.mjs`** refuses to overwrite an existing scratch run directory — a silent overwrite
  would destroy an unharvested run. It exits non-zero and names the directory.
- **`harvest.mjs`** fails loudly if `_telemetry.json` is absent, or if its `cost_basis` is not
  `"transcript"`. An aggregate-only telemetry has no `peak_prefix_tokens` worth comparing, and
  silently harvesting one would poison the median.
- **Arm provenance is recorded, not trusted.** Each harvested result stores the plugin version and
  the marketplace `gitCommitSha` read at harvest time. `compare.mjs` refuses to compare two sets
  whose recorded arms disagree with their filenames.
- **Partial runs** (pipeline aborted, a phase skipped) are harvested but flagged; `compare.mjs`
  excludes flagged runs from medians and reports how many it dropped. A silently smaller N is
  indistinguishable from a clean one, which is exactly the failure this guards.
- **`compare.mjs` never reports a verdict from fewer than 2 runs per arm.** It prints the numbers
  and states that no verdict is available.

## Testing

The harness is measurement equipment: if it is wrong, every conclusion drawn from it is wrong.

- Unit tests for `compare.mjs` over committed synthetic result fixtures: median of an even and an
  odd count, spread calculation, the three pilot thresholds at their boundaries, flagged-run
  exclusion, and the refusal to verdict below 2 runs per arm.
- Unit tests for `harvest.mjs` against a fixture `_telemetry.json` — including the
  `cost_basis != "transcript"` rejection and the missing-file case.
- `prepare.mjs` is tested by its refusal-to-overwrite behaviour and by asserting the copy is
  complete and byte-identical to the specimen.
- The reference app itself must build and test clean before it is committed: `./gradlew test`
  green, so a benchmark run never starts from a broken specimen.
- Tests live in `bench/test/*.test.mjs`, run as `node --test bench/test/*.test.mjs`. They stay out
  of `tools/sdlc-lint/test/` because `sdlc-lint all` is a CI merge gate and the harness is not:
  a benchmark script has no business turning CI red. Fixtures live in `bench/test/fixtures/`.

## Non-obvious consequences

- **The harness measures a delta, not the 101k figure.** Its numbers are not comparable to the
  original baseline and must never be presented as if they were.
- **Every run costs money.** N is a budget decision, which is why the pilot measures noise before
  the budget is committed.
- **A null result is a real result.** If read discipline shows no measurable effect at this task
  size, that is worth knowing and worth recording — it would mean the lever is smaller than the
  analysis predicted, and E1/E3 deserve the next investment instead.

## Open items

- Step 0's arm-switch procedure is unverified. It is the first thing the implementation plan must
  establish, and it may invalidate the "arm = installed plugin version" assumption.
- Whether the pipeline's own `docs/plans/` output inside the scratch copy should be harvested
  alongside the telemetry for qualitative comparison of the two arms' deliverables. Deferred: the
  first question is whether the cost metric moves at all.
