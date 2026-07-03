# SDLC Marketplace for Claude Code — Android

AI-assisted SDLC pipelines for **Android** development, built on the **Stack Provider Pattern**: a single platform-agnostic core orchestrator runs the pipeline; **Android Foundation** registers itself via a declarative `manifest.yaml` (`kind: foundation`) and drives the flow; **framework plugins** (Retrofit, Room, Dagger/Hilt, …) attach **additively** via `manifest.yaml` (`kind: framework`). No core overrides, no slot registries, no copy-paste.

**v0.5.0** — flat plugin set: 1 platform-agnostic core (`sdlc`) + the **Android Foundation** centerpiece (`android-foundation`) + additive **framework plugins** (`retrofit-plugin`, `room-plugin`, `dagger-plugin`). Cost-optimized: model tiering + `effort` per-subagent. Generic control flow (review-loops, parallel groups), workflow discovery across plugins, auto-detected framework enrichment, and guaranteed per-agent model enforcement.

> Adapted from [AratKruglik/claude-sdlc](https://github.com/AratKruglik/claude-sdlc) (MIT) — re-oriented around an Android Foundation with a Framework Provider Pattern. See `NOTICE`.

---

## Quickstart

```bash
# 1. Add the marketplace
/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin

# 2. Install Android Foundation (sdlc core installs automatically as a dependency)
/plugin install android-foundation@agentic-sdlc   # Android (Kotlin + Gradle) — the centerpiece

# 3. (Optional) Install framework plugins — they auto-activate when their library is detected
/plugin install retrofit-plugin@agentic-sdlc      # Retrofit/OkHttp networking enrichment

# 4. Verify
/sdlc:doctor
/sdlc:list-stacks

# 5. Run
/sdlc:start "Add a settings screen with a dark-mode toggle"
```

See [`docs/WORKFLOW.md`](docs/WORKFLOW.md) for system diagrams and [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md) for a full end-to-end Android run.

---

## How It Works: Stack Provider Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                    sdlc (core, platform-agnostic)            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  pipeline-orchestrator (skill) — NEVER CHANGES          │ │
│  │                                                         │ │
│  │  • pick the FOUNDATION     (kind: foundation winner)    │ │
│  │  • DELEGATE framework discovery → to the foundation     │ │
│  │  • resolve workflow recipe (discovered across plugins)  │ │
│  │  • merge active profiles   (foundation + ADDITIVE set)  │ │
│  │  • execute phases          (loops + parallel groups)    │ │
│  │  • dispatch agents_per_phase[phase] (from the winner)   │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ▲                                  │
│         reads manifest.yaml (split by kind) + workflows/     │
└────────────────────────────┼─────────────────────────────────┘
                             │
                             │ core picks the foundation
                             ▼
              ┌──────────────────────────────────┐
              │ android-foundation (manifest.yaml)│  FOUNDATION (kind: foundation)
              │ owns aspect:android · 11 agents   │  hosts_aspects: [network, persistence,
              │ → RESOLVES its own frameworks     │    di, ui, background, analytics, …]
              └────────────────┬─────────────────┘  + framework_detection (where to look)
                               │ collects manifest.yaml (kind: framework) where
                               │ enriches_aspect ∈ hosts_aspects (by category, never by name)
              ┌────────────────┼─────────────────┐
       ┌──────▼─────┐   ┌──────▼─────┐   ┌────────▼───┐    FRAMEWORKS (additive)
       │ retrofit-  │   │   room-    │   │  dagger-   │    enriches_aspect:
       │ plugin     │   │  plugin    │   │  plugin    │      network│persistence│di
       │ network    │   │ persistence│   │    di      │    NO agents · skill+inject
       └────────────┘   └────────────┘   └────────────┘
        no deps between them · none depends on the foundation by name
```

**Key principles:**

1. **Core never changes.** Pipeline logic lives exclusively in `pipeline-orchestrator/SKILL.md`. It has zero knowledge of any platform, library, security standard, or workflow recipe.
2. **The foundation registers itself** via `manifest.yaml` (`kind: foundation`) — it declares auto-detection rules, priority, agents per phase, an optional default workflow, and convention skills.
3. **Framework plugins attach additively** via `manifest.yaml` (`kind: framework`). They enrich existing phases (convention skill + dev/security injections + ProGuard) and ship **no agents** — they never win an aspect or own a phase. The core picks the foundation, then **delegates** framework discovery to it: the foundation collects every `kind: framework` manifest whose `enriches_aspect` (a functional category like `network`/`persistence`/`di`) is in its `hosts_aspects`, and detects them via its own `framework_detection`. Frameworks point *up* to a category, never sideways at a plugin.
4. **Priority wins.** When multiple foundations match, the highest priority takes over. Framework manifests do not compete.
5. **Everything is discovered, not hardcoded.** Manifests (`**/manifest.yaml`, split by `kind`), workflows (`**/workflows/*.yaml`), and runtime dependencies (`**/runtime-dependencies.json`) are globbed across all installed plugins.

### Stack Priority Table

Stack providers (foundations) detect by project structure (`detect`); framework providers just name a `dependency` and point at a functional category via `enriches_aspect`. The foundation hosting that category (`hosts_aspects`) declares where to search (`framework_detection`: catalog first, then build files) and the orchestrator executes it.

| Priority | Plugin              | Aspects | Detect / dependency                                                 |
| -------- | ------------------- | ------- | ------------------------------------------------------------------- |
| 0        | `vanilla` (sdlc)    | —       | `*` (always matches)                                                |
| 300      | `android-foundation`| android | `(settings.gradle.kts OR settings.gradle)` **AND** `**/*.kt`        |
| additive | `retrofit-plugin`   | —       | `dependency: com.squareup.retrofit2`                                |
| additive | `room-plugin`       | —       | `dependency: androidx.room`                                         |
| additive | `dagger-plugin`     | —       | `dependency: com.google.dagger` (Dagger + Hilt)                     |

### Detection rules

A profile's `detect` block supports four rule types, freely nestable via `any` / `all`:

| Rule | Matches when |
| ---- | ------------ |
| `file_exists: <path>` | the file exists |
| `file_contains: { path, pattern }` | the file at `path` matches the regex (`path` may be a glob like `**/build.gradle` — matches if any globbed file contains the pattern) |
| `file_glob: <pattern>` | ≥1 file matches the glob (variable-named / nested artifacts — module-level build files, monorepo subtrees) |
| `any: [...]` / `all: [...]` | nested OR / AND (recursive) |

This is why projects auto-detect with **no `--stack=` flag** — and why framework plugins activate automatically when their library appears in the build.

### Framework Provider Pattern (additive profiles)

A **framework plugin** ships a `manifest.yaml` with `kind: framework`. Unlike a foundation, it:

- **Owns no aspect and no agents.** It is excluded from per-aspect winner resolution and from PRIMARY_PROFILE selection — it cannot drive a phase.
- **Decorates a functional category, not a plugin.** It declares `enriches_aspect: <network|persistence|di|ui|background|analytics|architecture>` and depends on **no** sibling plugin (its `plugin.json → dependencies` lists only `sdlc`). It is never considered unless a winning foundation's `hosts_aspects` includes that category — so any foundation hosting it satisfies the contract, and frameworks stay true peers, never referencing another plugin's skill id directly.
- **Enriches existing phases.** It contributes a convention skill, `development` + `security` phase-prompt injections, ProGuard/R8 keep rules, and (optionally) post-checks — all merged into the run by the orchestrator's existing profile-merge.
- **Auto-detects** from the Gradle version catalog / build files; the foundation hosting its category consumes its guidance through that phase's existing agents — only when the library is present.

Toggle frameworks per project in `.claude/sdlc.local.yaml`:

```yaml
frameworks:
  enable: [retrofit]    # force-on even if detection missed it
  disable: [dagger]     # suppress even if detected
```

The boundary: **pinned house rules** (Coil3, Kermit, KSP, `@Serializable` routes, DataStore, Play Billing) stay in the foundation as non-negotiables; **detect-don't-impose libraries** (Retrofit, Room, Dagger/Hilt) become framework plugins. `retrofit-plugin` is the reference implementation.

---

## Pipeline Phases

### Standard 5-phase pipeline (vanilla fallback)

```
Phase 1: BA       → business-analyst (opus/high)
          ↓ docs/plans/{slug}/01-business-analysis.md
Phase 2: Dev      → [stack agent] (sonnet/medium)
          ↓ docs/plans/{slug}/02-development.md
Phase 3: QA       → qa-engineer (sonnet/medium, max 3 attempts)
          ↓ docs/plans/{slug}/03-qa.md
Phase 4: Security → security-analyst (opus/high, platform-neutral baseline)
          ↓ docs/plans/{slug}/04-security.md
Phase 5: Docs     → document-writer (haiku/low)
          ↓ Pull Request
```

### Android pipeline (workflow `android-feature`)

The headline pipeline showcases the generic control flow — a review **loop** and a **parallel group**:

```
business_analysis → development → review ──approved──→ [ security ‖ test ] → qa → documentation
                         ▲              │
                         └──changes─────┘  (loop, max 3 rounds)
```

- **review** is a *loop phase*: changes-requested → re-run `development` (implement pass only) with findings injected, up to 3 rounds, then escalate.
- **[security ‖ test]** is a *parallel group*: both phases dispatched in one message; both must return before `qa`.
- The `android` profile declares `workflow: android-feature`, so this DAG auto-selects — `/sdlc:start "<feature>"` (no `--workflow=`).

The agent assigned to each phase (and the on-demand agents) is documented in [`plugins/android-foundation/README.md`](plugins/android-foundation/README.md#agent-roster).

### Framework enrichment (additive)

When a framework plugin's library is detected, its guidance joins the run without changing the pipeline shape. Example: on a project using Retrofit, `retrofit-plugin` adds its `retrofit-conventions` skill to the development phase and injects networking + TLS guidance into the `android-developer` and `android-security` prompts. No extra agent, no extra phase — the existing agents simply receive richer, library-specific instructions. Multiple frameworks compose: their injections concatenate deterministically.

---

## Commands

| Command                         | Purpose                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `/sdlc:init`                    | Detect platform(s), scaffold `.claude/sdlc.local.yaml`, optionally seed `CLAUDE.md` |
| `/sdlc:extension [--list]`      | Author the Project Extension Manifest step-by-step (per-agent Skill mappings)       |
| `/sdlc:start "feature"`         | Run the pipeline (auto-selects the profile's workflow)             |
| `/sdlc:batch "task1" "task2"`   | Run pipelines in parallel for multiple tasks (isolated worktrees)  |
| `/sdlc:list-stacks`             | Show detected stack profiles and their priorities                  |
| `/sdlc:doctor`                  | Preflight: deps, stack detection, host capability (uname/toolchains), cost |
| `/sdlc:security-init`           | Materialize security-patterns for the security-guidance plugin     |

---

## Dynamic Workflow Recipes

A **workflow recipe** is a YAML file declaring which phases to run and in what shape. Recipes are discovered across **all** plugins (`**/workflows/*.yaml`), validated against `schemas/workflow.schema.json` on load.

### Built-in recipes

| Recipe          | Owner          | Phases                                                            |
| --------------- | -------------- | ----------------------------------------------------------------- |
| `default`       | sdlc (core)    | BA → Dev → QA → Security → Docs                                   |
| `bugfix`        | sdlc (core)    | Dev → QA → Security → Docs                                        |
| `hotfix`        | sdlc (core)    | Dev → QA → Security → Docs                                        |
| `refactor`      | sdlc (core)    | Dev → QA → Security → Docs                                        |
| `docs-only`     | sdlc (core)    | Docs                                                              |
| `android-feature` | android-foundation | BA → Dev → Review(⇄Dev ×3) → [Security ‖ Test] → QA → Docs   |
| `android-bugfix`  | android-foundation | Dev → Review(⇄Dev ×3) → [Security ‖ Test] → QA              |

### Control-flow shapes (generic)

| Shape | Syntax | Meaning |
| ----- | ------ | ------- |
| plain | `- development` or `- {name, when}` | run the phase |
| loop  | `- {name: review, loop: {return_to: development, max_rounds: 3}}` | re-run `return_to` on changes-requested, capped, then escalate |
| parallel | `- {parallel: [security, test]}` | dispatch listed phases concurrently |

### Workflow selection precedence

`--workflow=NAME` > `.claude/sdlc.local.yaml active_workflow` > **match-based auto-selection** > the PRIMARY profile's declared `workflow:` > `default`.

```bash
/sdlc:start "Add dark mode"                            # android profile → android-feature (auto)
/sdlc:start --workflow=docs-only "Update README"       # explicit override
```

### Automatic workflow selection

When no explicit workflow is chosen (no `--workflow=`, no `active_workflow`), the orchestrator inspects the change and picks the most fitting recipe by evaluating each recipe's optional `match:` block. This tier sits **between** `active_workflow` and the profile default: explicit choices always win, but intent detection beats the generic default.

A recipe is a **candidate** only if it carries a non-empty `match:` block (a recipe with no `match:` can only be chosen explicitly). Available signals: `$ARGUMENTS`, `LOC_TOUCHED`, `HAS_MIGRATIONS`, `CONFIG_ONLY`. A candidate **matches iff ALL conditions present in its `match:` block are satisfied** (absent conditions are ignored):

- `arguments_pattern` — ECMAScript regex, tested **case-insensitively** against `$ARGUMENTS`.
- `loc_touched_max` / `loc_touched_min` — `LOC_TOUCHED <= max` / `LOC_TOUCHED >= min`.
- `has_migrations: true` — matches only when a migration is present.
- `config_only: true` — matches only when the change touches config-only files.

**Tie-break** when several recipes match, applied in order: (1) most specific — highest count of satisfied conditions; (2) most conservative — lowest `caps.max_total_cost_usd` (no cap = +∞); (3) alphabetical by `name`. If exactly one survives it is selected; if none match, selection falls through to the profile default unchanged.

When auto-selection fires it announces:

```text
🧭 Auto-selected workflow 'bugfix' — matched: arguments_pattern,loc_touched_max. Override with --workflow=NAME or --no-auto-workflow.
```

**Override** by naming a workflow (`/sdlc:start --workflow=NAME "…"`) or by disabling the tier entirely (`/sdlc:start --no-auto-workflow "…"`, which jumps straight to the profile default).

### Custom recipes

Place a YAML file under any plugin's `workflows/` (or a project-local recipe). Names must be unique across the marketplace; core recipe names are reserved.

---

## Model Enforcement

Every agent declares its `model:` tier in frontmatter; the pipeline guarantees that tier is used regardless of the session default.

**Two enforcement layers:**

1. **Orchestrator (Layer 1)** — Step 3b reads the agent's frontmatter and passes the declared tier verbatim in the `Agent()` dispatch.
2. **PreToolUse hook (Layer 2)** — `plugins/sdlc/hooks/enforce-agent-model.sh` intercepts every `Agent` call, compares the requested model with the agent's declared `model:`, and corrects it via `updatedInput` if they differ.

> The `Agent` tool's `model` parameter accepts the **short tier name only** (`opus` / `sonnet` / `haiku` / `fable`). Passing a full model ID raises `InputValidationError`, so both layers enforce the tier verbatim. The tier → model-ID resolution is used **only** for telemetry/cost accounting (orchestrator Step 3d-1), never for dispatch.

**Tier → model ID (telemetry/cost only):** concrete model IDs are defined once in the model registry [`plugins/sdlc/config/models.json`](plugins/sdlc/config/models.json) — the single source of truth. Bump a model there, not here.

---

## Cost Optimization: model + effort

Cost is controlled exclusively through `model` + `effort` (Claude Code does not expose per-subagent `temperature`). The tier → model mapping is in [Model Enforcement](#model-enforcement) above; the **per-agent `model`/`effort` roster lives in each plugin's README** so it stays next to the agents it describes:

- core fallback agents → [`plugins/sdlc/README.md`](plugins/sdlc/README.md)
- Android roster → [`plugins/android-foundation/README.md`](plugins/android-foundation/README.md)
- framework providers ship no agents → [`retrofit-plugin`](plugins/retrofit-plugin/README.md) · [`room-plugin`](plugins/room-plugin/README.md) · [`dagger-plugin`](plugins/dagger-plugin/README.md)

> `effort: high` on Opus is the costliest combination — reserved for leverage agents (BA, Security) where reasoning quality affects every downstream phase.

**Levers:** skip-rules for trivial changes · QA 3-attempt hard cap · compact ≤2–3K-token handoffs · prompt caching (stable prefixes).

---

## Available Plugins

| Plugin               | Type               | Stack / Technology                                                    |
| -------------------- | ------------------ | --------------------------------------------------------------------- |
| `sdlc`               | Core               | Platform-agnostic orchestrator + 5 fallback agents                    |
| `android-foundation` | Stack provider     | Android (Kotlin + Gradle) — 11-agent roster, MASVS, vault, house rules |
| `retrofit-plugin`    | Framework provider | Retrofit/OkHttp — additive (skill + injections + ProGuard), no agents  |
| `room-plugin`        | Framework provider | Room persistence — additive (skill + injections + ProGuard), no agents |
| `dagger-plugin`      | Framework provider | Dagger/Hilt DI — additive (skill + injections + ProGuard), no agents   |

### Optional external dependencies

| Plugin              | Source                               | Role                                                                                              |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `superpowers`       | `obra/superpowers`                   | Brainstorming for BA, TDD for QA, verification-before-completion for architects. Degrades gracefully. |
| `security-guidance` | `anthropics/claude-plugins-official` | Hooks-based in-session security review. The MASVS security phase runs fully without it.            |

### Optional system tools

| Tool | Role |
| ---- | ---- |
| **Android CLI** (Google's `android` binary) | Project scaffolding, emulator/device, SDK, docs, Studio bridge. `android-foundation` advises (non-blocking) if absent; no agent requires it. |

---

## Stack Composition Examples

| Project                           | Profile(s)                              | Development dispatch                       |
| --------------------------------- | --------------------------------------- | ------------------------------------------ |
| Android app repo                  | android (300)                           | android-developer                          |
| Android app + Retrofit            | android (300) + retrofit (add.)         | android-developer, enriched by retrofit    |
| Android app + Retrofit/Room/Hilt  | android (300) + retrofit + room + dagger| android-developer, enriched by all three   |
| Unknown stack                     | vanilla (0)                             | developer (fallback)                       |

---

## Security: MASVS / MASTG

The core security phase is **platform-neutral** (secrets, auth, injection/input validation, data protection, access control, misconfiguration, vulnerable deps, logging) and applies the standard injected by the active profile as authoritative. On Android, `android-security` runs a full **MASVS/MASTG** audit — see [`plugins/android-foundation/README.md`](plugins/android-foundation/README.md#security--masvs--mastg). Active framework plugins concatenate their own security guidance (e.g. `retrofit-plugin` adds MASVS-NETWORK TLS/pinning checks).

---

## Optional Obsidian Vault

Agents use a project's `.obsidian-vault/` as the single source of knowledge **when present**, falling back to the codebase + `docs/plans/` when absent. The Android `manage-vault` skill owns the vault lifecycle (scaffold → repair → STUB-aware (re)populate → archive) — see [`plugins/android-foundation/README.md`](plugins/android-foundation/README.md#optional-obsidian-vault--manage-vault).

---

## Local Overrides

A `.claude/sdlc.local.yaml` at the project root adapts the pipeline without editing any plugin:

```yaml
post_pipeline_checks:
  - "./gradlew testDebugUnitTest"
  - "./gradlew lintDebug"

phase_command_overrides:
  qa: "./gradlew connectedDebugAndroidTest"

convention_skills_extra:
  - "local:our-compose-conventions"

skip_phases:
  - security        # internal hotfix branches

extra_phase_prompts:
  development: "Follow our internal module-structure.md"

extensions:                       # Project Extension Manifest — per-agent Skill mapping
  skills:
    - skill: "superpowers:test-driven-development"
      agents: [android-developer]   # list of agent names, or "all"
      when: "before writing production code"
      policy: mandatory             # mandatory | recommended (default)
```

### Project Extension Manifest (`extensions:`)

Extend the SDLC process **without editing any plugin**. The `extensions.skills` array maps
fully-qualified Skill ids (`<plugin>:<skill>`) to the agents that should invoke them:

- **Pipeline agents** (BA / Dev / QA / Security / Docs and their platform overrides) get matching
  rows injected into their phase prompt by the orchestrator (Step 3b-1a). `policy: mandatory` means
  the agent must invoke it; `recommended` (the default) means consider it.
- **On-demand agents** that bypass the orchestrator (debugger / devops / cicd / aar) self-read their
  matching rows from `sdlc.local.yaml` at use-time.
- `agents: "all"` targets every agent. An extension skill whose plugin is not installed is
  automatically downgraded to best-effort `recommended` — a missing optional skill never blocks a run.

Run **`/sdlc:extension`** to author these mappings step-by-step (it discovers installed agents/skills,
validates your picks, and merges idempotently), or **`/sdlc:extension --list`** to review the current
rows. Commands and hooks need no manifest: project `.claude/commands/` and `.claude/settings.json`
hooks load natively, and `post_pipeline_checks` / `phase_command_overrides` above cover phase-bound
commands.

---

## Adding a New Stack Plugin

Contract for a new platform provider:

```
plugins/your-platform-plugin/
├── .claude-plugin/
│   └── plugin.json          # { "name": "...", "dependencies": ["sdlc"] }
├── manifest.yaml            # kind: foundation — stack, priority, aspects, detect, workflow, …
├── agents/
│   └── your-agent.md        # frontmatter: name, model, effort, color, tools
├── workflows/               # optional: platform-specific recipes
│   └── your-feature.yaml
├── skills/
│   └── your-conventions/SKILL.md
└── README.md
```

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
agents_per_phase:
  business_analysis: android-ba
  development: android-developer
  review: android-reviewer
  security: android-security
  test: android-tester
  qa: android-qa
  documentation: android-docs
```

## Adding a Framework Plugin

A framework plugin is **additive** — it enriches an aspect's phases and ships **no agents**:

```
plugins/your-framework-plugin/
├── .claude-plugin/
│   └── plugin.json          # { "name": "...", "dependencies": ["sdlc"] }  ← no sibling-plugin dep
├── manifest.yaml            # kind: framework — stack, enriches_aspect, dependency, phase_injections
├── skills/
│   └── your-conventions/SKILL.md   # library-specific idioms; defer to the aspect's conventions, don't restate
├── rules/snippets/          # optional: ProGuard/R8 keep rules for the library
└── README.md
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
> so each plugin stays trivial, the platform-specific "where to look" lives in the foundation (core stays
> agnostic), and the matching mechanics live once in the core. `dependency` may be a list (matches if any
> coordinate is found). A hand-written `detect:` block remains available as an escape hatch for frameworks
> not identified by a single Maven coordinate.

> Framework manifests (`kind: framework`) **must not** declare `agents_per_phase`, `workflow`, `hosts_aspects`, or `framework_detection` — the schema and the orchestrator both reject it. `retrofit-plugin` is the reference implementation.

### Schema validation

```bash
# manifest.yaml (foundation + framework — same schema)
npx check-jsonschema --schemafile schemas/manifest.schema.json plugins/*/manifest.yaml
# workflow recipe
npx check-jsonschema --schemafile schemas/workflow.schema.json workflows/your-feature.yaml
```

---

## Installation (step-by-step)

### 1. Add the marketplace

```bash
/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin
# or for local development:
/plugin marketplace add /path/to/Agentic-SDLC-Plugin
```

### 2. Install Android Foundation (+ optional frameworks)

```bash
# Core (sdlc) installs automatically as a dependency
/plugin install android-foundation@agentic-sdlc
# Optional: framework plugins auto-activate when their library is detected
/plugin install retrofit-plugin@agentic-sdlc
```

### 3. Optional dependencies

```bash
/plugin marketplace add obra/superpowers
/plugin install superpowers@superpowers-marketplace

/plugin marketplace add anthropics/claude-plugins-official
/plugin install security-guidance@claude-plugins-official
```

### 4. Verify

```bash
/sdlc:doctor
# → Stack profiles: vanilla(0), android(300)
# → superpowers: ✅ installed
# → Android CLI: ⚠️ not found (optional — pipeline runs without it)

/sdlc:list-stacks
```

### 5. Run

```bash
/sdlc:start "Add a settings screen with a dark-mode toggle"
# → Detects android, auto-selects android-feature, runs the DAG, creates a PR
```

---

## Requirements

- Claude Code (latest).
- API Tier 2+ or Claude Max — a medium feature uses a large token volume; lower tiers may be throttled.
- A Git repository for `android-docs` / `document-writer` (PR creation).
- **Android:** JDK + Gradle wrapper. Builds (`assembleDebug`) and instrumented tests are CI-deferred; in-pipeline verification is detekt + JVM unit tests + Kotlin compile-check.

---

## License

MIT — see [`LICENSE`](LICENSE)
