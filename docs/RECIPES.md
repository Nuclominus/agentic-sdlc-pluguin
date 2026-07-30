# 🧭 Dynamic Workflow Recipes

A **workflow recipe** is a YAML file declaring which phases to run and in what shape. Recipes are
discovered across **all** plugins (`**/workflows/*.yaml`), validated against
[`schemas/workflow.schema.json`](../schemas/workflow.schema.json) on load.

> See also: [How the system works](WORKFLOW.md) for the orchestration flow, and
> [Cost & Models](COST-AND-MODELS.md) for the `caps.max_total_cost_usd` gate referenced below.

## Built-in recipes

| Recipe          | Owner          | Phases                                                            |
| --------------- | -------------- | ----------------------------------------------------------------- |
| `default`       | sdlc (core)    | BA → Dev → QA → Security → Remediation? → Docs                    |
| `bugfix`        | sdlc (core)    | Dev → QA → Security → Remediation? → Docs                         |
| `hotfix`        | sdlc (core)    | Dev → QA → Security → Remediation? → Docs                         |
| `refactor`      | sdlc (core)    | Dev → QA → Security → Remediation? → Docs                         |
| `docs-only`     | sdlc (core)    | Docs                                                              |
| `analysis`      | sdlc (core)    | BA → Security (reports only — no code, no PR)                     |
| `testing`       | sdlc (core)    | QA (backfill / verify tests)                                      |
| `debug`         | sdlc (core)    | Dev → QA (fix-and-verify; developer does root-cause)             |
| `android-feature` | android-foundation | BA → Dev → Review(⇄Dev ×3) → [Security ‖ Test] → Remediation? → QA → Docs |
| `android-bugfix`  | android-foundation | Dev → Review(⇄Dev ×3) → [Security ‖ Test] → Remediation? → QA |
| `android-debug`   | android-foundation | Debugger → Dev → Review(⇄Dev ×2) → Test                     |

`Remediation?` is **gated**: the security agent is read-only and only reports. The `remediation`
phase dispatches the *development* agent to apply the fixes, and only when security reported a
Critical or High finding — otherwise it is skipped at zero cost. `analysis` is the deliberate
exception: it ships no code, so there is nothing to remediate.

**Built-in intents.** `analysis`, `testing`, and `debug` (core) plus `android-debug` (android) each carry
a `match:` block so `/sdlc:start` can auto-select them from the task text — e.g. "analyze/audit/assess …"
→ `analysis`, "add tests / coverage" → `testing`, "debug/crash/regression/root-cause" → `debug` (or
`android-debug` on an Android project, which wins the tie via `match.priority: 10`). `android-debug` wires the
otherwise on-demand `android-debugger` into a real pipeline phase (`debugging` → `android-debugger`).

## Control-flow shapes (generic)

| Shape | Syntax | Meaning |
| ----- | ------ | ------- |
| plain | `- development` or `- {name, when}` | run the phase |
| loop  | `- {name: review, loop: {return_to: development, max_rounds: 3}}` | re-run `return_to` on changes-requested, capped, then escalate |
| gate  | `- {name: remediation, gate: {after: [security], min_severity: high}}` | dispatch ONLY if a listed phase reported a finding at that severity; else skip at zero cost |
| parallel | `- {parallel: [security, test]}` | dispatch listed phases concurrently |

`gate` is a one-way hand-off, not a loop: it never re-runs the phases in `after`. It exists because
a parallel member is a bare string and cannot carry control flow — `security` runs inside
`[security ‖ test]`, so its hand-off to the developer has to be a separate phase after the group.

## Workflow selection precedence

`--workflow=NAME` > `.claude/sdlc.local.yaml active_workflow` > **match-based auto-selection** > the PRIMARY profile's declared `workflow:` > `default`.

```bash
/sdlc:start "Add dark mode"                            # android profile → android-feature (auto)
/sdlc:start --workflow=docs-only "Update README"       # explicit override
```

## Automatic workflow selection

When no explicit workflow is chosen (no `--workflow=`, no `active_workflow`), the orchestrator inspects the change and picks the most fitting recipe by evaluating each recipe's optional `match:` block. This tier sits **between** `active_workflow` and the profile default: explicit choices always win, but intent detection beats the generic default.

A recipe is a **candidate** only if it carries a non-empty `match:` block (a recipe with no `match:` can only be chosen explicitly). Available signals: `$ARGUMENTS`, `LOC_TOUCHED`, `HAS_MIGRATIONS`, `CONFIG_ONLY`. A candidate **matches iff ALL conditions present in its `match:` block are satisfied** (absent conditions are ignored):

- `arguments_pattern` — ECMAScript regex, tested **case-insensitively** against `$ARGUMENTS`.
- `loc_touched_max` / `loc_touched_min` — `LOC_TOUCHED <= max` / `LOC_TOUCHED >= min`.
- `has_migrations: true` — matches only when a migration is present.
- `config_only: true` — matches only when the change touches config-only files.

**Tie-break** when several recipes match, applied in order: (1) highest `match.priority` (integer, default `0`) — the explicit author override; (2) most specific — highest count of satisfied conditions; (3) most conservative — lowest `caps.max_total_cost_usd` (no cap = +∞); (4) alphabetical by `name`, a final deterministic backstop. If exactly one survives it is selected; if none match, selection falls through to the profile default unchanged.

When auto-selection fires it announces:

```text
🧭 Auto-selected workflow 'bugfix' — matched: arguments_pattern,loc_touched_max. Override with --workflow=NAME or --no-auto-workflow.
```

**Override** by naming a workflow (`/sdlc:start --workflow=NAME "…"`) or by disabling the tier entirely (`/sdlc:start --no-auto-workflow "…"`, which jumps straight to the profile default).

## Custom recipes

Place a YAML file under any plugin's `workflows/`. Names must be unique across the marketplace; core recipe names are reserved (a plugin must not reuse them).

## Project-local workflows

A project may ship its own recipes without editing any plugin. Drop a YAML file at:

```text
<project>/.claude/sdlc-workflows/<name>.yaml
```

These are discovered with **highest precedence**: a project recipe **shadows** any plugin recipe of the same name (intentional per-project override — not an ambiguity halt; only two *plugins* colliding on a name halts). They validate against the same [`schemas/workflow.schema.json`](../schemas/workflow.schema.json). Author one interactively:

```bash
/sdlc:workflow-config                # step-by-step: name, phases, match, caps → writes .claude/sdlc-workflows/<name>.yaml
/sdlc:workflow-config --list         # list project recipes + which plugin recipes they shadow
```

Selection precedence with a project recipe: `--workflow=NAME` resolves the name, then the resolver prefers `<project>/.claude/sdlc-workflows/NAME.yaml` over any plugin's `workflows/NAME.yaml`.
