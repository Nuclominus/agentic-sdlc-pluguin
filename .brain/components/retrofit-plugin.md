---
plugin: retrofit-plugin
kind: framework
enriches_aspect: network
dependency: com.squareup.retrofit2
---

# retrofit-plugin

## Responsibility

Additive framework provider for Retrofit/OkHttp networking. Auto-detected from the Gradle
version catalog / build files; enriches the `network` aspect (`enriches_aspect: network`) via
`manifest.yaml` (`kind: framework`) with the `retrofit-conventions` skill, development + security
phase-prompt injections, and R8/ProGuard keep rules. Ships no agents — it specializes the
existing development / security phase prompts. Reference implementation of the Framework
Provider Pattern.

## Key files
- `plugins/retrofit-plugin/manifest.yaml`
- `plugins/retrofit-plugin/.claude-plugin/plugin.json`

## Decisions
- [[decisions/ADR-0002-framework-provider-pattern]]

## Change history
_Backlinks from `changes/` accumulate here._
