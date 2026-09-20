---
pr: 178
date: 2026-09-20
author: Nuclominus
type: fix
plugins: [sdlc]
roadmap: null
files_changed: 8
---

# PR #178 — resolve a workflow recipe named in the request (#176)

> `fix` · merged 2026-09-20 · by @Nuclominus

## Summary

Closes #176. "Would the **docs-only** SDLC workflow for 'Document the growth log screen' fit under
its cost cap?" resolved the `default` recipe — 6 phases, `~$4.38`, cap `$16.00` — and answered a
cap question about a pipeline nobody asked about. `docs-only` is 1 phase, `~$0.15`, cap `$0.35`.
Both sets of figures are real, which is precisely what made the substitution invisible.

No existing tier could catch it. `docs-only` carries `match.config_only`, which
`tools/resolve/skiprules.mjs` computes from the **diff** ("every changed file is a config file"),
so `match:` auto-selection can never reach it from prompt text and cannot fire at all where there
is no comparable base ref; and nothing turned the user's words into `--workflow=docs-only`.

A new tier **1b** sits between the flag and `active_workflow`: a recipe *named* in `$ARGUMENTS`
resolves as if the flag had been typed, reported as `workflow.tier = "named_in_prose"` and
announced with `🧭 Recipe '<name>' named in the request`. The plan JSON also gains
`workflow.available` — the sorted, deduped discoverable names, which `locateRecipe` already
computed privately on its not-found halt path.

## Changed areas

- [[components/sdlc]] — `tools/resolve/workflow.mjs` (the tier, `availableNames`,
  `matchNamedRecipe`) and `tools/resolve/plan.mjs` (the new plan field, tier warnings routed into
  both `prints[]` and `warnings[]`).
- `workflows/RESOLVER.md` gains a **Step 1b** section; the tier list is renumbered with explicit
  tier labels, since the document already spends "Step 1.5" on `match:` auto-selection.
- [[architecture/pipeline-orchestrator]] — `SKILL.md` Step 0 gains exactly one obligation, and it
  is not building the flag: **do not trim the recipe name out of `$ARGUMENTS`** while shortening a
  natural-language request into a one-line brief. In the run that opened #176 the brief arrived as
  `"Document the growth log screen"`, with `docs-only` already gone before the command ran, so the
  resolver-side tier would have been correct and unreachable.

## Decisions & rationale

- Implements [[decisions/ADR-0024-naming-a-recipe-is-an-explicit-request]]. The obvious repair —
  have the orchestrator map the prose onto `--workflow=NAME` itself — is the second implementation
  in prompt text that [[decisions/ADR-0019-the-run-start-is-one-command]] exists to remove, and
  the model cannot do it correctly anyway: the installed recipe set is discovered at run time from
  the project and every installed plugin, and nothing tells the model what it is before the command
  runs. An earlier working branch had taken that route; it was stashed unmerged in favour of this
  one.
- Two routes were ruled out in the issue before either was attempted, and both stayed ruled out:
  relaxing `match.config_only` (a diff predicate, not a project opt-in — relaxing it would make
  prompt text select recipes for every consumer), and letting the auto-matcher fire on prompt text
  alone.
- **Review of this PR found the guard was too loose to hold, and it is the interesting part.** The
  first implementation required a cue word (`workflow`/`recipe`/`pipeline`) merely to be *present*
  and matched recipe names anywhere else in the string. But `/sdlc:start` is documented to users as
  "run the SDLC pipeline", so ordinary feature descriptions carry a cue word: `"run the SDLC
  pipeline to add debug logging"` → `debug`, `"Refactor the data pipeline module"` → `refactor`,
  and worst, `"Add a testing stage to the release pipeline"` → `testing`, a QA-only recipe with no
  `development` phase, for a request to implement something. **Co-occurrence is not naming.**
  Selection now reads only the kebab-shaped tokens *standing at* a cue word — `<name> workflow`,
  `workflow <name>`, `<name> SDLC workflow`, or quoted against it — and asks whether the token *is*
  a discovered name. The cue-word test that was supposed to catch this passed only because its
  fixture happened to contain no cue word.
- Matching whole tokens also retired a substring-overlap filter that had resolved a genuinely
  ambiguous "the docs workflow vs the docs-only workflow" instead of declining it.
- **The unknown-name report is deliberately narrower than #176's acceptance wording**, recorded so
  it is not later read as an oversight. That warning reaches the user (`plan.mjs` pushes tier
  warnings into `prints[]`), and a denylist of English words cannot be completed: an ungated
  version reported `implement`, `config`, `growth-log` and `engine` as mistyped recipes on ordinary
  requests. It now fires on evidence the token was *meant* as a name — a one-character slip from an
  installed name, a quoted token, or `--workflow ` written with a space. Edit distance stops at 1:
  at 2, `analytics` pairs with `analysis` and the false alarm returns. A token resembling nothing
  installed and quoted by nobody falls through silently, with the resolved recipe still visible on
  the preview's `Workflow:` line.
- Also raised in review and *declined*: making tier 1b honour the selected recipe's own `match:`
  constraints. Tier 1 bypasses `match:` too, deliberately — that bypass is the entire reason either
  tier can reach `docs-only` — and honouring it here would reinstate the defect, since `hotfix`'s
  `loc_touched_max: 200` would silently refuse an explicitly requested `hotfix` on a large diff and
  fall back to `default`. The worked example behind the finding is resolved by the adjacency fix
  instead: `hotfix` no longer stands at a cue word there.

## Planning

- Verified deterministically, no install needed: the issue's probe under
  `env -u CLAUDE_PLUGIN_ROOT` prints `Workflow: docs-only`, `Phases (1)`, `~$0.15`,
  `Cap: $0.35 → WITHIN`. The other paths — unknown name, no cue word, two names, explicit
  `--workflow=hotfix` — were probed alongside it and behave as specified. 725 `sdlc-lint` tests
  (15 new) and 32 `brain-sync` tests pass.
- The acceptance criterion this change exists for is **still unrun**: `plugins/sdlc/evals/`
  `04-nl-budget-docs-only` should go 0.67 → 1.00 in the *with* arm, and `03-hotfix-recipe` should
  keep passing. That suite is billed and lives on `evals/sdlc-dry-run` (PR #177), not on `develop`.
  It is the only thing that tests the `SKILL.md` half of this fix — the resolver half has unit
  tests, the "do not trim the name" obligation is prose, and prose obligations are the ones that
  get skipped ([[planning/h1-compliance-auditor]]).

---
_Auto-generated by `tools/brain-sync`. Frontmatter is machine-owned; prose below "Summary" is safe to enrich._
