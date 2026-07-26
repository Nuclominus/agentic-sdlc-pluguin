---
description: Author a PROJECT-LOCAL workflow recipe step-by-step — writes .claude/sdlc-workflows/<name>.yaml. Prompts for phases (plain / parallel / loop), optional match rules and cost caps. Validates against schemas/workflow.schema.json; idempotent; never clobbers unrelated files.
argument-hint: "[--list]"
---

# /sdlc:workflow-config

Interactive helper to author a **project-local workflow recipe** at
`<repo_root>/.claude/sdlc-workflows/<name>.yaml` — a per-project pipeline definition that the
orchestrator discovers with **highest precedence** (a project recipe **shadows** any plugin recipe
of the same name; see `plugins/sdlc/workflows/RESOLVER.md` Step 1). This command only edits config —
it never runs the pipeline.

## What this command does

1. **Repo root check.** `git rev-parse --show-toplevel` should match CWD; otherwise tell the user to
   `cd` there. Target directory: `<repo_root>/.claude/sdlc-workflows/`. Create it if absent.

2. **`--list` fast path.** If `$ARGUMENTS` contains `--list`: `Glob <repo_root>/.claude/sdlc-workflows/*.yaml`,
   read each, and print a table (`recipe │ phases │ shadows-plugin?`). Cross-reference each `name`
   against plugin recipes (`Glob {PLUGIN_CACHE_ROOT}/**/workflows/*.yaml`, the cache root resolved
   per `plugins/sdlc/PLUGIN-PATHS.md` — never a literal `~`) to flag which project
   recipes shadow a plugin recipe. If none exist, print `No project-local workflows configured.` and stop.

3. **Discover valid choices** (so the user picks from real names, not free text):
   - **Existing project recipes:** `Glob <repo_root>/.claude/sdlc-workflows/*.yaml` (for editing/shadow warnings).
   - **Plugin recipe names** (reserved / shadow detection): `Glob {PLUGIN_CACHE_ROOT}/**/workflows/*.yaml`
     → collect each file's `name`.
   - **Available phase names:** read the ACTIVE stack's `manifest.yaml` (reuse Step 0b detection from
     `pipeline-orchestrator/SKILL.md`, or `Glob {PLUGIN_CACHE_ROOT}/**/manifest.yaml`) and offer the
     **keys of `agents_per_phase`** as the valid phase palette (e.g. Android: `business_analysis`,
     `debugging`, `development`, `review`, `security`, `test`, `qa`, `documentation`; vanilla:
     `business_analysis`, `development`, `qa`, `security`, `documentation`). A phase name that no active
     profile maps to an agent will be skipped at run time — warn if the user picks one.

4. **Name the recipe** (use `AskUserQuestion` or a prompt). Rules:
   - kebab-case, matching `^[a-z][a-z0-9-]*$`, length 2–40 (the schema `name` pattern).
   - If the name equals an **existing project recipe** → this is an EDIT; load it as the starting point.
   - If the name equals a **plugin recipe** → warn: `⚠️ '<name>' shadows the plugin recipe of the same
     name — the project recipe will win. Continue?` Only proceed on explicit confirmation. (Shadowing is
     allowed and intentional; the warning just prevents accidents.)

5. **Description.** Prompt for a one-line human-readable `description`.

6. **Ordered phases.** Build the `phases` array by asking, for each slot, which shape:
   - **plain** — a single phase name from the palette → emitted as a bare string `- <name>`.
   - **parallel** — 2+ phase names run concurrently → `- {parallel: [a, b, …]}` (min 2 members).
   - **loop** — a phase that iterates back → `- {name: <phase>, loop: {return_to: <earlier-phase>,
     max_rounds: <1–10>}}`. `return_to` MUST name an earlier phase already in the list (validate).
   Keep asking "add another phase?" until the user is done. Enforce: at least 1 phase; **no duplicate
   phase name** across the flattened list (parallel members count); `return_to` targets an earlier phase.

7. **Optional `match` block.** Ask whether this recipe should auto-select. If yes, collect any of:
   `arguments_pattern` (ECMAScript regex, matched case-insensitively against the task text),
   `loc_touched_min` / `loc_touched_max` (integers ≥ 0), `has_migrations` (bool), `config_only` (bool),
   `priority` (integer, default 0 — the FIRST tie-break: raise it to force this recipe to win an
   auto-select tie over a competing recipe, e.g. a project recipe that must beat a built-in one).
   Omit the whole block if the user declines. (This command only AUTHORS the match data; the
   match-evaluation algorithm lives in the orchestrator.)

8. **Optional cost cap.** Ask for `caps.max_total_cost_usd` (a number ≥ 0). Omit if declined.

9. **Assemble, validate, confirm.** Build the YAML, then **validate against
   `schemas/workflow.schema.json`** (Read the schema; verify `required` = `[name, phases]`, types match,
   no unknown properties, `name` pattern, phase-item shapes, `loop.max_rounds` 1–10, `parallel` minItems 2).
   Show the assembled YAML and ask **write & finish / cancel**.

10. **Write — idempotent, non-destructive.** On confirm, write
    `<repo_root>/.claude/sdlc-workflows/<name>.yaml`. Editing an existing recipe updates it in place;
    never touch other files in the directory. Print the path and the next step.

## YAML shape written

```yaml
name: my-hotfix
description: Project hotfix lane — dev, review loop, then parallel security+test.
match:
  arguments_pattern: "\\bhotfix\\b|\\burgent\\b"
  loc_touched_max: 200
caps:
  max_total_cost_usd: 0.60
phases:
  - development
  - name: review
    loop:
      return_to: development
      max_rounds: 2
  - parallel: [security, qa]
```

## Output

```
🧩 SDLC project-local workflow

Discovered: 8 phase names (android profile), 8 plugin recipes

recipe:  my-hotfix
phases:  development → review(⇄development ×2) → [security ‖ qa]
match:   arguments_pattern, loc_touched_max=200
caps:    max_total_cost_usd=0.60
shadows: (no plugin recipe named 'my-hotfix')

✅ Validated against schemas/workflow.schema.json
Wrote: .claude/sdlc-workflows/my-hotfix.yaml

Next:
  /sdlc:start --workflow=my-hotfix "<feature>"    # or let match auto-select it
```

## Hard rules

- **Project-local only.** This command writes ONLY under `<repo_root>/.claude/sdlc-workflows/`. It never
  edits a plugin's `workflows/` directory.
- **Validate before writing.** The assembled recipe MUST pass `schemas/workflow.schema.json`; re-prompt on
  any violation. Never write an invalid recipe.
- **Idempotent & non-destructive.** Same `<name>` ⇒ update in place; never clobber other recipes.
- **Shadowing is explicit.** Warn (and require confirmation) when the chosen name collides with a plugin
  recipe — the project recipe wins by design, but the user must intend it.
- **Phases from the active palette.** Offer `agents_per_phase` keys from the active manifest; warn on a
  phase no active profile maps to an agent.
- **No pipeline run.** This command only authors config.
- **Reuse, don't reimplement.** Phase-palette / recipe discovery mirrors `pipeline-orchestrator` Step 0b /
  Step 1c and `RESOLVER.md`; validation reuses `schemas/workflow.schema.json`.

## When to use

- A project needs a bespoke pipeline (extra loop, different phase order, a cost cap) without editing any plugin.
- Overriding (shadowing) a built-in recipe for one repo — e.g. a stricter project `hotfix`.
- Reviewing (`--list`) the project's current recipes and which plugin recipes they shadow.
