# apply.md — Write rules (phase 4.4)

Loaded by `manage-vault` phase 4.4. Consumes the diff lists from [scan.md](scan.md). Sequential writes.
Reads templates from the **project** vault (`.obsidian-vault/_templates/`), which phases 1–3 guarantee
exist.

## Date

Use `$(date +%F)` (ISO `YYYY-MM-DD`).

## 1. Create stub notes (`to_create_*`)

For each entry in `to_create_modules`, `to_create_screens`, `to_create_flows`:

```
template = Read .obsidian-vault/_templates/<kind>.md
content  = template
         .replace("{{title}}", <slug-or-Name>)
         .replace("{{date}}",  <DATE>)
         .replace(
            "<!-- STUB: created by check-docs-sync.sh on <DATE>. ... -->",
            "<!-- STUB: created by manage-vault on <DATE>. document-writer must fill all sections before PR. -->"
         )
Write content → target path
```

Targets: `modules/<slug>.md` (`module`), `screens/<Name>.md` (`screen`),
`business-logic/<slug>.md` (`flow`).

**Pre-check before Write:** if the target already exists, do NOT create — fall through to the refresh
rule below. Never overwrite via the create path.

The stub inherits the template's typed-edge frontmatter (`depends_on`/`screens`/`flows`/`adrs`/`related`,
all empty). Leave them empty — `document-writer` owns edge values.

## 2. Refresh existing stubs (`to_refresh_stubs`) — STUB-aware

A note already exists AND still carries a `<!-- STUB -->` marker (never filled). It is safe to refresh
it to the current template shape (e.g. template gained a new section), preserving nothing the user wrote
because, by definition, a stub has no authored content.

```
if the note still contains "<!-- STUB:" :
    re-render from .obsidian-vault/_templates/<kind>.md (same substitution as step 1),
    preserving the note's existing frontmatter edge VALUES if any were added.
else:
    it is FILLED content → SKIP entirely (untouchable).
```

Double-check the marker immediately before writing. If the marker is gone, abort the refresh for that
note — it became content between scan and apply.

## 3. MOCs are Dataview — nothing to append

`_moc-modules.md` / `_moc-screens.md` / `_moc-flows.md` are Dataview query tables. A correctly stubbed
note (right `type`/`tags`/folder) appears automatically. Never edit a MOC's `## Index`.

## 4. `navigation/routes.md`

If the file does NOT exist, create it:

```markdown
---
type: general
slug: routes
tags: [meta/navigation, layer/ui]
updated: <DATE>
---

# Navigation Routes

Registry of every `@Serializable` route used by `NavHost` / `composable<…>`. Maintained jointly by
`manage-vault` (auto-discovery) and `document-writer` (PR-time updates).

## Index

| Route class | FQCN | Screen | Source |
|-------------|------|--------|--------|
```

For each entry in `to_append_routes`:

```
row = | <RouteClass> | <fqcn> | [[screens/<Name>]] | <file:line> |
```

`<Name>` = the correlated `@Composable` screen (same module + name root); blank if unknown
(`document-writer` fills it). Append rows; preserve existing; dedupe by the `RouteClass` cell. Update
`updated:` only when rows changed. A row with a filled (non-stub) screen note is never rewritten.

## 5. Migrate edges + regenerate graph (Node — phase 4.5)

Run from repo root after writes. Requires Node; if `node` is absent, skip and note it.

```bash
node .claude/scripts/migrate-edges.mjs --dry-run   # preview: legacy links: → depends_on backfill
node .claude/scripts/migrate-edges.mjs             # apply (idempotent; skips already-typed notes)
node .claude/scripts/gen-mermaid.mjs               # rebuild architecture/dependency-graph.md
```

`migrate-edges.mjs` backfills `depends_on` only from each note's `## Dependencies` prose wikilinks and
drops the stale `links:` field. Fresh/empty stubs are untouched. `gen-mermaid.mjs` rebuilds the generated
`architecture/dependency-graph.md` (plugin/tool-owned — safe to regenerate).

## What NOT to write

- Section bodies inside stubs (Purpose, State, Intents, Steps …) — template comment hints stay.
- Edge values on fresh stubs — leave empty; migration only backfills from existing prose.
- New ADRs; notes under `stack/`, `architecture/`, `general/`.
- The `_templates/` files themselves (immutable content per documentation rules).
- ANY note that does not carry a `<!-- STUB -->` marker.

## Atomicity & failure

Writes are not transactional. On a failed Write: STOP, report which writes succeeded and which were
pending, tell the user to inspect. A re-run is safe — every step is existence-/marker-checked.
