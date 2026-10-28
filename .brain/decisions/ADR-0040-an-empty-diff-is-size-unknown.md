---
adr: 40
status: accepted
date: 2026-10-27
supersedes: null
---

# ADR-0040 — An empty diff is "size unknown", not "small"

## Context

Step 0c (`plugins/sdlc/tools/resolve/skiprules.mjs`) measures the diff against the resolved base
ref and feeds two consumers: the skip-rules, and the Step 1.5 recipe auto-selection
(`workflow.mjs` `evaluateMatch`). Both run once, at the start of the run, before any phase has
written code.

A fresh feature run starts on a fresh branch. In the AAR of three Android client runs (issue #239),
one run was resolved 14 s after `git switch -c … origin/develop`. The diff was empty, so
`LOC_TOUCHED=0`, no migrations and no sensitive paths, and `lightweight-no-db` skipped the
security phase. The change ended at 28 files, including purchase screens. The rule answered for
the branch state, not the change. Because an empty diff is the *normal* state of a new feature run,
the rule fired on nearly every one.

The same `0` reached the recipe matcher: `loc_touched_max: 500` (`bugfix`) and `200` (`hotfix`)
were satisfied by every fresh branch. The shipped recipes keep security, but a project recipe that
uses a size bound to drop phases would repeat the defect.

The module's own stated principle already covered this case: "when a signal cannot be established
the rules must not fire". `degraded` signals honoured it, but an empty diff was read as an
established size of zero.

## Decision

1. **The diff measures the change, not the commits.** `computeDiffSignals` diffs the merge base
   with the base ref against the **working tree** and counts the lines of untracked files, instead
   of `<base>...HEAD`. A branch with one 3-line commit and 28 uncommitted files is a 28-file change,
   and every signal (size, migrations, sensitive paths, config-only, whitespace-only) sees it as
   one. The pipeline's own paths (`.sdlc/`, `docs/plans/`) are excluded: an untracked
   `.sdlc/sdlc.local.yaml` left by `/sdlc:init` would otherwise turn a fresh branch into a small
   config-only diff.
2. **Some sizes are unknown, and that is a signal.** `size_unknown` carries the reason when the
   diff is empty, has binary files (git counts no lines in a keystore or a `.so`), or has more
   than 500 untracked files. `loc_touched` then takes the sentinel degraded signals already use
   (`999999`), so a reader that only compares `loc_touched < n` gets the safe answer without
   knowing this rule exists. `loc_measured` keeps what *was* measured, as a lower bound.
3. **One reading of the size.** `locAtLeast(signals, n)` in `skiprules.mjs` is the only reader:
   `true` / `false`, or `null` when the size is unknown and the lower bound does not settle it.
   The skip-rules and the recipe bounds both go through it.
4. **Size-gated skip-rules are withheld while the size is unknown.** `typo-fix` (LOC < 30),
   `config-only` (LOC < 200) and `lightweight-no-db` (LOC < 50) do not fire. `typo-fix` is
   included on purpose: "rename Foo to Bar" matches its pattern and can touch every file, and the
   LOC bound is the only guard against that.
5. **Withheld is said, not silent.** A rule whose other conditions held, on a phase that is
   present, is recorded in `plan.skip_rules.withheld[]` (`rule`, `phase_kept`, `reason`), printed
   under `🛡️ Skip-rules withheld:`, and shown in the dry-run block. A run that keeps a phase it used
   to skip looks like a regression unless it says why.
6. **An unknown size must not decide the recipe in either direction.** An unknown
   `loc_touched_*` bound is not satisfied, so the recipe does not match. But candidates are
   *ranked* as if every unknown bound were met, which is how they ranked before. If that winner
   matched outright, the size changed nothing and it is selected. If the winner is a recipe the
   size held back, auto-selection **abstains**. Step 1 then falls through to the profile default
   (the stack's full pipeline) and prints `🧭 Auto-select withheld '<name>' …`. The first version
   of this decision (#246, before review) let the runner-up win instead. On a fresh branch,
   "Fix crash …" then lost `bugfix`, which runs security, to `debug`, which does not, so the
   fix for #239 recreated #239 for crash reports.
7. **An explicit `--base-ref` changes the range, not the meaning.** An empty diff against a named
   ref is still size-unknown. A diff whose size is known is judged exactly as before.

## Consequences

- A fresh-branch feature run keeps its security phase. The cost is one security dispatch on the
  small changes the rule used to skip correctly (per-phase p90 about $0.40, from the recipe cap
  basis), against a missed review on a large one.
- **No request loses security that it ran before.** A test runs the shipped recipe sets (vanilla,
  and vanilla plus android-foundation) over representative requests. It asserts that whenever a
  known-small diff selects a recipe with security, a fresh branch does too.
- `bugfix` and `hotfix` no longer auto-select on a fresh branch. A "fix …" request runs the
  profile default instead, which has more phases, including business analysis. `--workflow=bugfix`,
  or naming the recipe in the request (ADR-0024 tier 1b), still picks it. Once the change has a
  measurable size, the bounds are judged as before. A winner the size could not affect, such as
  `android-debug` at priority 10, is selected exactly as before.
- A typo or rename request on a fresh branch now runs business analysis. Committing first, or
  `--workflow=NAME`, restores the lean path.
- A change that adds a binary file (an image, a keystore) keeps its security phase whatever its
  line count.
- Step 0c now reads untracked files to count their lines, up to 500 files.
- **Not done here, follow-ups:**
  - Re-evaluate the size-gated rules at the `[security ‖ test]` group boundary, against the
    post-development diff. That would let a run that turned out small still drop security, but
    it needs orchestrator changes in `pipeline-orchestrator/SKILL.md`. This decision makes the
    run-start answer safe. It does not make it precise.
  - Copy `skip_rules.withheld` into `_telemetry.json`. The orchestrator copies only
    `skip_rules.applied`, so the AAR, report and rollup cannot yet see why a phase was kept.

## Related
- Implemented by: #246 (fixes issue #239). Telemetry field `skip_rules.withheld` is additive.
- Relates to: [[decisions/ADR-0024-naming-a-recipe-is-an-explicit-request]],
  [[decisions/ADR-0019-the-run-start-is-one-command]], [[architecture/pipeline-orchestrator]],
  [[components/sdlc]]
