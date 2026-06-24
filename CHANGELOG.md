# Changelog

All notable changes to the Agentic SDLC Plugin (Android) marketplace.

## [0.5.0] — unreleased

<!-- Add entries here as work lands. Rename the version + date the heading when cutting the release. -->

Android-only restructure: the marketplace drops iOS and reorganizes the Android stack into a
**foundation + additive framework plugins** model (the Framework Provider Pattern).

### Added
- **Framework Provider Pattern** — framework libraries (Retrofit, Room, Dagger/Hilt, …) are now
  **additive plugins** that attach to the orchestrator-managed flow rather than owning it. A framework
  plugin ships a `framework.md` profile with `additive: true` (same schema as `stack.md`), is
  **auto-detected** from the Gradle version catalog / build files, and is **enrich-only**: it
  contributes a convention skill + development/security phase-prompt injections + ProGuard keep rules
  + post-checks, but ships **NO agents** and owns **NO phases**.
- `additive: true` flag in `schemas/stack.schema.json` — marks a profile as an additive framework
  provider. The orchestrator collects additive profiles into an `ADDITIVE_PROFILES` set, merges their
  enrichments into the active flow, and **excludes** them from per-aspect winner resolution and
  `PRIMARY_PROFILE` selection (additive profiles never become the primary stack).
- `frameworks.enable` / `frameworks.disable` override in `.claude/sdlc.local.yaml` — force a framework
  profile on or off, overriding auto-detection.
- **`retrofit-plugin`** (`plugins/retrofit-plugin/`) — the first reference framework plugin
  (Retrofit / OkHttp). Ships `framework.md` (`additive: true`), a convention skill, phase-prompt
  injections, and `rules/snippets/retrofit-proguard.md`.

### Changed
- **`android-plugin` → `android-foundation`** — the Android stack provider was renamed to the
  "Android Foundation", the centerpiece stack provider, and bumped to **0.5.0**. Its internal stack
  id stays `android` (aspect: android, priority 300); only the plugin name changed.
- Marketplace scope is now **Android-only**; the top-level marketplace description was rebranded to
  Android-centric (name stays `agentic-sdlc`).
- Retrofit / OkHttp ProGuard keep rules were **extracted out of** the foundation's
  `rules/snippets/proguard-keep.md` into `retrofit-plugin/rules/snippets/retrofit-proguard.md`. The
  pinned house rules (Coil3, Kermit, KSP, `@Serializable` routes, DataStore, Play Billing) stay in the
  foundation; only detect-don't-impose libraries (Retrofit, Room, Dagger/Hilt) move to framework plugins.

### Removed
- **`ios-plugin`** removed entirely — iOS is no longer in scope.
- `ios` and `shared` aspects removed from the `schemas/stack.schema.json` aspects enum.

### Fixed
- `sdlc` **0.2.1** — model-tier dispatch broke every agent call (`InputValidationError:
  expected one of "sonnet"|"opus"|"haiku"|"fable"`). The `Agent` tool's `model` parameter now
  accepts the short tier name only; both enforcement layers were converting it to a full model ID
  (`opus → claude-opus-4-8`). `enforce-agent-model.sh` now enforces the short tier verbatim (and
  recognizes the new `fable` tier); `pipeline-orchestrator` §3b-3/§3c pass the tier to `Agent()`,
  with the tier→full-ID mapping confined to telemetry/cost (§3d-1).

## [0.4.0] — 2026-06-23

Builds out the marketplace from the initial skeleton into a working native-mobile SDLC system.

### Added
- Full Android specialized roster (11 agents): `android-ba`, `android-developer`, `android-reviewer`,
  `android-security`, `android-tester`, `android-qa`, `android-docs`, plus on-demand `android-debugger`,
  `android-devops`, `android-cicd`, `android-aar` — with model/effort tiering.
- Generic orchestrator control flow: review-loops (`loop: {return_to, max_rounds}`) and parallel groups
  (`{parallel: [...]}`); `workflow.schema.json` + RESOLVER support; `android-feature` / `android-bugfix` recipes.
- Workflow discovery across all plugins (`**/workflows/*.yaml`); core ships only generic recipes.
- Profile-declared default workflow (`stack.md` `workflow:` field) — Android auto-selects `android-feature`.
- `file_glob` detection rule + nested `any`/`all`; precise detection — Android = Gradle **and** Kotlin,
  iOS = `*.xcodeproj` / `*.xcworkspace` / `Package.swift` (app-target + monorepo).
- MASVS/MASTG security in `android-security`; core `security-analyst` made platform-neutral.
- `manage-vault` skill — Obsidian vault lifecycle (scaffold → repair → STUB-aware (re)populate → archive).
- Authored the four Android convention skills (`android-architecture`, `android-compose-ui`,
  `android-data`, `android-navigation`) — previously Phase-3 stubs. Stack-agnostic principles,
  patterns, and anti-patterns; library choices defer to Architecture Detection and reference
  `rules/snippets/non-negotiable.md` rather than duplicating it.
- testTag convention + UI-testing requirement: every non-decorative Compose component carries a
  `testTag` from a centralized `TestTag` object (`TestTag.<Screen>Tags.<ELEMENT>`, grammar
  `<screen>.<element>`); per-screen index in `ui-patterns.md` for fast QA lookup. Documented in the
  `android-compose-ui` skill (§ Test tags) and enforced via `android-developer`/`android-qa`/
  `android-reviewer` checklists + `non-negotiable.md`.
- `validate-kotlin.sh` now also blocks inline `testTag("…")` / `testTag = "…"` literals in production
  Kotlin (steers to the central `TestTag` object). Fixed `kotlin-guard.sh` to propagate the
  validator's exit code — previously it swallowed exit 2, so **all** non-negotiable checks were silent
  no-ops; the regex rules now actually surface to the agent as documented.
- Vault testTag index: seeded `architecture/ui-patterns.md` note (the per-screen testTag table QA
  searches) + `android-docs` owns reconciling it whenever UI components change; documented in the
  `documentation.md` canon (structure, triggers) and the docs-agent Definition of Done.
- Android CLI as an OPTIONAL, plugin-owned advisory hook (core has zero Android-CLI knowledge).
- `/sdlc:init` command; `/sdlc:doctor` host-capability probe (uname + toolchains).
- `docs/WORKFLOW.md` (system diagrams) + `docs/WALKTHROUGH.md` (end-to-end Android run); READMEs
  restructured into the sectioned style and de-duplicated (root overview vs per-plugin detail).

### Changed
- QA in-pipeline scope = lint + unit + compile-check; full builds and instrumentation/UI/on-device tests
  are CI-deferred; capability-gated post-pipeline checks SKIP (not fail) when the tool is absent off-host.
- Version aligned to 0.1.1 across the marketplace and the `android`/`ios` plugins.

### Fixed
- 8 convention-skill stub frontmatters whose inline HTML comment broke YAML parsing.

## [0.1.0] — initial skeleton baseline

Initial native-mobile marketplace.

### Added
- `sdlc` core plugin (copied from upstream): pipeline-orchestrator skill, 5 cost-tiered default
  agents, slash commands, workflow recipes, and the enforce-agent-model hook. Web examples in
  commands/agents/orchestrator retuned to Android/iOS.
- `android-plugin` skeleton — `android` aspect (priority 300): stack.md, android-architect agent
  frontmatter, format/guard hooks. Convention skills are stubs (Phase 3).
- `ios-plugin` skeleton — `ios` aspect (priority 300): stack.md, ios-architect agent frontmatter,
  host-capability-aware format/guard hooks. Convention skills are stubs (Phase 4).
- `stack.schema.json` extended with `android`, `ios`, `shared` aspects.
- `CORE-TODO.md` tracking the mobile retune (file_glob detection, MASVS security, CI-deferred builds).

### Removed
- All web/server framework providers from upstream (Laravel, Django, NestJS, Next.js, React, Vue,
  Angular, Symfony, Flask, FastAPI, Spring, etc.) and the JS/PHP/Python/Java/C# foundations.

### Known limitations
- iOS app-target auto-detection needs `file_glob` (not yet supported); SPM packages detect today,
  app-only repos use `--stack=ios`. See CORE-TODO.md §1.
- security-analyst base checklist is still OWASP-web; MASVS retune pending. See CORE-TODO.md §2.
