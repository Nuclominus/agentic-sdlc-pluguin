---
plugin: sdlc
kind: core
enriches_aspect: null
dependency: null
---

# sdlc

## Responsibility

Universal SDLC orchestrator with stack provider auto-discovery. Owns the pipeline; plugins
register themselves via `manifest.yaml` profiles (`kind: foundation | framework`). Includes 5
cost-tiered default agents (BA Opus, Dev Sonnet, QA Sonnet with iteration cap, Sec Opus, Docs
Haiku). Slash command: `/sdlc:start "<feature>"`. Ships its own vanilla `manifest.yaml`
(`kind: foundation`, `priority: 0`) as the always-matching fallback profile when no specialized
foundation claims the project, but the core pipeline logic itself never forks per stack — it
reads whichever foundation manifest wins.

## Key files
- `plugins/sdlc/manifest.yaml`
- `plugins/sdlc/.claude-plugin/plugin.json`

## Decisions
- [[decisions/ADR-0001-stack-provider-pattern]]

## Change history
_Backlinks from `changes/` accumulate here._
