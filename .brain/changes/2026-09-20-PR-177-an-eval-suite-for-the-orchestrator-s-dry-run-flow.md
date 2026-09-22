---
pr: 177
date: 2026-09-20
author: Nuclominus
type: test
plugins: [sdlc]
roadmap: null
files_changed: 58
---

# PR #177 — an eval suite for the orchestrator's --dry-run flow

> `test` · merged 2026-09-20 · by @Nuclominus

## Summary

An eval suite for the orchestrator's `--dry-run` flow — `plugins/sdlc/evals/`, eight cases, run
with `claude plugin eval . --ablation with-without --judge-model opus` plus an explicit
`--allow-tools "Bash(node:*)" "Bash(jq:*)"`. **That grant is load-bearing:** no skill declares
`allowed-tools`, so without it `resolve/cli.mjs` never runs and every case scores 0 in *both*
arms, which reads as a suite that measures nothing rather than as a misconfiguration.

Baseline on sdlc 2.4.1 (agent sonnet, judge opus, 3 runs): **mean Δ +0.31 across 48 runs, $23.68,
17 minutes.** Six cases must fire — the slash command, a natural-language preview, a non-default
recipe via `--workflow=hotfix`, a cost-cap question, an unknown `--stack` that must halt, and a
forced stack with a Cyrillic description — and two near-misses must not: a generic "what phases
does an SDLC have" and a trivial rename. Four of the six firing inputs are real `/sdlc:start`
traffic from local transcripts.

Every case returns an identical score on all three runs, and that quiet is the deliverable: it
means a moved number in a later run is a behavioural change rather than sampling noise. The
baseline arm declines or asks for the project path instead of inventing a preview, so Δ measures
uplift rather than a rigged floor.

**The suite paid for itself before it ever reported a score.** Calibration surfaced four plugin
defects: #164/#173 (a path-loaded plugin discovered neither its manifest, its recipes nor its
dependencies), #165 (natural-language dry-run requests did not trigger the orchestrator, and one
run invented an 8-phase pipeline against the real 6), #176 (a recipe named in prose was ignored
and the cap verdict answered for `default`), and #180 (the other half of that — a prose name
matching *no* installed recipe, silently replaced).

## Changed areas

- [[components/sdlc]] — `plugins/sdlc/evals/`: eight case directories, each a `prompt.md` with
  frontmatter (`max_turns`, `timeout_seconds`, `allowed_tools`, `model`, `runs`) plus a `graders/`
  set scored per case.
- **Graders score outcomes, not trajectories** — the expected phase count, estimate and cap
  verdict per recipe (`$4.38`/`$16.00` default, `$3.44`/`$12.50` hotfix, `$0.15`/`$0.35`
  docs-only); an LLM provenance grader that fails any preview whose figures did not come out of a
  `resolve/cli.mjs plan` tool result, and fails an answer carrying no preview at all; and the
  run-stayed-dry checks (no `docs/plans/` workspace, no `▶ Phase` banner, no pipeline agent
  dispatched). `tool_used: Skill` is a display-only trigger indicator and never moves Δ.
- The dollar figures in the graders are pinned to `config/models.json` pricing — a pricing change
  must update them in the same commit, or the suite fails for a reason that has nothing to do
  with the orchestrator.

## Decisions & rationale

- Grading outcomes rather than trajectories is what makes the numbers stable enough to trust: a
  preview reached by a different route still scores 1.00, so the only thing that moves Δ is the
  answer being wrong, missing, or invented.
- The provenance grader exists because a plausible preview is the dangerous failure. #176 and
  #165 both produced *real-looking* figures for the wrong pipeline — #176 answered a cap question
  about `default`'s six phases and its $16.00 cap, both figures genuine. A grader checking only
  the numbers cannot catch that; one checking where the numbers came from can.
- `04-nl-budget-docs-only` was red on purpose at merge time — the reproduction for #176 rather
  than a failure to fix. It was re-measured on its own after
  [[decisions/ADR-0024-naming-a-recipe-is-an-explicit-request]] landed and went 0.83/0.67/0.50
  (Δ +0.17) → 1.00/1.00/1.00 (Δ +0.50), with the without-arm unmoved at 0.50. The suite average
  folds that number in; the other seven cases come from the single full-suite run.
- Relates to [[planning/h1-compliance-auditor]]: the orchestrator's obligations are prose, and
  prose obligations are the ones that get skipped. This suite is the only thing that tests the
  `SKILL.md` half of a resolver change end to end — the resolver half has unit tests.

## Planning

- _No roadmap item tagged._
- **The suite owes a case for #180.** This PR deliberately left it uncovered, on the grounds that
  the behaviour was undecided — it wanted a warning, not a halt. It is decided now and shipped
  (#181): prose naming a compound recipe nobody installed emits a non-fatal `WARN:` and falls
  through. A ninth case belongs here, and until it exists that path is covered only by unit tests.
- Verified before merging #177 that #181 does not perturb the baseline: all eight prompts were run
  through the post-#181 resolver and every one resolves the same tier and recipe as before, with
  no new `WARN:` line — `04` still `docs-only` via `named_in_prose`, `03` still the flag. The
  measured numbers above therefore stand against current `develop`.
- `plugins/*/evals/results/` is gitignored; reports and `aggregate-result.json` regenerate on
  every run. Cost is an API-equivalent estimate — on a subscription it consumes the usage window
  rather than billing.

---
_Auto-generated by `tools/brain-sync`. Frontmatter and the index are machine-owned; every prose section, Summary included, is meant to be enriched — but `sync --pr` rewrites the whole file, so enrich after running it._
