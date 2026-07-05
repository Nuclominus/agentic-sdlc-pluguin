# Second Brain — `.brain/`

The single source of truth for how the **SDLC Marketplace** works and how it evolves.
Open this folder as an Obsidian vault. Four pillars, one wiki-linked graph:

- **[[_moc-root]]** — start here (dashboard).
- **architecture/** — how the system works ([[architecture/_moc-architecture]]).
- **components/** — one note per plugin.
- **changes/** — one immutable note per merged PR ([[changes/_moc-changes]]).
- **decisions/** — ADRs, the "why" ([[decisions/_moc-decisions]]).
- **planning/** — roadmap + backlog ([[planning/_moc-planning]]).
- **releases/** — thin release list mirroring `../CHANGELOG.md`.

## Maintenance contract (the heartbeat)

A **merged PR is the trigger.** On merge to `develop`, the `brain-sync` GitHub Action runs
`tools/brain-sync` and opens a follow-up PR (`brain-sync/pr-<num>`) adding that PR's change note
and refreshing `changes/_moc-changes.md`. The auto note is deterministic; **enrich** its prose,
link the ADR it implements, and update the touched `components/` + `architecture/` notes by hand
or via the `android-docs` agent.

Run locally:
```bash
node tools/brain-sync/cli.mjs sync --pr <number>   # one PR
node tools/brain-sync/cli.mjs sync --backfill       # all merged PRs
node tools/brain-sync/cli.mjs check                 # validate structure + links
```

> This vault documents **this repository** (the plugin marketplace). It is unrelated to the
> `.obsidian-vault/` template that the `manage-vault` skill scaffolds for end-user Android apps.
