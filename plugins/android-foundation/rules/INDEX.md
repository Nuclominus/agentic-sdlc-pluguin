# Rules Index — Loaded-By Map

Each rules file is **lazy**: a role reads it only when its own name appears in the `Loaded by`
column. Do NOT preload everything.

Roles here are the CORE roster (`plugins/sdlc/agents/`), because ADR-0021 moved every agent to the
core — this foundation contributes expertise, not agents. A role does not have to find these files:
`manifest.yaml` `role_expertise.<role>.rules` names the ones that role may need, and the orchestrator
pastes their **absolute** paths into the phase prompt (an on-demand agent gets the same list from
`resolve/cli.mjs expertise --role <name>`). This table is the human-readable mirror of that
declaration — keep the two in sync.

| File | Loaded by | When |
|------|-----------|------|
| `workflow.md` | aar-analyst; a human or orchestrator reading the Android DAG | When auditing a run against the Android specifics of each step |
| `skills.md` | developer, qa-engineer, business-analyst, reviewer, devops | Only when the optional `android` CLI is on PATH and a task calls for native tooling |
| `logging.md` | developer, reviewer, debugger, tester, security-analyst | Before writing a log line, when adding tracing, during review, and for the test-source exemption |
| `documentation.md` | business-analyst, developer, reviewer, tester, qa-engineer, security-analyst, document-writer, debugger | Before answering project-specific questions (vault lookup); document-writer before the PR; reviewer during review |
| `git-operations.md` | document-writer (PR step), any role on a commit request | Only when about to commit or open a PR |
| `enforcement.md` | debugger (hook troubleshooting), devops (hook scripts) | Only when a foundation hook misbehaves |
| `snippets/non-negotiable.md` | developer (pre-implementation), reviewer (review), debugger (fix verification) | Forbidden-patterns reference |
| `snippets/proguard-keep.md` | security-analyst, devops | ProGuard/R8 review or rules edit |
| `snippets/gradle-commands.md` | developer, qa-engineer, tester, devops, cicd | When running Gradle |

Unit-test patterns are no longer a rules file: `rules/testing.md` was folded into the
`android-foundation:android-testing` skill, which the `tester` role invokes (ADR-0021).

## Documentation tooling (Node scripts, non-blocking)

| Script | Purpose | Invoked by |
|--------|---------|-----------|
| `.claude/scripts/gen-mermaid.mjs` | Regenerate the module dependency Mermaid from `depends_on:` edges | document-writer (DoD), fill-vault, CI |
| `.claude/scripts/validate-docs.mjs` | Lint typed edges: resolution, prose↔frontmatter drift, layer rules, cycles. Reports only | document-writer (DoD), reviewer, fill-vault, CI |
| `.claude/scripts/migrate-edges.mjs` | Backfill `depends_on:` from prose; drop legacy `links:` (`--dry-run`) | fill-vault, one-off migrations |

These need **Node** on the machine and (for the Dataview MOCs to render) the **Dataview** Obsidian
community plugin. They are non-blocking — unlike the `validate-kotlin.sh` PostToolUse hook. Full
rules: `documentation.md`.

## Conventions

- Each `.md` rules file carries a YAML header `loaded_by: [...]` repeating the row above, in core
  role names. A role may use it as a hint to skip-load.
- A role that needs a rule MUST `Read` the file at use-time — do not paraphrase from memory; rules
  evolve.
- These files are read by agents that live in **another plugin**, so they never name the plugin-root
  variable: it resolves to the plugin owning the *agent*, which is `sdlc`, and every such path would
  miss. Refer to a sibling file by name ("the foundation's `hooks/validate-kotlin.sh`"); the
  resolver supplies absolute paths where an agent actually needs one.
- **Vault lookup is implicit** — every role reads `.obsidian-vault/` notes when answering
  project-specific questions. See `documentation.md` "Single source of knowledge".
- **Navigate typed edges** — follow a note's `depends_on` / `screens` / `flows` wikilinks and the
  generated `architecture/dependency-graph.md`, not a flat link list.
