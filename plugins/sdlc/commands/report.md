---
description: Cross-run cost rollup across all SDLC pipeline runs — total spend, cost over time, by phase/model, cache-hit trend, cap breaches, skip frequency, QA-iteration distribution. Deterministic, no LLM tokens.
---

# /sdlc:report

Aggregate every `docs/plans/*/_telemetry.json` in this project into a single cross-run
rollup. Runs a deterministic, dependency-free script — no agents, no LLM tokens.

Run exactly this from the project root:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/rollup/cli.mjs report
```

Then relay to the user:
- the terminal digest the script prints (totals, per-run table, by-model, by-phase), and
- the path it wrote: `docs/plans/rollup/index.html` (self-contained HTML artifact with the
  cost-over-time trend, QA-iteration distribution, and incident lists).

If the script prints "No pipeline runs recorded yet", tell the user there is no telemetry to
roll up yet (run `/sdlc:start` first). Pass `--json` instead of the bare `report` only when the
user wants the raw aggregate object.
