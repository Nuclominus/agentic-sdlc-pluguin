---
loaded_by: [aar-analyst]
load_when: "When auditing a run against what Android adds to each pipeline step."
---

# Android specifics per pipeline step

The pipeline itself — phase order, the review loop and its cap, the gated `remediation` phase, the
parallel group, crash recovery, checkpointing — belongs to the core orchestrator
(`sdlc/skills/pipeline-orchestrator/SKILL.md`) and to the recipe under `workflows/`. This file does
not restate it. What follows is only what **Android** adds, step by step, and the roles are the CORE
roster (ADR-0021): this foundation ships no agents.

The recipe this foundation selects is `workflows/android-feature.yaml`; the bug-fix variants are
`android-debug.yaml` and `android-bugfix.yaml`.

## Applies to every step

- **Vault first.** `.obsidian-vault/` is the single source of project knowledge. Before answering a
  project-specific question, `Read` the relevant note starting from `_moc-root.md`, then follow the
  typed edges (`depends_on` / `screens` / `flows` / `adrs`) and the generated
  `architecture/dependency-graph.md`. The vault is OPTIONAL — when it is absent, go straight to the
  codebase and `docs/plans/{task_slug}/`. See `documentation.md`.
- **Act, don't stall.** The first emitted action in a phase is a tool call. A `Glob`/`Read` that
  misses IS the check for whether the vault exists.
- **Plan mode** for any task that touches ≥ 3 files, introduces a public API or exported component,
  adds a dependency, or crosses a module boundary.
- **Diagnostics** belong in a development source set or behind a lazy severity gate — never a runtime
  flag inside production logic (`logging.md`, ADR-0020).
- **Gradle task probe.** If `./gradlew detekt` or `./gradlew ktlintCheck` reports "task not found" on
  the first attempt, skip that check. Do not retry under alternate names or inspect build files.

## business_analysis

Identify affected `:feature:<name>` modules and decide module placement (bounded contexts, the
UI → domain → data direction, where shared primitives live). If the analysis introduces a new
architectural decision or cross-module boundary, draft an ADR stub at
`.obsidian-vault/architecture/adr-<NNNN>-<slug>.md` from `_templates/adr.md`; the documentation phase
finalises it. Skill: `android-requirements`.

## development

Detect the project's state-management pattern and DI framework before implementing state — never
impose one. Compile check is `./gradlew compileDebugKotlin`, one attempt; the test phase iterates.
The `check-docs-sync.sh` PostToolUse hook auto-creates vault stubs for new modules and screens — do
not delete them; flag them in the handoff. `validate-kotlin.sh` blocks the forbidden patterns in
`snippets/non-negotiable.md` at write time. Convention skills for Compose UI, architecture, data and
navigation are declared in `manifest.yaml` `convention_skills`; framework plugins (Hilt, Retrofit,
Room, …) add their own `phase_injections` on top.

## review

Android review dimensions and the vault-freshness checks are the `android-review` skill. Security is
**not** reviewed here — it is the security phase's, and a review that duplicates it wastes the
parallel group.

## security ‖ test (parallel)

**security** — MASVS/MASTG against the **release** variant; the `android-security-masvs` skill
carries the audit sections and the control map. Read-only: the gated `remediation` phase dispatches
the developer with the report when a Critical or High finding exists.

**test** — JVM unit and integration tests only (`android-testing` skill). Instrumented and Compose
UI tests are the QA phase's; a full assemble and `connectedAndroidTest` are CI-only and never run
in-pipeline.

## qa

E2E on the project's debug variant: Compose UI Test, Maestro flows, accessibility
(`android-e2e` skill). Selectors are testTag constants resolved through the vault's
`architecture/ui-patterns.md` index. An instrumented run needs a device or emulator — when none is
available, say so rather than reporting an untested pass.

## documentation

The Obsidian vault Definition of Done gates the PR: no `<!-- STUB -->` marker survives, typed edges
resolve, `gen-mermaid.mjs` re-run, `validate-docs.mjs` clean or every finding escalated, the
`ui-patterns.md` testTag index reconciled. Full checklist: `documentation.md` and the
`android-docs-vault` skill. PR title format is `[task_id] title` (e.g. `[CRF-6] Search Filters`); no
AI mentions, no change statistics, no test checklists in the description.

**Model note.** The documentation role defaults to a low tier, which is fine for vault edits but
unreliable for an outward-facing `gh pr create` combined with a cross-repo / submodule commit. When
the phase does both, escalate that run's tier deliberately and record why.

## debugging (and on-demand)

Read-only root-cause analysis; the prescribed fix goes to the development phase in the next step,
where it passes through the normal review loop. The Android symptom→cause tables, Logcat filters and
heap-dump commands are the `android-debugging` skill.

## Out of pipeline

- **devops** — Gradle, `build-logic/`, the version catalog, signing, R8, store distribution.
- **cicd** — GitHub Actions workflow YAML and CI stage design.
- **aar-analyst** — `/sdlc:aar`, user-triggered and retrospective. Mandatory-skill adherence is
  audited against `manifest.yaml` `role_expertise.<role>.skills` (what the orchestrator actually
  pasted), not against any agent's prose.
