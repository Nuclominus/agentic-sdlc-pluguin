---
plugin: datastore-proto-plugin
kind: framework
enriches_aspect: persistence
dependency: androidx.datastore
---

# datastore-proto-plugin

## Responsibility

Additive framework provider for Proto DataStore persistence. Auto-detected from the Gradle version
catalog / build files; enriches the `persistence` aspect (`enriches_aspect: persistence`) via
`manifest.yaml` (`kind: framework`) with the `datastore-conventions` skill, development + security
phase-prompt injections, and R8/ProGuard keep rules. Ships no agents — it specializes the existing
development / security phase prompts. Coexists with `room-plugin` on the `persistence` aspect; only
the detected provider activates.

## Key files
- `plugins/datastore-proto-plugin/manifest.yaml`
- `plugins/datastore-proto-plugin/.claude-plugin/plugin.json`

## Decisions
- [[decisions/ADR-0002-framework-provider-pattern]]

## Change history
_Backlinks from `changes/` accumulate here._
