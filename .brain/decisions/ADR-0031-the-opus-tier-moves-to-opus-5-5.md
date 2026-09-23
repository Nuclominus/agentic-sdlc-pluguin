---
adr: 31
status: accepted
date: 2026-09-24
supersedes: null
---

# ADR-0031 — The `opus` tier moves to Claude Opus 5.5

## Context

The `opus` tag in the Claude model registry resolved to `claude-opus-5` ($5 input / $0.50 cached / $25 output per MTok). Claude Opus 5.5 is the next model in the Opus line at a lower price ($4 / $0.20 / $20) with the same context window and tokenizer. It differs in ways that could matter to a dispatcher: thinking cannot be disabled, `effort` defaults to `medium` rather than `high`, and forced `tool_choice` returns a 400.

## Decision

Repoint the dispatched `opus` tag to `claude-opus-5-5` and keep `claude-opus-5` as a pin-only reference entry (`opus-5`) so telemetry can still price runs that recorded it. The registry stays the single place a model or rate is edited.

Nothing in the pipeline is exposed to the 5.5 changes: every agent declares `effort` explicitly, dispatch goes through the `Agent` tool by tier name, and the pipeline sets neither `thinking` nor `tool_choice`.

## Consequences

- Opus phases cost less per token; dry-run previews for `opus` drop from about $0.95 to about $0.62 per dispatch.
- `estimation_baselines.opus` is **provisional**: its tokens were measured on Opus 5 and no run has been measured on 5.5. The drift test prices that baseline at the model it was measured on, so it checks the token shape only. Re-derive the baseline once real 5.5 runs exist.
- The `fable` baseline inherits the opus token shape and is affected the same way.
- Recorded runs that name `claude-opus-5` keep pricing correctly through the reference entry.

## Related
- Implemented by: #220
- Relates to: [[decisions/ADR-0029-one-ssot-emitted-host-packages]]
