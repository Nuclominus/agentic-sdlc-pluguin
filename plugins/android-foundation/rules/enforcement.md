---
loaded_by: [debugger, devops]
load_when: "Only when a PostToolUse hook fails, misbehaves, or needs to be extended."
---

# Enforcement Layer

Automated guardrails that run outside the agents themselves.

## PostToolUse Hooks (configured in `.claude/settings.json`)

| Hook | Script | Purpose | Behaviour |
|------|--------|---------|-----------|
| validate-kotlin | the foundation's `hooks/validate-kotlin.sh` (via `kotlin-guard.sh`) | Blocks `!!`, `runBlocking`, `println`, `android.util.Log.*`, `.printStackTrace()`, and inline `testTag("…")` literals in production Kotlin | **Blocking** — `kotlin-guard.sh` propagates exit 2, surfacing the violation to the agent |
| check-docs-sync | `.claude/scripts/check-docs-sync.sh` | When production Kotlin is edited and matching `.obsidian-vault/` note is absent, **auto-creates a stub** from `.obsidian-vault/_templates/`. android-docs fills the stub before PR. | **Non-blocking** — emits `INFO` and creates the stub file |

Both fire on `Write|Edit`. Test sources (`src/test/**`, `src/androidTest/**`, `*Test.kt`, `*Spec.kt`) are exempt from validate-kotlin (see `snippets/non-negotiable.md`).

## PreToolUse Gate — publishing commands

| Hook | Script | Purpose | Behaviour |
|------|--------|---------|-----------|
| git-guard | the foundation's `hooks/git-guard.sh` (via `validate-logging.sh`) | Gates `git commit`, `git push` and `gh pr create` on `logging.md` (ADR-0020) | **Blocking** — exit 2 with a `file:line` report; **never edits code** |

`kotlin-guard.sh` is `PostToolUse(Edit|Write)`, so it only ever sees files edited **through those
tools**. A hand edit, a `sed` in a Bash call, a merge, a rebase or a cherry-pick reaches the commit
unchecked. `git-guard` is that net: on a publishing command it re-scans the staged diff (for
`commit`) or the branch's commits over its base (for `push` / `pr create`).

What it checks, over production Kotlin only (test sources exempt throughout):

- **Tier 1** — `println(`, `android.util.Log.*`, `.printStackTrace()`. Same constructs as
  `validate-kotlin`, re-checked because the file may never have passed through `Edit|Write`.
- **Tier 2 (ADR-0020)** — eager message construction (`logger.d("…")` instead of `logger.d { "…" }`),
  hand-rolled `if (BuildConfig.DEBUG)` / `if (isDebugBuild)` guards around a log call, a
  `Development*` decorator declared outside a development source set, and a `src/debug/**` DI
  provider with no `src/release/**` counterpart.

**It reports; it does not clean.** Under ADR-0020 a log line is not something to delete — the fix
for a misplaced trace is to move it into a `Development*` decorator, which is a refactor no script
can apply safely, and deleting a legitimately-placed log is itself a violation. Silently rewriting
a staged diff would also mean committing code that was never reviewed.

**Fails open.** No `jq`, not a git repo, an undeterminable base, an unreadable file — none of these
are a violation, and none block the command.

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
- New **logging** rule needed → add it to `validate-logging.sh` AND to `logging.md`; `git-guard.sh` picks it up.
- `git commit` blocked unexpectedly → the report names `file:line` and the fix. It is never a formatting
  complaint; re-run after fixing and re-staging. It cannot be silenced per-file by design.

## Roadmap — Detekt Custom Rules

Hook regex covers production sources only. AST-level checks belong in a future `detekt-rules/` project:

- `NoNotNullAssertionRule`
- `NoRunBlockingRule`
- `NoPrintlnRule`
- `NoAndroidLogRule`
- `MutableStateInPublicApiRule`

Not implemented in the skeleton — tracked separately. Until then, the hook + reviewer agent are the enforcement layer.
