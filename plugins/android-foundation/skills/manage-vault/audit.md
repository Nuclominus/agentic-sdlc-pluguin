# audit.md — Drift detection (phase 4.6)

Loaded by `manage-vault` phase 4.6. Consumes the `to_flag_drift` lists from [scan.md](scan.md).

## Principle

A vault note exists for an artifact that no longer exists in the codebase. The skill does **not**
delete — deletion is an `document-writer`/human decision that may require an ADR (deprecation,
supersession). `manage-vault` only annotates.

## Drift marker

Append a single HTML comment after the frontmatter (just below the closing `---`):

```
<!-- DRIFT: source artifact not found on <DATE> by manage-vault. document-writer must verify and either rewire, mark `#status/deprecated`, or delete. -->
```

Idempotency: if a `<!-- DRIFT:` marker is already present, replace its date in place — do not append a
duplicate.

Do NOT touch the `updated:` field (would imply a meaningful edit) or any tag (a content decision).

## Coverage

| Note location | Drift condition |
|---|---|
| `modules/<slug>.md` | `<slug>` not in scanned Gradle modules |
| `screens/<Name>.md` | `<Name>` not matched by any `@Composable fun <Name>(…)` in production sources |
| `business-logic/<slug>.md` | `<slug>` not matched by any ViewModel/store prefix |
| `navigation/routes.md` rows | row's `RouteClass` cell not in scanned `@Serializable` route classes |

For `navigation/routes.md`, drift-flag at row granularity: append `<!-- DRIFT -->` at the end of the
offending row's source cell rather than touching the file header.

## Edge & schema validation (delegated to `validate-docs.mjs`)

A second class of drift lives inside the frontmatter: unresolved / bare-slug typed edges, and
`depends_on:` that disagrees with its prose mirror. Do NOT re-implement — run the validator and fold its
findings into the report (Node; skip with a note if absent):

```bash
node .claude/scripts/validate-docs.mjs
```

It reports path-qualification, unresolved edges, prose↔frontmatter drift, layer violations, and cycles.
`manage-vault` only **reports** — it never rewrites edges to make the validator pass. Layer violations
are real architectural findings: surface them and recommend an `document-writer`/human decision.

## What is NOT drift

- ADRs (`architecture/adr-*.md`) — manually authored, never auto-flagged.
- Notes in `stack/`, `architecture/`, `general/` — no auto-detection.
- A stub that hasn't been filled — that's the normal backlog, not drift.

## Report

```
drift detected (N):
  modules/feature-foo.md
  screens/LegacyScreen.md
  business-logic/old-checkout.md
```

Include paths so the user can open them in Obsidian. Recommend running `document-writer` (or a manual
cleanup PR) next.
