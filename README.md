# SDLC Marketplace for Claude Code — Native Mobile

AI-assisted SDLC pipelines for **native mobile** development, built on the **Stack Provider Pattern**: a single platform-agnostic core orchestrator runs the pipeline; platform plugins register themselves via declarative `stack.md` profiles. No core overrides, no slot registries, no copy-paste between platforms.

**v0.1.1** — 3 plugins: 1 platform-agnostic core + a full **Android (Kotlin)** stack provider + an **iOS (Swift)** skeleton. Cost-optimized: model tiering + `effort` per-subagent. Generic control flow (review-loops, parallel groups), workflow discovery across plugins, precise `file_glob` detection, and guaranteed per-agent model enforcement.

> Adapted from [AratKruglik/claude-sdlc](https://github.com/AratKruglik/claude-sdlc) (MIT) — stripped to native mobile and re-oriented around the `android` / `ios` aspect axis. See `NOTICE`.

---

## Quickstart

```bash
# 1. Add the marketplace
/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin

# 2. Install the stack plugin you need (sdlc core is installed automatically as a dependency)
/plugin install android-plugin@agentic-sdlc      # Android (Kotlin + Gradle)
/plugin install ios-plugin@agentic-sdlc          # iOS (Swift/SwiftUI) — skeleton

# 3. Verify
/sdlc:doctor
/sdlc:list-stacks

# 4. Run
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
│  │  • detect stack profiles   (file_glob / nested any-all) │ │
│  │  • resolve workflow recipe (discovered across plugins)  │ │
│  │  • execute phases          (loops + parallel groups)    │ │
│  │  • dispatch agents_per_phase[phase] (per aspect)        │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ▲                                  │
│                            │ reads stack.md + workflows/      │
└────────────────────────────┼─────────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
       ┌────▼─────┐                       ┌────▼─────┐
       │ android  │                       │   ios    │
       │ plugin   │                       │  plugin  │
       │ stack.md │                       │ stack.md │
       │ 11 agents│                       │ skeleton │
       └──────────┘                       └──────────┘
```

**Key principles:**

1. **Core never changes.** Pipeline logic lives exclusively in `pipeline-orchestrator/SKILL.md`. It has zero knowledge of any platform, security standard, or workflow recipe.
2. **Plugins register themselves** via `stack.md` frontmatter — they declare auto-detection rules, priority, agents per phase, an optional default workflow, and convention skills.
3. **Per-aspect dispatch.** A project can have multiple aspects (`android` + `ios`). Each aspect gets its own specialist; `development` and `qa` fan out per aspect.
4. **Priority wins.** When multiple profiles match, the highest priority takes over.
5. **Everything is discovered, not hardcoded.** Profiles (`**/stack.md`), workflows (`**/workflows/*.yaml`), and runtime dependencies (`**/runtime-dependencies.json`) are globbed across all installed plugins.

### Stack Priority Table

| Priority | Plugin           | Aspects | Detect                                                              |
| -------- | ---------------- | ------- | ------------------------------------------------------------------- |
| 0        | `vanilla` (sdlc) | —       | `*` (always matches)                                                |
| 300      | `android-plugin` | android | `(settings.gradle.kts OR settings.gradle)` **AND** `**/*.kt`        |
| 300      | `ios-plugin`     | ios     | `**/*.xcodeproj` OR `**/*.xcworkspace` OR `Package.swift`            |

### Detection rules

A profile's `detect` block supports four rule types, freely nestable via `any` / `all`:

| Rule | Matches when |
| ---- | ------------ |
| `file_exists: <path>` | the file exists |
| `file_contains: { path, pattern }` | the file matches the regex |
| `file_glob: <pattern>` | ≥1 file matches the glob (variable-named / nested artifacts — iOS Xcode projects, monorepo subtrees) |
| `any: [...]` / `all: [...]` | nested OR / AND (recursive) |

This is why app-only and monorepo layouts auto-detect with **no `--stack=` flag**.

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

The agent assigned to each phase (and the on-demand agents) is documented in [`plugins/android-plugin/README.md`](plugins/android-plugin/README.md#agent-roster).

### Per-aspect dispatch (monorepo)

For a monorepo with an Android module and an iOS module, both profiles match. `development` and `qa` fan out per aspect (Android → the Android development agent, iOS → the iOS one). One BA spec, one PR. Aspects dispatch in canonical order: `android → ios`.

---

## Commands

| Command                         | Purpose                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `/sdlc:init`                    | Detect platform(s), scaffold `.claude/sdlc.local.yaml`, optionally seed `CLAUDE.md` |
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
| `android-feature` | android-plugin | BA → Dev → Review(⇄Dev ×3) → [Security ‖ Test] → QA → Docs       |
| `android-bugfix`  | android-plugin | Dev → Review(⇄Dev ×3) → [Security ‖ Test] → QA                  |

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

1. **Orchestrator (Layer 1)** — Step 3b reads the agent's frontmatter, resolves the tier to a model ID, and passes it in the `Agent()` dispatch.
2. **PreToolUse hook (Layer 2)** — `plugins/sdlc/hooks/enforce-agent-model.sh` intercepts every `Agent` call, compares the requested model with the agent's declared `model:`, and corrects it via `updatedInput` if they differ.

**Tier → model ID:**

| Tier     | Model ID                    |
| -------- | --------------------------- |
| `opus`   | `claude-opus-4-8`           |
| `sonnet` | `claude-sonnet-4-6`         |
| `haiku`  | `claude-haiku-4-5-20251001` |

---

## Cost Optimization: model + effort

Cost is controlled exclusively through `model` + `effort` (Claude Code does not expose per-subagent `temperature`). The tier → model mapping is in [Model Enforcement](#model-enforcement) above; the **per-agent `model`/`effort` roster lives in each plugin's README** so it stays next to the agents it describes:

- core fallback agents → [`plugins/sdlc/README.md`](plugins/sdlc/README.md)
- Android roster → [`plugins/android-plugin/README.md`](plugins/android-plugin/README.md)
- iOS → [`plugins/ios-plugin/README.md`](plugins/ios-plugin/README.md)

> `effort: high` on Opus is the costliest combination — reserved for leverage agents (BA, Security) where reasoning quality affects every downstream phase.

**Levers:** skip-rules for trivial changes · QA 3-attempt hard cap · compact ≤2–3K-token handoffs · prompt caching (stable prefixes).

---

## Available Plugins

| Plugin           | Type           | Stack / Technology                                                        |
| ---------------- | -------------- | ------------------------------------------------------------------------- |
| `sdlc`           | Core           | Platform-agnostic orchestrator + 5 fallback agents                        |
| `android-plugin` | Stack provider | Native Android (Kotlin + Gradle) — 11-agent roster, MASVS, vault          |
| `ios-plugin`     | Stack provider | Native iOS (Swift/SwiftUI) — `ios-architect` + skeleton (Phase 4 TODOs)   |

### Optional external dependencies

| Plugin              | Source                               | Role                                                                                              |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `superpowers`       | `obra/superpowers`                   | Brainstorming for BA, TDD for QA, verification-before-completion for architects. Degrades gracefully. |
| `security-guidance` | `anthropics/claude-plugins-official` | Hooks-based in-session security review. The MASVS security phase runs fully without it.            |

### Optional system tools

| Tool | Role |
| ---- | ---- |
| **Android CLI** (Google's `android` binary) | Project scaffolding, emulator/device, SDK, docs, Studio bridge. `android-plugin` advises (non-blocking) if absent; no agent requires it. |

---

## Stack Composition Examples

| Project              | Profile(s)                | Development dispatch                              |
| -------------------- | ------------------------- | ------------------------------------------------- |
| Android app repo     | android (300)             | android-developer                                 |
| iOS app repo         | ios (300)                 | ios-architect                                     |
| Mobile monorepo      | android (300) + ios (300) | android-developer (android) + ios-architect (ios) |
| Unknown stack        | vanilla (0)               | developer (fallback)                              |

---

## Security: MASVS / MASTG

The core security phase is **platform-neutral** (secrets, auth, injection/input validation, data protection, access control, misconfiguration, vulnerable deps, logging) and applies the standard injected by the active profile as authoritative. On Android, `android-security` runs a full **MASVS/MASTG** audit — see [`plugins/android-plugin/README.md`](plugins/android-plugin/README.md#security--masvs--mastg).

---

## Optional Obsidian Vault

Agents use a project's `.obsidian-vault/` as the single source of knowledge **when present**, falling back to the codebase + `docs/plans/` when absent. The Android `manage-vault` skill owns the vault lifecycle (scaffold → repair → STUB-aware (re)populate → archive) — see [`plugins/android-plugin/README.md`](plugins/android-plugin/README.md#optional-obsidian-vault--manage-vault).

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
```

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
aspects: [android, shared]
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

### Schema validation

```bash
# stack.md frontmatter
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

### 2. Install core + platform plugin

```bash
# Core (sdlc) installs automatically as a dependency
/plugin install android-plugin@agentic-sdlc
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
- **Android:** JDK + Gradle wrapper. **iOS:** macOS + Xcode for lint/build (otherwise verification is review-only, builds CI-deferred).

---

## License

MIT — see [`LICENSE`](LICENSE)
