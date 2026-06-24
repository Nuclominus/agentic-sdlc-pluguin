# SDLC Marketplace for Claude Code — Android

AI-assisted SDLC pipelines for **Android** development, built on the **Stack Provider Pattern**: a single platform-agnostic core orchestrator runs the pipeline; **Android Foundation** registers itself via a declarative `stack.md` profile and drives the flow; **framework plugins** (Retrofit, Room, Dagger/Hilt, …) attach **additively** via `framework.md` profiles. No core overrides, no slot registries, no copy-paste.

**v0.5.0** — flat plugin set: 1 platform-agnostic core (`sdlc`) + the **Android Foundation** centerpiece (`android-foundation`) + additive **framework plugins** (`retrofit-plugin`, with more to follow). Cost-optimized: model tiering + `effort` per-subagent. Generic control flow (review-loops, parallel groups), workflow discovery across plugins, auto-detected framework enrichment, and guaranteed per-agent model enforcement.

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
│  │  • detect profiles         (stack.md + framework.md)    │ │
│  │  • resolve workflow recipe (discovered across plugins)  │ │
│  │  • merge active profiles   (stack winner + ADDITIVE set)│ │
│  │  • execute phases          (loops + parallel groups)    │ │
│  │  • dispatch agents_per_phase[phase] (from the winner)   │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ▲                                  │
│                  reads stack.md / framework.md + workflows/  │
└────────────────────────────┼─────────────────────────────────┘
                             │
            ┌────────────────┴───────────────────┐
       ┌────▼──────────┐                  ┌───────▼────────────┐
       │ android-      │   enriched by →  │ retrofit-plugin    │
       │ foundation    │                  │ framework.md       │
       │ stack.md      │   (additive)     │ additive: true     │
       │ 11 agents     │ ◀─────────────── │ skill + injections │
       │ (the winner)  │                  │ NO agents          │
       └───────────────┘                  └────────────────────┘
```

**Key principles:**

1. **Core never changes.** Pipeline logic lives exclusively in `pipeline-orchestrator/SKILL.md`. It has zero knowledge of any platform, library, security standard, or workflow recipe.
2. **The foundation registers itself** via `stack.md` frontmatter — it declares auto-detection rules, priority, agents per phase, an optional default workflow, and convention skills.
3. **Framework plugins attach additively** via `framework.md` (`additive: true`). They enrich existing phases (convention skill + dev/security injections + ProGuard) and ship **no agents** — they never win an aspect or own a phase. The orchestrator already merged matched profiles; additive ones join that merge.
4. **Priority wins.** When multiple stack profiles match, the highest priority takes over. Additive profiles do not compete.
5. **Everything is discovered, not hardcoded.** Profiles (`**/stack.md`, `**/framework.md`), workflows (`**/workflows/*.yaml`), and runtime dependencies (`**/runtime-dependencies.json`) are globbed across all installed plugins.

### Stack Priority Table

| Priority | Plugin              | Aspects | Detect                                                              |
| -------- | ------------------- | ------- | ------------------------------------------------------------------- |
| 0        | `vanilla` (sdlc)    | —       | `*` (always matches)                                                |
| 300      | `android-foundation`| android | `(settings.gradle.kts OR settings.gradle)` **AND** `**/*.kt`        |
| additive | `retrofit-plugin`   | —       | `libs.versions.toml` / `build.gradle*` contains `retrofit`          |

### Detection rules

A profile's `detect` block supports four rule types, freely nestable via `any` / `all`:

| Rule | Matches when |
| ---- | ------------ |
| `file_exists: <path>` | the file exists |
| `file_contains: { path, pattern }` | the file matches the regex |
| `file_glob: <pattern>` | ≥1 file matches the glob (variable-named / nested artifacts — module-level build files, monorepo subtrees) |
| `any: [...]` / `all: [...]` | nested OR / AND (recursive) |

This is why projects auto-detect with **no `--stack=` flag** — and why framework plugins activate automatically when their library appears in the build.

### Framework Provider Pattern (additive profiles)

A **framework plugin** ships a `framework.md` profile (same schema as `stack.md`, plus `additive: true`). Unlike a stack provider, it:

- **Owns no aspect and no agents.** It is excluded from per-aspect winner resolution and from PRIMARY_PROFILE selection — it cannot drive a phase.
- **Enriches existing phases.** It contributes a convention skill, `development` + `security` phase-prompt injections, ProGuard/R8 keep rules, and (optionally) post-checks — all merged into the run by the orchestrator's existing profile-merge.
- **Auto-detects** from the Gradle version catalog / build files; the foundation's `android-developer` and `android-security` consume its guidance only when the library is present.

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

`--workflow=NAME` > `.claude/sdlc.local.yaml active_workflow` > the PRIMARY profile's declared `workflow:` > `default`.

```bash
/sdlc:start "Add dark mode"                            # android profile → android-feature (auto)
/sdlc:start --workflow=docs-only "Update README"       # explicit override
```

### Custom recipes

Place a YAML file under any plugin's `workflows/` (or a project-local recipe). Names must be unique across the marketplace; core recipe names are reserved.

---

## Model Enforcement

Every agent declares its `model:` tier in frontmatter; the pipeline guarantees that tier is used regardless of the session default.

**Two enforcement layers:**

1. **Orchestrator (Layer 1)** — Step 3b reads the agent's frontmatter and passes the declared tier verbatim in the `Agent()` dispatch.
2. **PreToolUse hook (Layer 2)** — `plugins/sdlc/hooks/enforce-agent-model.sh` intercepts every `Agent` call, compares the requested model with the agent's declared `model:`, and corrects it via `updatedInput` if they differ.

> The `Agent` tool's `model` parameter accepts the **short tier name only** (`opus` / `sonnet` / `haiku` / `fable`). Passing a full model ID raises `InputValidationError`, so both layers enforce the tier verbatim. The tier → model-ID table below is used **only** for telemetry/cost accounting (orchestrator Step 3d-1), never for dispatch.

**Tier → model ID (telemetry/cost only):**

| Tier     | Model ID                    |
| -------- | --------------------------- |
| `opus`   | `claude-opus-4-8`           |
| `sonnet` | `claude-sonnet-4-6`         |
| `haiku`  | `claude-haiku-4-5-20251001` |

---

## Cost Optimization: model + effort

Cost is controlled exclusively through `model` + `effort` (Claude Code does not expose per-subagent `temperature`). The tier → model mapping is in [Model Enforcement](#model-enforcement) above; the **per-agent `model`/`effort` roster lives in each plugin's README** so it stays next to the agents it describes:

- core fallback agents → [`plugins/sdlc/README.md`](plugins/sdlc/README.md)
- Android roster → [`plugins/android-foundation/README.md`](plugins/android-foundation/README.md)
- framework providers ship no agents → [`plugins/retrofit-plugin/README.md`](plugins/retrofit-plugin/README.md)

> `effort: high` on Opus is the costliest combination — reserved for leverage agents (BA, Security) where reasoning quality affects every downstream phase.

**Levers:** skip-rules for trivial changes · QA 3-attempt hard cap · compact ≤2–3K-token handoffs · prompt caching (stable prefixes).

---

## Available Plugins

| Plugin               | Type               | Stack / Technology                                                    |
| -------------------- | ------------------ | --------------------------------------------------------------------- |
| `sdlc`               | Core               | Platform-agnostic orchestrator + 5 fallback agents                    |
| `android-foundation` | Stack provider     | Android (Kotlin + Gradle) — 11-agent roster, MASVS, vault, house rules |
| `retrofit-plugin`    | Framework provider | Retrofit/OkHttp — additive (skill + injections + ProGuard), no agents  |

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

| Project                      | Profile(s)                       | Development dispatch                          |
| ---------------------------- | -------------------------------- | --------------------------------------------- |
| Android app repo             | android (300)                    | android-developer                             |
| Android app + Retrofit       | android (300) + retrofit (add.)  | android-developer, enriched by retrofit       |
| Android app + Retrofit + Room| android (300) + retrofit + room  | android-developer, enriched by both           |
| Unknown stack                | vanilla (0)                      | developer (fallback)                          |

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
├── stack.md                 # frontmatter: stack, priority, aspects, detect, workflow
├── agents/
│   └── your-agent.md        # frontmatter: name, model, effort, color, tools
├── workflows/               # optional: platform-specific recipes
│   └── your-feature.yaml
├── skills/
│   └── your-conventions/SKILL.md
└── README.md
```

### `stack.md` example

```markdown
---
stack: kmp
priority: 350
aspects: [android]
workflow: android-feature
detect:
  all:
    - file_exists: settings.gradle.kts
    - file_glob: "**/commonMain/**/*.kt"
---

## Agents per phase
- business_analysis: android-ba
- development: android-developer
- review: android-reviewer
- security: android-security
- test: android-tester
- qa: android-qa
- documentation: android-docs
```

## Adding a Framework Plugin

A framework plugin is **additive** — it enriches the foundation's phases and ships **no agents**:

```
plugins/your-framework-plugin/
├── .claude-plugin/
│   └── plugin.json          # { "name": "...", "dependencies": ["sdlc", "android-foundation"] }
├── framework.md             # frontmatter: stack, additive: true, aspects: [], detect (on the library)
├── skills/
│   └── your-conventions/SKILL.md   # library-specific idioms; cross-link foundation skills, don't restate
├── rules/snippets/          # optional: ProGuard/R8 keep rules for the library
└── README.md
```

### `framework.md` example

```markdown
---
stack: room
additive: true
aspects: []
detect:
  any:
    - file_contains: { path: gradle/libs.versions.toml, pattern: "(?i)androidx\\.room" }
---

## Convention skills to apply
- room-plugin:room-conventions

## Phase prompts injection
For development phase, inject: "Room present: @Dao methods are suspend/Flow; …"
For security phase, inject: "Room: parameterize all @Query; no string concatenation; …"
```

> Additive profiles **must not** declare `## Agents per phase` or a `workflow` — the schema and the orchestrator both reject it. `retrofit-plugin` is the reference implementation.

### Schema validation

```bash
# stack.md / framework.md frontmatter (same schema)
npx check-jsonschema --schemafile schemas/stack.schema.json <(yq '.' <(sed -n '/^---$/,/^---$/p' stack.md | sed '1d;$d'))
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
