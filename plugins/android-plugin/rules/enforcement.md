---
loaded_by: [debugger, devops, main-thread-on-hook-failure]
load_when: "Only when a PostToolUse hook fails, misbehaves, or needs to be extended."
---

# Enforcement Layer

Automated guardrails that run outside the agents themselves.

## PostToolUse Hooks (configured in `.claude/settings.json`)

| Hook | Script | Purpose | Behaviour |
|------|--------|---------|-----------|
| validate-kotlin | `${CLAUDE_PLUGIN_ROOT}/hooks/validate-kotlin.sh` | Blocks `!!`, `runBlocking`, `println`, `android.util.Log.*`, `.printStackTrace()` in production Kotlin | **Blocking** — file write/edit fails on violation |
| check-docs-sync | `.claude/scripts/check-docs-sync.sh` | When production Kotlin is edited and matching `.obsidian-vault/` note is absent, **auto-creates a stub** from `.obsidian-vault/_templates/`. android-docs fills the stub before PR. | **Non-blocking** — emits `INFO` and creates the stub file |

Both fire on `Write|Edit`. Test sources (`src/test/**`, `src/androidTest/**`, `*Test.kt`, `*Spec.kt`) are exempt from validate-kotlin (see `snippets/non-negotiable.md`).

## Documentation tooling (Node, non-blocking — NOT hooks)

Unlike the blocking `validate-kotlin.sh` hook, the vault tooling runs **on demand** (android-docs
Definition-of-Done, `fill-vault`, optional CI) and never blocks a write:

| Script | Purpose | Behaviour |
|--------|---------|-----------|
| `gen-mermaid.mjs` | Regenerate `architecture/dependency-graph.md` from module `depends_on:` edges | Writes only between the `BEGIN/END GENERATED MERMAID` markers; idempotent |
| `validate-docs.mjs` | Lint typed edges (resolution, prose↔frontmatter drift, layer rules, cycles) | **Reports only — never edits a note.** Exit 1 on findings (CI gate) |
| `migrate-edges.mjs` | Backfill `depends_on:` from prose, drop legacy `links:` | `--dry-run` shows the diff; idempotent |

Requirements: **Node** on the machine; the **Dataview** Obsidian community plugin for the MOC
tables to render. Full rules in `documentation.md`.

**Fail faithfully:** `validate-docs.mjs` layer findings are real architectural signals —
escalate them, never rewrite an edge to pass. **Self-modification boundary:** changing the
validator's layer rules / escape hatches, the hooks, or `settings.json` needs explicit user
confirmation (global CLAUDE.md).

## Troubleshooting

- Hook silently does nothing → check `chmod +x .claude/scripts/*.sh`.
- Hook blocks legitimate code → verify file path matches the exemption rules in the script; do NOT relax the regex.
- New forbidden pattern needed → add a regex to `validate-kotlin.sh` AND a row to `snippets/non-negotiable.md`.

## Roadmap — Detekt Custom Rules

Hook regex covers production sources only. AST-level checks belong in a future `detekt-rules/` project:

- `NoNotNullAssertionRule`
- `NoRunBlockingRule`
- `NoPrintlnRule`
- `NoAndroidLogRule`
- `MutableStateInPublicApiRule`

Not implemented in the skeleton — tracked separately. Until then, the hook + reviewer agent are the enforcement layer.
