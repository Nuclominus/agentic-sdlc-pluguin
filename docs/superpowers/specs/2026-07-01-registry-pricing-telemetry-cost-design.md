# Model registry pricing as SSOT + telemetry cost wiring

**Date:** 2026-07-01
**Branch:** `feat/registry-pricing-telemetry-cost`

## Problem

The model registry (`plugins/sdlc/config/models.json`) centralizes tag→model_id
but omits pricing. Per-model prices live **inline** in the pipeline orchestrator
`SKILL.md` (step 3d-1), where the Opus rate is **stale** — it lists
`$15/$1.50/$75`, which is Opus 4.0/4.1-era pricing; Opus 4.8 is `$5/$0.50/$25`.
So telemetry over-reports Opus cost ~3×, `fable` has no price at all, and the
prices are duplicated instead of sourced from the SSOT.

## Goal

1. Add per-model `pricing` to the registry (the SSOT).
2. Wire the SKILL.md cost computation to read pricing from the registry.
3. Ensure telemetry records `cost_usd` per subagent model **and** a total.

## Design

### 1. `plugins/sdlc/config/models.json`

Add `pricing: { input, cached_input, output }` (USD per MTok) to every model.
`cached_input` = 0.1× `input` (Anthropic cache-read economics).

| tag | model_id | input | cached | output |
|---|---|---|---|---|
| opus | claude-opus-4-8 | 5.00 | 0.50 | 25.00 |
| sonnet | claude-sonnet-5 | 2.00 | 0.20 | 10.00 |
| haiku | claude-haiku-4-5-20251001 | 1.00 | 0.10 | 5.00 |
| fable | claude-fable-5 | 10.00 | 1.00 | 50.00 |
| opus-4-7 | claude-opus-4-7 | 5.00 | 0.50 | 25.00 |
| opus-4-6 | claude-opus-4-6 | 5.00 | 0.50 | 25.00 |
| sonnet-4-6 | claude-sonnet-4-6 | 3.00 | 0.30 | 15.00 |
| mythos | claude-mythos-5 | 10.00 | 1.00 | 50.00 |

`sonnet` uses **intro pricing** (active through 2026-08-31) and carries a
`note` flagging the expiry and the standard `3.00/0.30/15.00` fallback. The
top-level `description` drops the "planned next step / intentionally omitted"
language and states pricing is the SSOT for telemetry cost.

### 2. `schemas/models.schema.json`

The `pricing` object already exists (input/cached_input/output). Add one
optional `note` string to it; update the schema description to present tense.

### 3. `SKILL.md` step 3d-1

Delete the inline price table. Compute:

```
cost_usd = (input_tokens - cached_input_tokens)/1e6 * pricing.input
         + cached_input_tokens/1e6                  * pricing.cached_input
         + output_tokens/1e6                        * pricing.output
```

`pricing` = `MODELS.models[].pricing` for the tag matching the phase tier
(registry already loaded in 3d-0). `input_tokens` is treated as total input and
`cached_input_tokens` as its cached subset — consistent with the existing
`cache_hit_ratio = cached_input_tokens / max(input_tokens, 1)` definition.

**Missing-pricing fallback:** `cost_usd: null`, stderr
`WARN: no pricing for {model_id} — cost omitted`, exclude from the total.

### 4. `SKILL.md` step 5 + final summary

`total_cost_usd` = sum of **non-null** phase `cost_usd`; when any phase is
null-priced, append `(partial — {n} phase(s) unpriced)` to the total line.
Per-subagent cost is already in each `phases[]` entry (`model` + `cost_usd`) and
the per-phase summary already prints `${cost}`. The illustrative telemetry JSON
and the two shown phase `cost_usd` values are recomputed with the new
formula/prices.

## Scope

`models.json`, `models.schema.json`, `pipeline-orchestrator/SKILL.md`. No agent
`.md` or hook changes (the enforcement hook keys off tiers, not prices).
