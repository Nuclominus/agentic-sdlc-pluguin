# sdlc — platform-agnostic core

The orchestration layer for the marketplace. It owns the pipeline machinery and **knows nothing about any platform** — detection rules, agents, security standards, and workflow recipes all come from platform plugins. For the Stack Provider Pattern, recipe mechanics, detection rule types, and model-enforcement design, see the [root README](../../README.md); this page documents the `sdlc` plugin's own contents.

---

## What's in this plugin

```
sdlc/
├── .claude-plugin/plugin.json               # name: sdlc
├── stack.md                                 # vanilla profile (priority 0, detect *)
├── commands/{init,start,doctor,list-stacks,batch,security-init}.md
├── skills/pipeline-orchestrator/SKILL.md    # the orchestrator + RESOLVER reference
├── workflows/{default,bugfix,hotfix,refactor,docs-only}.yaml + RESOLVER.md
├── hooks/{hooks.json,enforce-agent-model.sh}
├── runtime-dependencies.json                # declares superpowers (policy: warn)
└── agents/  (5 fallback agents)
```

---

## Fallback agents

Used only when no platform plugin provides an agent for a phase (the vanilla path). Platform plugins override these per phase.

| Agent | model | effort | Role |
| ----- | ----- | ------ | ---- |
| `business-analyst` | `opus` | `high` | Requirements + acceptance criteria; read-only tools |
| `developer` | `sonnet` | `medium` | Implementation against a clear spec |
| `qa-engineer` | `sonnet` | `medium` | Tests against criteria; hard 3-attempt cap |
| `security-analyst` | `opus` | `high` | Platform-neutral security baseline; applies the profile-injected standard |
| `document-writer` | `haiku` | `low` | Structured PR output from known facts |

---

## What the orchestrator does

A single skill (`pipeline-orchestrator`) runs every pipeline:

1. **Dependency preflight** — aggregate `runtime-dependencies.json` across all plugins (cached).
2. **Detect** — glob `**/stack.md`, evaluate each profile's `detect` rules, resolve a winner per aspect + a PRIMARY profile.
3. **Resolve workflow** — discover recipes via `**/workflows/*.yaml`; precedence `--workflow=` > `sdlc.local.yaml` > profile `workflow:` > `default`.
4. **Execute phases** — in order, dispatching `agents_per_phase[phase]`; aspect-aware phases fan out per aspect; supports review-loops and parallel groups. Each phase returns a compact summary; detail goes to `docs/plans/{slug}/0X-<phase>.md`.
5. **Finish** — run `post_pipeline_checks`; write `_telemetry.json`.

The full step text lives in `skills/pipeline-orchestrator/SKILL.md`; the visual flow is in [`docs/WORKFLOW.md`](../../docs/WORKFLOW.md).

---

## Model enforcement (Layer 2 hook)

This plugin ships `hooks/enforce-agent-model.sh` (registered in `hooks/hooks.json`), a PreToolUse hook on `Agent` calls that corrects the model to each agent's declared tier. This is the second of the two enforcement layers described in the [root README](../../README.md#model-enforcement).

---

## Dependency preflight

Declares `obra/superpowers` with `policy: warn`: if absent, the pipeline still runs but with reduced rigor in the BA/QA/Security phases. The check runs once at the start of `/sdlc:start` and is cached.

---

## Project overrides

The orchestrator honors a project-level `.claude/sdlc.local.yaml` (post-pipeline checks, phase command overrides, extra phase prompts, skipped phases, extra convention skills, and the `extensions.skills` Project Extension Manifest) — see [Local Overrides](../../README.md#local-overrides) in the root README.
