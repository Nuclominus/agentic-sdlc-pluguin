---
loaded_by: [ba, developer, reviewer, debugger, tester, qa, docs-writer, devops, cicd, aar]
load_when: "BEFORE phase work begins. Single source of truth for Skill invocations per role, project-extension self-read rules, and Android CLI capability bindings."
---

# Skills Matrix

Maps each pipeline phase to mandatory and recommended skill invocations.
Bundled with android-plugin (agents read this at phase start). See `workflow.md` for the full DAG.

## Mandatory Skills (invoke BEFORE phase work — no exceptions)

| Agent | Mandatory Skill | When |
|-------|-----------------|------|
| **android-ba** | `superpowers:brainstorming` | Before any requirements formulation or analysis |
| **android-ba** | `superpowers:verification-before-completion` | Before the development→review handoff |
| **android-developer** | `superpowers:test-driven-development` | Before writing any production code |
| **android-developer** | `frontend-design:frontend-design` | Before implementing Compose UI screens |
| **android-developer** | `superpowers:verification-before-completion` | Before the development→review handoff |
| **android-reviewer** | `superpowers:requesting-code-review` | When generating the review report |
| **android-reviewer** | `superpowers:receiving-code-review` | When evaluating developer responses to review comments |
| **android-reviewer** | `superpowers:verification-before-completion` | Before final LGTM signoff |
| **android-debugger** | `superpowers:systematic-debugging` | Before any diagnosis or fix — must follow structured methodology |
| **android-debugger** | `superpowers:verification-before-completion` | Before declaring root cause identified |

## Architecture Detection — android-developer only

Detect the project's existing state-management pattern before any state-management
implementation, then follow it — never impose a pattern the project does not use.

```bash
grep -rhoE "MVVM|MVI|MVP|Redux|Clean|StateFlow|MutableStateFlow|sealed (interface|class) \w+(State|Intent|Action|Event)" \
  $(find . -name "*.kt" -path "*/src/*" 2>/dev/null) 2>/dev/null | sort | uniq -c | sort -rn | head -20
```

| Result | Decision |
|--------|----------|
| Existing pattern found | Identify it (MVVM/MVI/MVP/Redux/Clean) from the code and follow it consistently |
| No clear pattern | Default to the project's idiomatic `ViewModel` + `StateFlow`. Do NOT impose an unused pattern. |

## Recommended Skills (invoke when the task calls for it)

| Agent | Recommended Skill | When |
|-------|-------------------|------|
| **android-aar** | `superpowers:verification-before-completion` | Before returning findings — every claim must cite transcript evidence |
| **android-tester** | `superpowers:test-driven-development` | When writing new tests from scratch |
| **android-qa** | `superpowers:verification-before-completion` | Before final E2E signoff |
| **android-docs** | `claude-mem` | When cross-session vault context is needed |
| **Every agent** | (implicit) `Read` `.obsidian-vault/` notes | BEFORE answering project-specific questions — see `documentation.md` "Single source of knowledge" |
| **All agents** | `context-mode` | When switching between planning / coding / reviewing work contexts |
| **All agents** | `get-shit-done-cc` | When managing tasks at session level |
| **android-ba / android-developer** | `skill-creator` | When creating or editing project-specific Claude skills |

## Project Extensions (`sdlc.local.yaml` → `extensions.skills`)

A project may request extra Skills per agent via the **Project Extension Manifest** in
`.claude/sdlc.local.yaml` — no plugin edits required:

```yaml
extensions:
  skills:
    - skill: "<plugin>:<skill>"
      agents: [android-developer, android-reviewer]   # list of agent names, or "all"
      when: "before implementing Compose UI"
      policy: mandatory | recommended                  # default: recommended
```

How agents pick these up:

- **Pipeline phase agents** (android-ba, android-developer, android-reviewer, android-tester,
  android-qa, android-security, android-docs) do **nothing** — the orchestrator injects matching rows
  into the phase prompt (`pipeline-orchestrator` Step 3b-1a). Honor any `MANDATORY` / `RECOMMENDED`
  lines that appear in your prompt.
- **On-demand agents that bypass the orchestrator** (**android-debugger**, **android-devops**,
  **android-cicd**, **android-aar**) MUST **self-read** this file's sibling — the project's
  `.claude/sdlc.local.yaml` — at use-time, select `extensions.skills` rows whose `agents` contains
  your own name (or equals `"all"`), and invoke them: `mandatory` → always, `recommended` → when the
  task calls for it. If the file is absent or has no `extensions:` block, do nothing.

This mirrors the single-source "agents read skills.md at use-time" pattern; an extension skill whose
plugin is not installed is best-effort (skip silently rather than failing).

## Android CLI Capability Bindings (OPTIONAL)

Maps Google's official `android` CLI (https://developer.android.com/tools/agents/android-cli)
capabilities to the agents that own them. The CLI is **optional** — the pipeline runs without it.
Presence is advised at SessionStart by `hooks/android-cli-check.sh` (Android projects only).
When `android` is on PATH, the listed agents MAY use the `android-cli` skill (installed by
`android init`) for the capabilities below; when it is absent, agents fall back to their normal tools.
This binding lives **entirely inside android-plugin** — the core orchestrator has zero Android-CLI knowledge.

| Capability (`android …`) | Owner agent(s) | Use when |
|--------------------------|----------------|----------|
| `create` (+ `create list`) | **android-developer** only | Scaffolding a new project from a template (or listing templates). **android-ba** may *plan* the scaffold but does not run `create` — actual creation is the developer's responsibility |
| `describe` | **android-ba** / **android-developer** | Analyzing an existing project to generate descriptive metadata (structure, build targets, output artifacts) during analysis & implementation |
| `emulator *` (create/list/start/stop), `run`, `screen capture`, `screen resolve`, `layout` | **android-qa** | Managing virtual devices, deploying the APK, capturing/annotating screenshots, resolving annotated labels to `(x, y)` coordinates, and dumping the live UI layout (JSON) for E2E / UI verification |
| `sdk *` (install/list/remove/update), `studio version-lookup` | **android-devops** / **android-developer** | Managing SDK packages (channels: stable/beta/canary) and looking up the **latest versions of dependencies, Android platforms, and SDK tools** (e.g. Google Maven) during environment setup or build work |
| `docs search`, `docs fetch` (Android Knowledge Base, via `kb://` URLs) | **any agent** (grounding) | Searching the Android Knowledge Base and fetching docs to ground answers before implementing or reviewing |
| `studio analyze-file`, `studio find-declaration`, `studio find-usages`, `studio open-file`, `studio render-compose-preview`, `studio check` | **android-developer** / **android-reviewer** | IDE-backed static analysis/inspections, semantic declaration/usage navigation, opening files in the editor, rendering Compose `@Preview` (optionally its semantics tree), and checking running Studio instances during implementation & review |
| `skills add`, `skills find`, `skills list`, `skills remove`, `init`, `update`, `info` | **android-devops** | Managing the CLI's own agent skills, initializing the environment (`init` installs the `android-cli` skill), updating the CLI, and locating the default SDK path during environment setup |

Notes:
- Capabilities are **advisory affordances**, not mandatory steps — an agent uses them only when the
  task calls for native tooling and the CLI is present.
- Environment-setup capabilities (`init`/`update`/`info`/`skills *`) are owned by **android-devops** —
  there is no dedicated "setup" agent; setup is an android-devops responsibility.
- **android-qa** may also drop down to native **`adb`** commands directly (e.g. `adb devices`,
  `adb install`, `adb shell input`, `adb shell am start`, `adb logcat`, `adb shell screencap`) to
  control real devices when the `android` CLI is absent or a lower-level operation is needed. `adb`
  is part of the standard Android SDK platform-tools — no `android-cli` skill required.
- ⚠️ `studio version-lookup` resolves **dependency / platform / SDK-tool versions** (not the Android
  Studio app version).
- Setup (optional): download → `android update` → `android init` (installs the `android-cli` skill).
- Authoritative command reference: https://developer.android.com/tools/agents/android-cli (verified 2026-06-23).

## Parallel Phase Execution

`[security ‖ test]` (Steps 3+4) must be invoked **simultaneously in one message with two Agent calls**:

```
Agent(android-security, ...) + Agent(android-tester, ...)  ← single message, parallel
```

See `workflow.md` for the complete pipeline DAG.
