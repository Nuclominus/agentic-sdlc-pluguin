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
reads whichever foundation manifest wins. Beyond the five phase agents it ships `session-recorder`,
a built-in run closer dispatched at orchestrator Step 6 that appends a short entry to the cumulative
run journal `docs/plans/_journal.md` (elapsed time measured via a real Step 2 clock, not estimated).
Its orchestrator prompt template carries a **read-discipline contract** in the cache-stable prefix
(Track E2, [[decisions/ADR-0008-read-discipline-contract]]) — surgical reads, no repeat reads, terse
tool output — enforced at CI time by the `read-discipline` verb of `tools/sdlc-lint` (part of `all`).
Every runtime path it reads resolves from the **running install** — the three roots
(`SDLC_PLUGIN_ROOT` / `PLUGIN_CACHE_ROOT` / `CONFIG_DIR`) defined in `plugins/sdlc/PLUGIN-PATHS.md`
and computed in orchestrator Step 0, never a literal `~`
([[decisions/ADR-0009-plugin-root-resolution]], issue #70) — guarded by the `plugin-paths` lint verb.

## Key files
- `plugins/sdlc/manifest.yaml`
- `plugins/sdlc/.claude-plugin/plugin.json`
- `plugins/sdlc/agents/session-recorder.md`
- `plugins/sdlc/PLUGIN-PATHS.md` (path-resolution contract; orchestrator Step 0 resolves it)
- `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (Step 0 roots, Step 2 clock, Step 5 timing, Step 6 close)
- `tools/sdlc-lint/lib/read-discipline.mjs`
- `tools/sdlc-lint/lib/plugin-paths.mjs`

## Decisions
- [[decisions/ADR-0001-stack-provider-pattern]]
- [[decisions/ADR-0003-session-recorder-run-journal]]
- [[decisions/ADR-0009-plugin-root-resolution]]

## Change history
_Backlinks from `changes/` accumulate here._
