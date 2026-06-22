---
type: general
slug: moc-modules
tags: [meta/moc, layer/modules]
updated: 2026-01-01
---

# Modules MOC

One note per `:feature:<name>` module. Notes are auto-stubbed by the
`check-docs-sync.sh` hook when production code is touched without a matching note;
DocsWriter fills the stub before PR.

## Index

> Requires the **Dataview** community plugin (see [[README]]). The table is generated
> live from each note's typed frontmatter — there is no hand-maintained bullet list.

```dataview
TABLE WITHOUT ID
  file.link AS "Module",
  depends_on AS "Depends on",
  join(filter(file.etags, (t) => startswith(t, "#layer")), ", ") AS "Layer",
  updated AS "Updated"
FROM "modules"
WHERE type = "module"
SORT file.name ASC
```

## Dependency graph

See [[architecture/dependency-graph]] — a Mermaid diagram generated from every module's
`depends_on:` edges by `.claude/scripts/gen-mermaid.mjs`.

## Conventions

- File name = bare module slug (e.g. `auth.md`, not `feature-auth.md`).
- Frontmatter `slug: feature-<name>` keeps the canonical id.
- Tag every module note with `#feature/<name>` and `#layer/<ui|data|domain>`.
- `depends_on:` is the source of truth for edges; keep the `## Dependencies` prose in sync.
