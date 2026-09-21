# 📦 Installation & Requirements

The [Quickstart](../README.md#quickstart) covers the fast path. This page is the full step-by-step
install, optional dependencies, and requirements.

## Installation (step-by-step)

### 1. Add the marketplace

```bash
# Stable channel (recommended) — pinned to the `release` branch
/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin@release

# Bleeding edge — tracks the default branch (`develop`)
/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin

# or for local development:
/plugin marketplace add /path/to/Agentic-SDLC-Plugin
```

A marketplace added with a branch `ref` keeps following that branch: `/plugin marketplace update
agentic-sdlc` (and auto-updates) pull the latest commit of `release`, not of `develop`. The
`release` branch only moves when a release is cut (fast-forward from `develop`), so the stable
channel never sees work-in-progress.

### 2. Install Android Foundation

```bash
# Core (sdlc) installs automatically as a dependency
/plugin install android-foundation@agentic-sdlc
# Frameworks (Retrofit, Ktor, Room, Proto DataStore, Dagger/Hilt, Koin, WorkManager) are embedded
# (ADR-0026) and auto-activate when their library is detected — nothing extra to install.
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

## Updating an existing install

```bash
/plugin marketplace update agentic-sdlc   # pulls the latest commit of the branch you pinned
/sdlc:doctor                              # reports anything your config still names that no longer ships
```

`/sdlc:doctor` is the whole migration story. This marketplace ships **no runtime aliases** — a
renamed agent (ADR-0021) or a renamed Skill id (ADR-0026) is renamed once, and a config row naming
the old spelling silently targets nothing. Doctor lists every such row across
`.claude/sdlc.local.yaml` and `.claude/model.local.json` and rewrites it **only after you approve**;
it never edits `installed_plugins.json` or `settings.json`, which belong to the harness.

**Coming from `2.x`:** the seven framework plugins (`retrofit-plugin`, `ktor-plugin`, `room-plugin`,
`datastore-proto-plugin`, `dagger-plugin`, `koin-plugin`, `workmanager-plugin`) were merged into
`android-foundation` in `3.0.0` and no longer exist. Uninstall each one you still have
(`/plugin uninstall <name>@agentic-sdlc`) — a stale copy is reported as shadowed rather than used,
so it breaks nothing, but nothing needs it either. Their conventions now live in
`android-foundation` and activate on the same dependency detection as before. Full steps:
[README → Upgrading](../README.md).

---

## Requirements

- Claude Code (latest).
- API Tier 2+ or Claude Max — a medium feature uses a large token volume; lower tiers may be throttled.
- A Git repository for `document-writer` (PR creation).
- **Android:** JDK + Gradle wrapper. Builds (`assembleDebug`) and instrumented tests are CI-deferred; in-pipeline verification is detekt + JVM unit tests + Kotlin compile-check.
