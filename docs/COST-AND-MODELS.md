# 💰 Cost & Models

How the pipeline enforces per-agent model tiers, and how cost is controlled and reported.

> See also: [How the system works](WORKFLOW.md) · [Workflow Recipes](RECIPES.md) (the
> `caps.max_total_cost_usd` gate is declared in a recipe).

## Model Enforcement

Every agent declares its `model:` tier in frontmatter; the pipeline guarantees that tier is used regardless of the session default.

**Two enforcement layers:**

1. **Orchestrator (Layer 1)** — Step 3b reads the agent's frontmatter and passes the declared tier verbatim in the `Agent()` dispatch.
2. **PreToolUse hook (Layer 2)** — `plugins/sdlc/hooks/enforce-agent-model.sh` intercepts every `Agent` call, compares the requested model with the agent's declared `model:`, and corrects it via `updatedInput` if they differ.

> The `Agent` tool's `model` parameter accepts the **short tier name only** (`opus` / `sonnet` / `haiku` / `fable`). Passing a full model ID raises `InputValidationError`, so both layers enforce the tier verbatim. The tier → model-ID resolution is used **only** for telemetry/cost accounting (orchestrator Step 3d-1), never for dispatch.

**Tier → model ID (telemetry/cost only):** concrete model IDs are defined once in the model registry [`plugins/sdlc/config/models.json`](../plugins/sdlc/config/models.json) — the single source of truth. Bump a model there, not here.

## Cost Optimization: model + effort

Cost is controlled exclusively through `model` + `effort` (Claude Code does not expose per-subagent `temperature`). The tier → model mapping is in [Model Enforcement](#model-enforcement) above; the **per-agent `model`/`effort` roster lives in each plugin's README** so it stays next to the agents it describes:

- core fallback agents → [`plugins/sdlc/README.md`](../plugins/sdlc/README.md)
- Android roster → [`plugins/android-foundation/README.md`](../plugins/android-foundation/README.md)
- framework providers ship no agents → [`retrofit-plugin`](../plugins/retrofit-plugin/README.md) · [`room-plugin`](../plugins/room-plugin/README.md) · [`dagger-plugin`](../plugins/dagger-plugin/README.md) · [`workmanager-plugin`](../plugins/workmanager-plugin/README.md)

> `effort: high` on Opus is the costliest combination — reserved for leverage agents (BA, Security) where reasoning quality affects every downstream phase.

**Levers:** skip-rules for trivial changes · QA 3-attempt hard cap · compact ≤2–3K-token handoffs · prompt caching (stable prefixes).

### Dry-run & cost caps

**`--dry-run`** previews the resolved plan and dispatches **nothing** — no agents, no code,
no `docs/plans/{slug}/` workspace, no telemetry. After resolving the stack, workflow, phases,
and per-agent model tiers, the orchestrator prints a plan block and exits cleanly:

```bash
/sdlc:start "Add dark mode" --dry-run
```
```
🔎 DRY RUN — no agents dispatched, no code written.
Stack: android | Workflow: android-feature
Phases (6):
   1. business_analysis  → android-ba (opus)          ~$0.16
   2. development         → android-developer (sonnet) ~$0.18
   ...
Estimated cost: ~$0.63  (worst-case $0.91)
Cap: 0.60  → ⚠️ EXCEEDS by $0.03
```

Cost figures are a **heuristic estimate** (baseline per-phase token assumptions × model-registry
pricing), not a measurement. In headless mode a machine-readable JSON line is also written to stdout.

**`caps.max_total_cost_usd`** (declared in a workflow recipe, e.g. `hotfix.yaml` caps at `$0.60`)
gates a **real run**: the orchestrator accumulates actual per-phase cost and, before dispatching the
next phase, if the running total exceeds the cap it **pauses** for approve-continue / abort
(interactive) or **aborts** with exit 1 (headless). Both `--dry-run` and the real-run gate read the
cap from the resolved active workflow recipe.

Each phase is priced **from its own subagent transcript the moment it finishes** — the Agent result
envelope reports only an aggregate token count that cannot be priced, so a gate fed from it would
see `$0` for every phase and never fire (ADR-0011). Telemetry records `cost_cap_usd` and
`cap_status`:

| `cap_status` | meaning |
|---|---|
| `within` | cap set and never exceeded (or no cap declared) |
| `exceeded-continued` | you approved continuing past the cap, or a self-heal loop was stopped by it |
| `exceeded-aborted` | you aborted, or a headless run halted at the cap |
| `exceeded-undetected` | the run went over cap **without the gate catching it** — a phase could not be priced in-run (`cap_gate_blind`) and counted as `$0`. Written after the fact by cost enrichment, alongside `cap_breach_usd` (phase spend minus cap) |

The cap gates **phase spend only**. Orchestration overhead (the orchestrator's own turns) is
reported in `total_cost_usd` but never enters the comparison, so a run can legitimately show a total
above the cap while `cap_status` is `within` — size recipe caps against phase spend accordingly.

**`--resume`** — continue an interrupted pipeline from the first unfinished phase (per-phase
checkpoints in `docs/plans/{slug}/.checkpoint/`). See [How the system works](WORKFLOW.md).

### Run reports, cross-run rollup & AAR

**Per-run HTML report.** At the end of every run the orchestrator renders a self-contained
`docs/plans/{slug}/report.html` from `_telemetry.json` — phase timeline, cost by model, signals
(QA iterations, skip rules, cap status), post-pipeline checks, and touched files. No external
assets; open it straight in a browser.

**`/sdlc:report` — cross-run rollup.** A deterministic, dependency-free script globs **every**
`docs/plans/*/_telemetry.json` and renders `docs/plans/rollup/index.html` plus a terminal digest:
total spend, cost over time, cost by phase and by model, cache-hit trend, cap-breach incidents,
skip-rule frequency, and the QA-iteration distribution. Reuses the run metrics; spends **no** LLM
tokens.

**`/sdlc:aar` — After Action Review.** Reviews a completed run (token cost + how the agents
cooperated) from its telemetry + session transcript, proposes improvements, and — only on your
approval — appends curated lessons to `.claude/sdlc-lessons.md`. The orchestrator injects those
lessons into later runs' phase prompts (cache-safe, in the stable prefix), closing a lightweight
learning loop.
