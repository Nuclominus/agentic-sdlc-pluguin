# Agentic SDLC Plugin — Architecture (Native Mobile)

> A Claude Code plugin marketplace for an AI-assisted SDLC targeting **native mobile**: Android (Kotlin + Gradle) and iOS (Swift/SwiftUI).
>
> **Principle:** The core owns the pipeline and does not change. Platform plugins **register themselves** via a declarative `stack.md` profile and supply specialized agents/skills. The core reads the profiles and composes execution.
>
> іThe Stack Provider Pattern, orchestrator algorithm, aspect resolution, and cost model are kept; everything is recast for native mobile and all web/server providers removed. See `NOTICE`.

---

## 1. Key Concept: Stack Provider Pattern

```
┌─────────────────────────────────────────────────────────────┐
│                    sdlc (core plugin)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  pipeline-orchestrator (skill) — DOES NOT CHANGE     │  │
│  │                                                      │  │
│  │  Phase 1: BA          → core's business-analyst      │  │
│  │  Phase 2: Dev         → ⚡ DISPATCH to platform agent│  │
│  │  Phase 3: QA          → core's qa-engineer           │  │
│  │  Phase 4: Security     → core's security-analyst      │  │
│  │  Phase 5: Docs/PR     → core's document-writer       │  │
│  └──────────────────────────────────────────────────────┘  │
│                            ▲                                │
│                            │ reads stack.md profiles        │
└────────────────────────────┼────────────────────────────────┘
                             │
                ┌────────────┴────────────┐
                │                         │
         ┌──────▼───────┐         ┌──────▼───────┐
         │ android-     │         │ ios-         │
         │  plugin      │         │  plugin      │
         │              │         │              │
         │ stack.md     │         │ stack.md     │
         │  aspect:     │         │  aspect:     │
         │  android     │         │  ios         │
         │ android-     │         │ ios-         │
         │  architect   │         │  architect   │
         │ + skills     │         │ + skills     │
         │ + hooks      │         │ + hooks      │
         └──────────────┘         └──────────────┘
```

**Contract between core and platform plugin:**

1. The platform plugin places a `stack.md` file at the root of the plugin.
2. It provides agents with platform-specific specialization (`android-architect`, `ios-architect`).
3. The core orchestrator reads every `stack.md`, selects the highest-priority profile **per aspect** whose `detect` check succeeds, and dispatches to the correct agent for each phase.

**What this marketplace explicitly does NOT do:**

- No web/server providers. Native mobile only (Android/Kotlin, iOS/Swift).
- No override mechanism. A platform plugin **adds itself**; it never edits the core.
- No capability/domain plugins in v0.1. Anything cross-cutting lives in the platform plugin that uses it.

---

## 2. File Structure (as it exists in this repo)

```
Agentic-SDLC-Plugin/
├── .claude-plugin/
│   └── marketplace.json          ← 5 entries: 2 optional external + sdlc + android + ios
├── schemas/
│   ├── plugin.schema.json
│   ├── stack.schema.json         ← aspects enum includes android, ios, shared
│   └── workflow.schema.json
├── ARCHITECTURE.md               ← this file
├── CORE-TODO.md                  ← mobile retune tasks (file_glob, MASVS, CI-deferred builds)
├── NOTICE / LICENSE              ← MIT + attribution
│
├── plugins/
│   ├── sdlc/                     ← CORE (platform-agnostic, copied from upstream)
│   │   ├── .claude-plugin/plugin.json
│   │   ├── stack.md              ← vanilla profile (priority 0)
│   │   ├── skills/pipeline-orchestrator/SKILL.md
│   │   ├── agents/
│   │   │   ├── business-analyst.md   ← opus / high
│   │   │   ├── developer.md          ← sonnet / medium (vanilla fallback)
│   │   │   ├── qa-engineer.md        ← sonnet / medium (3-attempt cap)
│   │   │   ├── security-analyst.md   ← opus / high
│   │   │   └── document-writer.md    ← haiku / low
│   │   ├── commands/             ← start, doctor, list-stacks, batch, security-init
│   │   ├── workflows/            ← default, bugfix, hotfix, refactor, docs-only (+ RESOLVER)
│   │   └── hooks/
│   │       ├── hooks.json
│   │       └── enforce-agent-model.sh   ← PreToolUse(Agent): pin declared model tier
│   │
│   ├── android-plugin/           ← Android (Kotlin) provider — aspect android, priority 300
│   │   ├── .claude-plugin/plugin.json
│   │   ├── stack.md
│   │   ├── agents/                ← 11 specialized agents (android-ba, android-developer, …)
│   │   ├── skills/
│   │   │   ├── android-compose-ui/SKILL.md    ← convention skill
│   │   │   ├── android-architecture/SKILL.md  ← convention skill
│   │   │   ├── android-data/SKILL.md          ← convention skill
│   │   │   └── android-navigation/SKILL.md    ← convention skill
│   │   └── hooks/                ← format-on-stop (ktlint/detekt), guard-paths (build/, .gradle/)
│   │
│   └── ios-plugin/               ← iOS (Swift) provider — aspect ios, priority 300
│       ├── .claude-plugin/plugin.json
│       ├── stack.md
│       ├── agents/ios-architect.md            ← sonnet / medium
│       ├── skills/
│       │   ├── swiftui-ui/SKILL.md            ← (stub, Phase 4)
│       │   ├── ios-architecture/SKILL.md      ← (stub, Phase 4)
│       │   ├── ios-data/SKILL.md              ← (stub, Phase 4)
│       │   └── ios-navigation/SKILL.md        ← (stub, Phase 4)
│       └── hooks/                ← format-on-stop (swiftformat/swiftlint, macOS-only), guard-paths (Pods/, DerivedData/)
```

> **Key detail:** there is no `pipeline-orchestrator/` in the platform plugins. Core files stay untouched. Each platform plugin only adds `stack.md` + a specialized agent + convention skills + format/guard hooks.

---

## 3. Stack Profile — Contract Between Core and Platform

`stack.md` is markdown with YAML frontmatter. The orchestrator reads it.

### 3.1. Vanilla profile (`plugins/sdlc/stack.md`)

```yaml
---
stack: vanilla
priority: 0
detect:
  any: ["*"]
---
```
Always matches; loses to any platform profile with a higher priority.

### 3.2. Android profile (`plugins/android-plugin/stack.md`)

```yaml
---
stack: android
priority: 300
aspects: [android]
detect:
  any:
    - file_exists: settings.gradle.kts
    - file_exists: settings.gradle
---
```
Matches a Gradle project at the repo root. Because this marketplace ships no JVM-backend
providers, the only Gradle projects it encounters are Android. **Tightening to a Kotlin-AND
check, and matching an `androidApp/` subtree in a monorepo, requires `file_glob` in the
core — tracked in `CORE-TODO.md`.**

### 3.3. iOS profile (`plugins/ios-plugin/stack.md`)

```yaml
---
stack: ios
priority: 300
aspects: [ios]
detect:
  any:
    - file_exists: Package.swift
---
```
**Detection limitation (v0.1):** only SPM packages auto-detect. App-only Xcode projects
use a variable-named `*.xcodeproj` / `*.xcworkspace` with no exact path to match, so they
need `file_glob` (not yet supported). Until then force the profile with `/sdlc:start --stack=ios "..."`.

### 3.4. Frontmatter spec

| Field | Type | Required | Description |
|---|---|---|---|
| `stack` | string | ✅ | Unique name (`android`, `ios`, `vanilla`). |
| `priority` | int | ✅ | 0 = always-match fallback; 300 = platform provider. Higher wins per aspect. |
| `aspects` | array | — | Aspects this profile owns. `android` / `ios` (+ reserved `shared`). |
| `detect.any` / `detect.all` | array | ✅ | Detection rules. `["*"]` for vanilla. |
| `detect.*.file_exists` | string | — | Exact path that must exist at the project root. |
| `detect.*.file_contains` | object | — | `{path, pattern}` regex check. |

---

## 4. Platform-as-Aspect — Why Mobile Maps Cleanly

In the upstream (web) design, aspects were `backend`/`frontend`/`database`/...; a single
project could have several, each won by a different plugin. Here **the aspect IS the platform**:

- **Separate repos** (Android repo / iOS repo): one platform `detect` matches → single-aspect run, behaves like a single-stack project.
- **Monorepo** (`androidApp/` + `iosApp/`): both match → the `development` and `qa` phases **fan out per aspect** (android-architect *and* ios-architect). BA, security, and documentation stay aspect-agnostic, so requirements and the PR remain unified.

This is the same per-aspect winner resolution the orchestrator already implements (Step 0b);
mobile just populates it with `android` and `ios` instead of `backend`/`frontend`.

---

## 5. Pipeline Orchestrator (the one core skill)

`plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` is the heart of the system. Its 8-step
algorithm is kept verbatim from upstream (it is platform-agnostic):

```
Step 0a · External plugin dependency preflight (optional: superpowers, security-guidance)
Step 0b · Detect stack profile(s) via Glob of installed stack.md + per-aspect winner resolution
Step 0c · Skip-rule analysis (cost optimization for trivial changes)
Step 1  · Parse selected profile(s) + apply project-local overrides (.claude/sdlc.local.yaml)
Step 2  · Generate task slug, prepare workspace
Step 3  · Execute each phase: look up agent in profile → build prompt (base + injected + prior summary)
          → spawn agent → save COMPACT summary
Step 4  · Run post-pipeline checks
Step 5  · Telemetry + final summary (stack used, phases, cost, PR link)
```

**Mobile deltas to apply (tracked in `CORE-TODO.md`, not yet done):**
- `security` phase prompt: OWASP web Top 10 → **MASVS/MASTG** (insecure storage, Keychain/Keystore, cert pinning, deeplink validation, biometric step-up, secrets-in-binary).
- `qa` + post-pipeline: **builds are CI-deferred**; in-pipeline = lint + unit (JVM/SPM) + compile-check only.
- Step 0b: learn `file_glob` for iOS app-target and monorepo subtree detection.

---

## 6. Default Core Agents (cost-tiered)

All five live in `plugins/sdlc/agents/`. Model/effort follow the "cost of mistakes" principle.

| Agent | Plugin | Model | Effort | Tools (least-privilege) | Why |
|---|---|---|---|---|---|
| business-analyst | sdlc | opus | high | Read, Glob, Grep, WebSearch, WebFetch | Requirements errors cascade through 5 phases. |
| developer | sdlc | sonnet | medium | Read, Glob, Grep, Edit, Write, Bash | Vanilla fallback. |
| qa-engineer | sdlc | sonnet | medium | Read, Glob, Grep, Edit, Write, Bash | Clear criteria; hard 3-attempt cap. |
| security-analyst | sdlc | opus | high | Read, Glob, Grep, WebSearch | Mobile threat model; read-only. |
| document-writer | sdlc | haiku | low | Read, Glob, Grep, Bash, mcp__github__* | Structured output from known facts. |
| **android-architect** | android-plugin | sonnet | medium | Read, Glob, Grep, Edit, Write, Bash | Kotlin/Compose idioms via convention skills. |
| **ios-architect** | ios-plugin | sonnet | medium | Read, Glob, Grep, Edit, Write, Bash | Swift/SwiftUI idioms; host-aware verification. |

Model tier is enforced at dispatch by `plugins/sdlc/hooks/enforce-agent-model.sh` (a PreToolUse
hook that reads `model:` from the agent's frontmatter and rewrites the Agent call).

Cost discipline — compact handoffs, skip-rules, the QA iteration cap, and prompt-cache-friendly
stable frontmatter — is inherited from the upstream design.

---

## 7. Hooks

| Hook | Plugin | Event | Purpose |
|---|---|---|---|
| `enforce-agent-model.sh` | sdlc | PreToolUse(Agent) | Pin each agent to its declared model tier. |
| `format-on-stop.sh` | android-plugin | Stop | ktlint/detekt format. Fails open. |
| `guard-paths.sh` | android-plugin | PreToolUse(Edit\|Write) | Deny edits to `build/`, `.gradle/`, `*.iml`. |
| `format-on-stop.sh` | ios-plugin | Stop | swiftformat/swiftlint. **No-op off macOS.** |
| `guard-paths.sh` | ios-plugin | PreToolUse(Edit\|Write) | Deny edits to `Pods/`, `build/`, `DerivedData/`. |

---

## 8. Mobile-Specific Constraints (by design)

| Constraint | Why | Handling |
|---|---|---|
| **Builds can't run in-pipeline** | `assembleDebug` needs the full SDK; `xcodebuild` needs Xcode + simulator | Verification = lint + unit + compile-check; real builds in CI. |
| **iOS tooling is macOS-only** | swiftlint/swiftformat/xcodebuild absent on Linux/CI | ios-plugin detects host and degrades gracefully (hooks/post-checks no-op). |
| **iOS app-target detection needs glob** | `*.xcodeproj` has a variable name | `file_glob` is the top `CORE-TODO.md` item; SPM detects today, `--stack=ios` otherwise. |
| **`.pbxproj` mutation** | adding files to an app target edits project.pbxproj | Prefer SPM modules / folder references; flag unavoidable `.pbxproj` edits in DECISIONS. |
| **Security model differs from web** | mobile = MASVS/MASTG, not OWASP web | `security-analyst` + `security` phase to be retuned (CORE-TODO). |

---

## 9. Practical Usage

```bash
# Install (once published)
/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin
/plugin install android-plugin@agentic-sdlc        # pulls sdlc core as a dependency

# Status
/sdlc:doctor            # preflight + (planned) host-capability report
/sdlc:list-stacks       # 🎯 vanilla (always) · android (settings.gradle[.kts]) · ios (Package.swift)

# Run
/sdlc:start "Add a settings screen with dark-mode toggle"
# → Detected: android → android-architect (Sonnet) for development
# → BA (Opus) → Dev (android-architect) → QA (Sonnet) → Security (Opus) → Docs (Haiku)
# → Post-pipeline: detekt + testDebugUnitTest + compileDebugKotlin

# Force iOS on an app-only repo (until file_glob lands)
/sdlc:start --stack=ios "Add a profile screen"
```

---

## 10. How to Add a Platform (no core changes)

A future `shared` aspect (KMP) or a backend-for-frontend would slot in the same way:

```
<new>-plugin/
├── .claude-plugin/plugin.json     ← dependencies: sdlc
├── stack.md                        ← stack, priority, aspects, detect
├── agents/<new>-architect.md       ← model + effort + tools
├── skills/.../SKILL.md             ← convention skills
└── hooks/                          ← format-on-stop + guard-paths
```

On the next `/sdlc:start`, the orchestrator finds the new `stack.md` via Glob, evaluates its
`detect` rules, and dispatches the new architect for its aspect. No orchestrator rewrite.

---

## 11. Status & Next Steps

- **Core (`sdlc`)** — copied and functional; mobile retune pending (`CORE-TODO.md`).
- **android-plugin** — `stack.md`, hooks, agent frontmatter, and the four convention skills
  (`android-architecture`, `android-compose-ui`, `android-data`, `android-navigation`) complete.
  **ios-plugin** — `stack.md`, hooks, and agent frontmatter complete; convention skills and
  architect procedures are Phase 3/4 stubs.
- **Top priority:** add `file_glob` to the schema + orchestrator Step 0b (unblocks iOS app-target and monorepo detection).

The full staged development plan (Phases 0–7) accompanies this repo.
