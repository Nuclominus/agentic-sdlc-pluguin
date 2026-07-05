---
plugin: android-foundation
kind: foundation
enriches_aspect: null
dependency: null
---

# android-foundation

## Responsibility

The centerpiece Android (Kotlin + Gradle) stack provider for the Agentic SDLC marketplace.
Registers the `android` profile via `manifest.yaml` (`kind: foundation`, `aspect: android`,
`priority: 300`); ships the full specialized agent roster plus convention skills for Compose UI,
architecture, data and Navigation. Carries pinned house rules (Coil3, Kermit, KSP,
`@Serializable` routes, DataStore, Play Billing); detect-don't-impose libraries (Retrofit, Room,
Dagger/Hilt) attach as additive framework plugins. In-pipeline checks: detekt + unit tests +
compile-check (builds CI-deferred).

## Key files
- `plugins/android-foundation/manifest.yaml`
- `plugins/android-foundation/.claude-plugin/plugin.json`

## Decisions
- [[decisions/ADR-0001-stack-provider-pattern]]

## Change history
_Backlinks from `changes/` accumulate here._
