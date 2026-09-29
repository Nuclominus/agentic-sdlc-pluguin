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
house rules (Coil3, Kermit, KSP, `@Serializable` routes, DataStore, Play Billing). In-pipeline
checks: detekt + unit tests + compile-check (builds CI-deferred).

Since [[decisions/ADR-0026-embed-framework-providers-in-the-foundation]] (2026-09-20) this plugin
also embeds all 7 additive Android frameworks directly, via a `frameworks:` array in its own
`manifest.yaml` — detect-don't-impose libraries (Retrofit, Ktor, Room, Proto DataStore, Dagger/Hilt,
Koin, WorkManager) are no longer separate installed plugins. Each row carries its own
`enriches_aspect` + `dependency` for conditional activation (only the detected provider per
contested aspect — network: retrofit/ktor, persistence: room/datastore-proto, di: dagger/koin —
activates), and its convention skill now lives under this plugin's own `skills/` (namespace
`android-foundation:<name>-conventions`) with its ProGuard snippet under `rules/snippets/`.

Since [[decisions/ADR-0036-a-skill-catalog-is-a-runtime-dependency-a-skill-set-is-its-matrix]]
(2026-09-28) the plugin also owns the per-role matrix for Google's Android CLI skill catalog:
`skill-sets/android-skills.yaml` triages all 25 catalog skills into 13 categories, and each category
lists the only roles its skills may reach. The security-analyst, for example, has no UI skill. The
skills × roles table (`skill-sets/android-skills.md`) and the per-role README block are generated
from that file and checked by `sdlc-lint skill-sets`. At resolve time the manifest's
`skill_sets` key turns every assigned row into an ordinary `role_expertise` skill row. Each row is a
bare id with `requires: android-skills` and is gated against the project. The catalog itself is a
`kind: skill-catalog` dependency in `runtime-dependencies.json` with `policy: warn`, the same level
as superpowers. Missing skills are judged per skill:
- A mandatory row is downgraded to best-effort.
- A recommended row is not rendered.
- `android-cli` becomes unavailable when the `android` binary is missing.

`rules/skills.md` was removed; its command-group bindings are now the per-role `when` text of the
`android-cli` row.

`/sdlc:doctor` reports the catalog in its own section (from `resolve/cli.mjs deps --json --probe`).
The section shows:
- the installed catalog version against the version the matrix was triaged for;
- each missing skill, with the roles it costs;
- the `android` binary and its version;
- installed copies that no longer match the CLI's local clone (`catalog_dir`,
  `~/.android/cli/skills`), because `android skills add` copies and does not track updates;
- catalog skills the matrix has not triaged yet.

Rule files here are read by agents that live in `sdlc`, so they never name the plugin-root variable —
the resolver emits each `role_expertise.<role>.rules` path **absolute** instead.

## Key files
- `plugins/android-foundation/manifest.yaml` (`role_expertise` — the whole contribution to a run;
  `frameworks:` — the 7 embedded framework rows, ADR-0026)
- `plugins/android-foundation/.claude-plugin/plugin.json`
- `plugins/android-foundation/skills/` (4 convention skills + 9 extracted role skills + 7 embedded
  framework-conventions skills)
- `plugins/android-foundation/skill-sets/android-skills.yaml` (Android CLI skill matrix — the only
  place a catalog skill is assigned to a role; `android-skills.md` is generated from it)
- `plugins/android-foundation/rules/` (`documentation` carries the per-role vault reading map;
  `workflow` carries what Android adds to each pipeline step; `snippets/` also carries the 7
  relocated ProGuard keep-rule files)

## Decisions
- [[decisions/ADR-0001-stack-provider-pattern]]
- [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]] — the agents moved to
  the core; this plugin declares `role_expertise` instead of binding a roster. Track note:
  [[planning/i1-agents-in-core]].
- [[decisions/ADR-0020-logging-lives-in-a-development-artifact]] — diagnostics separate at compile
  time (`Development*` decorator in the debug source set) rather than being deleted before Done;
  gated at publish time by the `git-guard` PreToolUse hook.
- [[decisions/ADR-0026-embed-framework-providers-in-the-foundation]] — the 7 additive framework
  plugins (see e.g. [[components/retrofit-plugin]]) merged in; supersedes
  [[decisions/ADR-0002-framework-provider-pattern]].
- [[decisions/ADR-0036-a-skill-catalog-is-a-runtime-dependency-a-skill-set-is-its-matrix]] — the
  Android CLI skill catalog is a `policy: warn` dependency, and its per-role matrix is a skill set
  with a category scope guard.

## Change history
_Backlinks from `changes/` accumulate here._
