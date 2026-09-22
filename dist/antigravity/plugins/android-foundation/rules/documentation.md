---
loaded_by: [business-analyst, developer, reviewer, tester, qa-engineer, security-analyst, document-writer, debugger]
load_when: "Every role: before answering project-specific questions. document-writer: before the PR. reviewer: during review."
---

# Documentation Rules (SDLC)

## Single source of knowledge

`.obsidian-vault/` is the **authoritative project knowledge base** for the project.

Before answering any question about architecture, modules, screens, navigation, or
business logic — every role MUST `Read` the relevant note(s) from `.obsidian-vault/`.
Start from `.obsidian-vault/_moc-root.md`, then **navigate the typed edges**: follow a
note's `depends_on` / `screens` / `flows` / `adrs` wikilinks to the next note, and read
`.obsidian-vault/architecture/dependency-graph.md` for the whole-project module graph.
Do NOT paraphrase from memory; the vault evolves and memory does not.

No other documentation source is authoritative. There is no Notion, no `docs/wiki/`,
no scattered READMEs. The vault is it.

> **Act, don't stall.** Your FIRST emitted action in a phase MUST be a tool call
> (`Read`/`Glob`/`Grep`/…) — never end a turn on skill-selection or vault-availability
> reasoning alone (that returns zero tool calls and forces a wasteful resume). The vault
> is an **optional** module: if `.obsidian-vault/` is absent, skip the vault reads entirely
> and proceed straight to the codebase and `docs/plans/{task_slug}/`. Do not spend a turn
> "checking" whether the vault exists — a single `Glob`/`Read` that misses IS the check.

### Reading map

| You need… | Read |
|-----------|------|
| The whole module dependency graph | `architecture/dependency-graph.md` (generated Mermaid) |
| A module's dependencies | the module note's `depends_on:` frontmatter (authoritative) + `## Dependencies` prose (the why) |
| Which screens/flows touch a module | follow `screens:` / `flows:` edges, or the Dataview tables in the MOCs |
| The live index of modules/screens/flows | `_moc-modules.md` / `_moc-screens.md` / `_moc-flows.md` (Dataview tables) |

### Reading map by role

What each core role reads before its phase work, on top of `_moc-root.md` (always) and the typed
edges of whatever note it lands on. These lists moved here from the per-agent "Knowledge sourcing"
sections when the agents moved to the core (ADR-0021).

| Role | Reads |
|------|-------|
| business-analyst | `architecture/dependency-graph.md` + `architecture/`; `modules/<module>.md` per affected module; `business-logic/<flow>.md` per affected flow; `navigation/routes.md` when UI is in scope |
| developer | `modules/<module>.md` for every module it will touch; `architecture/dependency-graph.md` + `architecture/` for layering, DDD and UI-pattern invariants and the relevant ADRs; `screens/<Name>.md` when modifying UI; `business-logic/<flow>.md` when implementing a domain flow |
| reviewer | `architecture/dependency-graph.md` + `architecture/`; `modules/<module>.md` per affected module; `navigation/routes.md` for route changes |
| tester | `architecture/layering.md`; `architecture/ui-patterns.md` (the project's test patterns); `architecture/dependency-graph.md`; `modules/` |
| qa-engineer | `architecture/ui-patterns.md` (the testTag index — the selector source); `screens/` (each note's `route:`); `business-logic/` (the journeys to verify) |
| security-analyst | the notes for security-sensitive areas — secure persistence, networking, auth/session, realtime/backend, billing — plus `architecture/dependency-graph.md` to see what each pulls in |
| document-writer | `modules/<module>.md` for the modules in scope; `architecture/dependency-graph.md` + `architecture/`; `screens/<Name>.md` and `navigation/routes.md` when UI is in scope; `architecture/ui-patterns.md` |
| debugger | `architecture/layering.md`; `architecture/dependency-graph.md` (what a failing module pulls in); `architecture/ui-patterns.md`; `modules/` |

## Vault structure (canon)

```
.obsidian-vault/
├── .obsidian/                ← Obsidian app config — do not edit by hand
├── README.md                 ← vault entrypoint
├── _moc-root.md              ← top-level Map of Content
├── _moc-modules.md           ← MOC for feature modules
├── _moc-screens.md           ← MOC for screens
├── _moc-flows.md             ← MOC for business flows
├── _templates/               ← stub templates — copy, never edit
│   ├── module.md
│   ├── screen.md
│   ├── flow.md
│   └── adr.md
├── architecture/             ← layering, DDD, UI patterns, ADRs
│   ├── ui-patterns.md        ← testTag index (Screen → Element → Constant → testTag)
│   └── dependency-graph.md   ← generated module graph
├── modules/                  ← one note per :feature:<name> module — `<module>.md`
├── navigation/               ← `routes.md` registry
├── screens/                  ← one note per Composable screen — `<ScreenName>.md`
├── business-logic/           ← one note per flow — `<flow-name>.md`
├── stack/                    ← tech stack notes
└── general/                  ← overview, prerequisites, onboarding
```

Every note carries YAML frontmatter with **typed edges** — not a flat `links:` array.
Splitting edges into semantic fields is what makes the graph, the Mermaid diagram, the
Dataview tables, and the validator all possible: each consumer keys off knowing *what
kind* of edge each link is.

```yaml
---
type: module | screen | flow | architecture | adr | stack | general
slug: feature-auth
tags: [feature/auth, layer/data, status/active]
depends_on: ["[[modules/network]]"]   # authoritative module→module edges
screens:    ["[[screens/LoginScreen]]"]
flows:      ["[[business-logic/sign-in]]"]
adrs:       ["[[architecture/adr-0001-typed-edges]]"]
related:    []
exclude_from_validation: false          # module notes only — dev-only overlay escape hatch
updated: YYYY-MM-DD
---
```

Edge fields by note type:

| type | edge fields |
|------|-------------|
| module | `depends_on` (modules), `screens`, `flows`, `adrs`, `related`, `exclude_from_validation` |
| screen | `route` (route class name), `depends_on` (modules), `flows`, `adrs`, `related` |
| flow | `depends_on` (modules), `screens`, `adrs`, `related` |
| adr | `supersedes`, `superseded_by`, `related` |

**Every edge value is a path-qualified wikilink string** — `"[[modules/auth]]"`, never the
bare slug `"auth"`. The qualified form is the one shape all three consumers accept at once:
Obsidian renders a graph edge + click-through, Dataview resolves it to a `Link` object, and
the validator's regex strips it to a slug. Bare slugs give up the first two; plain text all
three. `validate-docs.mjs` flags any unqualified or unresolved edge.

Tags (`#feature/<name>`, `#layer/<ui|data|domain>`, `#status/<active|deprecated>`) are the
secondary index — folders are just for navigation. The `#layer/*` tag is load-bearing: the
graph colors and the validator's layer rules key off it.

## Source of truth, lint the mirror

`depends_on:` frontmatter is **authoritative** for dependency edges. The `## Dependencies`
prose (`## Modules involved` on flow notes) is the human-readable **mirror** — it keeps the
*why* of each edge, which auto-generation would destroy. So: keep the two in sync by hand,
and let `validate-docs.mjs` flag drift between them. Generate what's mechanical (the Mermaid
graph), lint what's authored (the prose). Never auto-rewrite the prose.

## Generated artifacts — never hand-edit

- `architecture/dependency-graph.md` holds a Mermaid block between
  `<!-- BEGIN GENERATED MERMAID -->` / `<!-- END GENERATED MERMAID -->`. It is rebuilt by
  `.claude/scripts/gen-mermaid.mjs` from module `depends_on:` edges. Edit the edges, re-run
  the script — never edit the block by hand; it will be overwritten.
- The MOC index tables (`_moc-*.md`) are Dataview queries over typed frontmatter. They need
  the **Dataview** community plugin (see `.obsidian-vault/README.md`). Do not hand-maintain
  bullet lists in them.

## Triggers — what code change requires what vault update

| Change | Required vault update |
|--------|----------------------|
| New :feature:<name> module | `.obsidian-vault/modules/<module>.md` (from `_templates/module.md`) + entry in `_moc-modules.md` |
| New `@Composable` screen + `@Serializable` route | `.obsidian-vault/screens/<Name>.md` + entry in `_moc-screens.md` + row in `.obsidian-vault/navigation/routes.md` |
| New business flow | `.obsidian-vault/business-logic/<flow>.md` (from `_templates/flow.md`) + entry in `_moc-flows.md` |
| New / changed / removed UI component (testTag) | Add, update, or prune its row in `.obsidian-vault/architecture/ui-patterns.md` (testTag index) |
| Changed public Repository / ViewModel API | Update `.obsidian-vault/modules/<module>.md` Public API section |
| New library / dependency | Update relevant `.obsidian-vault/stack/<area>.md` |
| Architecture decision | New ADR at `.obsidian-vault/architecture/adr-<NNNN>-<slug>.md` (from `_templates/adr.md`) |
| Removed module / screen / flow | Tag the note `#status/deprecated`, set `updated`, and remove links from MOCs |

## Hook-created stubs

The `check-docs-sync.sh` PostToolUse hook **auto-creates stub notes** in
`.obsidian-vault/modules/` and `.obsidian-vault/screens/` when production Kotlin
is edited and the matching note is absent. Stubs contain a
`<!-- STUB: ... must fill ... -->` marker.

The **document-writer** fills every stub before the PR. The **reviewer** rejects diffs where the
marker still exists in any changed note.

## Validation (`validate-docs.mjs`)

`.claude/scripts/validate-docs.mjs` lints the vault and **reports only — it never edits a
note**. Run it at the document-writer's Definition of Done, from `fill-vault`, and (optionally) in CI.
It checks four things:

1. **Resolution** — every typed-edge wikilink is path-qualified and resolves to a note.
2. **Drift** — `depends_on:` frontmatter vs the mirror prose section (see above).
3. **Layer rules** — architecture constraints encoded as data: a module may depend downward
   or same-layer (`ui → domain → data`); depending upward is an inversion and skipping a
   layer (`ui → data`) is a skip-layer violation. Cross-cutting modules (`di`, `util`) are an
   explicit escape hatch — allowed as a target from any layer. A note with
   `exclude_from_validation: true` (dev-only overlay) is skipped. The rules live in the
   script's config block, with the escape hatches as data — not special-cased prose.
4. **Cycles** — the module `depends_on` graph must be acyclic.

**Fail faithfully.** When the validator surfaces a layer violation, that is a genuine
architectural finding — **escalate it** (raise an ADR, fix the code, or get a human
decision). Do NOT rewrite the edge to a false value to make the validator go green. A
validator that lies to stay green is worse than no validator. Leave the data faithful.

## Self-modification boundary

The validator's rules, the hooks, and `.claude/settings.json` are tooling that enforces the
workflow. Editing them (new layer rule, new escape hatch, hook change) requires **explicit
user confirmation** per the global CLAUDE.md self-modification rule — do not work around it.

## Exemptions

- Internal refactoring without public API changes.
- Bug fix that does not change method signatures.
- Test-only changes (`src/test/`, `src/androidTest/`, `*Test.kt`, `*Spec.kt`).

## document-writer Definition of Done

Before creating any PR, the document-writer MUST verify:

- [ ] No `_vault-pending.md` breadcrumb sits at the repo root — its presence means the docs gate ran with **no vault** (usually an untracked vault a git worktree never inherited). Restore/track the vault and re-validate, or explicitly record why docs are deferred; do NOT create the PR treating an absent vault as a silent pass.
- [ ] Every hook-created stub in `.obsidian-vault/modules/` and `.obsidian-vault/screens/` has been filled (no `<!-- STUB -->` markers in changed notes).
- [ ] New modules have a `.obsidian-vault/modules/<name>.md` linked from `_moc-modules.md`.
- [ ] New screens are in `.obsidian-vault/screens/<Name>.md` and linked from `_moc-screens.md` + `.obsidian-vault/navigation/routes.md`.
- [ ] New flows have `.obsidian-vault/business-logic/<flow>.md` (Dataview MOCs index them automatically — no manual bullet).
- [ ] Typed edges are path-qualified wikilinks and resolve (no bare slugs, no dangling links).
- [ ] `depends_on:` frontmatter and the `## Dependencies` (or `## Modules involved`) prose agree — no drift.
- [ ] Any note still on the legacy `links:` field has been migrated (`migrate-edges.mjs`).
- [ ] `node .claude/scripts/gen-mermaid.mjs` re-run so `architecture/dependency-graph.md` is current.
- [ ] `node .claude/scripts/validate-docs.mjs` is clean — OR every finding is escalated (layer violations are NOT rewritten to pass).
- [ ] No note references a class/function/screen/route that no longer exists.
- [ ] Templates in `.obsidian-vault/_templates/` are NOT modified — only copied.
- [ ] Every changed/new note has fresh `updated:` frontmatter.

If any item fails — STOP and update the vault before `gh pr create`.

## reviewer enforcement

The reviewer rejects (returns the diff to the development phase) when:

- A new :feature:<name> module ships without a `.obsidian-vault/modules/<name>.md` note.
- A new public screen / `@Serializable` route ships without a `.obsidian-vault/screens/<Name>.md` note and a `routes.md` entry.
- A public Repository / ViewModel interface changes without an update to the corresponding `modules/<name>.md`.
- Any stub in changed files still contains a `<!-- STUB -->` marker.
- A typed edge is a bare slug or does not resolve, or `depends_on:` drifts from its prose mirror.
- `architecture/dependency-graph.md` is stale (a changed `depends_on:` edge isn't reflected — re-run `gen-mermaid.mjs`).
- `validate-docs.mjs` reports findings that were neither fixed nor escalated (a layer violation rewritten to pass is a hard reject).
- A `_vault-pending.md` breadcrumb is present (the docs gate ran with no vault — an untracked/uninherited vault) and the change touches production code without an acknowledged deferral.

Severity: **major**.
