---
status: in-progress
---

# I1 — Agents in the core, expertise in the foundations

> Track note for [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]].
> The design spec is `docs/superpowers/specs/2026-09-05-agents-in-core-design.md`; this note carries
> the PR ledger and the expertise-coverage table that PR-2 and PR-3 are gated on.

**Amended 2026-09-06, after PR-1's review:** the original design carried a one-release alias layer
(`resolve/aliases.mjs` plus a mirror in the model-enforcement hook). Review found ten defects in
PR-1, six of them inside that layer and all of one shape: one copy of the rename map keyed on the
canonical name while another was keyed on the dispatched one. The layer is deleted. An agent name is
never translated; `/sdlc:doctor` migrates a project's config once, with approval, from the rename
data in `plugins/sdlc/config/agent-migrations.json`. Four of the ten findings vanished with the
code, three collapsed to one-line fixes, and three were ordinary bugs fixed in place.

## Goal

`sdlc` = process (every agent). Foundation = expertise (skills, rules, hooks, workflows, and a
per-role `role_expertise` declaration the core consumes). Every `android-*` role gets a 1:1 core
successor; `android-foundation/agents/` is deleted, and consumers' config is migrated by
`/sdlc:doctor` rather than by a compatibility shim.

## PR ledger

| PR | Scope | State |
|---|---|---|
| PR-1 | Core roster (+reviewer, tester, debugger, devops, cicd), expertise slot in every agent, core manifest binds every phase, `role_expertise` schema, resolver merge + `prompt_blocks` + `expertise --role` command, stale-name reporting, `/sdlc:doctor` config migration (`config/agent-migrations.json` + `tools/migrate/`), orchestrator pastes the blocks, `sdlc-lint roster`, ADR-0021 (proposed). The foundation still binds its own roster (warned as deprecated), so an Android run behaves as before. | **#139 merged** into `agents-relocation` |
| PR-2 | Nine Android skills extracted from the agent bodies; `role_expertise` in the Android manifest; foundation stops binding agents and drops its `phase_injections`; `rules/` rewritten by core role; `${CLAUDE_PLUGIN_ROOT}` purged from `rules/**`; `aar` skill switches to the core analyst; coverage table below + `expertise-coverage.mjs`; docs. Android agent files stay on disk one more PR for side-by-side review. | in review |
| PR-3 | `git rm plugins/android-foundation/agents/`; schema forbids roster keys on non-core foundations; resolver ignores + warns; roster checks 1, 2, 7; create-pluguin, CONTRIBUTING, README, marketplace, CHANGELOG; commands; android-foundation 2.0.0; ADR-0021 → accepted. | planned |
| PR-4 | Core `debug.yaml` gains the `debugging` phase; prefix growth measured with `sdlc-lint compliance` on 3 real runs; alias-sunset ticket. | optional |

Brain-sync ordering ([[planning/roadmap]] discipline): merge each `brain-sync/pr-<n>` before the
next feature PR opens.

## Expertise-coverage table

One row per `##` section of each Android agent, with the destination that now carries it and an
anchor phrase `tools/sdlc-lint/scripts/expertise-coverage.mjs` asserts is literally present there.
The script also runs the bijection the other way while the agent files are still on disk: a section
with no row fails, and a row naming a section that does not exist fails. PR-3 deletes the agents,
after which the anchors alone keep guarding the destinations.

A destination of `—` means the section was deliberately **not** carried over: the core agent already
says it, verbatim or better. Those rows carry the reason instead of an anchor — a drop is a decision,
and an undocumented one is indistinguishable from an omission.

Destinations in short: `manifest.yaml` = `role_expertise.<role>` (invariants and skills rows),
`skills/<name>/SKILL.md` = an extracted foundation skill, `rules/*` = a rewritten rules file,
`plugins/sdlc/agents/*` = process text the core roster already carried.

| Agent | Section | Destination | Anchor |
|---|---|---|---|
| android-aar | Mandatory Skills | plugins/android-foundation/manifest.yaml | `before returning findings — every claim cites transcript evidence` |
| android-aar | Input | plugins/sdlc/agents/aar-analyst.md | `Use these numbers verbatim.` |
| android-aar | Extraction contract | plugins/sdlc/agents/aar-analyst.md | `Follow the `sdlc:aar` skill's `gather.md` contract.` |
| android-aar | Knowledge sourcing (before grounding recommendations) | plugins/android-foundation/manifest.yaml | `the Android DAG and per-step specifics you audit against` |
| android-aar | Authoritative References | plugins/sdlc/agents/aar-analyst.md | `Return ONLY the report defined in the skill's `report.md`` |
| android-aar | Deliverable | — | core `aar-analyst` § Deliverable owns the report contract |
| android-aar | Non-negotiable rules | plugins/android-foundation/manifest.yaml | `Workflow scope only: agents, rules, settings, process docs` |
| android-ba | Mandatory Skills | plugins/android-foundation/manifest.yaml | `android-foundation:android-requirements` |
| android-ba | Knowledge sourcing (mandatory — before any analysis) | plugins/android-foundation/skills/android-requirements/SKILL.md | `it is the single source of project knowledge` |
| android-ba | Authoritative References | plugins/android-foundation/rules/documentation.md | `per affected module; ` |
| android-ba | 1. Requirements Discovery | plugins/android-foundation/skills/android-requirements/SKILL.md | `minSdk reach, background-execution limits, and battery/data cost.` |
| android-ba | 2. Technical Analysis | plugins/android-foundation/skills/android-requirements/SKILL.md | `addable (version catalog, minSdk floor, licence).` |
| android-ba | 3. Domain Design (embedded DDD) | plugins/android-foundation/skills/android-requirements/SKILL.md | `shared primitives go in the model module` |
| android-ba | 4. Risk & Dependency Assessment | plugins/android-foundation/skills/android-requirements/SKILL.md | `main-thread work, large lists, image decoding, oversized recompositions` |
| android-ba | 5. Implementation Roadmap | plugins/android-foundation/skills/android-requirements/SKILL.md | `Estimate complexity in relative terms, never in hours.` |
| android-ba | 6. Deliverable Format | plugins/android-foundation/skills/android-requirements/SKILL.md | `# Feature Analysis: [Feature Name]` |
| android-ba | 7. Vault Capture (architectural deltas) | plugins/android-foundation/skills/android-requirements/SKILL.md | `The documentation phase finalises it.` |
| android-cicd | Project Extensions | — | replaced by one `expertise --role cicd` command (ADR-0014/0019) |
| android-cicd | Authoritative References | plugins/android-foundation/skills/android-ci/SKILL.md | `Never hardcode Kotlin / Gradle / AGP / DI versions in CI docs` |
| android-cicd | Build Variants | plugins/android-foundation/skills/android-ci/SKILL.md | `Note any tooling the project disables per build type` |
| android-cicd | Project File Locations | plugins/android-foundation/skills/android-ci/SKILL.md | `.github/workflows/              — CI/CD workflows` |
| android-cicd | CI Pipeline Structure | plugins/android-foundation/skills/android-ci/SKILL.md | `lint (parallel: detekt, ktlintCheck)` |
| android-cicd | Gradle Commands | plugins/android-foundation/skills/android-ci/SKILL.md | `./gradlew bundle<Flavor>Release` |
| android-cicd | GitHub Actions Workflow Example | plugins/android-foundation/skills/android-ci/SKILL.md | `path: app/build/outputs/apk/<flavor>/debug/*.apk` |
| android-cicd | Caching | plugins/android-foundation/skills/android-ci/SKILL.md | `restore-keys: gradle-` |
| android-cicd | Signing for Release | plugins/android-foundation/skills/android-ci/SKILL.md | `KEYSTORE_BASE64` (base64-encoded keystore)` |
| android-cicd | Best Practices | plugins/android-foundation/skills/android-ci/SKILL.md | `Pin action versions to commit SHAs for supply-chain safety.` |
| android-cicd | Scope Boundary | plugins/android-foundation/skills/android-ci/SKILL.md | `Signing infrastructure, keystore management` |
| android-cicd | Quality Checklist | plugins/android-foundation/skills/android-ci/SKILL.md | `Failure artifacts uploaded (test reports, mapping files)` |
| android-cicd | Non-Negotiable Rules | plugins/android-foundation/manifest.yaml | `Pin action versions and the JVM version` |
| android-debugger | Mandatory Skills | plugins/android-foundation/manifest.yaml | `superpowers:systematic-debugging` |
| android-debugger | Authoritative References | plugins/android-foundation/rules/documentation.md | `(what a failing module pulls in)` |
| android-debugger | Debugging Methodology | plugins/android-foundation/skills/android-debugging/SKILL.md | `identify the originating layer (UI screen, ViewModel/store` |
| android-debugger | Common Bug Categories | plugins/android-foundation/skills/android-debugging/SKILL.md | `State resets on rotation` |
| android-debugger | Logging — the project's logging library | plugins/android-foundation/skills/android-debugging/SKILL.md | `adb logcat --pid=$(adb shell pidof -s <applicationId>)` |
| android-debugger | Quality Checklist | plugins/android-foundation/skills/android-debugging/SKILL.md | `The checklist covers the report handed to the development phase` |
| android-debugger | Non-Negotiable Rules | plugins/android-foundation/manifest.yaml | `follow evidence, not assumptions` |
| android-developer | Mandatory Skills & Architecture Detection | plugins/android-foundation/skills/android-architecture/SKILL.md | `then follow it — never impose a pattern the project does not use.` |
| android-developer | Knowledge sourcing (mandatory — before any code) | plugins/android-foundation/rules/documentation.md | `for every module it will touch` |
| android-developer | Authoritative References | plugins/android-foundation/manifest.yaml | `forbidden patterns — read before the first edit` |
| android-developer | Implementation | plugins/android-foundation/manifest.yaml | `./gradlew compileDebugKotlin, one attempt` |
| android-developer | Reviewer ⇄ Developer Loop | plugins/sdlc/agents/developer.md | `every `MUST_FIX` item, not just the first` |
| android-developer | Quality Checklist | plugins/android-foundation/manifest.yaml | `Every non-decorative composable gets a testTag` |
| android-devops | Project Extensions | — | replaced by one `expertise --role devops` command (ADR-0014/0019) |
| android-devops | Authoritative References | plugins/android-foundation/skills/android-build-release/SKILL.md | `SDK / JVM target source of truth` |
| android-devops | Infrastructure Overview | plugins/android-foundation/skills/android-build-release/SKILL.md | `Annotation processing` |
| android-devops | Build Variants | plugins/android-foundation/skills/android-build-release/SKILL.md | `type is R8 off by design (profiling / diagnostics)` |
| android-devops | Project File Locations | plugins/android-foundation/skills/android-build-release/SKILL.md | `app/proguard-rules.pro          — ProGuard / R8 rules` |
| android-devops | Signing Configuration | plugins/android-foundation/skills/android-build-release/SKILL.md | `rootProject.file("config/keystore.properties")` |
| android-devops | ProGuard / R8 Rules | plugins/android-foundation/skills/android-build-release/SKILL.md | `for the project's own third-party SDKs — detect them from` |
| android-devops | Gradle Commands | plugins/android-foundation/skills/android-build-release/SKILL.md | `The current command set is the foundation's `rules/snippets/gradle-commands.md`.` |
| android-devops | Gradle Performance | plugins/android-foundation/skills/android-build-release/SKILL.md | `org.gradle.configuration-cache=true` |
| android-devops | App Distribution (example: Firebase — adapt to the project's channel) | plugins/android-foundation/skills/android-build-release/SKILL.md | `firebase appdistribution:distribute` |
| android-devops | Quality Checklist | plugins/android-foundation/skills/android-build-release/SKILL.md | `Release assemble succeeds (signing exercised)` |
| android-devops | Non-Negotiable Rules | plugins/android-foundation/manifest.yaml | `KSP over KAPT` |
| android-docs | Knowledge sourcing (mandatory) | plugins/android-foundation/skills/android-docs-vault/SKILL.md | `the testTag index, when UI is in scope` |
| android-docs | Vault Structure (canon) | plugins/android-foundation/skills/android-docs-vault/SKILL.md | `Templates live in `.obsidian-vault/_templates/` — copy them, never edit them.` |
| android-docs | Hook-created stubs | plugins/android-foundation/skills/android-docs-vault/SKILL.md | `grep -rl "<!-- STUB" .obsidian-vault/` |
| android-docs | testTag index — when UI changes | plugins/android-foundation/skills/android-docs-vault/SKILL.md | `removed component loses its row` |
| android-docs | Definition of Done (before PR) | plugins/android-foundation/skills/android-docs-vault/SKILL.md | `An absent vault is not a silent pass.` |
| android-docs | Closing nudge (after PR) | plugins/android-foundation/skills/android-docs-vault/SKILL.md | `Workflow complete. Run `/sdlc:aar` to review this cycle` |
| android-docs | Authoritative References (always link, never duplicate) | plugins/android-foundation/skills/android-docs-vault/SKILL.md | `Never pin Kotlin / Gradle / AGP / DI / Compose versions inside vault notes` |
| android-docs | Project Stack (mirrors `.obsidian-vault/stack/`) | plugins/android-foundation/skills/android-docs-vault/SKILL.md | `This table is a **template**, not a fixed stack.` |
| android-docs | Documentation Standards | plugins/android-foundation/skills/android-docs-vault/SKILL.md | `tag is load-bearing` |
| android-docs | Build Commands Reference | plugins/android-foundation/skills/android-docs-vault/SKILL.md | `use the project's Gradle commands` |
| android-docs | Quality Checklist | plugins/android-foundation/skills/android-docs-vault/SKILL.md | `STOP and fix the vault if any item fails` |
| android-docs | Non-Negotiable Rules | plugins/android-foundation/manifest.yaml | `Templates in `_templates/` are copied, never edited` |
| android-docs | Recommended Skills | plugins/android-foundation/manifest.yaml | `android-foundation:android-docs-vault` |
| android-qa | Authoritative References | plugins/android-foundation/skills/android-e2e/SKILL.md | `Confirm the app id and host activity from` |
| android-qa | Testing Stack | plugins/android-foundation/skills/android-e2e/SKILL.md | `Cross-process / system UI interaction (permission dialogs, billing sheets)` |
| android-qa | Compose UI Test | plugins/android-foundation/skills/android-e2e/SKILL.md | `performScrollToIndex(10)` |
| android-qa | Maestro E2E Flows | plugins/android-foundation/skills/android-e2e/SKILL.md | `maestro --device <device_id> test .maestro/flows/` |
| android-qa | Accessibility — Compose semantics | plugins/android-foundation/skills/android-e2e/SKILL.md | `AccessibilityChecks.enable().setRunChecksFromRootView(true)` |
| android-qa | Commands | plugins/android-foundation/skills/android-e2e/SKILL.md | `connected<Flavor>DebugAndroidTest` |
| android-qa | Scope Boundary | plugins/sdlc/agents/qa-engineer.md | `do **not** duplicate them` |
| android-qa | Quality Checklist | plugins/android-foundation/skills/android-e2e/SKILL.md | `Accessibility audit passes (content descriptions, 48dp targets, TalkBack)` |
| android-qa | Non-Negotiable Rules | plugins/android-foundation/manifest.yaml | `use Compose `waitUntil { }`` |
| android-reviewer | Mandatory Skills | plugins/android-foundation/manifest.yaml | `superpowers:requesting-code-review` |
| android-reviewer | Knowledge sourcing (mandatory — before any finding) | plugins/android-foundation/skills/android-review/SKILL.md | `verify the diff respects documented invariants` |
| android-reviewer | Authoritative References | plugins/android-foundation/manifest.yaml | `forbidden patterns — the reject list` |
| android-reviewer | Review Dimensions | plugins/android-foundation/skills/android-review/SKILL.md | `defeat recomposition skipping` |
| android-reviewer | Review Output Format | plugins/android-foundation/skills/android-review/SKILL.md | `Non-decorative Compose components carry a `testTag` from `TestTag` (no inline literals)` |
| android-reviewer | Severity Levels | — | core `reviewer` § Severity owns the ladder |
| android-security | Authoritative References | plugins/android-foundation/skills/android-security-masvs/SKILL.md | `Read the vault notes for the project's security-sensitive areas before auditing` |
| android-security | Security Audit Coverage | plugins/android-foundation/skills/android-security-masvs/SKILL.md | `The IV is randomly generated per encryption and stored alongside the ciphertext` |
| android-security | Reporting Format | — | core `security-analyst` § Deliverable owns the report shape |
| android-security | Return value (COMPACT summary) | — | core `security-analyst` owns the `ISSUES_FOUND` machine contract |
| android-security | Commands | plugins/android-foundation/skills/android-security-masvs/SKILL.md | `process<Flavor>ReleaseManifest` |
| android-security | MASVS / MASTG Reference | plugins/android-foundation/skills/android-security-masvs/SKILL.md | `Insufficient Binary Protections` |
| android-security | Non-Negotiable Rules | plugins/android-foundation/skills/android-security-masvs/SKILL.md | `use placeholders` |
| android-tester | Authoritative References | plugins/android-foundation/skills/android-testing/SKILL.md | `Gradle commands, including single-class invocation via` |
| android-tester | Testing Stack | plugins/android-foundation/skills/android-testing/SKILL.md | `no Interactor/UseCase layer` |
| android-tester | TDD Workflow | plugins/android-foundation/manifest.yaml | `when writing new tests from scratch` |
| android-tester | Patterns | plugins/android-foundation/skills/android-testing/SKILL.md | `cancelAndIgnoreRemainingEvents()` |
| android-tester | What TO Test | plugins/android-foundation/skills/android-testing/SKILL.md | `DTO ↔ domain ↔ entity` |
| android-tester | What NOT to Test | plugins/android-foundation/skills/android-testing/SKILL.md | `Trivial delegations with no logic.` |
| android-tester | Commands | plugins/android-foundation/skills/android-testing/SKILL.md | `koverHtmlReport` |
| android-tester | Quality Checklist | plugins/android-foundation/skills/android-testing/SKILL.md | `AAA structure per test` |
| android-tester | Non-Negotiable Rules | plugins/android-foundation/manifest.yaml | ``runTest`, never `runBlocking`` |

## Review of PR-2 (2026-09-06) — what it changed

Eight findings, all confirmed by re-execution before acting. Disposition:

| Finding | Disposition |
|---|---|
| `/sdlc:aar` Step 4 told the analyst to read `blocks.expertise` / `blocks.skills`; `resolveExpertise` returns `block` / `skills_block` at top level | fixed — the whole aar substitution was inert as written, since the command exits 0 and the analyst was simply dispatched with no stack expertise |
| `role_expertise` skill rows were never downgraded when their plugin is missing, though the CHANGELOG said they were | fixed — one shared `downgradeIfMissing` now serves both authors of a skill row. The first cut used the enumerated skill list and was **inverted** on a marketplace checkout: it downgraded all nine of the foundation's own new skills and left `frontend-design` mandatory. The preflight's per-plugin flag is the signal that answers the question actually being asked |
| `sdlc-lint roster`'s declaration check was keyed on the literal `superpowers` | fixed — any foreign owner now needs a declaration; the `frontend-design` omission that motivated the rule had passed it green |
| `rules/skills.md` was reachable from no role, while INDEX.md and the README claimed five | fixed — added to those five roles' `rules`, noted as CLI-only |
| `rules/logging.md` still pointed at `testing.md`, deleted by this PR | fixed — points at the `android-testing` skill |
| `android-docs-vault` cited an absolute path the document-writer is never handed | fixed — describes the file instead of promising a path |
| ~a third of the coverage anchors were the destination's own `##` heading | fixed — 67 rewritten to distinctive sentences. A heading proves a heading exists; the gate is worth only what its anchors bind. (Rewriting them put a newline in one anchor and truncated the table — the bijection check caught it immediately, which is the check earning its place) |
| stale `android-docs` / `android-qa` names in `enforcement.md`, `git-operations.md` | fixed |

## Review of PR-1 (2026-09-06) — what it changed

Ten confirmed findings, eight verification angles. Disposition:

| Finding | Disposition |
|---|---|
| model override rewritten to a name the tier lookup never used; hook alias one-directional; rename branch dead behind a stale plugin cache; rename never rewrote `subagent_type` | gone with the alias layer |
| `expertise --role` rejected every core role while a foundation bound its own; 3b-3 frontmatter path claimed core-only too early; alias WARN reached no channel a human reads | one-line fixes: the valid role set is dispatched ∪ core, the path wording waits for PR-3, `expertise` echoes warnings to stderr |
| `resolveExpertise` dropped `deps.abort`; equal-policy skill collision resolved by file order; `roster` slot check was a bare substring test satisfied by two false sentences | fixed in place, each with a regression test |

Not carried into PR-1, recorded for later: `resolveExpertise` runs the full dependency preflight
and rewrites the preflight stamp on every on-demand bootstrap, and `resolveStack` re-walks the
project tree once per framework. Both are startup cost on a path that now runs per agent, measured
at roughly 180 ms on a real project. Fold into PR-4 with the prefix measurement.

## Measurements owed

- Per-turn prefix size before/after on an Android run (the ADR predicts a net shrink; PR-4 measures it).
- `sdlc-lint compliance` on the first three runs that dispatch core agents on Android: did the
  mandatory `role_expertise` skills get invoked?
