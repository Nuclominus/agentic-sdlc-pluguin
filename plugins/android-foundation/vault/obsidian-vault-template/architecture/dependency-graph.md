---
type: architecture
slug: dependency-graph
tags: [meta/generated, layer/architecture]
updated: 2026-01-01
---

# Module Dependency Graph

This diagram is **generated** from the `depends_on:` frontmatter of every
`modules/*.md` note by `.claude/scripts/gen-mermaid.mjs`. Do NOT edit the block
between the markers by hand — it will be overwritten. To change an edge, edit the
`depends_on:` field on the relevant module note and re-run:

```bash
node .claude/scripts/gen-mermaid.mjs
```

Node color = the module's `#layer/<ui|data|domain>` tag. An arrow pointing the
wrong way (e.g. into a `data` node from a `ui` node, skipping `domain`) is a layer
violation — `validate-docs.mjs` reports it; do not rewrite the edge to hide it.

<!-- BEGIN GENERATED MERMAID -->
```mermaid
graph LR
  empty["no modules yet"]
```
<!-- END GENERATED MERMAID -->
