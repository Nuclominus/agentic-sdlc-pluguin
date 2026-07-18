# ⚙️ Configuration & Local Overrides

Adapt the pipeline to a project **without editing any plugin**, via a `.claude/sdlc.local.yaml` at
the project root.

> See also: [Workflow Recipes](RECIPES.md) for project-local workflow files, and
> [CONTRIBUTING.md](../CONTRIBUTING.md) for authoring plugins.

## Local Overrides

```yaml
post_pipeline_checks:
  - "./gradlew testDebugUnitTest"
  - "./gradlew lintDebug"

phase_command_overrides:
  qa: "./gradlew connectedDebugAndroidTest"

convention_skills_extra:
  - "local:our-compose-conventions"

skip_phases:
  - security        # internal hotfix branches

extra_phase_prompts:
  development: "Follow our internal module-structure.md"

extensions:                       # Project Extension Manifest — per-agent Skill mapping
  skills:
    - skill: "superpowers:test-driven-development"
      agents: [android-developer]   # list of agent names, or "all"
      when: "before writing production code"
      policy: mandatory             # mandatory | recommended (default)
```

## Project Extension Manifest (`extensions:`)

Extend the SDLC process **without editing any plugin**. The `extensions.skills` array maps
fully-qualified Skill ids (`<plugin>:<skill>`) to the agents that should invoke them:

- **Pipeline agents** (BA / Dev / QA / Security / Docs and their platform overrides) get matching
  rows injected into their phase prompt by the orchestrator (Step 3b-1a). `policy: mandatory` means
  the agent must invoke it; `recommended` (the default) means consider it.
- **On-demand agents** that bypass the orchestrator (debugger / devops / cicd / aar) self-read their
  matching rows from `sdlc.local.yaml` at use-time.
- `agents: "all"` targets every agent. An extension skill whose plugin is not installed is
  automatically downgraded to best-effort `recommended` — a missing optional skill never blocks a run.

Run **`/sdlc:extension`** to author these mappings step-by-step (it discovers installed agents/skills,
validates your picks, and merges idempotently), or **`/sdlc:extension --list`** to review the current
rows. Commands and hooks need no manifest: project `.claude/commands/` and `.claude/settings.json`
hooks load natively, and `post_pipeline_checks` / `phase_command_overrides` above cover phase-bound
commands.
