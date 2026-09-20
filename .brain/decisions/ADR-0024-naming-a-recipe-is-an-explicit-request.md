---
adr: 24
status: proposed
date: 2026-09-20
supersedes: null
---

# ADR-0024 — Naming a recipe is an explicit request, and the resolver is what reads the name

## Context

`workflows/RESOLVER.md` has five tiers for picking a workflow recipe: `--workflow=NAME`, then
`active_workflow`, then `match:` auto-selection, then the profile default, then `default`. A user
who *names* a recipe in ordinary words — "would the **docs-only** workflow fit under its cost
cap?" — matched none of them.

Two tiers look like they should have caught it, and neither can.

- **`match:` auto-selection cannot.** `docs-only` carries `match.config_only`, which
  `tools/resolve/skiprules.mjs` computes from the **diff** ("every changed file is a config
  file"). It is a condition on the change set, not a project opt-in, and where there is no
  comparable base ref it is never true. Relaxing it to let prompt text select the recipe would
  turn a diff predicate into a text predicate for every consumer.
- **`--workflow=NAME` cannot**, because nothing turns the words into the flag.

What the run did instead is the cost. Issue #176: the orchestrator ran `plan` without
`--workflow=docs-only`, got `default` — 6 phases, `~$4.38`, cap `$16.00` — and answered a cap
question about a pipeline the user had not asked about. Both figures were real, which is exactly
what made the substitution invisible.

The obvious repair — have the orchestrator map the prose onto `--workflow=NAME` itself — is the
thing [[decisions/ADR-0019-the-run-start-is-one-command]] exists to prevent. Resolution lives
inside the command; a second implementation in prompt text is what that ADR removed. The model
also cannot do it correctly: the installed recipe set is discovered at run time from the project
and every installed plugin, and nothing tells the model what it is before the command runs.

## Decision

**Add a tier between `--workflow=NAME` and `active_workflow`: a recipe NAMED in `$ARGUMENTS`
resolves as if the flag had been typed. It is resolved inside `tools/resolve/workflow.mjs`, over
the recipe names the run actually discovered, and it is reported.**

- `workflow.tier` reports `named_in_prose`, distinct from tier 1, so telemetry can tell an
  inferred selection from a typed one.
- The plan JSON gains `workflow.available` — the sorted, deduped discoverable names. The
  not-found halt already computed that list privately; the successful plan now carries it too.
- Selection is deterministic and closed over the discovered set: a cue word (`workflow`,
  `recipe`, `pipeline`) must be present, and a discovered name must match case-insensitively on a
  word boundary. The cue word is what keeps `analysis`, `testing` and `debug` — ordinary English
  words — from hijacking a feature description.
- **Nothing ambiguous selects.** Two names matched, or a name-like token matching nothing
  installed, produces a `WARN:` and falls through to the next tier. The unknown-name warning
  prints the same `Available:` list the halt does.
- The orchestrator's one obligation is **not to trim the name out of `$ARGUMENTS`** while it
  shortens a request into a brief. It does not build the flag and does not screen the name.

## Consequences

**Positive.**

- A recipe whose `match:` block tests the diff is reachable by asking for it, which is the only
  way `docs-only` was ever reachable outside a config-only change set.
- The failure the issue describes cannot recur quietly: every outcome of the tier either selects
  and says so, or falls through and says why.
- `workflow.available` makes the discoverable set an output rather than something a consumer
  learns only by getting a name wrong.

**Negative, and accepted.**

- **A heuristic sits on the resolution path.** It is small, deterministic and tested, but it is
  the first tier that reads intent out of free text rather than a flag or a file. The cue-word
  guard and the fall-through-on-ambiguity rule are what bound the damage: the worst case is a
  `WARN` and the behaviour that existed before.
- **The unknown-name report can cry wolf.** A kebab-shaped token standing next to "pipeline" in a
  sentence about something else earns a warning. A stop-list of ordinary English words keeps it
  rare; it costs a line of output and changes no resolution.
- **The name must survive the orchestrator's reconstruction of `$ARGUMENTS`.** That is a prose
  obligation in `SKILL.md`, and prose obligations are the ones that get skipped
  ([[planning/h1-compliance-auditor]]). It is the minimum possible one — *do not delete these
  words* — and the eval suite is what holds it.

## Related
- Implemented by: #178
- Why resolution lives in the command and not in prompt text: [[decisions/ADR-0019-the-run-start-is-one-command]]
- Which values the model may and may not supply: [[decisions/ADR-0015-the-machine-value-invariant]]
- The component: [[components/sdlc]] / [[architecture/pipeline-orchestrator]]
