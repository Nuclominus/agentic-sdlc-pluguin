# Machine values — the invariant

> The rule Track H3 makes enforceable. Shipped with the plugin, like `PLUGIN-PATHS.md`, so the
> contract travels with the text it governs. Enforced by `sdlc-lint machine-values`, which parses
> the registry below — this document *is* the check's input, so it cannot drift from it.

## The invariant

**The model never transcribes or computes a value a machine already holds. Where the value exists
on disk, the contract passes the path — never the number.**

Three of the four defects in the incident that opened Track H were instances of this one rule being
absent (`ADR-0012`). H2 fixed the worst of them by making `run/cli.mjs finish` the sole writer of
the run clock (`ADR-0014`); this document generalises that fix and gives it teeth.

Why a lint rather than firmer wording: the two definitions of `cache_hit_ratio` had **already**
diverged before anyone noticed —

```
SKILL.md (prose, removed by H3)   cached / max(input, 1)
tools/usage/usage.mjs:628          cached / (input + cached)
```

Same key, different denominators, no symptom — because the tool overwrites whatever the model
computed. A drift that survives human review for as long as both spellings have existed is not
fixed by asking more emphatically.

## Registry — machine-owned keys

Each entry is `<key>: <owner command>`. A key listed here must never appear as the subject of a
computation in shipped prose.

```machine-values
cost_usd: tools/usage/cli.mjs phase-cost, then tools/run/cli.mjs finish
input_tokens: tools/run/cli.mjs finish
output_tokens: tools/run/cli.mjs finish
cached_input_tokens: tools/run/cli.mjs finish
cache_creation_tokens: tools/run/cli.mjs finish
billed_tokens: tools/run/cli.mjs finish
turns: tools/run/cli.mjs finish
peak_prefix_tokens: tools/run/cli.mjs finish
cache_pressure: tools/run/cli.mjs finish
total_input_tokens: tools/run/cli.mjs finish
total_output_tokens: tools/run/cli.mjs finish
total_cached_input_tokens: tools/run/cli.mjs finish
total_cache_creation_tokens: tools/run/cli.mjs finish
total_cost_usd: tools/run/cli.mjs finish
cache_hit_ratio: tools/run/cli.mjs finish
orchestration_overhead: tools/run/cli.mjs finish
cost_basis: tools/run/cli.mjs finish
plugin_version: tools/run/cli.mjs finish
started_at: tools/run/cli.mjs finish
completed_at: tools/run/cli.mjs finish
wall_clock_seconds: tools/run/cli.mjs finish
sealed_by: tools/run/cli.mjs finish
```

## Audit — what the orchestrator was asked to produce

Every machine-known value `pipeline-orchestrator/SKILL.md` asked the model to compute, and what
became of it.

| value | site | disposition |
|---|---|---|
| `cost_usd` | 3d-1 pricing formula | **removed** — `phase-cost` computes it one step later from the same registry |
| `input_tokens` / `output_tokens` / `cached_input_tokens` | 3d-1 envelope shape 1 | **removed** — this harness's envelope never exposes the split; the transcript does |
| token estimate `len / 4` | 3d-1 envelope shape 3 | **removed** — inventing a number for a value a machine holds is the invariant's purest violation |
| `total_input_tokens` / `total_output_tokens` / `total_cached_input_tokens` | Step 5 | **removed** — `usage.mjs:621–623` assigns them unconditionally |
| `total_cost_usd` | Step 5 | **removed** — `usage.mjs:626` |
| `cache_hit_ratio` | Step 5 | **removed** — `usage.mjs:628`, and the two definitions had already diverged |
| `started_at` / `completed_at` / `wall_clock_seconds` | Step 5 | **removed by H2** — `clock.mjs` is their sole writer (`ADR-0014`) |
| `sealed_by` | — | **new in H6** — records which path sealed the run (orchestrator or `Stop` hook); the model must never write it, since the whole point is that it says who did |

Values that stay with the model, and why the invariant does not reach them:

| value | why |
|---|---|
| `agent_id` | exists only in the Agent result envelope; no file records it |
| `subagent_tokens`, `total_subagent_tokens` | the envelope's aggregate count. `finish` sums only `usage_source: "transcript"` phases and never writes this key — removing it would delete the value, not relocate it |
| `qa_iterations_used`, `qa_status` | parsed from the agent's compact summary, which exists only in context |
| `compact_summary_chars` | the length of a string that exists only in context |
| `model` | a registry *lookup* from the declared tier, not a value stored on disk under that key |
| `CONTEXT.running_cost_usd` | feeds a decision **inside** the run. `phase-cost` returns each phase's number; the accumulation is the gate's own state |
| `cap_status` | the gate's verdict. `finish` may override it to `exceeded-undetected`, but does not originate it |
| `touched_files` | git holds it — a genuine instance, deliberately deferred (see Limits) |

## What this check does not do

Stated so the guarantee is not oversold:

- **Left-hand anchoring only.** `foo = cost_usd + bar` is not caught. Broadening to "a machine key
  anywhere near an operator" re-admits false positives like `max_total_cost_usd=0.60` and
  `CONTEXT.running_cost_usd = 0`; the narrowness *is* the design.
- **Lexical, not semantic.** Prose that asks for the same computation without `=`, `sum of`,
  `computed from` or `derived from` evades it. The check raises the cost of adding a new
  transcription; it does not make one impossible.
- **Registry-bounded.** A machine value never added to the registry is never checked.
- **Deferred instances.** `touched_files` (git) and the cap gate's running-total accumulation are
  real instances left model-owned. Both need tool changes rather than deletions, and H3 is a
  subtraction. They are recorded here so the next person finds them already reasoned about.

## Escape hatch

A line that must state a computation carries, on itself or the line directly above:

```
<!-- machine-values: ok — reason -->
```

The reason is required. As of H3 the tree contains **zero** of these; if you are adding the first
one, the question to answer is why the value cannot come from the path instead.
