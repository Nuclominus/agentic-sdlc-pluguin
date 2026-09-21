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

Both live in the **official Anthropic marketplace** — this one does not redistribute them:

```bash
/plugin marketplace add anthropics/claude-plugins-official

# superpowers — brainstorming for BA, TDD for QA, verification-before-completion
# for architects. The pipeline degrades gracefully without it.
/plugin install superpowers@claude-plugins-official

# security-guidance — hooks-based in-session security review. The MASVS security
# phase runs fully without it.
/plugin install security-guidance@claude-plugins-official
```

The preflight resolves these **by plugin name, not by marketplace**, so any install counts. If you
want superpowers at obra's HEAD rather than the official marketplace's pinned commit, use its own
marketplace instead — note the name is `superpowers-dev`:

```bash
/plugin marketplace add obra/superpowers
/plugin install superpowers@superpowers-dev
```

### 4. Verify

```bash
/sdlc:doctor
# → Stack profiles: vanilla(0), android(300)
# → superpowers: ✅ available (superpowers@claude-plugins-official)
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

**Coming from an install made before `3.0.1`:** this marketplace used to re-declare `superpowers`
and `security-guidance` as entries of its own, so Claude Code cloned them into **our** namespace and
registered them as `superpowers@agentic-sdlc` / `security-guidance@agentic-sdlc` — a second copy of
a plugin we never authored, shadowing the one you installed yourself. Both entries are gone
(ADR-0028). **Install the replacement before uninstalling ours** — the other order leaves you with
no superpowers at all in between, and every `MANDATORY — invoke superpowers:*` row silently
downgrades to best-effort:

```bash
/plugin marketplace add anthropics/claude-plugins-official
/plugin install superpowers@claude-plugins-official     # 1. replacement FIRST
/sdlc:doctor                                            # 2. confirm ✅ available
/plugin marketplace update agentic-sdlc
/plugin uninstall superpowers@agentic-sdlc              # 3. only then remove ours
/plugin uninstall security-guidance@agentic-sdlc        #    (if still registered)
/sdlc:doctor                                            # 4. advisory should be gone
```

Nothing renames — `superpowers:brainstorming` is the same skill id from either marketplace — so no
`.claude/sdlc.local.yaml` row changes and there is no config migration to run. The official entry is
pinned to obra commit `b36e0829` (v6.3.0) while the old entry tracked HEAD, so you may step back one
minor version; every skill this marketplace declares exists at that pin.

---

## Requirements

- Claude Code (latest).
- API Tier 2+ or Claude Max — a medium feature uses a large token volume; lower tiers may be throttled.
- A Git repository for `document-writer` (PR creation).
- **Android:** JDK + Gradle wrapper. Builds (`assembleDebug`) and instrumented tests are CI-deferred; in-pipeline verification is detekt + JVM unit tests + Kotlin compile-check.
