---
source: ARCHITECTURE.md
---

# Manifest & Aspects

> Migrated from `ARCHITECTURE.md`. See [[architecture/_moc-architecture]].

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
Wins the `android` aspect (platform/winner axis) and declares the per-role expertise
(`role_expertise` — invariants, rule paths and mandatory skills per CORE role; ADR-0021 moved both the
roster and its `agents_per_phase` binding to `plugins/sdlc/manifest.yaml`, and the Android
`phase_injections` became `role_expertise.<role>.invariants` in the same move), the convention skills,
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

## 8. Android constraints (by design)

| Constraint | Why | Handling |
|---|---|---|
| **Builds can't run in-pipeline** | `assembleDebug` needs the full SDK | Verification = detekt + JVM unit tests + Kotlin compile-check; real builds in CI. |
| **Instrumented tests are CI-only** | `connectedAndroidTest` needs an emulator/device | Unit tests (JVM) in-pipeline; Compose UI Test / Maestro in CI. |
| **Security model is mobile** | MASVS/MASTG, not OWASP web | `android-security` runs a full MASVS/MASTG audit; framework providers add MASVS-NETWORK (e.g. retrofit TLS/pinning). |
| **Library guidance is detected, not imposed** | projects swap Retrofit/Room/Hilt | Detect-don't-impose libraries live in framework plugins; pinned house rules (Coil, Kermit, KSP, …) stay in the foundation. |
