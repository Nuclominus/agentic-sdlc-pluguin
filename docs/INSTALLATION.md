# 📦 Installation & Requirements

The [Quickstart](../README.md#quickstart) covers the fast path. This page is the full step-by-step
install, optional dependencies, and requirements.

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

## Requirements

- Claude Code (latest).
- API Tier 2+ or Claude Max — a medium feature uses a large token volume; lower tiers may be throttled.
- A Git repository for `android-docs` / `document-writer` (PR creation).
- **Android:** JDK + Gradle wrapper. Builds (`assembleDebug`) and instrumented tests are CI-deferred; in-pipeline verification is detekt + JVM unit tests + Kotlin compile-check.
