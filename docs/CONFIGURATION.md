# ⚙️ Configuration & Local Overrides

Adapt the pipeline to a project **without editing any plugin**, via a `.sdlc/sdlc.local.yaml` at
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

frameworks:
  disable: [ktor]   # suppress a framework the resolver DID detect (see below)

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
  same applies to `agents{}` keys in `.sdlc/model.local.json`. The `3.0.0` upgrade renamed all
  seven framework convention skills into the `android-foundation:` namespace, so a project carrying
  such a row needs exactly one doctor run.

Run **`/sdlc:extension`** to author these mappings step-by-step (it discovers installed agents/skills,
validates your picks, and merges idempotently), or **`/sdlc:extension --list`** to review the current
rows. Commands and hooks need no manifest: project `.claude/commands/` and `.claude/settings.json`
hooks load natively, and `post_pipeline_checks` / `phase_command_overrides` above cover phase-bound
commands.

## Framework activation

A framework listed in a foundation's `frameworks:` array (ADR-0026) activates when the resolver
detects its `dependency` in your build files — the version catalog first, then module build files
— and stays silent otherwise. **Detection is the default and you rarely need to touch it.**

### `frameworks.disable` — suppress one the resolver found

Since ADR-0026 two providers can contest the same functional aspect: Retrofit and Ktor both
enrich `network`, Dagger and Koin both `di`, Room and DataStore-Proto both `persistence`. A
project genuinely carrying both coordinates — one module migrated, one not — otherwise gets
*both* sets of guidance injected into every development and security prompt, and the only way out
would be removing the dependency from the build, which is not an option mid-migration.

```yaml
frameworks:
  disable: [ktor]        # stack ids, as `/sdlc:list-stacks` prints them
```

- Suppression happens where attachment is decided, so a disabled framework contributes **nothing**:
  no phase injection, no convention skill, no `role_expertise` rules.
- The run says so. The active-profiles banner grows a `suppressed:` row, and the machine plan
  carries `stack.suppressed_profiles` — distinct from a framework that was simply never detected.
- Listing a framework that did not detect is a silent no-op; you may name one pre-emptively.
- A name **no installed framework declares** is reported:
  `WARN: frameworks.disable 'ktorr' — no installed framework declares that stack id — ignored`.
- So is a malformed entry. `disable` is a plain list of ids; writing `- ktor: true` (the shape the
  pre-3.0 docs implied) names the offending index rather than dropping it quietly.

### There is no `frameworks.enable`

Versions `1.13.0`–`3.0.0` documented one; nothing read it ([#197]). It is not coming back.
Since ADR-0026 a framework is a row inside its foundation's own manifest, so force-activating one
whose dependency is absent means injecting guidance for a library the project does not use. To get
a framework's guidance, add its dependency. A stale `enable:` block warns rather than doing nothing
quietly.

### Unknown keys are reported

Every top-level key in `sdlc.local.yaml` that nothing reads produces one line per run:

```
WARN: .sdlc/sdlc.local.yaml: unknown key 'skip_phase' — ignored. Supported: active_workflow, …
```

A typo used to be ignored in complete silence, which is how a dead `frameworks:` block read as
honoured for seven releases. The supported set is exactly: `active_workflow`,
`convention_skills_extra`, `cost_caps`, `extensions`, `extra_phase_prompts`, `frameworks`,
`heal_checks`, `phase_command_overrides`, `post_pipeline_checks`, `skip_phases`.

[#197]: https://github.com/Nuclominus/agentic-sdlc-pluguin/issues/197

