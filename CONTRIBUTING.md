# Contributing

This marketplace is **Android-centric** (Android/Kotlin). Please keep contributions within that
scope — no web/server stack providers.

> **Fastest path:** run the **`sdlc:create-pluguin`** skill — a step-by-step wizard that scaffolds a
> schema-valid plugin (framework or foundation): identity, functional aspect from the taxonomy,
> `manifest.yaml`, drafted phase injections + a conventions skill, marketplace registration, and
> validation. The sections below document the same structure for hand-authoring.

There are now two kinds of plugin:

- **Stack providers** (like `android-foundation`) — register a stack via `manifest.yaml`
  (`kind: foundation`), select the workflow recipe, and ship the platform **expertise** the core roster
  consumes: `role_expertise` per core role, skills, rules and hooks. They ship **no agents**
  (ADR-0021 — `plugins/sdlc/agents/` is the only `agents/` directory in the marketplace).
- **Additive framework providers** (like `retrofit-plugin`) — register a framework library via
  `manifest.yaml` (`kind: framework`, same schema). They are **enrich-only**: they
  contribute a convention skill + phase-prompt injections + ProGuard keep rules + post-checks, ship
  **no agents**, and own **no phases**. The orchestrator auto-detects them and merges their
  enrichments into the active flow.

## Adding or changing a stack-provider plugin

A stack provider registers itself; it never edits the core. It contains:

```
<stack>-plugin/
├── .claude-plugin/plugin.json   ← dependencies: ["sdlc"]
├── manifest.yaml                 ← kind: foundation — stack, priority, aspects, detect, role_expertise
├── workflows/                    ← optional: platform-specific recipes
├── skills/<name>/SKILL.md        ← the platform expertise the core roles invoke
├── rules/                        ← files a role may Read; paths declared in role_expertise
└── hooks/                        ← format-on-stop + guard-paths
```

There is no `agents/` here. `sdlc-lint roster` fails any plugin but `sdlc` that ships one.

### `manifest.yaml` example (`kind: foundation`)

```yaml
kind: foundation
stack: kmp
priority: 350
aspects: [android]
workflow: android-feature
detect:
  all:
    - file_exists: settings.gradle.kts
    - file_glob: "**/commonMain/**/*.kt"
hosts_aspects: all
framework_detection: [gradle/libs.versions.toml, "**/build.gradle.kts", "**/build.gradle"]
role_expertise:                  # per CORE role — the extension point that replaced the roster
  developer:
    invariants: |
      Kotlin Multiplatform: shared code in commonMain; expect/actual only where a platform API
      is unavoidable. Never block the main dispatcher.
    rules:
      - { path: rules/snippets/non-negotiable.md, note: "forbidden patterns — before the first edit" }
    skills:
      - { skill: kmp-foundation:kmp-conventions, when: "before writing shared code" }
  tester:
    invariants: |
      kotlin.test + coroutines-test; commonTest for shared logic, platform test source sets only
      for expect/actual behaviour.
```

`invariants` is capped at **1400 characters** per role — it rides in every turn's stable prefix, so a
long checklist belongs in a skill. `rules` paths are relative to the manifest and are emitted
**absolute** by the resolver, because the agent that reads them lives in `plugins/sdlc`, where the
plugin-root variable would resolve to the wrong plugin — so a foundation's `rules/**` must never name
it. `agents_per_phase`, `on_demand_agents` and `aar_analyst` are rejected by the schema on any
foundation but the core's own `stack: vanilla` profile.

## Adding or changing an additive framework plugin

An additive framework provider also registers itself without editing the core. It contains:

```
<framework>-plugin/
├── .claude-plugin/plugin.json   ← dependencies: ["sdlc"]  ← no sibling-plugin dep
├── manifest.yaml                 ← kind: framework — enriches_aspect, dependency (validates against schemas/manifest.schema.json)
├── skills/<name>/SKILL.md        ← convention skill (defer to the aspect's conventions, don't restate)
└── rules/snippets/               ← phase-prompt injections + ProGuard keep rules
```

### `manifest.yaml` example (`kind: framework`)

```yaml
kind: framework
stack: room
priority: 150
enriches_aspect: persistence     # functional category — a foundation hosting `persistence` resolves me
dependency: androidx.room        # just name the library — the foundation declares WHERE to look
convention_skills:
  - room-plugin:room-conventions
phase_injections:
  development: |
    Room present: @Dao methods are suspend/Flow; …
  security: |
    Room: parameterize all @Query; no string concatenation; …
post_pipeline_checks: []
```

> **The plugin only names the dependency; the FOUNDATION owns where to look.** A framework provider
> declares `dependency: <coordinate>` (e.g. `androidx.room` or `com.squareup.retrofit2`) and ships **no**
> detection rules. The foundation that hosts its `enriches_aspect` category declares the search order via
> `framework_detection` — for Android Foundation: **version-catalog first** (`gradle/libs.versions.toml`),
> then module build files (`**/build.gradle*`, gitignore-aware). The orchestrator executes that search,
> so each plugin stays trivial. `dependency` may be a list (matches if any coordinate is found). A
> hand-written `detect:` block remains available as an escape hatch for frameworks not identified by a
> single Maven coordinate.

> Framework manifests (`kind: framework`) **must not** declare `agents_per_phase`, `workflow`,
> `hosts_aspects`, or `framework_detection` — the schema and the orchestrator both reject it.
> Since ADR-0021 the schema rejects `agents_per_phase` / `on_demand_agents` / `aar_analyst` on a
> **foundation** too: the roster is the core's. `retrofit-plugin` is the reference implementation for
> a framework; `android-foundation` for a stack provider.

## Verifying plugins locally

Before opening a PR, run the deterministic verifier (schema + workflow-cycle + stack-detection checks):

```bash
npm ci --prefix tools/sdlc-lint
node tools/sdlc-lint/cli.mjs all
```

CI runs the same `sdlc-lint all` plus `shellcheck` and the unit tests on every push/PR.

You can also validate manifests and workflow recipes directly against their schemas:

```bash
# manifest.yaml (foundation + framework — same schema)
npx check-jsonschema --schemafile schemas/manifest.schema.json plugins/*/manifest.yaml
# workflow recipe
npx check-jsonschema --schemafile schemas/workflow.schema.json workflows/your-feature.yaml
```

## Before opening a PR

- Validate JSON: every `plugin.json`, `hooks.json`, `runtime-dependencies.json`, and `marketplace.json`.
- Validate each `manifest.yaml` against `schemas/manifest.schema.json` (e.g. `npx check-jsonschema --schemafile schemas/manifest.schema.json plugins/*/manifest.yaml`).
- `bash -n` every hook script.
- Keep agent frontmatter (`model`, `effort`, `tools`) stable — it is prompt-cache-sensitive.
- Run `node tools/sdlc-lint/cli.mjs roster` (part of `all`): no `agents/` outside the core, every
  `role_expertise` key is a core role, every declared rule path and skill resolves, and no retired
  agent name or plugin-root path survives in a foundation's files.
- Builds stay CI-deferred: do not add `assembleDebug` / `assembleRelease` to in-pipeline post-checks.

## Core changes

Changes to `plugins/sdlc/**` affect every platform. See `CORE-TODO.md` for the planned mobile
retune (file_glob detection, MASVS security, QA/build philosophy). Discuss core changes in an issue first.

## Attribution

Derived from claude-sdlc (MIT). Preserve `NOTICE` and `LICENSE`.
