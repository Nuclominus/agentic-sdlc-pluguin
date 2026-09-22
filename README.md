# SDLC Marketplace for Claude Code — Android

A collection of Claude Code plugins that run an AI-assisted development pipeline for **Android** projects. You describe a feature in plain language, and a team of specialized agents takes it through the full cycle: analyzing the requirements, writing the code, adding tests, running a security review, and opening a pull request.

Everything is built around one idea: a single core drives the pipeline, and a plugin adds the platform and library knowledge on top. **Android Foundation** teaches the pipeline how to build Android apps, and embeds its own additive framework support (Retrofit, Ktor, Room, Proto DataStore, Dagger/Hilt, Koin, WorkManager, and more) — each conditionally activates only when your project uses that library. You never wire anything by hand; the active frameworks are detected and combined for you.

---

## Quickstart

```bash
# 1. Add the marketplace — pinned to the stable release channel
/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin@release

# 2. Install Android Foundation (sdlc core installs automatically as a dependency)
/plugin install android-foundation@agentic-sdlc   # Android (Kotlin + Gradle) — the centerpiece

# 3. Frameworks (Retrofit, Ktor, Room, Proto DataStore, Dagger/Hilt, Koin, WorkManager) are
#    embedded in android-foundation and auto-activate when their library is detected — nothing
#    extra to install.

# 4. Verify
/sdlc:doctor
/sdlc:list-stacks

# 5. Run
/sdlc:start "Add a settings screen with a dark-mode toggle"
```

The `@release` suffix pins the marketplace to the stable `release` branch — installs and updates
follow it instead of the development branch. Omit the suffix to track `develop` (bleeding edge).

Full install, optional dependencies, and requirements → [`docs/INSTALLATION.md`](docs/INSTALLATION.md).

> **Upgrading from `2.x`?** `3.0.0` merged the seven additive framework plugins into
> `android-foundation`. `retrofit-plugin`, `ktor-plugin`, `room-plugin`, `datastore-proto-plugin`,
> `dagger-plugin`, `koin-plugin` and `workmanager-plugin` **no longer exist** — each is now a row in
> `android-foundation`'s `frameworks:` array, activating on the same `dependency` detection as
> before. Three steps:
>
> 1. **Update, then uninstall the seven.** `/plugin marketplace update agentic-sdlc`, then
>    `/plugin uninstall <name>@agentic-sdlc` for each one still registered. A stale copy does not
>    break a run — the resolver reports it as shadowed and prefers the foundation's own row — but it
>    is dead weight.
> 2. **Run `/sdlc:doctor`.** Skill ids moved into the `android-foundation:` namespace
>    (`retrofit-plugin:retrofit-conventions` → `android-foundation:retrofit-conventions`, and note
>    the divergent `dagger-plugin:hilt-conventions` → `android-foundation:hilt-conventions`). There
>    are **no runtime aliases**, so a `.sdlc/sdlc.local.yaml` row naming an old id targets nothing.
>    Doctor lists every stale id and rewrites it once you approve.
> 3. **Nothing else changes.** `stack` ids are untouched, so `additive_profiles` telemetry stays
>    comparable, and framework activation is still automatic — detected from your build files, with
>    no list to maintain.
>
> Details: [`CHANGELOG.md`](CHANGELOG.md#300--2026-09-21).

> **Installed `superpowers` or `security-guidance` from this marketplace?** They were never ours to
> ship. Earlier versions re-declared both as entries of `agentic-sdlc`, so Claude Code cloned them
> into our namespace as `superpowers@agentic-sdlc` / `security-guidance@agentic-sdlc`, shadowing the
> copy you installed yourself. Both entries are gone (ADR-0028). **Install the replacement first,
> uninstall ours second** — the other order leaves you with no superpowers in between:
>
> ```bash
> /plugin marketplace add anthropics/claude-plugins-official
> /plugin install superpowers@claude-plugins-official   # replacement FIRST
> /sdlc:doctor                                          # confirm ✅ available
> /plugin uninstall superpowers@agentic-sdlc            # only then remove ours
> /plugin uninstall security-guidance@agentic-sdlc      # if still registered
> ```
>
> Nothing renames: `superpowers:brainstorming` is the same id from either marketplace, so no config
> migration is needed. Full steps: [`docs/INSTALLATION.md`](docs/INSTALLATION.md#updating-an-existing-install).

> **Upgrading from `1.x`?** Do the `2.0.0` step first: it retired the eleven `android-*` agents in
> favour of a single platform-neutral roster, also with no runtime aliases. `/sdlc:doctor` migrates
> agent names and skill ids in the same pass, so one run covers both hops. Rename table:
> [`CHANGELOG.md`](CHANGELOG.md#200--2026-09-08).

---

## Documentation

The README is the front door; each topic has a focused page under [`docs/`](docs/README.md).

| Topic | Page |
| ----- | ---- |
| 🧩 **How the system works** — orchestration flow, Stack Provider Pattern, detection rules, pipeline phases, model tiers, artifacts | [`docs/WORKFLOW.md`](docs/WORKFLOW.md) |
| 🎬 **End-to-end run** — a full Android pipeline, phase by phase | [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md) |
| 🧭 **Workflow recipes** — built-in recipes, control-flow shapes, auto-selection, custom & project-local recipes | [`docs/RECIPES.md`](docs/RECIPES.md) |
| 💰 **Cost & models** — model-tier enforcement, `model`+`effort`, dry-run & caps, reports/rollup/AAR | [`docs/COST-AND-MODELS.md`](docs/COST-AND-MODELS.md) |
| ⚙️ **Configuration** — `.sdlc/sdlc.local.yaml` overrides + Project Extension Manifest | [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) |
| 📦 **Installation** — step-by-step install, optional deps, requirements | [`docs/INSTALLATION.md`](docs/INSTALLATION.md) |
| 🤝 **Contributing** — authoring a foundation or framework plugin | [`CONTRIBUTING.md`](CONTRIBUTING.md) |

This repo's own architecture, decisions, per-PR changes, and roadmap live in the **Second Brain** Obsidian vault at [`.brain/`](.brain/) — the engineering source of truth for how the marketplace works and evolves (see [`.brain/README.md`](.brain/README.md)).

**In one paragraph:** the core `pipeline-orchestrator` skill never changes — it has zero knowledge of any platform, library, or security standard. `sdlc` owns the **process**: the whole agent roster and the only phase→agent binding in the marketplace. A **foundation** (`kind: foundation`) owns the **expertise**: it registers detection rules, priority and a default workflow, and declares `role_expertise` per core role — invariants, rule paths and mandatory skills that the orchestrator pastes into the phase prompt. **Framework plugins** attach additively (`kind: framework`): they enrich existing phases with a convention skill + prompt injections + ProGuard rules and auto-detect from the Gradle build. No plugin but `sdlc` ships agents. Everything — manifests, workflows, dependencies — is *discovered by glob*, never hardcoded. See [`docs/WORKFLOW.md`](docs/WORKFLOW.md) for the diagrams and the full contract.

---

## Roadmap

What's next, in order:

| # | Next | What it means |
| - | ---- | ------------- |
| 1 | Check that every agent gets its platform knowledge | Agents are handed Android know-how at the start of each step. In one real run, one step never received it. |
| 2 | Prove the faster startup really is faster | Pipeline start-up was rewritten to be shorter. The first attempt to time it was spoiled, so it still has to be measured properly. |
| 3 | Find a better measure of context bloat | The current limit flags big tasks rather than wasteful ones, so it can't tell a real problem from an ordinary large feature. |
| 4 | Stop re-sending old attempts during review | When code goes back for another review round, every earlier attempt is sent again. Summarise them instead. |
| 5 | Pay start-up once for a batch of small fixes | Several small fixes can run together, but each still pays full set-up. On one run that overhead cost more than all the work itself. |

The full board — every track, status and landing PR — is generated from the vault roadmap into
[`roadmap/index.html`](roadmap/index.html); the table it reads is
[`.brain/planning/roadmap.md`](.brain/planning/roadmap.md).

---

## Commands

| Command                         | Purpose                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `/sdlc:init`                    | Detect platform(s), scaffold `.sdlc/sdlc.local.yaml`, optionally seed `CLAUDE.md` |
| `/sdlc:extension [--list]`      | Author the Project Extension Manifest step-by-step (per-agent Skill mappings)       |
| `/sdlc:start "feature"`         | Run the pipeline (auto-selects the profile's workflow)             |
| `/sdlc:batch "task1" "task2"`   | Run pipelines in parallel for multiple tasks (isolated worktrees)  |
| `/sdlc:report`                  | Cross-run cost rollup over all runs → `docs/plans/rollup/index.html` + digest (deterministic, no LLM) |
| `/sdlc:aar`                     | After Action Review of a run — token cost + agent cooperation; persists approved lessons |
| `/sdlc:list-stacks`             | Show detected stack profiles and their priorities                  |
| `/sdlc:doctor`                  | Preflight: deps, stack detection, host capability (uname/toolchains), cost. Also migrates config that names a retired agent — the one thing a `1.x` project needs after upgrading |
| `/sdlc:security-init`           | Materialize security-patterns for the security-guidance plugin     |

---

## Available Plugins

| Plugin               | Type               | Stack / Technology                                                    |
| -------------------- | ------------------ | --------------------------------------------------------------------- |
| `sdlc`               | Core               | Platform-agnostic orchestrator + the entire 12-agent roster            |
| `android-foundation` | Stack provider     | Android (Kotlin + Gradle) — expertise for 11 roles: 20 skills, MASVS, vault, house rules, **plus 7 embedded frameworks** (ADR-0026): Retrofit, Ktor, Room, Proto DataStore, Dagger/Hilt, Koin, WorkManager — each conditionally activates via its own `enriches_aspect`/`dependency` row in `manifest.yaml`'s `frameworks:` array, no separate install |

### Optional external dependencies

| Plugin              | Install                                               | Role                                                                                              |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `superpowers`       | `/plugin install superpowers@claude-plugins-official`     | Brainstorming for BA, TDD for QA, verification-before-completion for architects. Degrades gracefully. |
| `security-guidance` | `/plugin install security-guidance@claude-plugins-official` | Hooks-based in-session security review. The MASVS security phase runs fully without it.            |

Neither plugin is redistributed by this marketplace — add `anthropics/claude-plugins-official`
first, then install. The preflight resolves them **by plugin name, not by marketplace**, so an
install from any source counts (ADR-0028).

### Optional system tools

| Tool | Role |
| ---- | ---- |
| **Android CLI** (Google's `android` binary) | Project scaffolding, emulator/device, SDK, docs, Studio bridge. `android-foundation` advises (non-blocking) if absent; no agent requires it. |

---

## Security: MASVS / MASTG

The core security phase is **platform-neutral** and applies the standard injected by the active profile as authoritative. On Android, `security-analyst` runs a full **MASVS/MASTG** audit; active embedded frameworks concatenate their own checks (e.g. the `retrofit` row adds MASVS-NETWORK TLS/pinning). Details → [`plugins/android-foundation/README.md`](plugins/android-foundation/README.md#security--masvs--mastg).

## Optional Obsidian Vault

Agents use a project's `.obsidian-vault/` as the single source of knowledge **when present**, falling back to the codebase + `docs/plans/` when absent. The Android `manage-vault` skill owns the vault lifecycle → [`plugins/android-foundation/README.md`](plugins/android-foundation/README.md#optional-obsidian-vault--manage-vault).

---

## Requirements

Claude Code (latest) · API Tier 2+ or Claude Max · a Git repo (for PR creation) · Android: JDK + Gradle wrapper. Full details → [`docs/INSTALLATION.md`](docs/INSTALLATION.md#requirements).

## Contributing

Adding a foundation or framework plugin (directory shape, `manifest.yaml` examples, schema validation, local verification) is documented in [`CONTRIBUTING.md`](CONTRIBUTING.md). Fastest path: the `sdlc:create-pluguin` wizard.

## License

MIT — see [`LICENSE`](LICENSE)
