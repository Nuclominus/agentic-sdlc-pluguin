# sdlc — platform-agnostic core

The orchestration layer for the marketplace. It owns the pipeline machinery and **knows nothing about any platform** — detection rules, agents, security standards, and workflow recipes all come from platform plugins. For the Stack Provider Pattern, recipe mechanics, detection rule types, and model-enforcement design, see the [root README](../../README.md); this page documents the `sdlc` plugin's own contents.

---

## What's in this plugin

```
sdlc/
├── .claude-plugin/plugin.json               # name: sdlc
├── manifest.yaml                            # vanilla profile (kind: foundation, priority 0, detect *)
├── config/aspects.yaml                       # aspect vocabulary (platform + functional)
├── PLUGIN-PATHS.md                          # path-resolution contract (ADR-0009) — no literal `~`
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

| Agent | model | effort | Edits code? | Role |
| ----- | ----- | ------ | ----------- | ---- |
| `business-analyst` | `opus` | `high` | no | Requirements + acceptance criteria |
| `developer` | `sonnet` | `medium` | **yes** | Implementation against a clear spec; also the gated `remediation` phase |
| `qa-engineer` | `sonnet` | `medium` | **yes** | Tests against criteria; hard 3-attempt cap |
| `security-analyst` | `opus` | `high` | no | Platform-neutral security baseline; applies the profile-injected standard. **Read-only** — reports findings, `developer` applies them via `remediation` |
| `document-writer` | `haiku` | `low` | no | Structured PR output from known facts |
| `session-recorder` | `haiku` | `low` | no | Appends the run's journal entry (closing act, every run) |
| `aar-analyst` | `sonnet` | `medium` | no | Read-only retrospective for `/sdlc:aar` |

Every agent declares an explicit `tools:` allowlist in its frontmatter. An agent that omits `tools:`
inherits **every** tool — which is how a read-only reviewer ends up quietly editing the code it is
reviewing. Agents in the "no" column have no `Edit` tool at all; `Write` is granted only where the
agent must produce its own report or deliverable under `docs/plans/{task_slug}/`. Any agent that
needs to invoke a Skill must also list `Skill`, because the orchestrator injects
`Convention skills to consider invoking:` into every phase prompt.

**No agent may dispatch agents.** `Agent`, `Task`, `SendMessage`, and `Workflow` belong to the
orchestrator alone — it runs in the main loop as a skill and holds them by default, while no
subagent declares any of them. A subagent that spawned its own children would put that work outside
phase accounting: no checkpoint, no `_telemetry.json` entry, no contribution to the recipe's cost
cap, so the run's reported cost would stop being its real cost.

`sdlc-lint agent-tools` enforces this in CI across `plugins/*/agents/*.md` — a declared non-empty
`tools:`, no dispatch tool, no `Edit` on a reviewing agent, and a present `description:`. It covers
shipped agents only: a project-local agent under `.claude/agents/` that omits `tools:` still
inherits everything, and `sdlc.local.yaml` can bind one to a phase via `agents_per_phase`. See
[ADR-0018](../../.brain/decisions/ADR-0018-reviewers-do-not-write-code.md).

---

## What the orchestrator does

A single skill (`pipeline-orchestrator`) runs every pipeline:

1. **Dependency preflight** — aggregate `runtime-dependencies.json` across all plugins (cached).
2. **Detect** — glob `**/manifest.yaml`, split by `kind`, evaluate each foundation's `detect` rules, resolve a winner per aspect + a PRIMARY profile.
3. **Resolve workflow** — discover recipes via `**/workflows/*.yaml`; precedence `--workflow=` > `sdlc.local.yaml` > profile `workflow:` > `default`.
4. **Execute phases** — in order, dispatching `agents_per_phase[phase]`; aspect-aware phases fan out per aspect; supports review-loops and parallel groups. Each phase returns a compact summary; detail goes to `docs/plans/{slug}/0X-<phase>.md`.
5. **Finish** — run `post_pipeline_checks`; write `_telemetry.json`.

The full step text lives in `skills/pipeline-orchestrator/SKILL.md`; the visual flow is in [`docs/WORKFLOW.md`](../../docs/WORKFLOW.md).

---

## Model enforcement (Layer 2 hook)

This plugin ships `hooks/enforce-agent-model.sh` (registered in `hooks/hooks.json`), a PreToolUse hook on `Agent` calls that corrects the model to each agent's declared tier. This is the second of the two enforcement layers described in [Cost & Models](../../docs/COST-AND-MODELS.md#model-enforcement).

---

## Dependency preflight

Declares `obra/superpowers` with `policy: warn`: if absent, the pipeline still runs but with reduced rigor in the BA/QA/Security phases. The check runs once at the start of `/sdlc:start` and is cached.

---

## Project overrides

The orchestrator honors a project-level `.claude/sdlc.local.yaml` (post-pipeline checks, phase command overrides, extra phase prompts, skipped phases, extra convention skills, and the `extensions.skills` Project Extension Manifest) — see [Configuration & Local Overrides](../../docs/CONFIGURATION.md#local-overrides).

---

## Project-local model tiers (`.claude/model.local.json`)

Each project can override which model **tier** its SDLC agents run on, without editing any plugin.
Create `<repo_root>/.claude/model.local.json` (or run `/sdlc:model-config`):

```json
{
  "$schema": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin/schemas/model-local.schema.json",
  "default": "haiku",
  "agents": {
    "business-analyst": "sonnet",
    "security-analyst": "opus"
  }
}
```

- `default` — tier applied to every agent unless overridden.
- `agents` — per-agent override, keyed by bare agent name.
- Valid tiers: `opus | sonnet | haiku | fable` (the registry `pipeline_tiers`).

**Resolution (per agent):** `agents[<bare-name>]` → `default` → the agent's `.md` frontmatter `model:`
→ `sonnet`. Both the `enforce-agent-model.sh` hook and the orchestrator apply this same chain, so an
override is honored at dispatch and not reverted. A missing or malformed file, or an invalid tier, falls
back to the built-in tiers (fail-open). This changes only which tag an agent uses — the model registry
(`config/models.json`) remains the single source of truth for tag→model_id and pricing.

Author it interactively with `/sdlc:model-config` (default tier first, then optional per-agent), or
`/sdlc:model-config --list` to review the current mapping.
