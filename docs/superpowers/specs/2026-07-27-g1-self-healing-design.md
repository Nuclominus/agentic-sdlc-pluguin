# G1 — Self-healing compiler/lint micro-loops (design)

**Date:** 2026-07-27
**Track:** G1 (quality & autonomy) — see `.brain/planning/backlog.md`
**Status:** design approved, ready for implementation planning

## Problem

A mechanical build break — an unresolved reference, a detekt violation — currently costs a full
follow-up pipeline run. Three places in the current pipeline conspire to let it escape:

1. `plugins/sdlc/agents/developer.md:49` runs the compile command but is told *"if it fails, note it
   but don't iterate — that's QA's job."*
2. `qa-engineer.md` is scoped to **tests**, not compilation, and carries its own 3-attempt cap.
3. `post_pipeline_checks` run at **Step 4, after the entire pipeline**, and `SKILL.md:1261` says
   *"Do not automatically iterate."*

So the failure surfaces last, after every phase has been paid for, and the fix requires a new run.

A generic loop primitive already exists (`loop: {return_to, max_rounds}`, `SKILL.md:890`), but it is
driven by an **agent's prose verdict**. A compile break is a deterministic exit code; detecting it
should not cost a Reviewer dispatch.

## Goal

Feed compiler/lint `stderr` straight back to the agent that wrote the code, hard-capped at 2
attempts, then record a blocker and continue. Eliminate the follow-up run for mechanical failures
without introducing a new unbounded iteration budget.

## Decisions taken during design

| Question | Decision | Rationale |
|---|---|---|
| What is a "mechanical" failure? | **Compile + lint exit codes only.** Tests excluded. | A failing unit test is a logic problem. Including it would give one failure two independent healing budgets (heal's and QA's) and make *"never modify the implementation to make tests pass"* ambiguous. |
| What happens after the cap? | **Record blocker, print, continue the pipeline.** | Matches Step 4's existing report-don't-iterate behaviour and works identically on every recipe. Escalating "to the Reviewer" (the backlog's literal wording) is impossible on `default`/`bugfix`/`hotfix`/`refactor` — none has a `review` phase. |
| Which phases are guarded? | **Any phase that declares it in the recipe.** | `security-analyst` fixes Critical/High directly and `qa-engineer` writes test sources; both can break the build. Declaring it per-phase in the recipe keeps this generic control flow rather than a hardcoded orchestrator rule. |
| How is it expressed? | **A new `heal:` primitive, sibling to `loop:`.** | See "Approaches considered". |

## Approaches considered

**A — new `heal:` primitive (chosen).** Recipe declares *whether* a phase is guarded and the cap;
the stack profile declares *what* the check is. Mirrors `loop:` but keys off an exit code.

**B — extend `loop:` with `verdict_from: command`.** Reuses the 3-loop machinery, but the semantics
fight. `loop` is a two-phase bounce (*run X, on findings re-run Y then X*); healing is a self-bounce,
forcing the confusing `return_to: development` on the development phase itself. `loop` also escalates
to the user at `max_rounds` (`SKILL.md:897`) while heal must continue. Two divergent behaviours on one
primitive invite drift.

**C — agent contracts only, no orchestrator change.** Flip `developer.md:49` from *"don't iterate"* to
*"iterate ≤2 times"*. Zero schema work, but the cap becomes unenforced prose — the exact failure
`qa-engineer.md` documents (*"Past pipelines have spent $50+ on a single crashing test that the agent
kept 'almost fixing'"*). No telemetry, nothing lintable, and it must be duplicated into every
code-writing agent in every foundation plugin (the copy-drift trap already declined for E2).

## Architecture

### Attachment point

A new orchestrator step **3e-heal**, between `3e` (validate phase output) and `3d-3` (write
checkpoint):

```
3c spawn → 3d summary → 3d-1 telemetry → 3d-2 QA telem → 3d-cap cost gate
   → 3e validate → [3e-heal] → 3d-3 checkpoint
```

- **Before `3d-3`** so the checkpoint records the healed state and folds heal cost into the phase's
  `cost_usd`. A run interrupted mid-heal writes no checkpoint, so `--resume` re-runs the phase whole —
  the correct conservative behaviour.
- **After `3e`** so a phase that produced structurally invalid output escalates to the user first,
  rather than burning heal attempts on a phase that did not really finish.

### The loop

1. Phase completes. No `heal:` block on the recipe phase → skip entirely. Zero cost, zero prompt
   change, byte-identical stable prefix.
2. Run each command in `EFFECTIVE_PROFILE.heal_checks` via `Bash`. Capability-gate exactly as Step 4
   does (`SKILL.md:1254`): a missing toolchain is `skipped (tool unavailable on this host)`, **not** a
   failure. Without this, a host lacking Gradle heals to the cap on every guarded phase.
3. All exit zero → proceed to `3d-3`.
4. Any non-zero → re-dispatch **this phase's agent**, `attempt += 1`, print
   `🔧 {phase} heal attempt {n}/{max_attempts}`, return to step 2.
5. At `max_attempts` still failing → record blocker
   `"{phase} heal exhausted ({n} attempts) — {command} still failing"`, print it, and **continue to
   the next phase**.

Inherited behaviours, deliberately:

- **Development's planning gate is not re-opened** on a heal re-dispatch — straight to the implement
  pass, mirroring `SKILL.md:899` for loop rounds.
- **The `3d-cap` cost gate applies to heal dispatches.** A heal attempt is real spend and must not
  tunnel under the cap.

### Aspect-aware phases

Compilation is global: aspect A's code may legitimately not compile until aspect B lands. Therefore
heal runs **once after the whole fan-out**, never per-aspect.

The re-dispatch goes to the **canonical-first aspect's agent**, and the `aspect_constraint` is
**dropped for heal dispatches only**, replaced by an explicit instruction to fix nothing beyond what
the tool named. Mechanical fixes at a named `file:line` do not need aspect ownership; the alternative
(routing stderr to aspects by file path) is fragile guesswork.

### The heal dispatch

A heal re-dispatch is a **fresh subagent**, not a resumed one. It receives the phase's normal stable
prefix — unchanged, so prompt-cache stays warm — plus per-call trailer keys:

```
heal_attempt: 1/2
heal_command: ./gradlew compileDebugKotlin
heal_touched_files:            # git-derived; see "Pre-existing breakage"
  - app/src/main/java/.../Foo.kt
heal_stderr: |
  e: /path/Foo.kt:42:18 Unresolved reference: barBaz
  e: /path/Foo.kt:51:9 Type mismatch: inferred String but Int expected
```

Plus a fixed instruction: *fix only what the tool named; do not refactor, do not add features, do not
touch tests; if the failure is not mechanically fixable from this output, say so and stop.*

`heal_stderr` is capped at the **last 50 lines** — same shape as Step 4's 30-line capture, slightly
wider because compiler errors cluster at the tail. Unbounded stderr is exactly the *"never dump a full
build/test log into context"* case the read-discipline contract already forbids (ADR-0008).

The escape hatch is deliberate: if the compiler fails because the design is wrong, two more Dev
attempts will not fix it. The agent should burn one attempt, say so, and let the blocker path run.

## Config surfaces

### `schemas/workflow.schema.json`

New `heal` property on the phase object, sibling to `loop`:

```json
"heal": {
  "type": "object",
  "required": ["max_attempts"],
  "additionalProperties": false,
  "properties": {
    "max_attempts": { "type": "integer", "minimum": 1, "maximum": 3, "default": 2 }
  }
}
```

`maximum: 3` is the schema-level backstop against the runaway-iteration failure mode: a recipe author
cannot write `max_attempts: 10`.

### `schemas/manifest.schema.json`

New `heal_checks` array, shaped like `post_pipeline_checks` and merged identically: **union,
de-duplicated, preserving order PRIMARY → stack profiles → additive profiles** (`SKILL.md:476`). The
union is what lets a framework provider contribute a check without knowing about the host stack.

### `sdlc.local.yaml`

New `heal_checks` key that **REPLACES** the plugin value entirely, matching `post_pipeline_checks`
(`SKILL.md:494`). `heal_checks: []` disables healing project-wide without editing any recipe — the
same off-switch users already know.

### Values and rollout

`plugins/android-foundation/manifest.yaml`:

```yaml
heal_checks:
  - sh -c './gradlew compileDebugKotlin'
  - sh -c './gradlew detekt 2>/dev/null || ./gradlew ktlintCheck 2>/dev/null || true'
```

Deliberately a **subset** of its `post_pipeline_checks` — `testDebugUnitTest` is excluded per the
scope decision. Step 4 still runs the full set at the end; heal front-loads only the mechanical part.

Recipes gaining `heal: {max_attempts: 2}`:

| Recipe | Guarded phases |
|---|---|
| `default.yaml` | `development`, `security`, `qa` |
| `bugfix.yaml` | `development`, `security`, `qa` |
| `hotfix.yaml` | `development`, `security`, `qa` |
| `refactor.yaml` | `development`, `security`, `qa` |
| `debug.yaml` | `development`, `qa` |
| `testing.yaml` | `qa` |
| `analysis.yaml` | `security` |
| `android-feature.yaml` | `development`, `security`, `qa` |
| `docs-only.yaml` | none — `documentation` writes no compilable source |

`analysis.yaml` has no `development` phase, but its `security` phase still fixes Critical/High
directly, so it is guarded. `debug.yaml` runs `development` + `qa` and is fully guarded — the
debugger writes code like any other implementer.

## Telemetry and reporting

`qa_iterations_used` already blazes this trail; `heal_attempts_used` follows it end to end rather
than inventing a parallel mechanism.

| File | Change |
|---|---|
| `schemas/checkpoint.schema.json:38` | add `heal_attempts_used` (integer ≥ 0) and `heal_status` (`healed` \| `exhausted` \| `skipped` \| `pre-existing`) beside `qa_iterations_used` |
| `plugins/sdlc/tools/aar/metrics.mjs:77` | sum `heal_attempts_used` across phases; surface `exhausted` as an AAR finding |
| `plugins/sdlc/tools/rollup/rollup.mjs` | cross-run `heal_attempts` total + distribution, mirroring `qa_distribution` |
| `plugins/sdlc/tools/report/report.mjs:360` | per-phase badge — `2 heal attempt(s)` |

Heal dispatch cost folds into the phase's own `cost_usd`, so existing totals, caps and the cross-run
rollup stay correct with no arithmetic changes.

This gives G1 what E2 lacked: **the metric that proves or disproves it ships with it.**
`heal_status: healed` counts follow-up runs avoided; `exhausted` counts wasted dispatches. Both are
binary per-phase facts, not deltas against a 64% noise floor — verifiable at n=1, no `bench/`
campaign required.

## Error handling and edge cases

### Pre-existing breakage (the dangerous one)

If the repo already fails to compile *before* the guarded phase ran, a naive loop burns two
dispatches fixing damage the agent never caused, and may edit unrelated code. A baseline probe before
the first guarded phase would catch it but costs a full build (minutes, on Gradle) at run start.

Cheaper mitigation: derive the touched set from **git**, not from agent prose. The orchestrator
captures `git diff --name-only HEAD` plus untracked files immediately before dispatching a guarded
phase and again after it returns; the delta is `heal_touched_files`.

The rule passed to the heal dispatch — *if the reported errors name only files outside the touched
set, this is pre-existing breakage: report it and stop, do not attempt a fix.* Record
`heal_status: pre-existing`. Costs two `git` invocations instead of a build, and fails safe.

Git is the source rather than the phase's own report because `3e` validation only requires a
**development** phase to list files changed (`SKILL.md:1218`); `security` must report severity counts
and `qa` pass/fail counts, so prose would leave the two other guarded phases without a touched set.

### Loop × heal compounding

`android-feature.yaml` loops `review ⇄ development` up to 3×. With `heal` on `development`, worst
case is 3 rounds × (1 dev + 2 heal) = **9 dispatches**. Two consequences:

- `heal_attempts` resets **per dispatch**, not per phase — otherwise round 3 has no budget. The
  checkpoint's `heal_attempts_used` records the **sum** across rounds.
- The cost preview at `SKILL.md:743-744` currently folds in loop rounds only. It must also fold
  `max_attempts × est(phase)` per guarded phase into `worst_total`, or the estimate the user approves
  understates the run.

### Remaining cases

- **Agent declares the failure unfixable** → treat as exhausted immediately; do not spend the
  remaining attempt.
- **Command timeout** — heal commands run at the `Bash` tool's 600 000 ms ceiling. A Gradle build
  exceeding the 120 000 ms default would otherwise register as a spurious failure and trigger healing
  against a timeout rather than a compile error.
- **`--resume`** needs no change. Heal completes before the checkpoint is written, so skip semantics
  (`status ∈ {completed, skipped}`) are untouched; `resume.mjs` and its drift guard at `SKILL.md:935`
  stay as they are.

## Testing

| Layer | What |
|---|---|
| Schema fixtures | valid `heal`; `max_attempts: 4` rejected by the `maximum: 3` backstop; `heal` + `loop` coexisting on one phase; `heal_checks` in a manifest |
| Merge semantics | union/de-dupe across PRIMARY + stack + additive; `sdlc.local.yaml` **replaces**; `heal_checks: []` disables |
| `tools/sdlc-lint` | no new verb — the `schema` verb already validates recipes. Add a **drift guard comment** at 3e-heal in `SKILL.md` pointing at `schemas/workflow.schema.json`, matching the pattern at `SKILL.md:935` and `SKILL.md:1009` |
| `tools/aar`, `tools/rollup`, `tools/report` | extend the existing `qa_iterations_used` tests with `heal_attempts_used` sums, distribution, and the per-phase badge |

**End-to-end validation deliberately does not use `bench/`.** G1's DoD is binary per-phase, so the
honest test is a seeded specimen:

1. Introduce a known compile error (unresolved reference), run the pipeline, assert
   `heal_status: healed`, `heal_attempts_used: 1`, and that the Step 4 post-check passes.
2. A second specimen with an error not mechanically fixable from compiler output, asserting
   `heal_status: exhausted`, a recorded blocker, and **pipeline continuation**.

## Definition of Done

- A build/detekt failure introduced by a guarded phase is auto-fixed within ≤ 2 dispatches without
  invoking a reviewer.
- The 2-attempt cap is enforced structurally (schema `maximum: 3`, orchestrator counter) and logged.
- Exhaustion records a blocker and the pipeline **continues**; it never silently passes and never
  halts an unattended run.
- Pre-existing breakage is classified, not "fixed".
- `heal_attempts_used` / `heal_status` appear in checkpoint, AAR, rollup and HTML report.
- Recipes without a `heal:` block are byte-identical in prompt and behaviour to today.

## ADR

This changes the orchestrator↔subagent contract (a new dispatch kind with its own per-call keys and a
dropped `aspect_constraint`), so it warrants an ADR in `.brain/decisions/` per
`.claude/rules/second-brain.md` §3 — **ADR-0010** is the next free number.

## Open follow-ups (explicitly out of scope)

- **F2 fast-track DAG** pairs with this for the trivial-change lane; not part of G1.
- **Baseline probe** (running `heal_checks` once at run start) is rejected here on cost, but becomes
  cheap if a future stack profile declares an incremental check. Revisit then.
