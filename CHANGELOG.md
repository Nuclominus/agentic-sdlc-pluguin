# Changelog

All notable changes to the Agentic SDLC Plugin (native mobile) marketplace.

## [0.4.0] — unreleased

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
