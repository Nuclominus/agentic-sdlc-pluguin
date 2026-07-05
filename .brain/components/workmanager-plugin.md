---
plugin: workmanager-plugin
kind: framework
enriches_aspect: background
dependency: androidx.work
---

# workmanager-plugin

## Responsibility

Additive framework provider for Android WorkManager deferrable background work. Auto-detected by
the orchestrator from the Gradle version catalog / build files; enriches the `background` aspect
(`enriches_aspect: background`) via `manifest.yaml` (`kind: framework`) with the
`workmanager-conventions` skill, development + security phase-prompt injections, and R8/ProGuard
keep rules. Ships no agents — it specializes the existing development / security phase prompts.

## Key files
- `plugins/workmanager-plugin/manifest.yaml`
- `plugins/workmanager-plugin/.claude-plugin/plugin.json`

## Decisions
- [[decisions/ADR-0002-framework-provider-pattern]]

## Change history
_Backlinks from `changes/` accumulate here._
