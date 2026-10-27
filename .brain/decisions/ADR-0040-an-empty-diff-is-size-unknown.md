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

1. **`computeDiffSignals` flags the case.** It adds `empty_diff: true` when the range changes no
   path. `loc_touched` keeps its true value (`0`), so telemetry and other readers see the same
   number as before. The flag tells consumers not to read that `0` as a size.
2. **Size-gated skip-rules are withheld on an empty diff.** `typo-fix` (LOC < 30) and
   `lightweight-no-db` (LOC < 50) do not fire. `typo-fix` is included on purpose: "rename Foo to
   Bar" matches its pattern and can touch every file, and the LOC bound is the only guard against
   that. `whitespace-only` and `config-only` already require a changed path, so they cannot fire on
   an empty diff.
3. **Withheld is said, not silent.** A rule whose other conditions held, on a phase that is
   present, is recorded in `plan.skip_rules.withheld[]` (`rule`, `phase_kept`, `reason`), printed
   under `🛡️ Skip-rules withheld:`, and shown in the dry-run block. A run that keeps a phase it used
   to skip looks like a regression unless it says why.
4. **A size bound cannot be met on an empty diff.** `loc_touched_max` and `loc_touched_min` are
   unsatisfied, so the recipe does not auto-select. A recipe held back only by its size bound is
   named in a `🧭 Auto-select withheld …` print, and selection continues with the remaining tiers.
5. **An explicit `--base-ref` changes the range, not the meaning.** An empty diff against a named
   ref is still size-unknown. Any non-empty diff is judged exactly as before.

## Consequences

- A fresh-branch feature run keeps its security phase. The cost is one security dispatch on the
  small changes the rule used to skip correctly (per-phase p90 about $0.40, from the recipe cap
  basis), against a missed review on a large one.
- `bugfix` and `hotfix` no longer auto-select on a fresh branch. A "fix …" request falls through
  to the profile default (or a recipe without a size bound), which runs *more* phases, not fewer.
  `--workflow=bugfix`, or naming the recipe in the request (ADR-0024 tier 1b), still picks it. Once
  the branch has commits, the bounds are judged as before.
- A typo or rename request on a fresh branch now runs business analysis. Committing first, or
  `--workflow=NAME`, restores the lean path.
- Work that exists only in the working tree is not in the `<base>...HEAD` range, so it also reads
  as empty and is kept conservative.
- **Not done here, a follow-up:** re-evaluating the size-gated rules at the `[security ‖ test]`
  group boundary, against the post-development diff. That would let a run that turned out small
  still drop security, but it needs orchestrator changes in `pipeline-orchestrator/SKILL.md`. This
  decision makes the run-start answer safe. It does not make it precise.

## Related
- Implemented by: #246 (fixes issue #239). Telemetry field `skip_rules.withheld` is additive.
- Relates to: [[decisions/ADR-0024-naming-a-recipe-is-an-explicit-request]],
  [[decisions/ADR-0019-the-run-start-is-one-command]], [[architecture/pipeline-orchestrator]],
  [[components/sdlc]]
