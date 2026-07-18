# SDLC Marketplace for Claude Code — Android

AI-assisted SDLC pipelines for **Android** development, built on the **Stack Provider Pattern**: a single platform-agnostic core orchestrator runs the pipeline; **Android Foundation** registers itself via a declarative `manifest.yaml` (`kind: foundation`) and drives the flow; **framework plugins** (Retrofit, Room, Dagger/Hilt, …) attach **additively** via `manifest.yaml` (`kind: framework`). No core overrides, no slot registries, no copy-paste.

**v0.5.0** — a flat plugin set: 1 platform-agnostic core (`sdlc`) + the **Android Foundation** centerpiece + additive **framework plugins**. Cost-optimized (model tiering + per-subagent `effort`), with generic control flow (review-loops, parallel groups), cross-plugin workflow discovery, auto-detected framework enrichment, guaranteed per-agent model enforcement, `--resume` checkpoints, per-run HTML reports, a cross-run cost rollup, and an After Action Review learning cycle.

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

Full install, optional dependencies, and requirements → [`docs/INSTALLATION.md`](docs/INSTALLATION.md).

---

## Documentation

The README is the front door; each topic has a focused page under [`docs/`](docs/README.md).

| Topic | Page |
| ----- | ---- |
| **How the system works** — orchestration flow, Stack Provider Pattern, detection rules, pipeline phases, model tiers, artifacts | [`docs/WORKFLOW.md`](docs/WORKFLOW.md) |
| **End-to-end run** — a full Android pipeline, phase by phase | [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md) |
| **Workflow recipes** — built-in recipes, control-flow shapes, auto-selection, custom & project-local recipes | [`docs/RECIPES.md`](docs/RECIPES.md) |
| **Cost & models** — model-tier enforcement, `model`+`effort`, dry-run & caps, reports/rollup/AAR | [`docs/COST-AND-MODELS.md`](docs/COST-AND-MODELS.md) |
| **Configuration** — `.claude/sdlc.local.yaml` overrides + Project Extension Manifest | [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) |
| **Installation** — step-by-step install, optional deps, requirements | [`docs/INSTALLATION.md`](docs/INSTALLATION.md) |
| **Contributing** — authoring a foundation or framework plugin | [`CONTRIBUTING.md`](CONTRIBUTING.md) |

This repo's own architecture, decisions, per-PR changes, and roadmap live in the **Second Brain** Obsidian vault at [`.brain/`](.brain/) — the engineering source of truth for how the marketplace works and evolves (see [`.brain/README.md`](.brain/README.md)).

**In one paragraph:** the core `pipeline-orchestrator` skill never changes — it has zero knowledge of any platform, library, or security standard. The **foundation** registers itself via `manifest.yaml` (`kind: foundation`) and declares detection rules, priority, agents-per-phase, and a default workflow. **Framework plugins** attach additively (`kind: framework`): they enrich existing phases with a convention skill + prompt injections + ProGuard rules, ship **no agents**, and auto-detect from the Gradle build. Everything — manifests, workflows, dependencies — is *discovered by glob*, never hardcoded. See [`docs/WORKFLOW.md`](docs/WORKFLOW.md) for the diagrams and the full contract.

---

## Commands

| Command                         | Purpose                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `/sdlc:init`                    | Detect platform(s), scaffold `.claude/sdlc.local.yaml`, optionally seed `CLAUDE.md` |
| `/sdlc:extension [--list]`      | Author the Project Extension Manifest step-by-step (per-agent Skill mappings)       |
| `/sdlc:start "feature"`         | Run the pipeline (auto-selects the profile's workflow)             |
| `/sdlc:batch "task1" "task2"`   | Run pipelines in parallel for multiple tasks (isolated worktrees)  |
| `/sdlc:report`                  | Cross-run cost rollup over all runs → `docs/plans/rollup/index.html` + digest (deterministic, no LLM) |
| `/sdlc:aar`                     | After Action Review of a run — token cost + agent cooperation; persists approved lessons |
| `/sdlc:list-stacks`             | Show detected stack profiles and their priorities                  |
| `/sdlc:doctor`                  | Preflight: deps, stack detection, host capability (uname/toolchains), cost |
| `/sdlc:security-init`           | Materialize security-patterns for the security-guidance plugin     |

---

## Available Plugins

| Plugin               | Type               | Stack / Technology                                                    |
| -------------------- | ------------------ | --------------------------------------------------------------------- |
| `sdlc`               | Core               | Platform-agnostic orchestrator + 5 fallback agents                    |
| `android-foundation` | Stack provider     | Android (Kotlin + Gradle) — 11-agent roster, MASVS, vault, house rules |
| `retrofit-plugin`    | Framework provider | Retrofit/OkHttp — additive (skill + injections + ProGuard), no agents  |
| `room-plugin`        | Framework provider | Room persistence — additive (skill + injections + ProGuard), no agents |
| `dagger-plugin`      | Framework provider | Dagger/Hilt DI — additive (skill + injections + ProGuard), no agents   |
| `workmanager-plugin` | Framework provider | WorkManager background — additive (skill + injections + ProGuard), no agents |

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

## Security: MASVS / MASTG

The core security phase is **platform-neutral** and applies the standard injected by the active profile as authoritative. On Android, `android-security` runs a full **MASVS/MASTG** audit; active framework plugins concatenate their own checks (e.g. `retrofit-plugin` adds MASVS-NETWORK TLS/pinning). Details → [`plugins/android-foundation/README.md`](plugins/android-foundation/README.md#security--masvs--mastg).

## Optional Obsidian Vault

Agents use a project's `.obsidian-vault/` as the single source of knowledge **when present**, falling back to the codebase + `docs/plans/` when absent. The Android `manage-vault` skill owns the vault lifecycle → [`plugins/android-foundation/README.md`](plugins/android-foundation/README.md#optional-obsidian-vault--manage-vault).

---

## Requirements

Claude Code (latest) · API Tier 2+ or Claude Max · a Git repo (for PR creation) · Android: JDK + Gradle wrapper. Full details → [`docs/INSTALLATION.md`](docs/INSTALLATION.md#requirements).

## Contributing

Adding a foundation or framework plugin (directory shape, `manifest.yaml` examples, schema validation, local verification) is documented in [`CONTRIBUTING.md`](CONTRIBUTING.md). Fastest path: the `sdlc:create-pluguin` wizard.

## License

MIT — see [`LICENSE`](LICENSE)
