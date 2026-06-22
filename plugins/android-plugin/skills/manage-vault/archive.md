# archive.md — Archive before regenerate (phase 5)

Loaded by `manage-vault` phase 5. Runs **automatically before** phase 4 rewrites any existing stub,
and **only** when the vault already holds content worth preserving. A first populate of an empty vault
skips this entirely (nothing to lose).

## When it runs

- Phase 4 determined the run will refresh existing `<!-- STUB -->` notes or regenerate the graph, **and**
- `.obsidian-vault/` contains at least one note (stubbed or filled).

If both hold, archive first, then proceed. If the user declines the regenerate at phase 4.3, no archive
is made.

## What is archived

The vault's **content and plugin-owned notes** — everything under `.obsidian-vault/` EXCEPT transient
Obsidian workspace state, which is machine-local churn:

- Include: all `*.md`, `_templates/`, `_moc-*`, folder notes, `.gitkeep`, `.vault-manifest.json`.
- Exclude: `.obsidian/workspace*`, `.obsidian/cache`, and other per-machine runtime files under
  `.obsidian/` (keep `.obsidian/{app,core-plugins,community-plugins,graph}.json` — they are config).

## Location & naming

```
.obsidian-vault-archives/obsidian-vault-<ISO-timestamp>.zip
```

`<ISO-timestamp>` = `$(date +%Y%m%dT%H%M%S)` (e.g. `obsidian-vault-20260622T143012.zip`). The archive
directory is a sibling of the vault at the project root.

```bash
mkdir -p .obsidian-vault-archives
TS=$(date +%Y%m%dT%H%M%S)
( cd . && zip -rq ".obsidian-vault-archives/obsidian-vault-${TS}.zip" .obsidian-vault \
    -x ".obsidian-vault/.obsidian/workspace*" \
    -x ".obsidian-vault/.obsidian/cache" )
```

If `zip` is unavailable, fall back to `tar`:

```bash
tar --exclude=".obsidian-vault/.obsidian/workspace*" --exclude=".obsidian-vault/.obsidian/cache" \
    -czf ".obsidian-vault-archives/obsidian-vault-${TS}.tar.gz" .obsidian-vault
```

## Retention

Keep the **last 5** archives; prune older ones so the directory does not grow unbounded:

```bash
ls -1t .obsidian-vault-archives/obsidian-vault-* 2>/dev/null | tail -n +6 | xargs -r rm -f
```

## Gitignore

On first archive creation, if `.obsidian-vault-archives/` is not already ignored, suggest adding it to
`.gitignore` (do not edit `.gitignore` silently — recommend it in the report):

```
.obsidian-vault-archives/
```

## Report line

Always surface the archive path before regenerating, so the user can recover if needed:

```
archive: .obsidian-vault-archives/obsidian-vault-20260622T143012.zip  (pre-regenerate snapshot)
```

## Failure mode

If the archive step fails (no `zip`/`tar`, no disk, permission), **do not proceed** to regenerate —
abort phase 4 and report. The archive is the safety net; without it, no destructive-capable step runs.
