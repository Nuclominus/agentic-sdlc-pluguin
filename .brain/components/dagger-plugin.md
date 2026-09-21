---
plugin: retired
merged_into: android-foundation
stack: dagger
enriches_aspect: di
---

# dagger-plugin (merged)

## Responsibility

**Merged into [[components/android-foundation]] (ADR-0026, 2026-09-20).** This plugin no longer
exists as an installed plugin — its manifest, convention skill, and ProGuard snippet were folded
into a `frameworks:` row (`stack: dagger`) inside `android-foundation/manifest.yaml`. Conditional
activation is unchanged (`enriches_aspect: di`); the skill id moved from
`dagger-plugin:*-conventions` to `android-foundation:*-conventions`. This note is kept, not deleted, so
existing links and change-note backlinks stay resolvable.

## Decisions
- [[decisions/ADR-0002-framework-provider-pattern]] (superseded)
- [[decisions/ADR-0026-embed-framework-providers-in-the-foundation]]

## Change history
_Backlinks from `changes/` accumulate here._
