# H3 — The machine-value invariant (design)

**Date:** 2026-07-28
**Track:** H3 (instruction fidelity) — see `.brain/planning/h-instruction-fidelity.md`
**Status:** designed
**Depends on:** H2 (`run/cli.mjs finish` owns the run tail, PR #103) — see
`.brain/decisions/ADR-0014-the-run-tail-is-one-command.md`

## Problem

Three of the four defects in the incident that opened Track H are the same defect: the model was
asked to produce a value a machine already held. H2 fixed the instance that scored worst — the run
clock — by making `finish` its only writer. It did not state the rule, and it did not stop the next
one from being written.

What remains in `pipeline-orchestrator/SKILL.md` after H2:

| where | what the model is told to produce | who already holds it |
|---|---|---|
| 3d-1 | `cost_usd` via a five-term floating-point formula over registry pricing | `usage/cli.mjs phase-cost` (3d-1b), then `finish` |
| 3d-1 shape 1 | read `input_tokens` / `output_tokens` / `cached_input_tokens` off the envelope | the phase's subagent transcript |
| 3d-1 shape 3 | *estimate* tokens from `len(text) / 4` when the envelope carries no usage | nobody — this fabricates a machine value |
| Step 5 | `total_input_tokens`, `total_output_tokens`, `total_cached_input_tokens`, `total_cost_usd` as sums over `phases[]` | `usage.mjs:621–626`, unconditional assignment |
| Step 5 | `cache_hit_ratio = total_cached_input_tokens / max(total_input_tokens, 1)` | `usage.mjs:628` |

Every one of these is overwritten later in the same run. The prose asks for arithmetic whose result
is discarded — a step that can only be executed *wrongly*, never usefully.

That it can be executed wrongly is not hypothetical. The two `cache_hit_ratio` definitions have
already diverged:

```
SKILL.md:2036   cached / max(input, 1)
usage.mjs:628   cached / (input + cached)
```

Different denominators, same key. Nobody noticed, because the tool overwrites the model's answer.
A drift that a human review missed for as long as both have existed is the argument for a lint
rather than for better wording.

## Goal

State the invariant once, in a place that ships with the plugin, and give it teeth:

> **The model never transcribes or computes a value a machine already holds. Where the value exists
> on disk, the contract passes the path — never the number.**

Non-goals, deliberately: moving `touched_files` (git) or the final-summary rendering into `finish`;
teaching `phase-cost` to return a running total so the cap gate's accumulation leaves prose too.
Both are real instances, both are scoped out of H3 and recorded as *justified, deferred* in the
audit — they change tool behaviour, and H3 is a subtraction, not a rewrite. Also out of scope: any
value only the model can see. The guarantee extends exactly as far as the part of the procedure a
machine can perform, and not one step further.

## Design

### 1. The contract document

New `plugins/sdlc/MACHINE-VALUES.md`, shipped inside the plugin like `PLUGIN-PATHS.md`. It is three
things at once, on purpose: the statement of the invariant, the written audit the DoD asks for, and
the **source the lint parses**. A document the lint reads cannot drift from the lint — which is the
track's own principle applied to itself.

Structure:

- The invariant, stated as above.
- A machine-readable registry, in a fenced block, following the precedent of the ` ```sdlc-contract `
  blocks that `lib/contracts.mjs` already parses out of prose:

  ````
  ```machine-values
  cost_usd: tools/usage/cli.mjs phase-cost, then tools/run/cli.mjs finish
  input_tokens: tools/run/cli.mjs finish
  total_cost_usd: tools/run/cli.mjs finish
  cache_hit_ratio: tools/run/cli.mjs finish
  ...
  ```
  ````

  One `key: owner` per line. `key` is the telemetry key; `owner` is the command that writes it.
- The audit table: every value `SKILL.md` asked the model to produce, each marked `removed` or
  `model-owned — <reason>`.
- The lint's stated limits (below), so a reader is not misled about the strength of the guarantee.

**Machine-owned** (registry entries, model must not compute): `cost_usd`, `input_tokens`,
`output_tokens`, `cached_input_tokens`, `cache_creation_tokens`, `billed_tokens`, `turns`,
`peak_prefix_tokens`, `cache_pressure`, `total_input_tokens`, `total_output_tokens`,
`total_cached_input_tokens`, `total_cache_creation_tokens`, `total_cost_usd`, `cache_hit_ratio`,
`orchestration_overhead`, `started_at`, `completed_at`, `wall_clock_seconds`, `cost_basis`,
`plugin_version`.

**Model-owned, justified in writing** — the machine does not hold these, so the invariant does not
reach them:

| value | why it stays with the model |
|---|---|
| `agent_id` | exists only in the Agent result envelope, which no file records |
| `subagent_tokens`, `total_subagent_tokens` | the envelope's aggregate count; `finish` does not recompute it (`usage.mjs` sums only `usage_source: "transcript"` phases) |
| `qa_iterations_used`, `qa_status` | parsed from the agent's compact summary, which lives only in context |
| `compact_summary_chars` | length of a string that exists only in context |
| `model` | a registry *lookup* from the declared tier, not a value on disk under that key |
| `CONTEXT.running_cost_usd` | feeds a decision **inside** the run; `phase-cost` returns each phase's number, the accumulation is the gate's own state |
| `cap_status` | the gate's verdict; `finish` may *override* it to `exceeded-undetected`, but does not originate it |
| `touched_files` | git holds it — a genuine instance, deferred with the non-goals above |

### 2. The lint — `sdlc-lint machine-values`

A new verb in `tools/sdlc-lint/`, mirroring the shape of `plugin-paths` and `read-discipline`:
`lib/machine-values.mjs` + a CLI printer + inclusion in `all` and in `--json`. Source-tree only —
it never runs at pipeline runtime, so it gets no mirrored copy under `plugins/sdlc/tools/`.

Three checks:

1. **Contract present and referenced.** `plugins/sdlc/MACHINE-VALUES.md` reads, and
   `pipeline-orchestrator/SKILL.md` mentions it — so the rule has exactly one definition and the
   file it governs points at it.
2. **Registry well-formed.** The ` ```machine-values ` block parses, is non-empty, and every entry
   names an owner. A key with no owner is an unsupported claim.
3. **No arithmetic over a machine-owned key** in shipped prose. A line fails when a registry key
   appears as the *subject* of a computation:

   ```
   \b(key1|key2|…)\b`?\s*(?:=[^=]|(?:is )?(?:the )?sum of|computed from|derived from)
   ```

   unless the line — or the line directly above it — carries `<!-- machine-values: ok — reason -->`.
   A bare marker is not a justification: a stated reason is required after `ok`, the same lookahead
   guard the two existing lints use to keep `-->` from passing as a one-character reason.

**Scan surface:** `plugins/**/*.md` — skills, agents, rules, commands: everything an LLM reads as an
instruction. Ignores `node_modules` and `plugins/*/tools/*/test/**`.

**Exit codes:** `0` clean, `1` violations, `2` tool error (unreadable file / missing contract) —
matching every other verb.

**CI:** `.github/workflows/ci.yml` already runs `sdlc-lint all --json`; adding the verb to `all` is
the whole wiring.

#### Verified sharpness

The pattern was run against the live tree with the exact registry key list above, before this design
was written. Across all of `plugins/**/*.md` it produces exactly **six** hits — `SKILL.md:1429`,
`2002`, `2003`, `2004`, `2006`, `2036` — which are precisely the six lines this change removes.
Nothing else in the tree matches.

Three near-misses are worth naming, because each one is a false positive the design had to survive:

| line | why it does not fire |
|---|---|
| `commands/workflow-config.md:101` — `caps: max_total_cost_usd=0.60` | `\b` rejects: `total_cost_usd` is preceded by `_`, so there is no word boundary |
| `SKILL.md:1497` — `CONTEXT.running_cost_usd = 0` | same — `cost_usd` sits inside `running_cost_usd` |
| `SKILL.md:2005` — `total_subagent_tokens = sum of phase subagent_tokens` | not a registry key. It is genuinely model-owned, and the check correctly leaves it alone |

That last one is the design validating itself: the machine-owned / model-owned split declared in the
contract doc is the same split the lint enforces, so the one sum the model must keep computing is
the one sum the check does not object to.

It also does **not** match descriptive prose about the same keys —
`` `total_cost_usd` is NOT what the cost cap gates on `` passes cleanly. That matters: `SKILL.md`
discusses these keys dozens of times, and a check that fired on discussion would need so many
`ok` markers that it would become noise. Anchoring on assignment is what keeps it silent.

**Consequence:** after the Step 3 edits below, the lint runs clean with **zero** escape-hatch
markers in the tree. A lint whose first green run needs no exemptions is measuring the right thing.

#### Stated limits

Written into the contract doc, so the guarantee is not oversold:

- **Left-hand anchoring only.** `foo = cost_usd + bar` is not caught. Broadening to "a machine key
  anywhere near an operator" re-admits the false positives above; the narrowness *is* the design.
- **Lexical, not semantic.** Prose that asks for the same computation without an `=` or the word
  "sum" evades it. The check raises the cost of adding a new transcription; it does not make one
  impossible.
- **Registry-bounded.** A machine value that is never added to the registry is never checked.

### 3. The `SKILL.md` edits

| step | before | after |
|---|---|---|
| **3d-1** | three envelope shapes, in priority order | one shape. Record what only you can see: `agent_id` (REQUIRED, unchanged), `model` from the tier, `subagent_tokens` verbatim when the envelope reports one, `compact_summary_chars`, `status`, `output_file`, `aspect`. Set `cost_usd: null` and `usage_source: "pending"` — 3d-1b fills them from the transcript. |
| **3d-1 shape 1** | read the split triple off the envelope | deleted. This harness's envelope never exposes it; the transcript does, and 3d-1b already reads it. |
| **3d-1 shape 3** | estimate tokens from `len / 4` | deleted. Inventing a number for a value a machine holds is the defect the invariant names, in its purest form. |
| **3d-1** | the `cost_usd` pricing formula | deleted. `phase-cost` computes it from the same registry, one step later. |
| **Step 5** | four `total_* = sum of …` bullets and the `cache_hit_ratio` formula | write the keys as explicit `null`; `finish` is their only writer. Same pattern H2 established for the clock, with one difference (below). |
| **Step 5** | `total_subagent_tokens = sum of phase subagent_tokens` | **kept, unchanged.** `finish` sums only `usage_source: "transcript"` phases and never writes this key, so the model is its only writer. Removing it would delete the value, not relocate it. |
| **Step 5 example** | literal numbers for machine-owned keys | `"<written by Step 5b's finish>"` placeholders, matching what the three clock keys already do. The block documents what the *orchestrator writes*, so showing a number it must not write contradicts the instruction beside it. |

Kept, untouched: everything in Step 5 and 5b that is **judgement** rather than arithmetic — why the
cap and the total legitimately disagree, what `$— (unpriced)` means, when `exceeded-undetected` is a
gate failure versus a mis-sized cap. Track H explicitly cannot make those deterministic, and this
change must not thin them out while removing the formulas next to them.

#### `null` rather than omission

H2 had the model *omit* the clock keys. Cost totals get an explicit `null` instead, because
`enrich` has an early-return path: when no phase transcript resolves, it leaves pre-enrich telemetry
alone. Omission would then produce an absent key, which reads as "not applicable"; `null` reads as
"unknown" — and "an unknown must not be encoded as a measured zero" is doctrine this file already
states for `total_cost_usd` and `cache_hit_ratio`. The clock has no such path: `finish` writes it
from the anchor unconditionally, so omission is safe there and stays.

### 4. Integration risk

The one place this could break something is the consumers of telemetry written *before* enrichment.
What is already established:

- `usage.mjs:621–628` assigns every total unconditionally — it never merges with what the model
  wrote, so removing the model's sums cannot change an enriched run's numbers.
- There is no `telemetry.schema.json` anywhere in the tree, so no schema forbids a `null` total or a
  new `usage_source` value.

To verify during implementation: `tools/report`, `tools/rollup`, and `lib/aar-metrics.mjs` tolerate
`usage_source: "pending"` and `null` totals on an unenriched run. `pending` is a new enum member;
readers that switch on `"reported" | "subagent_aggregate" | "estimated" | "transcript"` need a
default branch. If any consumer requires a member of the old set, the fallback is to keep
`usage_source` unset until 3d-1b writes it, rather than to reintroduce the estimate.

### 5. Tests

`tools/sdlc-lint/test/machine-values.test.mjs`:

- registry parsing: well-formed block; empty block; entry with no owner; missing fence.
- positives: each of the six removed formula lines, as fixtures.
- negatives: `max_total_cost_usd=0.60`; `CONTEXT.running_cost_usd = 0`;
  `total_subagent_tokens = sum of phase subagent_tokens` (model-owned, absent from the registry);
  the descriptive `` `total_cost_usd` is NOT what the cost cap gates on ``.
- escape hatch: marker on the line; marker on the line above; marker with no stated reason →
  still fails.
- `tool_error` when the contract doc is missing.

`test/all.test.mjs` gains the new verb. The whole suite stays `node --test tools/sdlc-lint/test/*.test.mjs`.

## Definition of Done

- `plugins/sdlc/MACHINE-VALUES.md` exists, ships, is referenced from `SKILL.md`, and its audit table
  accounts for every machine-known value the file asked the model to produce.
- The six formula lines are gone from `SKILL.md`; `sdlc-lint machine-values` is green with **zero**
  `ok` markers in the tree.
- `sdlc-lint all` green; `npm test --prefix tools/sdlc-lint` green; CI unchanged except for the new
  verb running inside `all`.
- `SKILL.md` line count drops. The count of *mandated tool invocations* is unchanged by design —
  H3 removes work rather than adding a step, so it produces no new compliance rate to measure. Its
  effect shows up as a smaller surface for the rates H1 already tracks.

## Vault

- **ADR-0015** — the machine-value invariant: the rule, the `cache_hit_ratio` divergence as its
  evidence, the lint's stated limits, and why `touched_files` and the cap-gate accumulation were
  left model-owned.
- `.brain/planning/h-instruction-fidelity.md` — mark H3 shipped, record what was removed, and update
  the H4 gate paragraph, which waits on "H2 and H3 landed plus enough runs on the new tail".
- `.brain/planning/roadmap.md` — the H3 row.
- The change note is generated by `brain-sync` on merge; enrich its prose afterwards, never before.
