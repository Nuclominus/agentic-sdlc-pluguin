---
pr: 121
date: 2026-08-04
author: Nuclominus
type: feat
plugins: [sdlc]
roadmap: null
files_changed: 20
---

# PR #121 — collapse Steps 0→1d into the resolve command (−818 lines)

> `feat` · merged 2026-08-04 · by @Nuclominus

## Summary

The second half of [ADR-0019](.brain/decisions/ADR-0019-the-run-start-is-one-command.md). The
command shipped in #119; this removes the prose it replaces.

## Changed areas

- [[components/sdlc]] — `pipeline-orchestrator/SKILL.md` loses Steps 0a/0b/0c/1/1a/1b/1c/1d.
  Six other shipped docs (`commands/doctor|init|extension|model-config|start|workflow-config`,
  `skills/aar`, `workflows/RESOLVER`) had their citations retargeted at the modules that now
  implement those steps. Two modules gained behavior the prose carried and the command had not
  (`detect.mjs`, `profile.mjs`); `plan.mjs` and `cli.mjs` fixed how diagnostics reach the user.

## What shipped

```
SKILL.md   2544 → 1736 lines   (−808, −31.8%)
           162,436 → 112,883 chars   (~40.6k → ~28.2k tokens)
```

Measured, not projected: the numbers in the PR body were `−818 / −32.2% / 111,981 chars` — stale
by ~900 characters and corrected during review, because [[decisions/ADR-0019-the-run-start-is-one-command]]
quotes them in its cost arithmetic.

All thirteen cross-references into the deleted region were preserved by `0-anchors`, which keeps
seven historical labels alive as rows in the key map (`0a-1`, `0c`, `1b`, `1b-ext`, `1d-0`, `1d-2`,
`1d-4`) and declares every other sub-step number stale.

## What review caught

The premise held — the risk was never the deletion volume, it was the **seams**: things the prose
carried that nothing picked up, none of them anchorable by any test that existed. Nine findings,
three blocking, all closed in `4abe124` and `082b91f`.

The three that mattered were each a signal wired to a dead channel:

1. **The contract measuring this change reported a flat 0%.** `0-resolve`'s pattern wanted
   `cli.mjs plan`; the command it guards is `node "…/cli.mjs" plan` — a closing quote where the
   pattern wanted a space. Both sibling contracts already carried `"?\s+` for exactly this reason.
   The DoD number for [[planning/h5-prompt-surface]]'s Direction 2 would have come from this
   contract.
2. **The degraded path echoed stderr, which is empty under `--json`.** `halt` travels inside the
   stdout envelope. The orchestrator printed an empty string and stopped; the user got a halt with
   no reason.
3. **`warnings[]` reached nobody.** It was a sibling channel written to stderr in non-JSON mode
   only — and the orchestrator always invokes with `--json`. A project whose `sdlc.local.yaml`
   failed to parse ran on plugin defaults *silently*: no `post_pipeline_checks`, no cap override,
   no indication why.

Two more were behavior the prose carried and the command did not: the `🎯 Active stack profiles`
print (the deleted text called it "a contract with the user") and `--stack=NAME`, which was
advertised in four places and did nothing. Both restored. `--stack` now skips detection rather than
filtering it — the distinction is the flag's whole purpose — and an unknown name halts instead of
falling through to vanilla.

Two defects were found only because the fix required reading the surrounding code:

- **`profile_source` was worse than mislabelled.** It read `located.recipe.origin`, so a
  project-local *workflow recipe* would have made the *stack profile* report `"project"`. Split
  into `stack.profile_source` (the winning foundation's manifest) and `workflow.origin`.
- **A guard that had stopped guarding.** `schema.test.mjs`'s `1d-0` test anchored on headings the
  collapse removed, so both `indexOf` calls returned `-1`, the slice was empty, and it compared
  `0 === 0`. Green by construction. It sat three lines below a sibling that *had* been retired
  explicitly — the asymmetry was the tell, and the reason it survived is that it was passing.

## Decisions & rationale

- **[[decisions/ADR-0019-the-run-start-is-one-command]]** — the prose half, completing what #119
  began. Specification: [[planning/h5-d2-start-resolution-command]].
- **Two guards generalise past their findings**, and that is the durable output of this review:
  `contracts.test.mjs` now asserts every `bash_match` pattern matches some fenced block in the
  document it guards; `all.test.mjs` walks every shipped `.md` and fails on a citation of a deleted
  Step 0/1 label. Both failure modes are *silent by construction* — a pattern that matches nothing
  is indistinguishable from a step never performed, and a pointer that resolves to nothing still
  passes every link check. Six dangling citations across five files, all green in CI, is the shape.
- **The review's own sweep missed three of six citations**, because a grep for `0a-2` / `1a` / `1c`
  does not catch a bare `Step 0b`; a fourth (a table row citing `Step 1d`) was found by the
  scripted sweep and named by neither pass. Hand-written sweeps encode what their author was
  already looking for — which is the argument for the guard, not for a more careful sweep.

## Planning

- _No roadmap item tagged._ Completes **Track H**'s H5 Direction 2 ([[planning/h-instruction-fidelity]],
  [[planning/h5-prompt-surface]]) — the largest measured lever in the track at ~11.8% of run cost.
- **Still open, and it is the number that decides ADR-0019:** whether the start window falls from a
  measured median of **24 turns / 14 tool calls / $1.31** to the projected **2–3 turns**. That needs
  real runs on this prose. Findings 1 and 3 are part of why it is still unmeasured — with the
  contract at 0% and the warnings dark, a run would not have told us much.

---
_Auto-generated by `tools/brain-sync`. Frontmatter is machine-owned; prose below "Summary" is safe to enrich._
