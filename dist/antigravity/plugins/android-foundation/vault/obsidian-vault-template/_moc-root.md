---
type: general
slug: moc-root
tags: [meta/moc]
updated: 2026-01-01
---

# the project — Root MOC

Top-level Map of Content. Start here, drill into the relevant area.

## Project

- [[general/overview]]
- [[general/prerequisites]]
- [[general/onboarding]]

## Architecture

- [[architecture/layering]]
- [[architecture/ui-patterns]]
- [[architecture/ddd-boundaries]]
- ADRs: see `architecture/adr-*` notes

## Code map

- [[_moc-modules]] — every `:feature:<name>` module
- [[_moc-screens]] — every `@Composable` screen
- [[_moc-flows]] — every business flow
- [[navigation/routes]] — route registry
- [[architecture/dependency-graph]] — generated module dependency diagram

## Stack

- [[stack/build-system]]
- [[stack/ui]]
- [[stack/networking]]
- [[stack/storage]]
- [[stack/observability]]

## Tags

Use `#feature/<name>`, `#layer/<ui|data|domain>`, `#status/active`, `#status/deprecated`.
