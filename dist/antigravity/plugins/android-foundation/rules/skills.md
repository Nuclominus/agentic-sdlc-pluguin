---
loaded_by: [developer, qa-engineer, business-analyst, reviewer, devops]
load_when: "Only when the optional Google `android` CLI is on PATH and a task calls for native tooling."
---

# Android CLI capability bindings (optional)

> **The mandatory/recommended skill matrix moved out of this file (ADR-0021.)** Per-role skills are
> now declared in `manifest.yaml` under `role_expertise.<role>.skills`; the resolver merges them with
> the project's `.claude/sdlc.local.yaml` `extensions.skills` rows and the orchestrator pastes one
> deduped list into each phase prompt. An on-demand agent gets the same list from
> `resolve/cli.mjs expertise --role <name>`. There is no self-read of a skills matrix any more, and
> no per-agent "Project Extensions" self-read either — both were replaced by that one command
> (ADR-0014/0015/0019). The **Architecture Detection** grep moved to the `android-architecture` skill.

What remains here is a binding this foundation owns entirely: Google's official `android` CLI
(https://developer.android.com/tools/agents/android-cli) mapped to the CORE roles that own each
capability. The CLI is **optional** — the pipeline runs without it. Its presence is advised at
SessionStart by `hooks/android-cli-check.sh` (Android projects only). When `android` is on PATH, the
listed roles MAY use the `android-cli` skill (installed by `android init`) for the capabilities
below; when it is absent, they fall back to their normal tools. The core orchestrator has zero
Android-CLI knowledge.

| Capability (`android …`) | Owner role(s) | Use when |
|--------------------------|---------------|----------|
| `create` (+ `create list`) | **developer** only | Scaffolding a new project from a template (or listing templates). The **business-analyst** may *plan* the scaffold but does not run `create` — actual creation is the developer's responsibility |
| `describe` | **business-analyst** / **developer** | Analyzing an existing project to generate descriptive metadata (structure, build targets, output artifacts) during analysis and implementation |
| `emulator *` (create/list/start/stop), `run`, `screen capture`, `screen resolve`, `layout` | **qa-engineer** | Managing virtual devices, deploying the APK, capturing/annotating screenshots, resolving annotated labels to `(x, y)` coordinates, and dumping the live UI layout (JSON) for E2E / UI verification |
| `sdk *` (install/list/remove/update), `studio version-lookup` | **devops** / **developer** | Managing SDK packages (channels: stable/beta/canary) and looking up the **latest versions of dependencies, Android platforms, and SDK tools** (e.g. Google Maven) during environment setup or build work |
| `docs search`, `docs fetch` (Android Knowledge Base, via `kb://` URLs) | **any role** (grounding) | Searching the Android Knowledge Base and fetching docs to ground answers before implementing or reviewing |
| `studio analyze-file`, `studio find-declaration`, `studio find-usages`, `studio open-file`, `studio render-compose-preview`, `studio check` | **developer** / **reviewer** | IDE-backed static analysis/inspections, semantic declaration/usage navigation, opening files in the editor, rendering Compose `@Preview` (optionally its semantics tree), and checking running Studio instances during implementation and review |
| `skills add`, `skills find`, `skills list`, `skills remove`, `init`, `update`, `info` | **devops** | Managing the CLI's own agent skills, initializing the environment (`init` installs the `android-cli` skill), updating the CLI, and locating the default SDK path during environment setup |

Notes:

- Capabilities are **advisory affordances**, not mandatory steps — a role uses them only when the
  task calls for native tooling and the CLI is present.
- Environment-setup capabilities (`init` / `update` / `info` / `skills *`) are owned by **devops** —
  there is no dedicated "setup" role; setup is a devops responsibility.
- **qa-engineer** may also drop down to native **`adb`** directly (`adb devices`, `adb install`,
  `adb shell input`, `adb shell am start`, `adb logcat`, `adb shell screencap`) to control real
  devices when the `android` CLI is absent or a lower-level operation is needed. `adb` is part of the
  standard Android SDK platform-tools — no `android-cli` skill required.
- ⚠️ `studio version-lookup` resolves **dependency / platform / SDK-tool versions**, not the Android
  Studio app version.
- Setup (optional): download → `android update` → `android init` (installs the `android-cli` skill).
- Authoritative command reference: https://developer.android.com/tools/agents/android-cli
  (verified 2026-06-23).
