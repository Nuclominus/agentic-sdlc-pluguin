---
description: Run the full SDLC pipeline (BA → Dev → QA → Security → Remediation? → Docs) for a feature, with auto-detection of the framework stack.
argument-hint: "<feature description> [--stack=NAME] [--dry-run] [--resume[=slug]]"
---

# /sdlc:start

Single entry point for the SDLC pipeline.

## Mandatory execution protocol

You MUST follow these steps **in order**, **printing each announcement verbatim** (do not summarize, skip, or collapse them):

### Step 1 — Validate input

If `$ARGUMENTS` is empty: ask the user for a feature description and stop. Do NOT proceed.

If `$ARGUMENTS` contains `--stack=NAME`: remember the value for the echo below, but **leave it in the
description** — the resolve command parses it itself (`tools/resolve/detect.mjs`, `forceStack`), and
stripping it here would silently disable the override.

If `$ARGUMENTS` contains `--resume` or `--resume=<slug>`: set `resume` mode. For `--resume=<slug>`
remember `<slug>` as `resume_slug`; for bare `--resume` the slug is derived from the description
exactly as in the skill's Step 2. Strip the flag from the description. Pass `resume` / `resume_slug`
to the skill in Step 2.

Print verbatim:
```
▶ /sdlc:start
   Description: <the cleaned-up description>
   Forced stack: <forced_stack or "auto-detect">
```

### Step 2 — Invoke the pipeline-orchestrator skill

Use the Skill tool to load and execute the `pipeline-orchestrator` skill. Pass `$ARGUMENTS` through unchanged apart from `--resume`. **Do not improvise or inline the orchestration logic — delegate to the skill.**

The skill enforces its own MUST-print protocol for stack detection (`🎯 Active stack profiles:`), phase boundaries (`▶ Phase N/M: ...`), and the final summary. If you find yourself not printing these — stop, re-read the skill, and start over.

### Step 3 — Hard rules during orchestration

- Do NOT edit project source files directly. The skill dispatches specialist agents for that.
- Do NOT skip the announcement prints. Each phase boundary is a contract with the user.
- Do NOT exit early after BA without running through all phases (unless an earlier phase explicitly aborted with a documented reason).

### Step 4 — On unrecoverable failure

If any phase fails fatally (e.g. agent crashes, post-validation impossible to satisfy):
- Print: `⛔ Pipeline halted at phase: <name>. Reason: <one-line>`
- Write partial telemetry to `docs/plans/{task_slug}/_telemetry.json` with `aborted_at_phase: <name>`.
- Stop. Do not continue.

---

## What the orchestrator skill does

(For your reference — the skill itself contains the authoritative algorithm.)

1. **Step 0** — one command (`tools/resolve/cli.mjs plan --json`) resolves the whole run: plugin roots, dependency preflight, stack detection (highest-priority foundation, or the one `--stack=NAME` names), skip-rules, profile merge, project overrides, model tiers, workflow and cost cap. The orchestrator echoes what it returns; it does not re-derive any of it (ADR-0019).
2. **Step 2** — generate `task_slug`, create `docs/plans/{task_slug}/`.
3. **Step 3** — execute each phase (BA → Dev → [extras] → QA → Sec → Docs) via specialist agents. Compact handoffs.
4. **Step 4** — post-pipeline checks (lint, tests, route:list).
5. **Step 5** — telemetry + final summary (MANDATORY printed).

---

## Examples

```
/sdlc:start "Add subscription billing with Stripe"
/sdlc:start "Add /healthz endpoint" --stack=vanilla
/sdlc:start "Fix typo in README"
/sdlc:start "Add dark mode" --dry-run
```

## Dry-run preview (`--dry-run`)

Add `--dry-run` to any invocation to see the resolved plan **without dispatching a single
agent or writing any code**. The orchestrator resolves the stack, workflow, phases, and
per-agent model tiers in one command, then prints a preview and **exits cleanly** — no
`docs/plans/{slug}/` workspace is created, no phases run, no post-checks, no telemetry.

It prints (Step 1d-2 in `pipeline-orchestrator/SKILL.md`):

```
🔎 DRY RUN — no agents dispatched, no code written.
Stack: <stack> | Workflow: <name>
Phases (N):
   1. business_analysis  → business-analyst (opus)   ~$0.16
   2. development         → developer (sonnet)        ~$0.11
   ...
Skip-rules applied: <...>
Estimated cost: ~$<expected>  (worst-case $<worst>)
Cap: <caps.max_total_cost_usd or "none">  → WITHIN | ⚠️ EXCEEDS by $X
```

The cost figures are a clearly-labeled **HEURISTIC estimate** (baseline token assumptions ×
model-registry pricing), not a measurement — real cost is recorded from actual usage in a
real run. In headless mode `--dry-run` also emits a machine-readable JSON line to stdout for
CI gating.

## Resuming an interrupted run (`--resume`)

If a run was interrupted (crash, cost-cap abort, fatal halt), re-invoke with `--resume` to continue
from the first unfinished phase instead of re-running everything:

```
/sdlc:start "Add subscription billing with Stripe" --resume
/sdlc:start --resume=add-subscription-billing-with-stripe
```

The orchestrator reads `docs/plans/{slug}/.checkpoint/` — phases with a `completed`/`skipped`
checkpoint are skipped (their cost is preserved in the final telemetry); the pipeline re-enters at
the first unfinished phase. Combine with `--dry-run` to preview what would be skipped without
dispatching anything.

**Non-goal:** `--resume` does NOT restore repository state. It trusts the workspace and the code on
disk; if git moved under the completed phases, that is the operator's responsibility.

## Cost caps (`caps.max_total_cost_usd`)

A workflow recipe may declare `caps.max_total_cost_usd`. In a **real run**, the orchestrator
tracks a running cost total; before dispatching the next phase, if the accumulated cost has
exceeded the cap it **pauses** and asks you to **approve continuing** or **abort** (Step
3d-cap). In headless mode a cap-exceed is treated as an **abort** with a machine-readable
stderr line and exit 1. The final telemetry records `cost_cap_usd` and `cap_status`
(`within` | `exceeded-continued` | `exceeded-aborted`). Both `--dry-run` and the real-run
gate read the cap from the resolved active workflow recipe.

## Headless mode

Set `SDLC_NONINTERACTIVE=true` in the environment to run without interactive prompts (intended for CI / automation):

- `policy=block` dependency failures emit machine-readable JSON to stdout and exit 1 (no install prompts).
- `policy=warn` failures write a single line to stderr and continue.
- `policy=graceful-degrade` is silent in both modes.

The skill picks up the env var directly (Step 0a-1 in `pipeline-orchestrator/SKILL.md`); no flag is needed on the command line.
