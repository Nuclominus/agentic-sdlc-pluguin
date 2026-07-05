---
plugin: room-plugin
kind: framework
enriches_aspect: persistence
dependency: androidx.room
---

# room-plugin

## Responsibility

Additive framework provider for Room (`androidx.room`) persistence. Auto-detected by the
orchestrator from the Gradle version catalog / build files; enriches the `persistence` aspect
(`enriches_aspect: persistence`) via `manifest.yaml` (`kind: framework`) with the
`room-conventions` skill, development + security phase-prompt injections, and R8/ProGuard keep
rules. Ships no agents — it specializes the existing development / security phase prompts.

## Key files
- `plugins/room-plugin/manifest.yaml`
- `plugins/room-plugin/.claude-plugin/plugin.json`

## Decisions
- [[decisions/ADR-0002-framework-provider-pattern]]

## Change history
_Backlinks from `changes/` accumulate here._
