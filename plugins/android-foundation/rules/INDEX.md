# Rules Index — Loaded-By Map

Each rules file is **lazy**: agents read it only when their role appears in the `Loaded by` column. Do NOT preload everything.

| File | Loaded by | When |
|------|-----------|------|
| `workflow.md` | orchestrator / main thread | Once at session start, then on phase transitions |
| `skills.md` | android-ba, android-developer, android-reviewer, android-debugger (mandatory); android-tester, android-qa, android-docs, android-devops, android-cicd, android-aar (recommended) | BEFORE phase work — single source of truth for Skill invocations, project-extension self-read rules + Android CLI capability bindings |
| `testing.md` | android-tester | Before writing tests |
| `logging.md` | android-developer (pre-Done cleanup), android-debugger (pre-Done cleanup — adds debug logs while investigating), android-reviewer (enforcement check) | Before claiming Done / during review — covers BOTH log statements and comment hygiene (no commented-out code, no narration, no `// AI`/`// per plan` provenance chatter) |
| `documentation.md` | **every agent** | Before answering project-specific questions (vault lookup); android-docs before PR; android-reviewer during review |
| `git-operations.md` | android-docs (PR step — self-read before `gh pr create`), any agent on commit request | Only when about to commit / open PR. Also injected into the `/sdlc` pipeline's `documentation` phase via `manifest.yaml` `phase_injections.documentation`, so the PR-hygiene rules (no AI mentions, empty PR, no stats/checklists) reach the pipeline even when the doc agent is dispatched programmatically. |
| `enforcement.md` | android-debugger (hook troubleshooting), android-devops (hook scripts), main thread on hook failure | Only when hooks misbehave |
| `snippets/non-negotiable.md` | android-developer (pre-implementation), android-reviewer (review), android-debugger (verification) | Forbidden-patterns reference |
| `snippets/proguard-keep.md` | android-security, android-devops | ProGuard/R8 review or rules edit |
| `snippets/gradle-commands.md` | android-developer, android-qa, android-tester, android-devops, android-cicd | When running Gradle |

## Documentation tooling (Node scripts, non-blocking)

| Script | Purpose | Invoked by |
|--------|---------|-----------|
| `.claude/scripts/gen-mermaid.mjs` | Regenerate the module dependency Mermaid from `depends_on:` edges | android-docs (DoD), fill-vault, CI |
| `.claude/scripts/validate-docs.mjs` | Lint typed edges: resolution, prose↔frontmatter drift, layer rules, cycles. Reports only | android-docs (DoD), android-reviewer, fill-vault, CI |
| `.claude/scripts/migrate-edges.mjs` | Backfill `depends_on:` from prose; drop legacy `links:` (`--dry-run`) | fill-vault, one-off migrations |

These need **Node** on the machine and (for the Dataview MOCs to render) the **Dataview**
Obsidian community plugin. They are non-blocking — unlike the `validate-kotlin.sh` PostToolUse
hook. Full rules: `documentation.md`.

## Conventions

- Each `.md` rules file carries a YAML header `loaded_by: [...]` repeating the row above. Agents may use it as a hint to skip-load.
- Agents that need a rule MUST `Read` the file at use-time — do not paraphrase from memory; rules evolve.
- **Vault lookup is implicit** — every agent reads `.obsidian-vault/` notes when answering project-specific questions. See `documentation.md` "Single source of knowledge".
- **Navigate typed edges** — follow a note's `depends_on`/`screens`/`flows` wikilinks and the generated `architecture/dependency-graph.md`, not a flat link list.
