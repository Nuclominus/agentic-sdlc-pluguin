---
name: android-docs-vault
description: Android documentation duties — the Obsidian vault canon (structure, typed edges, generated artifacts), hook-created stubs, the testTag index, the stack table, KDoc standards, and the Definition of Done that gates the PR. Invoke before writing docs, filling vault stubs, or opening a PR on an Android project.
---

# android-docs-vault

Everything the documentation phase owes an Android project whose knowledge base is the Obsidian
vault at `.obsidian-vault/`. The PR-creation process itself belongs to the core `document-writer`
agent; this skill supplies the vault canon and the gate that must pass before `gh pr create`.

The vault lifecycle (scaffolding, auditing, archiving a vault) is the separate `manage-vault` skill.

## Knowledge sourcing

Before answering anything, `Read` from the vault:

- `.obsidian-vault/_moc-root.md` (always)
- `.obsidian-vault/modules/<module>.md` for the modules in scope, then follow its typed edges
  (`depends_on` / `screens` / `flows` / `adrs`) to neighbouring notes
- `.obsidian-vault/architecture/dependency-graph.md` (the generated module graph) and
  `.obsidian-vault/architecture/` for invariants and ADRs
- `.obsidian-vault/screens/<Name>.md` and `.obsidian-vault/navigation/routes.md` when UI is in scope
- `.obsidian-vault/architecture/ui-patterns.md` — the testTag index, when UI is in scope

## Vault structure (canon)

| Folder | Contents | Update trigger |
|--------|----------|----------------|
| `general/` | overview, prerequisites, onboarding | Project setup changes |
| `stack/` | tech stack notes (no hardcoded versions) | New library / dependency |
| `architecture/` | layering, UI patterns, ADRs | Architectural decisions |
| `architecture/ui-patterns.md` | testTag index (Screen → Element → Constant → testTag) | UI component added / changed / removed |
| `modules/` | one note per `:feature:<name>` module | New module → new note from `_templates/module.md` |
| `navigation/` | `routes.md` registry | New `@Serializable` route → add a row |
| `screens/` | one note per `@Composable` screen | New screen → new note from `_templates/screen.md` |
| `business-logic/` | one note per business flow | New flow → new note from `_templates/flow.md` |

Templates live in `.obsidian-vault/_templates/` — copy them, never edit them.

Every note carries YAML frontmatter with **typed edges**, not a flat `links:` array:
`depends_on` (modules), `screens`, `flows`, `adrs`, `related`. Every edge value is a
**path-qualified** wikilink string (`"[[modules/auth]]"`), never a bare slug — that is the only form
Obsidian, Dataview, and `validate-docs.mjs` all consume. `depends_on:` is authoritative; the
`## Dependencies` (or `## Modules involved`) prose is its human-readable mirror and holds the *why*
— keep the two in sync by hand and let the validator flag drift. Never auto-rewrite the prose.

Generated artifacts are never hand-edited: `architecture/dependency-graph.md` holds a Mermaid block
between `<!-- BEGIN GENERATED MERMAID -->` / `<!-- END GENERATED MERMAID -->`, rebuilt by
`gen-mermaid.mjs` from module `depends_on:` edges; the `_moc-*.md` index tables are Dataview
queries over typed frontmatter and need no hand-maintained bullet lists.

## Hook-created stubs

The foundation's `check-docs-sync.sh` PostToolUse hook auto-creates stub notes in
`.obsidian-vault/modules/` and `.obsidian-vault/screens/` whenever production Kotlin under
`feature/*/src/main/**` or `app/src/main/**` is touched and a matching note is absent. Stubs carry a
`<!-- STUB: ... must fill ... -->` marker.

Your responsibility: find every stub introduced this cycle, fill all sections, remove the STUB
marker, refresh the `updated:` frontmatter, and populate the typed edges with path-qualified
wikilinks. You do NOT hand-edit the MOCs — correct frontmatter is what makes a note appear.

```bash
grep -rl "<!-- STUB" .obsidian-vault/
```

## testTag index — when UI changes

Whenever the cycle adds, renames, or removes a Compose UI component,
`.obsidian-vault/architecture/ui-patterns.md` must stay complete and accurate — it is the table the
QA phase searches to pick selectors. The development phase adds a row as it applies each tag; **you
are the backstop**: reconcile the index against the changed UI so nothing is missing or stale.

For every non-decorative component touched this cycle, ensure a row exists with all columns:

| Column | Source |
|--------|--------|
| Screen | the screen/route name (the `<screen>` segment of the tag) |
| Element | human-readable name of the component |
| Constant | `TestTag.<Screen>Tags.<ELEMENT>` — the Kotlin accessor |
| testTag | the dot-separated value (e.g. `login.email`) — also the Maestro `id:` |
| Component | `Button`, `TextField`, `LazyColumn`, … |
| Interactions | what QA can do: `click`, `input`, `scroll`, `assertVisible` |
| State / Notes | conditional visibility, enabled/disabled, dynamic `{index}` items |

Rules: dynamic list items get **one** row with the `{index}` pattern plus the `item(i)` accessor;
decorative/layout components (Divider, Spacer, guidelines, decorative Icon/Image) are exempt; a
removed component loses its row (or is marked in **Notes** if the screen is `#status/deprecated`).
Do not restate the convention here — the grammar and `TestTag` rules are the `android-compose-ui`
skill § Test tags. This note is the concrete index only.

## Definition of Done (before the PR)

- [ ] No `_vault-pending.md` at the repo root — its presence means the docs gate ran with **no
      vault** (often an untracked vault a git worktree never inherited). Restore/track it and
      re-validate, or record why docs are deferred. An absent vault is not a silent pass.
- [ ] Every hook-created stub is filled; no `<!-- STUB -->` marker remains in any changed note.
- [ ] Every changed note has fresh `updated:` frontmatter.
- [ ] New modules have `.obsidian-vault/modules/<name>.md`; new screens have
      `.obsidian-vault/screens/<Name>.md` plus a `navigation/routes.md` row; new flows have
      `.obsidian-vault/business-logic/<flow>.md`.
- [ ] Typed edges are path-qualified wikilinks that resolve; `depends_on:` matches its prose mirror.
- [ ] Any note still on the legacy `links:` field migrated via `node .claude/scripts/migrate-edges.mjs`.
- [ ] `node .claude/scripts/gen-mermaid.mjs` re-run — `architecture/dependency-graph.md` is current.
- [ ] `node .claude/scripts/validate-docs.mjs` clean, OR every finding escalated. **A layer
      violation rewritten to a false edge to make it pass is a hard reject** — raise an ADR or fix
      the code instead.
- [ ] `architecture/ui-patterns.md` testTag index has a row for every non-decorative UI component
      added or changed this cycle; removed components pruned.
- [ ] `stack/<area>.md` updated if a dependency was added.
- [ ] Public API changes reflected in the `modules/<module>.md` Public API section.
- [ ] No note references a class / function / screen / route that no longer exists.
- [ ] Templates in `_templates/` are unchanged.

STOP and fix the vault if any item fails. Then `gh pr create`.

**Model note.** The documentation role defaults to a low tier, which is fine for vault edits but
unreliable for an outward-facing `gh pr create` combined with a cross-repo / submodule commit. When
the docs phase does both, escalate that run's model tier deliberately and record why.

## Closing nudge (after the PR)

Once the PR is opened, print this one line and stop — do NOT auto-invoke anything:

> Workflow complete. Run `/sdlc:aar` to review this cycle for token / cooperation improvements.

AAR is opt-in and retrospective; the user decides whether to run it.

## Authoritative references — always link, never duplicate

The vault is the authority for project knowledge. Code-level references:

- `CLAUDE.md` (repo root) — canonical Gradle commands, flavors, `config/*.properties`, and the
  single-test invocation format
- `build-logic/README.md` — convention plugins + `conf/AppConfig.kt` (SDK / JVM target source of truth)
- `gradle/libs.versions.toml` — the version catalog

Never pin Kotlin / Gradle / AGP / DI / Compose versions inside vault notes — link to the files above
with plain markdown links. Wikilinks are for vault-internal references only. Do not hardcode
flavor-specific task names in notes.

## Project stack table

This table is a **template**, not a fixed stack. Detect the project's actual stack from
`gradle/libs.versions.toml`, `*.gradle.kts`, and `build-logic/`, then mirror each area into
`.obsidian-vault/stack/<area>.md`.

| Component | What to capture (detect from the project) |
|-----------|--------------------------------------------|
| Language | Primary language + where its version lives (`libs.versions.toml`) |
| UI | UI toolkit + theme entrypoint (e.g. Compose + Material 3, or Views/XML) |
| Architecture | State-management pattern in use (run the Architecture Detection grep in `android-architecture`) |
| State | State/event primitives the pattern relies on |
| DI | DI framework (e.g. Hilt, Koin, manual) + any dispatcher qualifiers |
| Navigation | Navigation approach + route style (e.g. type-safe routes) |
| Network | HTTP client + serialization library |
| Realtime | Realtime / backend services, if any |
| Local DB | Persistence / database library |
| Persistence | Key-value / secure storage approach |
| Images | Image-loading library |
| Logging | Logging library + tagging convention |
| Subscriptions | Billing / subscriptions SDK, if any |
| Analytics / Crash | Analytics + crash-reporting tools, if any |
| Build | Build system + annotation processor (KSP preferred over KAPT) |
| Flavors / Types | The project's build matrix |
| Submodule | Native / cross-platform submodules, if any |

Record which tools are disabled per build type (e.g. analytics/crash off in `debug`) when the
project configures that.

## Documentation standards

- Tag every note: `feature/<name>`, `layer/<ui|data|domain>`, `status/<active|deprecated>`. The
  `#layer/*` tag is load-bearing — the graph colours and the validator's layer rules key off it.
- Keep notes single-purpose. If a note grows beyond one screen, split it into linked notes.
- Write in the user's preferred language; professional, concise technical prose, active voice,
  imperative for instructions. Include the "why" for non-obvious decisions; let the code and the
  vault explain the "what".

### KDoc standards

> Illustrative example (Compose + Hilt). Match the project's detected stack.

```kotlin
/**
 * ViewModel for the Feature screen.
 *
 * Hosts a [store] that reduces [FeatureIntent]s into
 * [FeatureState] and emits [FeatureAction] side effects.
 *
 * @param repository Repository exposing feature streams + mutation calls.
 * @param io Dispatcher qualifier for IO work.
 */
@HiltViewModel
class FeatureViewModel @Inject constructor(
    private val repository: FeatureRepository,
    @IODispatcher private val io: CoroutineDispatcher,
) : ViewModel() {
    /**
     * Submits the current item.
     *
     * @return [Result.success] when the server accepts the submission,
     * [Result.failure] with the underlying network error otherwise.
     */
    suspend fun submit(itemId: String): Result<Unit> = repository.submit(itemId)
}
```

Code examples must use idiomatic Kotlin (no `!!`, `val` over `var`), match the project's **detected**
stack, and use the project's Gradle commands. They must not violate the foundation's forbidden
patterns (`rules/snippets/non-negotiable.md`, whose absolute path the orchestrated prompt lists) or
introduce libraries the project's conventions forbid. Use the project's actual paths, package, and
class names, and prefer KSP over KAPT.
