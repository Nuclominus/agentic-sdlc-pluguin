---
type: architecture
slug: ui-patterns
tags: [layer/architecture, meta/index, status/active]
updated: 2026-01-01
---

# UI Patterns — testTag Index

The per-screen index of every `testTag` in the app. `android-qa` searches this note to pick
selectors for Compose UI Tests and Maestro flows; `android-developer` adds a row whenever it adds or
renames a tag; `android-docs` verifies and completes the index during the docs phase.

**The convention (grammar, the centralized `TestTag` object, required-vs-exempt rules) lives in the
`android-compose-ui` skill § Test tags — this note is the project's concrete index, not the rules.**

Quick recap of the contract:
- Grammar: `<screen>.<element>[.<variant>][.<index>]` — lowercase, dot-separated, stable, never
  localized text. Every screen has a `<screen>.root`; list items use `<screen>.item.{index}`.
- Tags live in one `TestTag` object (`TestTag.<Screen>Tags.<ELEMENT>`); production and tests reference
  the constant, never a string literal.
- `Constant` = copy-paste into a Compose test; `testTag` = the searchable value and the Maestro `id:`.

## Index

| Screen | Element | Constant | testTag | Component | Interactions | State / Notes |
|--------|---------|----------|---------|-----------|--------------|---------------|
<!-- One row per non-decorative component. Dynamic list items use a single `{index}` row. Example: -->
<!-- | Login | Email field | `TestTag.LoginTags.EMAIL` | `login.email` | TextField | input | required | -->
<!-- | Login | Submit | `TestTag.LoginTags.SUBMIT` | `login.submit` | Button | click | disabled until valid | -->
<!-- | Effects | List | `TestTag.EffectsTags.LIST` | `effects.list` | LazyColumn | scroll | — | -->
<!-- | Effects | List item | `TestTag.EffectsTags.item(i)` | `effects.item.{index}` | Card | click | dynamic, by index | -->

## Notes

<!-- Cross-screen tag conventions, shared component tags, deprecations. -->
