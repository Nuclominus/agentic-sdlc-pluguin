---
adr: 38
status: accepted
date: 2026-09-29
supersedes: null
---

# ADR-0038 — The `sonnet` tier moves to Claude Sonnet 5.5

## Context

The `sonnet` tag in the Claude model registry resolved to `claude-sonnet-5` ($2 input / $0.20 cached / $10 output per MTok). Claude Sonnet 5.5 is its successor at the same prices, with the same tokenizer, 1M context and 128K output. It differs in ways that could matter to a dispatcher: `thinking: {type: "disabled"}` returns a 400, forced `tool_choice` `any`/`tool` returns a 400, and effort levels are recalibrated.

## Decision

Repoint the dispatched `sonnet` tag to `claude-sonnet-5-5` and keep `claude-sonnet-5` as a pin-only reference entry (`sonnet-5`) so telemetry can still price runs that recorded it. Same pattern as [[decisions/ADR-0035-the-opus-tier-moves-to-opus-5-5]].

Nothing in the pipeline is exposed to the 5.5 changes: every agent declares `effort` explicitly, dispatch goes through the `Agent` tool by tier name, and the pipeline sets neither `thinking` nor `tool_choice`.

## Consequences

- No price change, so dry-run previews for `sonnet` are unchanged.
- `estimation_baselines.sonnet` is **provisional**: its tokens were measured on Sonnet 5 and no run has been measured on 5.5. The drift test prices it at the model it was measured on. Re-derive once real 5.5 runs exist.
- Recorded runs that name `claude-sonnet-5` keep pricing correctly through the reference entry.

## Related
- Relates to: [[decisions/ADR-0035-the-opus-tier-moves-to-opus-5-5]]
