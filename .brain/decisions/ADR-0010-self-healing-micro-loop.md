---
adr: 10
status: accepted
date: 2026-07-27
supersedes: null
---

# ADR-0010 — Self-healing compiler/lint micro-loop (`heal:`)

## Context

A mechanical build break — an unresolved reference, a detekt violation — used to cost a full
follow-up pipeline run. Three places conspired to let it escape:

1. `plugins/sdlc/agents/developer.md:49` runs the compile command but is told *"if it fails, note
   it but don't iterate — that's QA's job."*
2. `qa-engineer.md` is scoped to **tests**, not compilation, and carries its own 3-attempt cap.
3. `post_pipeline_checks` run at Step 4, **after the entire pipeline**, and the orchestrator's own
   instructions say *"do not automatically iterate."*

So the failure surfaced last, after every phase had already been paid for, and the fix required a
new run. A generic `loop: {return_to, max_rounds}` primitive already existed, but it is driven by
an **agent's prose verdict**. A compile break is a deterministic exit code; detecting it should not
cost a Reviewer dispatch.

## Decision

A new `heal:` primitive, sibling to `loop:`, keyed off a command exit code rather than a prose
verdict:

- A recipe phase declares `heal: {max_attempts: N}` (schema ceiling 3, default 2). The stack
  profile declares *what* to check via `heal_checks` (a list of shell commands, merged the same way
  as `post_pipeline_checks`).
- **Step `3b-0`** (new), immediately before the agent is spawned in `3c`, captures
  `CONTEXT.pre_phase_files` — the union of `git diff --name-only HEAD` and
  `git ls-files --others --exclude-standard` — for any phase carrying a `heal:` block. This is the
  working-tree state *before* the phase's own edits, and is what step `3e-heal` diffs against to
  derive `heal_touched_files` (the pre-existing-breakage guard has nothing to compare to without
  it). For an aspect-aware phase this is captured **once**, before the first aspect, not per aspect;
  for a looped phase it is re-captured on every dispatch.
- **Step `3e-heal`** (new), between `3e` (validate phase output) and `3d-3` (write checkpoint), runs
  the phase's `heal_checks`. All exit 0 → done. Any non-zero → re-dispatch the phase's own agent
  with the last 50 lines of the failing command's stderr, the git-derived `heal_touched_files`, and
  an instruction to fix only what the tool named — no refactors, no new features, no test edits.
  `aspect_constraint` is omitted on a heal dispatch: mechanical fixes at a named `file:line` do not
  need aspect ownership, and routing stderr to aspects by file path is fragile guesswork.
- Capped at `max_attempts` (schema ceiling 3, recipe default 2). At exhaustion, or when the agent
  itself reports the failure is not mechanically fixable, or when it reports the breakage predates
  its own phase: record a blocker, print it, and **continue the pipeline** — never halt, never
  escalate to a review phase. `qa-engineer`'s 3-attempt cap is untouched; heal scope is compile/lint
  only, never unit or E2E tests, so one failure never draws on two independent healing budgets.
- **Aspect-aware phases are healed once per phase, not per aspect.** Compilation is global — one
  aspect's code may legitimately not compile until a later aspect lands — so `3e-heal` runs at most
  once per phase dispatch, after the **last** aspect's own `3e` passes and before that unit's
  checkpoint is written.
- Recipes gained `heal:` on their code-writing/build-affecting phases: `default`, `bugfix`,
  `hotfix`, `refactor` (`development`, `security`, `qa`); `debug` (`development`, `qa`); `testing`
  (`qa`); `analysis` (`security`); `android-feature`, `android-bugfix` (`development`, `qa`);
  `android-debug` (`development`, `test` — `debugging` deliberately unguarded, since it is an
  investigation phase that writes no code). `docs-only` has none. `android-feature`'s `security`
  phase runs inside a `parallel: [security, test]` group, whose schema branch accepts strings only,
  so it cannot carry a `heal` block and stays unguarded — tracked as a follow-up in
  [[planning/backlog]], not solved here.
- Checkpoint gains `heal_attempts_used` (integer ≥ 0) and `heal_status`
  (`healed | exhausted | skipped | pre-existing`) beside `qa_iterations_used`, flowing through AAR,
  rollup and the HTML report exactly as that field already does. A phase without a `heal:` block
  produces a byte-identical prompt and checkpoint to before this change.

## Consequences

- Heal dispatches drop `aspect_constraint`; on a phase both looped and guarded, worst case is
  `max_rounds × max_attempts` heal dispatches on top of the base rounds (e.g. a 3-round loop over a
  2-attempt guarded phase adds 6 heal dispatches to the 3 base ones — 9 total). The dry-run cost
  preview's `worst_total`/`expected_total` fold this in as
  `Σ over healed phases rounds(H)·max_attempts·est(H)` (worst) /
  `rounds(H)·0.3·est(H)` (expected), where `rounds(H) = max_rounds` when the guarded phase is also
  looped, else `1`.
- `heal_status` gives a binary per-run success metric (`healed` vs. `exhausted`), so unlike Track E
  this needs no `bench/` A/B campaign to validate — it is verifiable at n=1.
- **Two decisions reversed during implementation review**, both worth flagging explicitly because a
  reader of the original spec/plan would land on the wrong answer:
  1. **Heal re-dispatch target on an aspect-aware phase is the canonical-LAST aspect's agent, not
     canonical-first.** The original design picked canonical-first; review found that wrong. The
     last aspect in `database → backend → frontend → testing` is the only unit whose checkpoint is
     still unwritten when `3e-heal` runs, so recording the heal result there is what keeps "the
     checkpoint records the healed state" true without reopening an earlier aspect's already-written
     checkpoint.
  2. **Heal cost does not fold in automatically.** The original design assumed a heal dispatch's
     tokens/cost simply landed inside the phase's existing `cost_usd` with "no arithmetic changes."
     That was false. Step `3d-1` (telemetry capture) is explicitly **re-entered after every heal
     dispatch**: the new `agent_id` is appended to the unit's `agent_id` list, its tokens and
     `cost_usd` are added to the unit's running totals, and the same delta is added to
     `CONTEXT.running_cost_usd` — then `3d-cap` (the cost-cap gate) is re-evaluated before another
     heal attempt may proceed. `3d-cap` also gained a dedicated carve-out: when the *next* dispatch
     is a heal attempt and the cap is exceeded, the run never pauses or aborts (heal's own contract
     is to never halt the run) — it stops healing that phase, marks `heal_status: "exhausted"`, and
     proceeds to the checkpoint write.
  3. There are five exit branches out of `3e-heal` (checks pass, exhausted-by-attempts,
     exhausted-by-cost-cap, pre-existing breakage, not-mechanically-fixable) but only four legal
     `heal_status` values — `not-mechanically-fixable` maps onto `exhausted` rather than inventing a
     fifth schema value. All five branches proceed to the checkpoint write.

## Related
- Implemented by: #77 (placeholder — update once the merging PR number is known).
- Relates to: [[architecture/pipeline-orchestrator]] / [[components/sdlc]] / [[planning/roadmap]] /
  [[planning/backlog]]
