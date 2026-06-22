---
type: general
slug: vault-readme
tags: [meta/index]
updated: 2026-01-01
---

# the project Knowledge Vault

This Obsidian vault is the **single source of project knowledge** for the project.
Every agent in the android-workflow pipeline reads from here before answering questions
about architecture, modules, screens, navigation, or business flows.

## Required plugin

Install the **Dataview** community plugin (Settings → Community plugins → Browse →
"Dataview" → Install → Enable). The MOC index notes are live Dataview tables; without
it they render as empty code blocks. It is pre-listed in `.obsidian/community-plugins.json`,
but Obsidian cannot install the binary for you.

## Entry points

- [[_moc-root]] — top-level Map of Content
- [[_moc-modules]] — feature modules
- [[_moc-screens]] — Compose screens
- [[_moc-flows]] — business-logic flows
- [[architecture/dependency-graph]] — generated module dependency diagram

## Conventions

- Every note has YAML frontmatter (`type`, `slug`, `tags`, typed edges, `updated`).
- **Edges are typed**: `depends_on` / `screens` / `flows` / `adrs` / `related` — not a
  flat `links` array. Each value is a **path-qualified** wikilink string
  (`"[[modules/auth]]"`), never a bare slug.
- `depends_on:` frontmatter is the source of truth for dependency edges; the matching
  prose section is its linted mirror. `validate-docs.mjs` flags drift.
- Tags follow `feature/<name>`, `layer/<ui|data|domain>`, `status/<active|deprecated>`.
- Templates live in `_templates/` — never edit them, copy them.
- The Mermaid graph in [[architecture/dependency-graph]] is generated — never hand-edit it.

## How agents use this vault

See `.claude/rules/documentation.md` (the "Single source of knowledge" rule).
