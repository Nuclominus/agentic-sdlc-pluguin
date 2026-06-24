# Agentic SDLC Plugin — Architecture (Android)

> A Claude Code plugin marketplace for an AI-assisted SDLC targeting **Android** (Kotlin + Gradle).
>
> **Principle:** The core owns the pipeline and does not change. **Android Foundation** registers itself
> via a declarative `stack.md` profile and supplies the specialized agents/skills that drive the flow.
> **Framework plugins** (Retrofit, Room, Dagger/Hilt, …) attach **additively** via `framework.md`
> profiles — they enrich existing phases without owning any. The core reads the profiles and composes
> execution.
>
> The Stack Provider Pattern, orchestrator algorithm, aspect resolution, and cost model are inherited
> from upstream; everything is recast for Android and all web/server/iOS providers removed. See `NOTICE`.

---

## 1. Two patterns, one engine

```
┌─────────────────────────────────────────────────────────────┐
│                    sdlc (core plugin)                        │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  pipeline-orchestrator (skill) — DOES NOT CHANGE        │ │
│  │                                                         │ │
│  │  • detect profiles  (stack.md winner + framework.md set)│ │
│  │  • merge profiles   (winner agents + ADDITIVE injects)  │ │
│  │  • execute phases   (loops + parallel groups)           │ │
│  │  • dispatch agents_per_phase[phase] (from the winner)   │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ▲                                  │
│              reads stack.md / framework.md + workflows/      │
└────────────────────────────┼─────────────────────────────────┘
                             │
          ┌──────────────────┴───────────────────┐
   ┌──────▼────────────┐               ┌──────────▼───────────┐
   │ android-foundation │  enriched by  │ retrofit-plugin      │
   │ STACK PROVIDER     │  ◀──────────  │ FRAMEWORK PROVIDER   │
   │ stack.md           │  (additive)   │ framework.md         │
   │ aspect: android    │               │ additive: true       │
   │ priority: 300      │               │ aspects: []          │
   │ 11 agents (winner) │               │ skill + injections   │
   │ pinned house rules │               │ ProGuard · NO agents │
   └────────────────────┘               └──────────────────────┘
```

**Stack Provider (the foundation).** Places a `stack.md` at its root; declares `detect` rules,
`priority`, `aspects`, agents per phase, an optional default workflow, and convention skills. The
orchestrator picks the highest-priority profile **per aspect** whose `detect` succeeds and dispatches its
agents. Android Foundation is the only stack provider here; it wins the `android` aspect and drives every
phase.

**Framework Provider (additive).** Places a `framework.md` (same schema + `additive: true`) at its root.
It is **excluded** from per-aspect winner resolution and from PRIMARY_PROFILE selection, declares **no**
`agents_per_phase` and **no** `workflow`, and contributes only to the merge: convention skills,
`development`/`security` phase-prompt injections, ProGuard keep rules, and post-checks. It activates by
`detect` (the library on the classpath) and enriches the foundation's existing agents.

**What this marketplace explicitly does NOT do:**

- No web/server/iOS providers. Android only.
- No override mechanism. A plugin **adds itself**; it never edits the core.
- No per-framework agents or phases. Frameworks enrich; they never fan out a specialist or a gate.

---

## 2. File structure

```
Agentic-SDLC-Plugin/
├── .claude-plugin/
│   └── marketplace.json          ← sdlc + android-foundation + retrofit-plugin (+ 2 optional external)
├── schemas/
│   ├── plugin.schema.json
│   ├── stack.schema.json         ← aspects enum: android + generic web aspects; `additive` flag
│   └── workflow.schema.json
├── ARCHITECTURE.md               ← this file
│
├── plugins/                      (all flat peers)
│   ├── sdlc/                     ← CORE (platform-agnostic engine)
│   │   ├── stack.md              ← vanilla profile (priority 0)
│   │   ├── skills/pipeline-orchestrator/SKILL.md
│   │   ├── agents/               ← business-analyst, developer, qa-engineer, security-analyst, document-writer
│   │   ├── commands/             ← start, doctor, list-stacks, batch, security-init, init, extension
│   │   ├── workflows/            ← default, bugfix, hotfix, refactor, docs-only (+ RESOLVER)
│   │   └── hooks/                ← enforce-agent-model.sh (PreToolUse(Agent): pin declared model tier)
│   │
│   ├── android-foundation/       ← STACK PROVIDER — aspect android, priority 300 (the centerpiece)
│   │   ├── stack.md
│   │   ├── agents/               ← 11 specialized agents (android-ba, android-developer, …)
│   │   ├── skills/               ← android-architecture, android-compose-ui, android-data, android-navigation, manage-vault
│   │   ├── rules/                ← conventions + snippets (non-negotiable, proguard-keep, gradle-commands)
│   │   ├── workflows/            ← android-feature, android-bugfix
│   │   ├── vault/                ← Obsidian vault template + Node tooling
│   │   └── hooks/                ← kotlin-guard, format-on-stop, guard-paths, android-cli-check
│   │
│   └── retrofit-plugin/          ← FRAMEWORK PROVIDER — additive, no agents (reference implementation)
│       ├── framework.md          ← additive: true, detect on the retrofit coordinate
│       ├── skills/retrofit-conventions/SKILL.md
│       └── rules/snippets/retrofit-proguard.md
```

> **Key detail:** there is no `pipeline-orchestrator/` outside `sdlc`. Core files stay untouched. The
> foundation adds `stack.md` + agents + skills + rules + hooks; a framework adds `framework.md` + a skill
> (+ optional ProGuard snippet) and nothing else.

---

## 3. Profiles — the contract

Both `stack.md` and `framework.md` are markdown with YAML frontmatter validated by
`schemas/stack.schema.json`.

### 3.1. Vanilla profile (`plugins/sdlc/stack.md`)

```yaml
---
stack: vanilla
priority: 0
detect:
  any: ["*"]
---
```
Always matches; loses to any stack profile with a higher priority.

### 3.2. Android Foundation profile (`plugins/android-foundation/stack.md`)

```yaml
---
stack: android
priority: 300
aspects: [android]
workflow: android-feature
detect:
  all:
    - any:
        - file_exists: settings.gradle.kts
        - file_exists: settings.gradle
    - file_glob: "**/*.kt"        # a Gradle project that actually has Kotlin
---
```
Wins the `android` aspect, declares the agents-per-phase roster, the convention skills, and the
`development` / `qa` / `security` phase injections (Compose-first, JVM-only tests, MASVS/MASTG). The stack
id stays `android` (config stability); only the plugin name is `android-foundation`.

### 3.3. Framework profile (`plugins/retrofit-plugin/framework.md`)

```yaml
---
stack: retrofit
additive: true
aspects: []
detect:
  any:
    - file_contains: { path: gradle/libs.versions.toml, pattern: "(?i)retrofit" }
---
```
Additive: contributes the `retrofit-conventions` skill plus development/security injections and a
ProGuard snippet. Declares no agents and no workflow (the schema and the orchestrator both reject those
for additive profiles).

### 3.4. Frontmatter spec

| Field | Type | Required | Description |
|---|---|---|---|
| `stack` | string | ✅ | Unique id (`android`, `retrofit`, `vanilla`). |
| `priority` | int | ✅ | 0 = always-match fallback; 300 = stack provider. Higher wins per aspect. Documentational for additive profiles. |
| `additive` | bool | — | `true` marks a framework provider: excluded from winner/PRIMARY resolution; must not declare `workflow` or agents. |
| `aspects` | array | — | Aspects the profile owns. `android` for the foundation; `[]` for additive frameworks. |
| `workflow` | string | — | Default recipe when this is the PRIMARY profile. Forbidden when `additive: true`. |
| `detect.any` / `detect.all` | array | ✅ | Detection rules. `["*"]` for vanilla. `file_exists` / `file_contains` / `file_glob`, nestable via `any`/`all`. |

---

## 4. Aspect resolution & the additive set

The upstream per-aspect winner resolution is kept (Step 0b). In this Android-only marketplace the
foundation simply wins the `android` aspect and becomes PRIMARY_PROFILE, so it drives every phase. The
new piece is the **additive set**:

- All matched profiles with `additive: true` are collected into `ADDITIVE_PROFILES` (Step 0b-frameworks),
  subject to the `frameworks.enable/disable` override in `.claude/sdlc.local.yaml`.
- They are excluded from aspect-winner and PRIMARY selection, and an additive profile that tries to
  declare agents-per-phase is a **HALT** error.
- Step 1a merges `ACTIVE_PROFILES.values() + PRIMARY_PROFILE + ADDITIVE_PROFILES`. The merge was already
  a union of `convention_skills`, `phase_prompts_injection` (per-phase concat), `extra_phases`, and
  `post_pipeline_checks` — additive profiles simply join it. This is the whole mechanism: ~one new
  collection bucket fed into an existing union.

---

## 5. Pipeline orchestrator (the one core skill)

`plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` is the heart of the system. Its algorithm:

```
Step 0a · External plugin dependency preflight (optional: superpowers, security-guidance)
Step 0b · Detect profiles via Glob of stack.md + framework.md
          · per-aspect winner resolution (stack profiles)
          · 0b-frameworks: resolve ADDITIVE_PROFILES (+ frameworks.enable/disable override)
Step 0c · Skip-rule analysis (cost optimization for trivial changes)
Step 1  · 1a Merge active profiles (winner + PRIMARY + ADDITIVE) → 1b project-local overrides → 1c phase order
Step 2  · Generate task slug, prepare workspace
Step 3  · Execute each phase: look up agent (winner/PRIMARY) → build prompt (base + injected + prior summary)
          → spawn agent → save COMPACT summary
Step 4  · Run post-pipeline checks
Step 5  · Telemetry + final summary (stack used, additive frameworks, phases, cost, PR link)
```

The orchestrator prints the active profiles verbatim, including an `additive:` line, so the user can
verify which frameworks activated.

---

## 6. Agents (cost-tiered)

The five core fallbacks live in `plugins/sdlc/agents/`; the Android roster lives in
`plugins/android-foundation/agents/`. Model/effort follow the "cost of mistakes" principle.

| Agent | Plugin | Model | Effort | Why |
|---|---|---|---|---|
| business-analyst | sdlc | opus | high | Requirements errors cascade through every phase. |
| developer | sdlc | sonnet | medium | Vanilla fallback (non-Android projects). |
| qa-engineer | sdlc | sonnet | medium | Clear criteria; hard 3-attempt cap. |
| security-analyst | sdlc | opus | high | Threat model; read-only. |
| document-writer | sdlc | haiku | low | Structured output from known facts. |
| **android-ba / android-developer / android-reviewer / android-security / android-tester / android-qa / android-docs** | android-foundation | opus→haiku | per role | The specialized roster that wins the `android` aspect (see the plugin README). |

Framework providers ship **no agents** — they enrich the prompts the agents above receive.

Model tier is enforced at dispatch by `plugins/sdlc/hooks/enforce-agent-model.sh` (a PreToolUse hook
that reads `model:` from the agent frontmatter and rewrites the Agent call).

---

## 7. Hooks

| Hook | Plugin | Event | Purpose |
|---|---|---|---|
| `enforce-agent-model.sh` | sdlc | PreToolUse(Agent) | Pin each agent to its declared model tier. |
| `kotlin-guard` → `validate-kotlin.sh` | android-foundation | PostToolUse(Edit\|Write) | Block non-negotiable patterns (`!!`, `runBlocking`, `println`, `Log.*`) in production Kotlin. |
| `format-on-stop.sh` | android-foundation | Stop | ktlint/detekt format. Fails open. |
| `guard-paths.sh` | android-foundation | PreToolUse(Edit\|Write) | Deny edits to `build/`, `.gradle/`. |
| `android-cli-check.sh` | android-foundation | SessionStart | Optional Android CLI advisory (non-blocking). |

---

## 8. Android constraints (by design)

| Constraint | Why | Handling |
|---|---|---|
| **Builds can't run in-pipeline** | `assembleDebug` needs the full SDK | Verification = detekt + JVM unit tests + Kotlin compile-check; real builds in CI. |
| **Instrumented tests are CI-only** | `connectedAndroidTest` needs an emulator/device | Unit tests (JVM) in-pipeline; Compose UI Test / Maestro in CI. |
| **Security model is mobile** | MASVS/MASTG, not OWASP web | `android-security` runs a full MASVS/MASTG audit; framework providers add MASVS-NETWORK (e.g. retrofit TLS/pinning). |
| **Library guidance is detected, not imposed** | projects swap Retrofit/Room/Hilt | Detect-don't-impose libraries live in framework plugins; pinned house rules (Coil, Kermit, KSP, …) stay in the foundation. |

---

## 9. Practical usage

```bash
# Install
/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin
/plugin install android-foundation@agentic-sdlc     # pulls sdlc core as a dependency
/plugin install retrofit-plugin@agentic-sdlc        # optional; auto-activates when Retrofit is detected

# Status
/sdlc:doctor            # preflight + host-capability report + active frameworks
/sdlc:list-stacks       # 🎯 android (settings.gradle[.kts] + *.kt) · ➕ retrofit (additive)

# Run
/sdlc:start "Add a settings screen with dark-mode toggle"
# → Detected: android → android-developer (Sonnet) for development; retrofit additive (if present)
# → BA (Opus) → Dev → Review(⇄Dev) → [Security ‖ Test] → QA → Docs
# → Post-pipeline: detekt + testDebugUnitTest + compileDebugKotlin
```

Toggle frameworks per project in `.claude/sdlc.local.yaml`:

```yaml
frameworks:
  enable: [retrofit]    # force-on even if detection missed it
  disable: [dagger]     # suppress even if detected
```

---

## 10. Adding a provider (no core changes)

**A stack provider** (e.g. a future KMP foundation) ships `stack.md` (stack, priority, aspects, detect,
workflow) + agents + skills + hooks. On the next `/sdlc:start`, the orchestrator finds it via Glob,
evaluates `detect`, and dispatches its agents.

**A framework provider** ships `framework.md` (`additive: true`, `aspects: []`, detect on the library) +
a convention skill (+ optional ProGuard snippet) and **no agents**. It auto-activates when its library is
detected and enriches the foundation's phases. `retrofit-plugin` is the reference; `room-plugin` and
`dagger-plugin` follow the same shape.

---

## 11. Status & next steps

- **Core (`sdlc`)** — functional; additive-profile support added (ADDITIVE_PROFILES, merge, guard, print).
- **android-foundation** — complete: 11 agents, four convention skills + `manage-vault`, MASVS security,
  rules, hooks, vault lifecycle; carries the pinned house rules.
- **retrofit-plugin** — reference framework provider (Phase 2): `framework.md`, `retrofit-conventions`
  skill, extracted Retrofit/OkHttp ProGuard keeps.
- **Next (Phase 3):** `room-plugin`, `dagger-plugin` (resolving the Hilt/Koin "detect, don't impose"
  choice), then further frameworks.
