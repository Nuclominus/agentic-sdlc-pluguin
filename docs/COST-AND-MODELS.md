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
Phases (7):
   1. business_analysis  → android-ba (opus)          ~$0.94
   2. development         → android-developer (sonnet) ~$1.84
   ...
Estimated cost: ~$4.29  (worst-case $7.71)
Cap: 16.50  → WITHIN
```

Cost figures are an **estimate** (per-tier baseline token counts × model-registry pricing), not a
measurement. In headless mode a machine-readable JSON line is also written to stdout.

The baselines live in the model registry
([`plugins/sdlc/config/models.json`](../plugins/sdlc/config/models.json), key
`estimation_baselines`) alongside pricing, and are priced with the **same formula** as real
transcript cost — an estimate and an actual differ only in their token counts, never in how those
tokens are valued.

> They were recalibrated in 2026-07 from 56 transcript-priced phases. The previous model assumed one
> dispatch ≈ a single API call (35k input, 60% cached, 3k output) and priced an opus row at `$0.16`.
> A phase is a multi-turn agent loop that re-reads its whole prefix every turn: measured, uncached
> input is negligible (24–194 tokens) while cache reads run 670k–820k and dominate the bill. The old
> model was wrong in *shape*, not merely magnitude, and under-reported by 6–10× — which is how the
> caps derived from it came to sit below their own median run. Current baselines land within ~11% of
> the measured median per tier; `development` carries a measured **×5.4** phase multiplier (it was
> ×1.6, reasoned from pass count rather than measured).

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
| `exceeded-undetected` | the run went over cap **without the gate catching it**. Written after the fact by cost enrichment, alongside `cap_breach_usd` (phase spend minus cap). Two causes — if any phase carries `cap_gate_blind`, it could not be priced in-run and counted as `$0` (a real gate failure); if none does, the overage landed on the last dispatch, where the gate has nothing left to stop, which usually means the cap is sized below one phase's real cost |

The cap gates **phase spend only**. Orchestration overhead (the orchestrator's own turns) is
reported in `total_cost_usd` but never enters the comparison, so a run can legitimately show a total
above the cap while `cap_status` is `within` — size recipe caps against phase spend accordingly.

**Every shipped recipe declares a cap** (a lint test enforces it). An absent cap does not mean
"generous" — it makes the gate skip entirely, which is how the default pipeline ran ungated before
these were added. Project-local recipes under `.claude/sdlc-workflows/` may still opt out.

| recipe | cap | recipe | cap |
|---|---|---|---|
| `docs-only` | $0.35 | `hotfix` | $9.00 |
| `testing` | $2.00 | `android-debug` | $11.00 |
| `analysis` | $4.25 | `default` | $12.75 |
| `debug` | $8.50 | `android-bugfix` | $12.75 |
| `bugfix` / `refactor` | $9.00 | `android-feature` | $16.50 |

All are derived the same way: **sum of measured per-phase p90 × 1.2, rounded up to the next $0.25**,
from 56 transcript-priced phases across 10 real runs. Each recipe's YAML carries its own arithmetic
in a comment. Two deliberate choices worth knowing when you tune one:

- **Review loops are not multiplied by `max_rounds`.** Six observed runs of the loop-bearing
  `android-feature` shape topped out at $9.67 — below even the un-multiplied sum — so folding in
  `max_rounds` would produce a cap no runaway could reach, which is the same as no cap.
- **The ×1.2 is headroom, not measurement.** No heal attempt has ever fired in the sample data
  (every observed `heal_status` is `skipped`), so heal cost is unmeasured; a worst-case heal
  multiplier would be invented rather than derived.

A cap is a **runaway stopper, not a budget**. Sized below a recipe's median run it becomes a
tripwire that fires every time and trains people to click through it. If a workflow should cost
less, constrain the work — fewer phases, cheaper tiers via `.claude/model.local.json` — and let the
cap follow the measurement.

#### Changing a cap for one project

Add a `cost_caps` block to `.claude/sdlc.local.yaml`:

```yaml
cost_caps:
  android-feature: 8.00     # exact recipe name — wins over "*"
  "*": 5.00                 # optional fallback for any recipe with no exact entry
  hotfix: null              # explicit null = run this recipe uncapped in this project
```

The override **replaces** the recipe's number (never combined with it, no "safest of the two"), and
is resolved in one place — orchestrator Step 1d-0 — so `--dry-run`, the live gate, and
`_telemetry.json` all agree on the value the run was gated on. Telemetry records the resolved cap in
`cost_cap_usd` plus a `cost_cap_source` of `recipe` / `project:<workflow>` / `project:*`, and the
HTML report labels an overridden cap as **(project override)** so it is never mistaken for the
shipped default. A run announces the override on startup:

```
🔧 Cost cap overridden by .claude/sdlc.local.yaml: $8.00 (was $16.50) — via project:android-feature
```

An unusable value (string, negative, nested object) is dropped with a `WARN` and the recipe's own
cap applies — a malformed override never halts a run. An entry naming a recipe you do not use is
silently ignored, not an error.

The older alternative still works and remains the right tool when you want to change *more* than the
cap: a project-local recipe at `.claude/sdlc-workflows/<name>.yaml` shadows the plugin recipe of the
same name entirely (author one with `/sdlc:workflow-config`). Prefer `cost_caps` for a cap alone —
shadowing means duplicating the phase list, `heal:` and `loop:` blocks, and your copy stops
receiving upstream recipe updates.

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
