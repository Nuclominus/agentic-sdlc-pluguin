---
plugin: koin-plugin
kind: framework
enriches_aspect: di
dependency: io.insert-koin
---

# koin-plugin

## Responsibility

Additive framework provider for Koin dependency injection. Auto-detected from the Gradle version
catalog / build files; enriches the `di` aspect (`enriches_aspect: di`) via `manifest.yaml`
(`kind: framework`) with the `koin-conventions` skill, development + security phase-prompt
injections, and minimal R8/ProGuard notes. Ships no agents — it specializes the existing
development / security phase prompts. Coexists with `dagger-plugin` on the `di` aspect; only the
detected provider activates.

## Key files
- `plugins/koin-plugin/manifest.yaml`
- `plugins/koin-plugin/.claude-plugin/plugin.json`

## Decisions
- [[decisions/ADR-0002-framework-provider-pattern]]

## Change history
_Backlinks from `changes/` accumulate here._
