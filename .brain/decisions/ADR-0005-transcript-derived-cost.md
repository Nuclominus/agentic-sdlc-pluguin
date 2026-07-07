---
adr: 5
status: accepted
date: 2026-07-07
supersedes: null
---

# ADR-0005 — Transcript-derived per-phase cost (real input/output/cache split)

## Context

[[decisions/ADR-0004-aggregate-token-telemetry-crash-recovery]] made the pipeline capture the Agent
result envelope's aggregate `subagent_tokens` verbatim and set `cost_usd: null` for those phases,
because the envelope exposes no input/output/cache split and a split can't be honestly fabricated
from an aggregate. That fixed the "all-zero tokens" bug but left two visible gaps, reported against
run `change-matches-filter-logic-gender`:

1. **Every phase's `cost_usd` was `null`** → `total_cost_usd: null`; the HTML report showed `—` for
   cost and "N phase(s) unpriced".
2. **The report showed 0 tokens per phase.** ADR-0004 updated `metrics.mjs` to surface
   `subagent_tokens`, but the HTML renderer (`tools/report/report.mjs`) and the cross-run rollup
   were never taught the new field, so they still summed the now-unset `input_tokens`/`output_tokens`
   and rendered 0. Worse, the aggregate itself badly *understates* real usage — it ignores the
   per-turn prompt-cache **reads** that dominate a long agent run (a 73k-`subagent_tokens` phase
   actually billed ~2M tokens).

The authoritative usage split does exist — not in the Agent envelope, but in each subagent's own
transcript. In this harness, every dispatched `Agent` persists a JSONL at
`~/.claude/projects/<encoded-cwd>/<session>/subagents/agent-<agentId>.jsonl`, and every assistant
turn there carries a real `message.usage` block (`input_tokens` = uncached input,
`cache_read_input_tokens`, `cache_creation_input_tokens` with an `ephemeral_5m`/`ephemeral_1h`
split, `output_tokens`). The orchestrator receives each phase's `agentId` in the Agent result, and
the dispatch order is recoverable from the session transcript.

## Decision

**Recover the real per-phase split and cost from subagent transcripts, deterministically, at
report time.** A new dependency-free tool `plugins/sdlc/tools/usage/` (`usage.mjs` + `cli.mjs`,
mirrored to `tools/sdlc-lint/lib/usage.mjs` for tests) reads each phase's subagent transcript,
sums the usage split across turns, prices it against the model registry, and rewrites
`_telemetry.json` with real `input_tokens`/`output_tokens`/`cached_input_tokens`/
`cache_creation_tokens`/`billed_tokens`/`cost_usd` (`usage_source: "transcript"`), real `total_*`
aggregates + `cache_hit_ratio`, and an `orchestration_overhead` block (orchestrator main-loop turns
bounded to the run window + non-phase/nested subagents). Phase→transcript mapping is authoritative:
from each phase's recorded `agent_id`, or derived from the session transcript's Agent dispatch order
(`Phase N/M: <phase>` descriptions); a multi-pass phase (dev plan + implement) sums all its ids.

- **Orchestrator (`SKILL.md`):** Step 3d-1 now **always records `agent_id`** on the phase entry
  (the aggregate capture stays as the live fallback). Step 5b runs
  `usage/cli.mjs enrich {slug}` before rendering the report; a phase with no locatable transcript
  keeps its aggregate/`null` cost. Enrichment never fails the pipeline.
- **Pricing (`config/models.json`):** cache **creation** is priced with new
  `cache_write_multipliers { ephemeral_5m: 1.25, ephemeral_1h: 2.0 }` (Anthropic standard, relative
  to the model's input rate); cache **reads** at `cached_input`. The registry stays the single
  source of truth.
- **Renderers:** `report.mjs` shows the real billed split (input / output / cache-read / cache-write
  per phase + an orchestration row) and reconciles to the total; `metrics.mjs` gains
  `cache_creation_tokens`/`billed_tokens` and ranks `top_consumers` by billed tokens. All keep an
  aggregate/`subagent_tokens` fallback for un-enriched (older / missing-transcript) phases.

This **supersedes the "cost is null for aggregate-only phases" position of ADR-0004** while keeping
its core principle intact: still never fabricate a split from an aggregate — instead read the real
split from the source that has it.

Rejected alternatives: **blended-rate estimate** from `subagent_tokens` (a cache-heavy run's
input:output:cache mix is unknowable from one number, so the estimate can be 3–5× off — the same
"looks authoritative but fiction" failure ADR-0004 rejected); **teaching the LLM orchestrator to
parse JSONL inline** (fragile prose-driven math; keep it in tested deterministic code); **counting
the whole session transcript unbounded** for overhead (a long-lived session's pre/post-run turns
would inflate the run — hence the run-window bound).

## Consequences

- Real all-in cost per run (e.g. `change-matches-filter-logic-gender`: **$16.87** = $10.35 phases +
  $5.16 orchestrator main-loop + $1.36 session-recorder/nested), replacing `—`; per-phase cost,
  billed tokens, and a 0.99 cache-hit ratio now render.
- Cost accuracy no longer depends on the harness ever exposing a split envelope — the transcript is
  the source of truth.
- Backfillable: `enrich <run-dir> --session <transcript>` reprices any past run whose transcripts
  survive. Applied to the reporting run.
- New per-phase fields (`agent_id`, `cache_creation_tokens`, `billed_tokens`, `usage_source:
  "transcript"`) registered in `schemas/checkpoint.schema.json`; the sdlc-lint suite covers the tool
  (9 new tests, 91 total).
- Overhead visibility surfaces a real signal for future AARs: the orchestrator's own main-loop can
  cost roughly as much as all work phases combined.

## Related
- Implemented by: (this change — PR TBD)
- Supersedes the cost-null decision of: [[decisions/ADR-0004-aggregate-token-telemetry-crash-recovery]]
- Relates to: [[architecture/pipeline-orchestrator]] / [[components/sdlc]]
