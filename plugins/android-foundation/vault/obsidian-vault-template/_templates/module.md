---
type: module
slug: feature-{{title}}
tags: [feature/{{title}}, layer/data, status/active]
depends_on: []
screens: []
flows: []
adrs: []
related: []
exclude_from_validation: false
updated: {{date}}
---

<!-- STUB: created by check-docs-sync.sh on {{date}}. DocsWriter must fill all sections before PR. -->

# {{title}}

<!--
Typed edges live in the frontmatter above. Use PATH-QUALIFIED wikilink strings only:
  depends_on: ["[[modules/auth]]"]   ✅      depends_on: ["auth"]   ❌
  screens:    ["[[screens/LoginScreen]]"]
  flows:      ["[[business-logic/sign-in]]"]
  adrs:       ["[[architecture/adr-0001-typed-edges]]"]
Set `layer/<ui|data|domain>` in `tags` — the graph + validator key off it.
`depends_on:` is the SOURCE OF TRUTH for edges; the ## Dependencies prose below is the
human-readable MIRROR. Keep them in sync — `validate-docs.mjs` flags drift, it does NOT
auto-generate prose. Set `exclude_from_validation: true` only for dev-only overlay modules.
-->

## Purpose

<!-- One sentence: what this module does. -->

## Public API

<!-- Repository interfaces, exported types, navigation entry points. -->

## Dependencies

<!-- Mirror of `depends_on:` frontmatter, with the WHY for each edge.
     One [[modules/<name>]] wikilink per dependency — keep the set identical to frontmatter. -->

## Screens

<!-- Mirror of `screens:` frontmatter. [[screens/<Name>]] notes that live in this module. -->

## Flows

<!-- Mirror of `flows:` frontmatter. [[business-logic/<flow>]] notes implemented here. -->

## Notes

<!-- Invariants, gotchas, ADR references via [[architecture/adr-NNNN-...]] (mirror of `adrs:`). -->
