---
type: screen
slug: {{title}}
tags: [layer/ui, status/active]
route: ""
depends_on: []
flows: []
adrs: []
related: []
updated: {{date}}
---

<!-- STUB: created by check-docs-sync.sh on {{date}}. DocsWriter must fill all sections before PR. -->

# {{title}}

<!--
Typed edges live in the frontmatter above. Use PATH-QUALIFIED wikilink strings only:
  depends_on: ["[[modules/auth]]"]   (modules / ViewModels this screen consumes)
  flows:      ["[[business-logic/sign-in]]"]
  adrs:       ["[[architecture/adr-0001-...]]"]
`route:` holds the @Serializable route class name (e.g. "LoginRoute"); the row in
[[navigation/routes]] is the registry. `depends_on:` is the source of truth; the
## Dependencies prose is its linted mirror.
-->

## Route

<!-- @Serializable data class / data object signature. Set `route:` in frontmatter and add a row to [[navigation/routes]]. -->

## State

<!-- State shape (e.g. MVVM / MVI). -->

## Intents

<!-- User-driven inputs. -->

## Actions

<!-- One-shot effects (navigation, snackbars). -->

## Dependencies

<!-- Mirror of `depends_on:` frontmatter. ViewModels, Repositories — [[modules/<name>]] wikilinks, with the WHY. -->

## Notes
