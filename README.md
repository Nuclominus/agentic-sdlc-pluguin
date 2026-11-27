<p align="center">
  <img src="docs/assets/banner.svg" alt="Agentic SDLC for Android — a multi-agent development pipeline for Claude Code" width="100%">
</p>

<p>
  <a href="https://github.com/Nuclominus/agentic-sdlc-pluguin/releases/latest"><img src="https://img.shields.io/github/v/release/Nuclominus/agentic-sdlc-pluguin?label=release&color=3ddc84" alt="Latest release"></a>
  <a href="https://github.com/Nuclominus/agentic-sdlc-pluguin/actions/workflows/ci.yml"><img src="https://github.com/Nuclominus/agentic-sdlc-pluguin/actions/workflows/ci.yml/badge.svg?branch=develop" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-007ec6" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/agents-13-24292f" alt="13 agents">
  <img src="https://img.shields.io/badge/security-MASVS%20%2F%20MASTG-9a6700" alt="MASVS / MASTG security audit">
</p>

You describe a feature in plain language; a team of specialist agents takes it through
requirements, implementation, review, security audit and tests, then opens a pull request. One
core drives the pipeline; **Android Foundation** adds the platform knowledge on top.

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/pipeline-dark.svg">
  <img src="docs/assets/pipeline-light.svg" alt="Pipeline: analyze, then build and review in a loop of up to three rounds, then security and tests in parallel, then QA verification, then a pull request" width="100%">
</picture>

<p align="center"><sub>The default <code>android-feature</code> workflow. Recipes can add phases, parallel groups and review loops.</sub></p>

### Three layers, wired automatically

| Layer | Kind | What it brings |
| ----- | ---- | -------------- |
| **Embedded frameworks** | `framework` | Retrofit · Ktor · Room · Proto DataStore · Dagger/Hilt · Koin · WorkManager — each turns on only when your Gradle build uses it |
| **`android-foundation`** | `foundation` | Android expertise for 11 roles: conventions, review and test playbooks, MASVS audit, house rules, 21 skills |
| **`sdlc`** | core | The pipeline orchestrator and all 13 agents. Knows the process, nothing about any platform |

Everything is discovered by glob — manifests, workflows, dependencies. Full contract →
[`docs/WORKFLOW.md`](docs/WORKFLOW.md)

## Quickstart

```bash
# Add the marketplace — pinned to the stable release channel
/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin@release

# Install Android Foundation (the sdlc core installs as a dependency)
/plugin install android-foundation@agentic-sdlc

# Verify
/sdlc:doctor
/sdlc:list-stacks

# Run
/sdlc:start "Add a settings screen with a dark-mode toggle"
```

`@release` pins installs and updates to the stable `release` branch; omit it to track `develop`.
Step-by-step guide, optional dependencies and upgrading an existing install →
[`docs/INSTALLATION.md`](docs/INSTALLATION.md)

## Commands

| Command | Purpose |
| ------- | ------- |
| `/sdlc:start "feature"` | Run the pipeline; `--brief=docs/briefs/<slug>.md` starts from a written brief |
| `/sdlc:brief ["idea"]` | Interview you and write a task brief |
| `/sdlc:ask-me "question"` | Sourced answers about the project, read-only |
| `/sdlc:batch "t1" "t2"` | Parallel pipelines in isolated worktrees |
| `/sdlc:init` | Detect the stack, scaffold `.sdlc/sdlc.local.yaml` |
| `/sdlc:extension [--list]` | Author the Project Extension Manifest |
| `/sdlc:report` | Cost rollup across all runs (deterministic, no LLM) |
| `/sdlc:aar` | After Action Review of the last run |
| `/sdlc:doctor` | Preflight: dependencies, skills, detection, config migration |
| `/sdlc:list-stacks` | Detected stack profiles and priorities |
| `/sdlc:security-init` | Materialize security patterns |

## Plugins

| Plugin | Type | What it brings |
| ------ | ---- | -------------- |
| `sdlc` | Core | Orchestrator + the 13-agent roster |
| `android-foundation` | Stack provider | Android expertise, MASVS / MASTG audit, Obsidian vault support, 7 embedded frameworks |

**Optional:** `superpowers` and `security-guidance` from `claude-plugins-official`, and Google's
Android CLI skills. Everything degrades gracefully without them →
[`docs/INSTALLATION.md`](docs/INSTALLATION.md#3-optional-dependencies)

Security and the optional project vault are covered in
[`plugins/android-foundation/README.md`](plugins/android-foundation/README.md).

## Documentation

[Walkthrough](docs/WALKTHROUGH.md) · [Workflow recipes](docs/RECIPES.md) ·
[Cost & models](docs/COST-AND-MODELS.md) · [Configuration](docs/CONFIGURATION.md) ·
[Installation & upgrading](docs/INSTALLATION.md) · [Changelog](CHANGELOG.md)

This repo's own architecture, decisions and per-PR history live in the [`.brain/`](.brain/README.md)
Obsidian vault.

## Contributing

Add a foundation or framework plugin with [`CONTRIBUTING.md`](CONTRIBUTING.md) or the
`sdlc:create-pluguin` wizard. Requires Claude Code (latest), API Tier 2+ or Claude Max, a Git
repo, and a JDK + Gradle wrapper for Android projects. MIT licensed — see [`LICENSE`](LICENSE).
