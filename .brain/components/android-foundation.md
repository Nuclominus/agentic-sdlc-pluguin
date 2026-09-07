---
plugin: android-foundation
kind: foundation
enriches_aspect: null
dependency: null
---

# android-foundation

## Responsibility

The centerpiece Android (Kotlin + Gradle) stack provider for the Agentic SDLC marketplace.
Registers the `android` profile via `manifest.yaml` (`kind: foundation`, `aspect: android`,
`priority: 300`). Since [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]]
it ships **no agents**: the roster is the core's, and this plugin contributes the *expertise* those
core roles consume — a `role_expertise` block keyed by core role name (invariants + rule paths +
mandatory skills), nine extracted skills (`android-requirements`, `android-review`,
`android-security-masvs`, `android-testing`, `android-e2e`, `android-docs-vault`,
`android-debugging`, `android-build-release`, `android-ci`), the four convention skills for Compose
UI, architecture, data and Navigation, the `rules/` set, and the PostToolUse hooks. Carries pinned
house rules (Coil3, Kermit, KSP, `@Serializable` routes, DataStore, Play Billing); detect-don't-impose
libraries (Retrofit, Room, Dagger/Hilt) attach as additive framework plugins. In-pipeline checks:
detekt + unit tests + compile-check (builds CI-deferred).

Rule files here are read by agents that live in `sdlc`, so they never name the plugin-root variable —
the resolver emits each `role_expertise.<role>.rules` path **absolute** instead.

## Key files
- `plugins/android-foundation/manifest.yaml` (`role_expertise` — the whole contribution to a run)
- `plugins/android-foundation/.claude-plugin/plugin.json`
- `plugins/android-foundation/skills/` (4 convention skills + the 9 extracted role skills)
- `plugins/android-foundation/rules/` (`documentation` carries the per-role vault reading map;
  `workflow` carries what Android adds to each pipeline step; `skills` is now only the optional
  `android` CLI capability bindings)

## Decisions
- [[decisions/ADR-0001-stack-provider-pattern]]
- [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]] — the agents moved to
  the core; this plugin declares `role_expertise` instead of binding a roster. Track note:
  [[planning/i1-agents-in-core]].
- [[decisions/ADR-0020-logging-lives-in-a-development-artifact]] — diagnostics separate at compile
  time (`Development*` decorator in the debug source set) rather than being deleted before Done;
  gated at publish time by the `git-guard` PreToolUse hook.

## Change history
_Backlinks from `changes/` accumulate here._
