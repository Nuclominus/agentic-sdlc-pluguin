---
pr: 156
date: 2026-09-08
author: Nuclominus
type: fix
plugins: [android-foundation, sdlc]
roadmap: null
files_changed: 15
---

# PR #156 — three defects run 5 surfaced in the mandate gate and its inputs

> `fix` · merged 2026-09-08 · by @Nuclominus

## Summary

Run 5 (`growth-log-screen`, Little-One-Tracker, `sdlc` 2.4.0) measured both of the previous two
PRs, and both hold:

| Steps 0→1d | run 4 | **run 5** | baseline | DoD |
|---|---|---|---|---|
| API calls *(the DoD's unit)* | 10 | **4** | 9 | 2–3 |
| tool calls | 9 | **3** | 14 | — |

The plan spilled to a `tool-results/` file, so #153's Step 0-large actually executed rather than
being skipped — one `jq` where run 4 made five. Mind the unit: the DoD is fixed in **API calls**
(deduped `message.id`), so run 5 is a large real collapse that is still **one call outside** the
target — H5-D2 stays open. And #152's planning dispatch arrived with `mandated=0`, so it no longer
enters the denominator it could never satisfy.

The adjudication that produced those numbers turned up five defects — three found by hand, two more
by the review of the fix.

## 1. The auditor was measuring the namespace, not the skill

The mandate reads `frontend-design:frontend-design`; run 5's review-loop round invoked
`frontend-design`, which the harness resolves to the same skill. Compared as exact strings, a skill
that **was** invoked scored as a miss. This is the defect `dispatchMatches` already fixed one line
above for agent names — skills never got the same treatment, and here it cuts the other way (the
mandate is namespaced, the invocation bare).

The rule stays narrow: equal, or one side bare and equal to the other's skill segment. Two
*namespaced* ids never match by their tails — `acme:brainstorming` is not
`superpowers:brainstorming`. A bare name is ambiguous, but that ambiguity is the harness's, which
resolves the bare name the author typed.

Re-audited: run 5 **15/20 → 16/20**; run 4 unchanged at 16/23.

The review then found the same equivalence was missing on the **authoring** side, which is worse:
`enumerateSkills` registers a plugin's skills only as `plugin:skill`, so a project row spelled
`frontend-design` was reported "not installed" and silently demoted out of the mandate it declared —
the row would never reach the denominator at all. `skillIdMatches` in `profile.mjs` is now the
shared rule, mirrored by the auditor's `skillMatches`, and `dedupeSkills` keys through it so the two
spellings of one skill collapse into one prompt line instead of two rows with different policies.

## 2. `workflow` was a machine value left to the model

Run 4 wrote `"workflow": "android-feature"`; run 5 omitted the key. `CONTEXT.active_workflow`
resolved correctly in both — `.checkpoint/_run.json` carries it on run 5 — so this was a gap in the
recorded shape, not a resolution failure.

The first fix was to document it in Step 5, and the review was right that this changes nothing: it
leaves in place exactly the discretion that lost the key. `.checkpoint/_run.json` is schema-required
to carry the value and `finishRun` already rewrites telemetry, so Step 5b copies it across instead —
[[decisions/ADR-0015-the-machine-value-invariant]] applied to a field that had escaped it. Fill
only; a run that states its own workflow keeps what it said, and a missing `_run.json` leaves the
key absent rather than failing the seal.

## 3. A mandate that named commands nobody would run

Runs 3 and 5 both opened a PR without invoking `android-foundation:android-docs-vault`. Its `when`
read "before filling vault notes and before `gh pr create`" — leading with the *conditional* half,
so a run with no vault notes can read the whole clause as inapplicable and the PR half never gets
its own turn. Two measured misses on one clause is a specification defect, not variance.

The first rewrite led with "your first commit, `gh pr create`, or vault-note write" — and the review
caught that this rebuilds the defect from the other end. Committing is something this role is
explicitly told never to do (`agents/document-writer.md`, `rules/git-operations.md`), so a trigger
naming it is unreachable by construction; and `gh pr create` is the documented *fallback* to
`mcp__github__create_pull_request`, so on a host with the GitHub MCP none of the three would fire.

The clause now names the **outcome**: "before you open the PR in THIS dispatch — by any mechanism —
and before your first vault-note write". The general lesson, and the reason it is written down here:
a `when` clause must name what the dispatch *achieves*, never the command it happens to use.

## Where run 5 actually landed

After fix 1, and adjudicating the rest by hand: **16 of 17 applicable mandates**, the single genuine
miss being the document-writer clause fix 3 addresses. The remaining reported gap is the remediation
dispatch, which edited two backup XML files — no Kotlin, no Compose UI — exactly as on run 4.

Ordering improved unprompted: run 5's review-loop round invoked its skills at 09:15:32–33 and edited
from 09:15:46, where run 4 had that backwards. Still measured by hand; the contract remains blind to
order, and that stays recorded rather than quietly fixed.

## What this does not show

Fix 3 is a wording change with two data points behind it and no run yet. #152 and #153 each have
exactly one measured run. Nothing here has been through a pipeline.

## Changed areas

- [[components/sdlc]]
- [[components/android-foundation]]

## Decisions & rationale

- No new ADR. Fix 2 is [[decisions/ADR-0015-the-machine-value-invariant]] reaching a field that had
  escaped it — the correction the review forced was choosing the machine path over documenting the
  prose.
- Fixes 1 and 3 are Track H's premise applied twice ([[planning/h-instruction-fidelity]]): when a
  measurement disagrees with a hand audit, suspect the instrument and the instruction before the
  model. Both turned out to be defects in what was asked or counted, not in what was done.
- Fix 3 extends the per-dispatch scoping of #148 with a second rule: a `when` names the outcome, not
  the command, or it silently excludes every host that reaches that outcome another way.

## Planning

- Advances Track H5-D2 ([[planning/h5-d2-start-resolution-command]]) — run 5 measured **4 API calls**
  for Steps 0→1d against a 9-call baseline and a 2–3 DoD, on a run where the saved-plan path was
  exercised. Close, not closed: the DoD stays open by one call.
- Advances Track H ([[planning/h-instruction-fidelity]]) — the mandate gate now measures the skill
  rather than its namespace, on both the authoring and the measuring side.

---
_Auto-generated by `tools/brain-sync`. Frontmatter is machine-owned; prose below "Summary" is safe to enrich._
