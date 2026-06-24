# Agentic SDLC Plugin — Architecture (Android)

> A Claude Code plugin marketplace for an AI-assisted SDLC targeting **Android** (Kotlin + Gradle).
>
> **Principle:** The core owns the pipeline and does not change. **Android Foundation** registers itself
> via a declarative `manifest.yaml` (`kind: foundation`) and supplies the specialized agents/skills that
> drive the flow. **Framework plugins** (Retrofit, Room, Dagger/Hilt, …) attach **additively** via
> `manifest.yaml` (`kind: framework`) — they enrich existing phases without owning any. The core reads the
> manifests and composes execution.
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
│  │  • pick the FOUNDATION  (kind: foundation winner)       │ │
│  │  • DELEGATE framework discovery → to the foundation     │ │
│  │  • merge profiles   (winner agents + ADDITIVE injects)  │ │
│  │  • execute phases   (loops + parallel groups)           │ │
│  │  • dispatch agents_per_phase[phase] (from the winner)   │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ▲                                  │
│        reads manifest.yaml (split by kind) + workflows/      │
└────────────────────────────┼─────────────────────────────────┘
                             │ picks a foundation
                             ▼
              ┌──────────────────────────────────┐
              │ android-foundation               │   LEVEL 2: FOUNDATION
              │ kind: foundation · manifest.yaml  │   owns aspect:android (platform)
              │ priority 300 · 11 agents (winner) │   hosts_aspects: [network,persistence,
              │ pinned house rules                │     di,ui,background,analytics,architecture]
              └────────────────┬─────────────────┘   framework_detection → RESOLVES frameworks
                               │ collects kind: framework where
                               │ enriches_aspect ∈ hosts_aspects (by category, never by name)
              ┌────────────────┼─────────────────┐         LEVEL 3: FRAMEWORKS
       ┌──────▼─────┐   ┌──────▼─────┐   ┌────────▼───┐     additive · NO agents
       │ retrofit-  │   │   room-    │   │  dagger-   │     enriches_aspect:
       │ plugin     │   │  plugin    │   │  plugin    │       network│persistence│di
       │ manifest.yaml│ │ manifest.yaml│ │ manifest.yaml│   dependency · skill · injections
       └────────────┘   └────────────┘   └────────────┘
        no deps between them · none depends on the foundation by name
```

**Stack Provider (the foundation).** Places a `manifest.yaml` (`kind: foundation`) at its root; declares
`detect` rules, `priority`, `aspects`, agents per phase, an optional default workflow, convention skills,
and — if it hosts libraries — a `framework_detection` block (where to look for framework coordinates). The
orchestrator picks the highest-priority profile **per aspect** whose `detect` succeeds, dispatches its
agents, **and then delegates framework discovery to it** (the core executes the foundation's declared
search; it never knows a library name or build system itself). Android Foundation is the only stack
provider here; it wins the `android` aspect, drives every phase, and resolves its own frameworks.

**Framework Provider (additive).** Places a `manifest.yaml` (`kind: framework`) at its root.
It is **excluded** from per-aspect winner resolution and from PRIMARY_PROFILE selection, declares **no**
`agents_per_phase` and **no** `workflow`, and contributes only to the merge: convention skills,
`development`/`security` phase-prompt injections, ProGuard keep rules, and post-checks. It names its
library via `dependency:` and points *up* at a functional category via `enriches_aspect:` (`network`,
`persistence`, `di`, …). The **foundation** whose `hosts_aspects` includes that category resolves it
(LEVEL 3 of the tree above): the foundation's `framework_detection` says where to look, the orchestrator
executes the search, and a match attaches the framework under that foundation. That category — not a named
sibling plugin — is its only contract: a framework declares **no** dependency on `android-foundation` (its
`plugin.json → dependencies` lists only `sdlc`), and is simply never considered if no winning foundation
hosts its category. So frameworks are true peers, swappable under
any provider of the aspect, with **no dependencies between them** and none on the foundation by name —
they never reference another plugin's skill id directly.

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
│   ├── manifest.schema.json      ← validates manifest.yaml (kind: foundation | framework)
│   └── workflow.schema.json
├── ARCHITECTURE.md               ← this file
│
├── plugins/                      (all flat peers)
│   ├── sdlc/                     ← CORE (platform-agnostic engine)
│   │   ├── manifest.yaml         ← vanilla profile (kind: foundation, priority 0)
│   │   ├── config/aspects.yaml   ← aspect vocabulary (platform + functional lists)
│   │   ├── skills/pipeline-orchestrator/SKILL.md
│   │   ├── agents/               ← business-analyst, developer, qa-engineer, security-analyst, document-writer
│   │   ├── commands/             ← start, doctor, list-stacks, batch, security-init, init, extension
│   │   ├── workflows/            ← default, bugfix, hotfix, refactor, docs-only (+ RESOLVER)
│   │   └── hooks/                ← enforce-agent-model.sh (PreToolUse(Agent): pin declared model tier)
│   │
│   ├── android-foundation/       ← STACK PROVIDER — aspect android, priority 300 (the centerpiece)
│   │   ├── manifest.yaml         ← kind: foundation
│   │   ├── agents/               ← 11 specialized agents (android-ba, android-developer, …)
│   │   ├── skills/               ← android-architecture, android-compose-ui, android-data, android-navigation, manage-vault
│   │   ├── rules/                ← conventions + snippets (non-negotiable, proguard-keep, gradle-commands)
│   │   ├── workflows/            ← android-feature, android-bugfix
│   │   ├── vault/                ← Obsidian vault template + Node tooling
│   │   └── hooks/                ← kotlin-guard, format-on-stop, guard-paths, android-cli-check
│   │
│   └── retrofit-plugin/          ← FRAMEWORK PROVIDER — additive, no agents (reference implementation)
│       ├── manifest.yaml         ← kind: framework, dependency on the retrofit coordinate
│       ├── skills/retrofit-conventions/SKILL.md
│       └── rules/snippets/retrofit-proguard.md
```

> **Key detail:** there is no `pipeline-orchestrator/` outside `sdlc`. Core files stay untouched. The
> foundation adds `manifest.yaml` (`kind: foundation`) + agents + skills + rules + hooks; a framework adds
> `manifest.yaml` (`kind: framework`) + a skill (+ optional ProGuard snippet) and nothing else.

---

## 3. Profiles — the contract

Both foundation and framework profiles are a single `manifest.yaml` (all-YAML, no frontmatter/markdown
body) distinguished by `kind:`, validated by `schemas/manifest.schema.json`.

### 3.1. Vanilla profile (`plugins/sdlc/manifest.yaml`)

```yaml
kind: foundation
stack: vanilla
priority: 0
detect:
  any: ["*"]
```
Always matches; loses to any foundation with a higher priority.

### 3.2. Android Foundation profile (`plugins/android-foundation/manifest.yaml`)

```yaml
kind: foundation
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
hosts_aspects: all               # accept every functional category
framework_detection:             # WHERE to look for a framework's coordinate — in order
  - gradle/libs.versions.toml
  - "**/build.gradle.kts"
  - "**/build.gradle"
```
Wins the `android` aspect (platform/winner axis), declares the agents-per-phase roster, the convention
skills, the `development` / `qa` / `security` phase injections (Compose-first, JVM-only tests, MASVS/MASTG),
and — via `hosts_aspects` + `framework_detection` — owns discovery of its frameworks (Retrofit→`network`,
Room→`persistence`, Dagger→`di`). The stack id stays `android` (config stability); only the plugin name is
`android-foundation`.

### 3.3. Framework profile (`plugins/retrofit-plugin/manifest.yaml`)

```yaml
kind: framework
stack: retrofit
priority: 150
enriches_aspect: network               # functional category; the foundation hosting it resolves me
dependency: com.squareup.retrofit2     # just name it; the foundation declares WHERE to look
```
Framework: contributes the `retrofit-conventions` skill plus development/security injections and a
ProGuard snippet. Declares no agents and no workflow (the schema and the orchestrator both reject those
for framework manifests). It ships **no detection rules** — it only names the dependency and the aspect it
enriches; the **foundation** that owns `android` declares where to look (version catalog first, then
module build files) and the orchestrator executes that search (see §4.1).

### 3.4. Manifest field spec

| Field | Type | Required | Description |
|---|---|---|---|
| `kind` | string | ✅ | `foundation` (stack provider) or `framework` (additive provider). Splits the manifest set on glob. |
| `stack` | string | ✅ | Unique id (`android`, `retrofit`, `vanilla`). |
| `priority` | int | ✅ | 0 = always-match fallback; 300 = foundation. Higher wins per aspect. Documentational for framework manifests. |
| `aspects` | array | — | **Platform/winner** aspects the profile owns (`[android]` for the foundation; omitted for frameworks). The axis for per-aspect winner resolution — NOT the library taxonomy. |
| `enriches_aspect` | string | — | Framework only. The **functional** category this framework decorates (`network`, `persistence`, `di`, `ui`, `background`, `analytics`, `architecture`) — points *up*, never names a plugin. Resolved by a foundation whose `hosts_aspects` includes it (§4.1). |
| `hosts_aspects` | array \| `all` | — | Foundation only. The **functional** categories this foundation accepts frameworks for (or the sugar `all`). A framework attaches when its `enriches_aspect` ∈ this list AND its `dependency` is found. |
| `framework_detection` | array | — | Foundation only. Ordered files/globs where the orchestrator searches for a framework's `dependency`, on this foundation's behalf. Pairs with `hosts_aspects`. |
| `workflow` | string | — | Foundation only. Default recipe when this is the PRIMARY profile. |
| `detect.any` / `detect.all` | array | ✳️ | Detection rules. `["*"]` for vanilla. `file_exists` / `file_contains` / `file_glob`, nestable via `any`/`all`. Required for foundations; optional for frameworks that use `dependency`. |
| `dependency` | string \| array | ✳️ | Framework only. The library coordinate(s) to detect (e.g. `com.squareup.retrofit2`). The plugin only names it; the foundation owning its aspect declares where to look and the orchestrator executes the search (§4.1). One of `detect` / `dependency` is required. |

---

## 4. Aspect resolution & the additive set

Per-aspect winner resolution runs first (Step 0b → 0b-aspects) over **foundations only** — the core globs
`manifest.yaml` and keeps `kind: foundation`, never `kind: framework`. In this Android-only marketplace the
foundation wins the `android` aspect and becomes PRIMARY_PROFILE, so it drives every phase. The **additive
set** is then resolved *under* the winning foundation:

- After the foundation winners are known, Step **0b-frameworks** asks each winning foundation to resolve
  its own libraries: it takes the `kind: framework` manifests, keeps those whose `enriches_aspect` is in
  that foundation's `hosts_aspects`, and detects each via the foundation's `framework_detection` search.
  Matches go into `ADDITIVE_PROFILES`, subject to the `frameworks.enable/disable` override in
  `.claude/sdlc.local.yaml`.
- A framework whose functional category no winning foundation hosts is never considered — **no hosting
  foundation ⇒ no frameworks**, structurally. A framework manifest that declares agents-per-phase (or a
  workflow, or `hosts_aspects`) is a **HALT** error.
- Step 1a merges `ACTIVE_PROFILES.values() + PRIMARY_PROFILE + ADDITIVE_PROFILES`. The merge was already
  a union of `convention_skills`, `phase_prompts_injection` (per-phase concat), `extra_phases`, and
  `post_pipeline_checks` — additive profiles simply join it.

### 4.1. Framework dependency detection — the foundation owns the search

A framework plugin does **not** ship detection rules. It only names the library via `dependency:` and the
functional category via `enriches_aspect:`. The **foundation** whose `hosts_aspects` includes that category
declares **where** to look (its `framework_detection` list); the orchestrator owns only the **matching
mechanics** and executes the search on the foundation's behalf. For each coordinate, walking the
foundation-declared locations in order and short-circuiting at the first match — for Android Foundation
that list is:

1. **Version catalog (authoritative)** — `gradle/libs.versions.toml`. If it names the coordinate → match;
   build files are never scanned.
2. **Module build files (fallback)** — `**/build.gradle.kts` / `**/build.gradle` (gitignore-aware) — for
   projects without a catalog or that declare the dependency directly in a module build file.

This keeps every framework plugin trivial (one line), the platform-specific "where to look" knowledge in
the **foundation** (so the core stays agnostic), and the matching mechanics in the core (so each foundation
stays declarative — no mini-orchestrator). A non-Gradle foundation just lists different locations.
A hand-written `detect:` block stays available as an escape hatch for frameworks not identified by a
single Maven coordinate.

---

## 5. Pipeline orchestrator (the one core skill)

`plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` is the heart of the system. Its algorithm:

```
Step 0a · External plugin dependency preflight (optional: superpowers, security-guidance)
Step 0b · Detect profiles via Glob of manifest.yaml (split by kind)
          · per-aspect winner resolution (kind: foundation)
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

**A stack provider** (e.g. a future KMP foundation) ships `manifest.yaml` (`kind: foundation` — stack,
priority, aspects, detect, workflow) + agents + skills + hooks. On the next `/sdlc:start`, the orchestrator
finds it via Glob, evaluates `detect`, and dispatches its agents.

**A framework provider** ships `manifest.yaml` (`kind: framework`, `enriches_aspect`, `dependency`) +
a convention skill (+ optional ProGuard snippet) and **no agents**. It auto-activates when its library is
detected and enriches the foundation's phases. `retrofit-plugin` is the reference; `room-plugin` and
`dagger-plugin` follow the same shape.

---

## 11. Status & next steps

- **Core (`sdlc`)** — functional; additive-profile support added (ADDITIVE_PROFILES, merge, guard, print).
- **android-foundation** — complete: 11 agents, four convention skills + `manage-vault`, MASVS security,
  rules, hooks, vault lifecycle; carries the pinned house rules.
- **retrofit-plugin** — reference framework provider (Phase 2): `manifest.yaml` (`kind: framework`),
  `retrofit-conventions` skill, extracted Retrofit/OkHttp ProGuard keeps.
- **Next (Phase 3):** `room-plugin`, `dagger-plugin` (resolving the Hilt/Koin "detect, don't impose"
  choice), then further frameworks.
