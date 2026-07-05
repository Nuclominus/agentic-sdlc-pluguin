---
plugin: dagger-plugin
kind: framework
enriches_aspect: di
dependency: com.google.dagger
---

# dagger-plugin

## Responsibility

Additive framework provider for Dagger / Hilt dependency injection. Auto-detected by the
orchestrator from the Gradle version catalog / build files; enriches the `di` aspect
(`enriches_aspect: di`) via `manifest.yaml` (`kind: framework`) with the `hilt-conventions` skill,
development + security phase-prompt injections, and R8/ProGuard keep rules. Ships no agents — it
specializes the existing development / security phase prompts.

## Key files
- `plugins/dagger-plugin/manifest.yaml`
- `plugins/dagger-plugin/.claude-plugin/plugin.json`

## Decisions
- [[decisions/ADR-0002-framework-provider-pattern]]

## Change history
_Backlinks from `changes/` accumulate here._
