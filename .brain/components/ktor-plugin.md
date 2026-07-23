---
plugin: ktor-plugin
kind: framework
enriches_aspect: network
dependency: io.ktor
---

# ktor-plugin

## Responsibility

Additive framework provider for Ktor client networking. Auto-detected from the Gradle version
catalog / build files; enriches the `network` aspect (`enriches_aspect: network`) via
`manifest.yaml` (`kind: framework`) with the `ktor-conventions` skill, development + security
phase-prompt injections, and R8/ProGuard keep rules. Ships no agents — it specializes the existing
development / security phase prompts. Coexists with `retrofit-plugin` on the `network` aspect; only
the detected provider activates.

## Key files
- `plugins/ktor-plugin/manifest.yaml`
- `plugins/ktor-plugin/.claude-plugin/plugin.json`

## Decisions
- [[decisions/ADR-0002-framework-provider-pattern]]

## Change history
_Backlinks from `changes/` accumulate here._
