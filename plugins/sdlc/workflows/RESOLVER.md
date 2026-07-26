# Workflow Resolver — Algorithm Reference

This document specifies how the pipeline orchestrator loads, validates, and
applies a workflow recipe file. Referenced from `pipeline-orchestrator/SKILL.md`
Step 1c.

## Step 1: Locate the workflow file

1. If `$ARGUMENTS` contains `--workflow=NAME`, use `NAME` as `WORKFLOW_NAME`.
2. Else if `EFFECTIVE_PROFILE` (from sdlc.local.yaml) specifies `active_workflow`,
   use that as `WORKFLOW_NAME`. *(Iteration 4+)*
3. **Else run match-based auto-selection** (Step 1.5 below): evaluate every
   discovered recipe's `match:` block against the diff signals + `$ARGUMENTS`. If
   exactly one recipe is selected, use its `name` as `WORKFLOW_NAME`. Skipped when
   `$ARGUMENTS` contains `--no-auto-workflow`, or when tiers 1–2 already resolved a name.
4. Else if the PRIMARY profile declared a `workflow:` in its `manifest.yaml`
   (`CONTEXT.profile_default_workflow`), use that. *(Generic — any profile may set it;
   e.g. a platform profile sets `workflow: <its-recipe>`.)*
5. Otherwise: `WORKFLOW_NAME = "default"`.

Search path — workflow recipes are discovered from **two sources**: project-local recipes in the
current project, and recipes shipped across **all installed plugins** (the same aggregation pattern
used for `manifest.yaml` and `runtime-dependencies.json`). Glob both:

```text
<project>/.claude/sdlc-workflows/{WORKFLOW_NAME}.yaml   # project-local (highest precedence)
{PLUGIN_CACHE_ROOT}/**/workflows/{WORKFLOW_NAME}.yaml   # all plugins (core + platform)
```

`{PLUGIN_CACHE_ROOT}` is the resolved cache root of the **active** config dir, not a literal `~` —
resolve it per `plugins/sdlc/PLUGIN-PATHS.md` (orchestrator Step 0) before globbing.

The plugin glob covers core (`sdlc/workflows/`) and every plugin that ships a `workflows/` directory
(e.g. `<platform>-plugin/workflows/<recipe>.yaml`). Resolution:

- **Project-local recipe present** (`<project>/.claude/sdlc-workflows/{WORKFLOW_NAME}.yaml` exists) →
  **use it**, and it **shadows** any plugin recipe of the same name. This is intentional per-project
  overriding, **not** an ambiguity halt — the project wins.
- **No project recipe, exactly one plugin match** → use the plugin recipe.
- **No project recipe, multiple plugin matches** (same `WORKFLOW_NAME` shipped by more than one plugin)
  → **HALT** (ambiguous — only two *plugins* colliding on a name halts):

```text
❌ Workflow '{WORKFLOW_NAME}' is ambiguous — defined in multiple plugins:
   {list each matching path}
   Rename one, or pass --workflow= with a unique name.
   (A project-local <project>/.claude/sdlc-workflows/{WORKFLOW_NAME}.yaml would override both.)
```

- Workflow names should be unique across the marketplace. Core recipe names
  (`default`, `bugfix`, `hotfix`, `refactor`, `docs-only`, `analysis`, `testing`, `debug`) are reserved
  — a plugin must not reuse them. A **project** MAY reuse any name to deliberately shadow a plugin recipe.

Project-local recipes are validated against the same `schemas/workflow.schema.json` (Step 2 below,
unchanged). Author them interactively with `/sdlc:workflow-config`.

If no file is found → **HALT**:

```text
❌ Workflow '{WORKFLOW_NAME}' not found.
   Searched: <project>/.claude/sdlc-workflows/{WORKFLOW_NAME}.yaml
             {PLUGIN_CACHE_ROOT}/**/workflows/{WORKFLOW_NAME}.yaml
   Available: {list all *.yaml found via Glob of <project>/.claude/sdlc-workflows/*.yaml
              AND **/workflows/, excluding test-fixtures/ — annotate project-local ones as "(project)"}
   Omit --workflow=NAME to use the default workflow.
```

## Step 1.5: Match-based auto-selection

This tier fires **only** when tiers 1–2 above did NOT resolve a `WORKFLOW_NAME`
(no `--workflow=NAME`, no `active_workflow`). It detects intent from the diff
signals and `$ARGUMENTS`, choosing a more specific recipe than the generic
profile default. It is **deterministic** — the same inputs always yield the same
result.

**Skip conditions.** Do NOT run this tier (fall straight through to tier 4, the
profile default) when ANY of these hold:

- `$ARGUMENTS` contains `--no-auto-workflow`, OR
- tier 1 (`--workflow=NAME`) or tier 2 (`active_workflow`) already resolved a name.

**Signals available by Step 1c** (computed in Step 0c): `LOC_TOUCHED` (integer),
`HAS_MIGRATIONS` (boolean), `CONFIG_ONLY` (boolean), and the raw `$ARGUMENTS` string.

### Candidate set

Every discovered recipe (globbed across ALL plugins, same search path as Step 1)
that carries a **non-empty** `match:` block is a candidate. A recipe whose `match`
block is empty or absent is NOT a candidate — it can only be chosen explicitly
(via `--workflow=` / `active_workflow` / profile default).

### Match predicate

A candidate MATCHES **iff ALL conditions present in its `match` block are satisfied**
against the signals. Conditions that are absent from the block are ignored (not a
constraint). The conditions:

| Key | Satisfied when |
| --- | --- |
| `arguments_pattern` | the ECMAScript regex, tested **case-insensitively**, finds a match in `$ARGUMENTS` |
| `loc_touched_max` | `LOC_TOUCHED <= value` |
| `loc_touched_min` | `LOC_TOUCHED >= value` |
| `has_migrations: true` | `HAS_MIGRATIONS == true` |
| `config_only: true` | `CONFIG_ONLY == true` |

(For `has_migrations` / `config_only`, a `false` value imposes no constraint.)

### Tie-break (when more than one recipe matches)

Apply these rules **in order**; stop at the first that yields a unique winner:

1. **Explicit priority** — highest `match.priority` (integer, default `0` when the field
   is absent). This is the author-controlled override: set it to force a recipe to win a
   tie deterministically (e.g. `android-debug` sets `priority: 10` to beat the generic
   `debug` recipe).
2. **Most specific wins** — highest count of *satisfied* conditions in the `match` block.
3. **Most conservative cost cap** — lowest `caps.max_total_cost_usd`. Treat a recipe
   with **no** `caps.max_total_cost_usd` as `+∞` (a present cap always beats no cap).
4. **Alphabetical** — lowest `name` in ASCII/lexicographic order. Final deterministic
   backstop only — reached when priority, specificity, and cost are all equal.

### Outcome

- **Exactly one recipe survives** → select it. Set `CONTEXT.workflow_autoselected = true`
  and `CONTEXT.active_workflow = <name>` (this becomes `WORKFLOW_NAME`), then continue to Step 2.
  **MUST print** (verbatim, substituting the CSV of the satisfied condition keys):

  ```text
  🧭 Auto-selected workflow '{name}' — matched: {csv of satisfied condition keys}. Override with --workflow=NAME or --no-auto-workflow.
  ```

- **No recipe matches** → do nothing here; fall through to tier 4 (profile default)
  / tier 5 (`"default"`) exactly as before. Print nothing for this tier.

## Step 2: Read, parse, and validate

`Read` the located file. Parse YAML. Validate the parsed structure against
`schemas/workflow.schema.json` (Read the schema, verify `required` fields are
present, types match, and no unknown properties exist). If validation fails → **HALT**:

```text
❌ Workflow '{WORKFLOW_NAME}' failed schema validation.
   Errors: {list each violation — missing field, wrong type, unknown property}
   File: {file_path}
```

Extract `phases` array. Normalize each element, **preserving its shape**:

- String element `"foo"` → `{name: "foo"}`
- Object element `{name: "foo", when?, loop?}` → keep as-is (the optional `loop: {return_to, max_rounds}` is carried through to execution)
- Parallel group `{parallel: ["a", "b", ...]}` → keep as-is (one ordered slot whose members run concurrently)

## Step 3: Acyclic validation (Iteration 0)

Build the flat list of executed phase names, **expanding parallel groups** to their members:
`phase_names = [ p.name for plain/loop phases ] + [ m for group in parallel groups for m in group.parallel ]`.

If any name appears more than once → **HALT**:

```text
❌ Workflow '{workflow_name}' contains duplicate phase '{duplicate_name}'.
   A workflow DAG must be acyclic — each phase may appear at most once.
   File: {file_path}
```

A phase's `loop.return_to` is an **intentional back-edge**, not a duplicate: `return_to` MUST name
an earlier phase that already appears in the list. Validate that the target exists and precedes the
loop phase; it does NOT count as a second occurrence. If `return_to` names a missing/later phase → **HALT**:

```text
❌ Loop phase '{loop_phase}' has return_to='{target}' which is not an earlier phase in
   workflow '{workflow_name}'.
   File: {file_path}
```

*(Iteration 1+: when `after:` edges are introduced, also run a topological sort. Until then,
duplicate-name detection plus loop back-edge validation is sufficient.)*

## Step 4: Build the resolved phase list

Start with the normalized `phases` from Step 2 (already in order for Iteration 0).

### Insert extra_phases from stack profiles

For each entry in `EFFECTIVE_PROFILE.extra_phases` (merged in Step 1a):

- Find the index of the phase named `extra_phase.after` in the list.
- If found: insert the extra phase immediately after that index.
- If not found: skip with a one-line warning:

```text
⚠️ Extra phase '{extra_phase.name}' has after='{extra_phase.after}' which is
   not present in workflow '{WORKFLOW_NAME}' — skipping.
```

### Conflict detection after insertion

After all extra_phases have been inserted, re-run the acyclic check from Step 3
on the merged list. If any phase name now appears more than once → **HALT**:

```text
❌ Workflow '{workflow_name}' after merging stack extra_phases contains duplicate
   phase '{duplicate_name}'. Check the stack profile's extra_phases declaration.
```

### Apply skip_phases

Sources: Step 0c skip-rules + Step 1b sdlc.local.yaml.

Remove all phases whose `name` is in the combined skip set.

## Step 5: Persist and announce

Store the resolved list as `CONTEXT.resolved_phases[]`. Persist `WORKFLOW_NAME` in
`CONTEXT.active_workflow`.

Print a new line **at Step 1c** (not part of the earlier Step 0b block):

```text
   workflow: {WORKFLOW_NAME}  ({N} phases after skips)
```

The full "resolved plan + cost-preview" verbatim block is added in Iteration 1.
