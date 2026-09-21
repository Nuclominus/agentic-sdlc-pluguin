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
      agents: [developer]           # list of agent names, or "all"
      when: "before writing production code"
      policy: mandatory             # mandatory | recommended (default)
```

## Project Extension Manifest (`extensions:`)

Extend the SDLC process **without editing any plugin**. The `extensions.skills` array maps
fully-qualified Skill ids (`<plugin>:<skill>`) to the agents that should invoke them:

- **Pipeline agents** get matching rows rendered into their phase prompt by the orchestrator
  (Step 3b-1a), merged and de-duplicated with whatever skills the active stack profile declares for
  that role. `policy: mandatory` means the agent must invoke it; `recommended` (the default) means
  consider it.
- **On-demand agents** that run outside the orchestrator (debugger / devops / cicd / aar-analyst)
  obtain the same merged list with one command,
  `node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs expertise --role <name>`.
- `agents: "all"` targets every agent. An extension skill whose plugin is not installed is
  automatically downgraded to best-effort `recommended` — a missing optional skill never blocks a run.
- **Agent names and Skill ids are used exactly as written.** Nothing translates a renamed agent
  (ADR-0021) or a renamed Skill id (ADR-0026) at runtime, so a row naming something this
  marketplace no longer ships targets nothing. Every run reports such a row, and **`/sdlc:doctor`**
  finds them across both config files and rewrites them in place once you approve — reading two
  rename tables, one for bare agent names and one for fully-qualified `<plugin>:<skill>` ids. The
  same applies to `agents{}` keys in `.claude/model.local.json`. The `3.0.0` upgrade renamed all
  seven framework convention skills into the `android-foundation:` namespace, so a project carrying
  such a row needs exactly one doctor run.

## Framework activation is automatic

There is no configuration key for it. A framework listed in a foundation's `frameworks:` array
(ADR-0026) activates when the resolver detects its `dependency` in your build files — the version
catalog first, then module build files — and stays silent otherwise. There is no `enable` / `disable`
override in `sdlc.local.yaml`: the supported keys are exactly the ones shown above
(`post_pipeline_checks`, `phase_command_overrides`, `convention_skills_extra`, `skip_phases`,
`extra_phase_prompts`, `extensions`, plus `cost_caps` and `heal_checks`). To stop a framework's
guidance from appearing, remove the dependency from the project — the detection follows the build,
not a list you maintain.

Run **`/sdlc:extension`** to author these mappings step-by-step (it discovers installed agents/skills,
validates your picks, and merges idempotently), or **`/sdlc:extension --list`** to review the current
rows. Commands and hooks need no manifest: project `.claude/commands/` and `.claude/settings.json`
hooks load natively, and `post_pipeline_checks` / `phase_command_overrides` above cover phase-bound
commands.
