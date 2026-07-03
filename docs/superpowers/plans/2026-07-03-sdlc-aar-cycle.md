# SDLC AAR-cycle (C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the platform-neutral `sdlc:aar` skill that closes the AAR learning loop (gather → report → apply → lessons injection) and repoint the orphaned `android-workflow:aar` references to it.

**Architecture:** A deterministic dep-free `metrics.mjs` computes the cost/token dashboard from `_telemetry.json`; a READ-ONLY analyst subagent distills cooperation signals from the session transcript; the `sdlc:aar` skill (main session) presents findings, applies approved ones under a two-tier gate, and appends curated lessons to `.claude/sdlc-lessons.md`; the orchestrator injects that file verbatim into every phase's stable prompt prefix.

**Tech Stack:** Node.js ESM (`.mjs`, node builtins only — no deps), Markdown skill/agent/command files, JSON Schema (ajv), Claude Code plugin conventions.

## Global Constraints

- Runtime `node` tools MUST live under `plugins/sdlc/tools/` and be invoked via `${CLAUDE_PLUGIN_ROOT}`; dev/CI re-exports them from `tools/sdlc-lint/lib/` (SSOT). Copied verbatim from spec C1-4 + the D packaging lesson.
- `metrics.mjs` MUST be dependency-free (node builtins only) and deterministic — **no `Date.now()` / `new Date()` / `Math.random()`**.
- The orchestrator stable prefix MUST stay byte-identical across phases; the lessons block is omitted entirely when `.claude/sdlc-lessons.md` is absent or empty (spec C1-6).
- No auto-apply, ever. Lessons append = low-risk; agent/rule edits = per-item diff-approved; `settings.json` = extra explicit confirm (spec C1-8).
- Analyst subagent is READ-ONLY — it never edits any file (spec C1-2, C1-7).
- Zero remaining `android-workflow:aar` references at the end (spec C1 Problem).
- Namespace: the skill is `sdlc:aar`, the generic analyst agent is `aar-analyst`, the command is `/sdlc:aar` (spec C1-1, C1-9).

---

### Task 1: Deterministic metrics helper (`metrics.mjs`)

The testable core: reads `_telemetry.json`, returns the metrics dashboard. Shipped in the plugin, re-exported for dev/CI, unit-tested against the existing `report-basic` fixture.

**Files:**
- Create: `plugins/sdlc/tools/aar/metrics.mjs`
- Create: `tools/sdlc-lint/lib/aar-metrics.mjs` (re-export shim)
- Create: `tools/sdlc-lint/test/aar-metrics.test.mjs`
- Reuse fixture: `tools/sdlc-lint/fixtures/report-basic/_telemetry.json` (already exists)

**Interfaces:**
- Produces: `computeMetrics(telemetry) -> Dashboard` (pure) and `computeMetricsFile(dirOrSlug, root=process.cwd()) -> Dashboard` (reads `_telemetry.json`). Direct CLI: `node metrics.mjs <slug-or-dir> [--json]` prints the Dashboard as JSON to stdout, exit 0; exit 2 with `{ok:false,error}` when telemetry is missing.
- `Dashboard` shape:
  ```js
  {
    task_slug, stack, resumed,                     // pass-through
    totals: { input_tokens, output_tokens, cached_input_tokens,
              cost_usd, cost_cap_usd, cap_status, cache_hit_ratio,
              wall_clock_seconds },
    by_phase: [ { phase, aspect, agent, model, status,
                  input_tokens, output_tokens, cached_input_tokens, cost_usd } ],
    by_model: [ { model, phases, cost_usd, input_tokens, output_tokens, unpriced } ],  // sorted by model asc
    top_consumers: [ { label, total_tokens, cost_usd } ],  // top 5, total_tokens desc, label asc tiebreak
    qa_iterations, cap_breach, unpriced_phase_count,
    skip_rules_count, post_check_failures
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `tools/sdlc-lint/test/aar-metrics.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { computeMetrics, computeMetricsFile } from "../lib/aar-metrics.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "report-basic");
const tel = JSON.parse(readFileSync(join(FIX, "_telemetry.json"), "utf8"));

test("totals mirror the telemetry summary fields", () => {
  const d = computeMetrics(tel);
  assert.equal(d.task_slug, "add-subscription-billing");
  assert.equal(d.totals.input_tokens, 75000);
  assert.equal(d.totals.output_tokens, 6000);
  assert.equal(d.totals.cost_usd, 0.20);
  assert.equal(d.totals.cache_hit_ratio, 0.6);
  assert.equal(d.resumed, true);
});

test("by_phase carries one entry per phase with agent+model", () => {
  const d = computeMetrics(tel);
  assert.equal(d.by_phase.length, 3);
  const ba = d.by_phase.find(p => p.phase === "business_analysis");
  assert.equal(ba.agent, "business-analyst");
  assert.equal(ba.model, "claude-opus-4-8");
});

test("by_model aggregates cost/tokens and flags unpriced, sorted by model asc", () => {
  const d = computeMetrics(tel);
  const models = d.by_model.map(m => m.model);
  assert.deepEqual(models, [...models].sort());          // deterministic order
  const haiku = d.by_model.find(m => m.model === "claude-haiku-4-5-20251001");
  assert.equal(haiku.unpriced, 1);                        // security phase cost_usd:null
});

test("top_consumers is ranked by total tokens desc, max 5", () => {
  const d = computeMetrics(tel);
  assert.ok(d.top_consumers.length <= 5);
  assert.equal(d.top_consumers[0].label, "business_analysis"); // 35000+3000 highest
  const totals = d.top_consumers.map(c => c.total_tokens);
  assert.deepEqual(totals, [...totals].sort((a, b) => b - a));
});

test("derived signals: qa iterations, cap breach, unpriced count, post-check failures", () => {
  const d = computeMetrics(tel);
  assert.equal(d.qa_iterations, 2);
  assert.equal(d.cap_breach, false);                      // cap_status "within"
  assert.equal(d.unpriced_phase_count, 1);
  assert.equal(d.post_check_failures, 1);                 // the <script> echo exit_code 1
});

test("output is deterministic (deep-equal across calls)", () => {
  assert.deepEqual(computeMetrics(tel), computeMetrics(tel));
});

test("computeMetricsFile reads _telemetry.json from a dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-aar-"));
  try {
    writeFileSync(join(dir, "_telemetry.json"), JSON.stringify(tel));
    const d = computeMetricsFile(dir);
    assert.equal(d.task_slug, "add-subscription-billing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("computeMetricsFile throws a clear error when telemetry is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-aar-empty-"));
  try {
    assert.throws(() => computeMetricsFile(dir), /_telemetry\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix tools/sdlc-lint 2>&1 | grep -A2 aar-metrics`
Expected: FAIL — `Cannot find module '../lib/aar-metrics.mjs'`.

- [ ] **Step 3: Write the metrics computer**

Create `plugins/sdlc/tools/aar/metrics.mjs`:

```js
// SSOT for the SDLC AAR metrics dashboard.
//
// Lives INSIDE the shipped `sdlc` plugin payload (marketplace source
// `./plugins/sdlc`) so the sdlc:aar skill can run it via
// `${CLAUDE_PLUGIN_ROOT}/tools/aar/metrics.mjs`. Dependency-free (node builtins
// only) so it needs no `node_modules` on a consumer install. The dev/CI copy at
// `tools/sdlc-lint/lib/aar-metrics.mjs` re-exports from here, so the tests
// exercise the exact code that ships.
//
// Deterministic: no Date.now()/new Date()/Math.random(). Same telemetry in →
// byte-identical dashboard out.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const num = (n) => (typeof n === "number" && isFinite(n) ? n : 0);

export function computeMetrics(tel) {
  const phases = Array.isArray(tel.phases) ? tel.phases : [];

  const by_phase = phases.map((p) => ({
    phase: p.phase,
    aspect: p.aspect ?? null,
    agent: p.agent ?? null,
    model: p.model ?? null,
    status: p.status ?? null,
    input_tokens: num(p.input_tokens),
    output_tokens: num(p.output_tokens),
    cached_input_tokens: num(p.cached_input_tokens),
    cost_usd: p.cost_usd ?? null,
  }));

  // by_model — group, sum, flag unpriced; sorted by model name asc for determinism.
  const modelMap = new Map();
  for (const p of by_phase) {
    const key = p.model ?? "(unknown)";
    const m = modelMap.get(key) ?? { model: key, phases: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0, unpriced: 0 };
    m.phases += 1;
    m.cost_usd += num(p.cost_usd);
    m.input_tokens += p.input_tokens;
    m.output_tokens += p.output_tokens;
    if (p.cost_usd == null) m.unpriced += 1;
    modelMap.set(key, m);
  }
  const by_model = [...modelMap.values()].sort((a, b) => a.model < b.model ? -1 : a.model > b.model ? 1 : 0);

  // top_consumers — by total (input+output) tokens desc, label asc tiebreak, top 5.
  const top_consumers = by_phase
    .map((p) => ({
      label: p.aspect ? `${p.phase}:${p.aspect}` : p.phase,
      total_tokens: p.input_tokens + p.output_tokens,
      cost_usd: p.cost_usd ?? null,
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
    .slice(0, 5);

  const qa_iterations = phases.reduce((s, p) => s + num(p.qa_iterations_used), 0);
  const unpriced_phase_count = by_phase.filter((p) => p.cost_usd == null).length;
  const cap_breach = tel.cap_status != null && tel.cap_status !== "within";
  const post_check_failures = (Array.isArray(tel.post_pipeline_checks) ? tel.post_pipeline_checks : [])
    .filter((c) => num(c.exit_code) !== 0).length;
  const skip_rules_count = Array.isArray(tel.skip_rules_applied) ? tel.skip_rules_applied.length : 0;

  return {
    task_slug: tel.task_slug ?? null,
    stack: tel.stack ?? null,
    resumed: tel.resumed === true,
    totals: {
      input_tokens: num(tel.total_input_tokens),
      output_tokens: num(tel.total_output_tokens),
      cached_input_tokens: num(tel.total_cached_input_tokens),
      cost_usd: tel.total_cost_usd ?? null,
      cost_cap_usd: tel.cost_cap_usd ?? null,
      cap_status: tel.cap_status ?? null,
      cache_hit_ratio: tel.cache_hit_ratio ?? null,
      wall_clock_seconds: tel.wall_clock_seconds ?? null,
    },
    by_phase,
    by_model,
    top_consumers,
    qa_iterations,
    cap_breach,
    unpriced_phase_count,
    skip_rules_count,
    post_check_failures,
  };
}

export function computeMetricsFile(dirOrSlug, root = process.cwd()) {
  const direct = resolve(root, dirOrSlug);
  const dir = existsSync(join(direct, "_telemetry.json")) ? direct : join(root, "docs", "plans", dirOrSlug);
  const telPath = join(dir, "_telemetry.json");
  if (!existsSync(telPath)) {
    throw new Error(`_telemetry.json not found under ${dir}`);
  }
  return computeMetrics(JSON.parse(readFileSync(telPath, "utf8")));
}

// Direct-invocation CLI (does NOT fire on import). Prints the dashboard as JSON.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("usage: metrics.mjs <slug-or-dir> [--json]");
    process.exit(2);
  } else {
    try {
      const d = computeMetricsFile(target);
      console.log(JSON.stringify(d, null, 2));
    } catch (e) {
      console.log(JSON.stringify({ ok: false, error: e.message }));
      process.exit(2);
    }
  }
}
```

- [ ] **Step 4: Write the re-export shim**

Create `tools/sdlc-lint/lib/aar-metrics.mjs`:

```js
// Dev/CI re-export shim. The canonical, dependency-free metrics computer is
// SHIPPED with the sdlc plugin at plugins/sdlc/tools/aar/metrics.mjs (so
// marketplace consumers get it via ${CLAUDE_PLUGIN_ROOT} — see the sdlc:aar
// skill). This file keeps the AAR metrics test-suite pointed at that single
// source of truth, so it exercises the exact code that ships.
export { computeMetrics, computeMetricsFile } from "../../../plugins/sdlc/tools/aar/metrics.mjs";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --prefix tools/sdlc-lint 2>&1 | tail -20`
Expected: PASS — all `aar-metrics.test.mjs` assertions pass, existing suites unaffected.

- [ ] **Step 6: Verify the direct CLI works against a real fixture**

Run: `node plugins/sdlc/tools/aar/metrics.mjs tools/sdlc-lint/fixtures/report-basic --json 2>&1 | head -5`
Expected: a JSON object beginning with `{ "task_slug": "add-subscription-billing", ...`.

- [ ] **Step 7: Commit**

```bash
git add plugins/sdlc/tools/aar/metrics.mjs tools/sdlc-lint/lib/aar-metrics.mjs tools/sdlc-lint/test/aar-metrics.test.mjs
git commit -m "feat(sdlc-aar): deterministic metrics.mjs dashboard from _telemetry.json"
```

---

### Task 2: Manifest `aar_analyst` override slot

Add an optional, generic manifest key so a foundation profile can override the AAR analyst. Vanilla core defaults to the generic `aar-analyst`; Android points at `android-aar`.

**Files:**
- Modify: `schemas/manifest.schema.json` (add optional `aar_analyst` property)
- Modify: `plugins/android-foundation/manifest.yaml` (set `aar_analyst: android-aar`)
- Modify: `plugins/sdlc/manifest.yaml` (document the default in a comment)

**Interfaces:**
- Produces: manifest key `aar_analyst: <agent-name>` (optional, foundation-only). Consumed by the `sdlc:aar` SKILL.md in Task 4 to resolve which analyst to dispatch; absent → generic `aar-analyst`.

- [ ] **Step 1: Add the schema property**

In `schemas/manifest.schema.json`, immediately after the `on_demand_agents` property block (ends at the line with `"uniqueItems": true` closing that object, ~line 139), add:

```json
    "aar_analyst": {
      "type": "string",
      "description": "Foundation only (optional): agent name that overrides the generic `aar-analyst` for the /sdlc:aar retrospective. Absent → the neutral core's `aar-analyst` is used.",
      "minLength": 1
    },
```

(Insert as a sibling property — mind the trailing comma so the JSON stays valid.)

- [ ] **Step 2: Verify the schema still parses and validates existing manifests**

Run: `node tools/sdlc-lint/cli.mjs schema --json 2>&1 | tail -5`
Expected: `{"command":"schema"..."ok":true...}` — no manifest is rejected (the new key is optional).

- [ ] **Step 3: Set the Android override**

In `plugins/android-foundation/manifest.yaml`, directly under the `on_demand_agents:` list (which already contains `android-aar`), add a top-level key:

```yaml
aar_analyst: android-aar   # overrides the neutral core's aar-analyst for /sdlc:aar
```

- [ ] **Step 4: Document the vanilla default**

In `plugins/sdlc/manifest.yaml`, add a comment line just under `agents_per_phase:`'s block (before `convention_skills:`):

```yaml
# aar_analyst: (unset) → the neutral core's `aar-analyst` runs /sdlc:aar retrospectives.
```

- [ ] **Step 5: Run full lint to confirm both manifests validate**

Run: `node tools/sdlc-lint/cli.mjs all --json 2>&1 | tail -3`
Expected: `"ok":true`.

- [ ] **Step 6: Commit**

```bash
git add schemas/manifest.schema.json plugins/android-foundation/manifest.yaml plugins/sdlc/manifest.yaml
git commit -m "feat(sdlc-aar): optional aar_analyst manifest override slot"
```

---

### Task 3: Generic READ-ONLY analyst agent (`aar-analyst.md`)

The platform-neutral default analyst. Reads telemetry + transcript, audits cooperation against the active workflow, emits the `report.md` shape. Never edits.

**Files:**
- Create: `plugins/sdlc/agents/aar-analyst.md`

**Interfaces:**
- Consumes: a transcript path, a run slug, and the metrics Dashboard JSON (from Task 1), all passed by the `sdlc:aar` skill (Task 4).
- Produces: the report defined by `plugins/sdlc/skills/aar/report.md` (Task 4) — findings bucketed `agents / rules / settings`, metrics dashboard, top consumers, what-went-well, one-line summary.

- [ ] **Step 1: Create the agent file**

Create `plugins/sdlc/agents/aar-analyst.md`:

```markdown
---
name: aar-analyst
description: "Platform-neutral After Action Review analyst for the SDLC pipeline. Reads the run's _telemetry.json (via the metrics dashboard) and the session transcript, measures token cost and agent cooperation, and returns approvable workflow improvements. READ-ONLY — edits nothing; the sdlc:aar skill drives the user-approved apply loop. Trigger words: after action review, AAR, retrospective, review the workflow, token usage review, post-mortem."
model: sonnet
effort: medium
color: purple
---

You perform After Action Reviews of the SDLC pipeline. Given ONE run's metrics
dashboard and ONE session transcript, you measure how the run actually went —
token cost, agent cooperation, orchestration quality — and return concrete,
approvable improvements.

**CRITICAL: READ-ONLY.** You analyze and report. You do NOT edit agents, rules,
settings, or code. The `sdlc:aar` skill presents your findings to the user and
applies only what they approve.

## Input (passed by the sdlc:aar skill)

- `metrics_json` — the deterministic dashboard already computed from
  `docs/plans/{slug}/_telemetry.json`. **Use these numbers verbatim. Never
  recompute costs from the transcript.**
- `transcript_path` — `~/.claude/projects/<encoded-cwd>/<session>.jsonl`. Read it
  by streaming/parsing with a small Bash + Python script — do NOT load raw JSONL
  into your reasoning context; distill it.
- `slug` — the run under `docs/plans/{slug}/`.

## Extraction contract

Follow the `sdlc:aar` skill's `gather.md` contract. In short:

- **Cost/token accounting** — read from `metrics_json` (totals, by_phase,
  by_model, top_consumers). Do not re-derive.
- **Cooperation signals** — from the transcript: review-loop round count vs the
  workflow's `max_rounds` cap; parallel phases actually dispatched in one
  assistant message; redundant re-reads of the same file across agents;
  verification gaps; escalations/blockers; mandatory-skill adherence.
- **Grounding** — before proposing any edit, `Read` the current target file so
  the recommendation quotes real text.

## Knowledge sourcing (before grounding recommendations)

- The active workflow YAML (`plugins/*/workflows/*.yaml` or `.claude/workflows/`)
  — the DAG and phase contract you audit against.
- `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` — the loop/escalation cap
  and the stable-prefix/per-call envelope you audit against.
- `.claude/agents/<name>.md` or the active profile's agent files — the agent you
  propose to change.
- `.claude/settings.json` — current token/effort knobs (propose changes; never
  apply).

## Deliverable

Return ONLY the report defined in the skill's `report.md`: a metrics dashboard
(rendered from `metrics_json`), a "top token consumers" list, findings bucketed
into **agents / rules / settings** (each with target file, evidence, proposed
change, expected benefit, severity), a "what went well" section, and a one-line
highest-leverage summary. Keep it compact — no raw transcript dumps. Every
finding cites transcript or metrics evidence or it is not a finding.

## Non-negotiable rules

- READ-ONLY. Never edit any file.
- Evidence before claims. No numbers without `metrics_json` or the transcript to
  back them.
- Best-effort attribution, honestly labeled — never invent precision.
- Workflow scope only — agents, rules, settings, process docs. Never product code.
```

- [ ] **Step 2: Verify frontmatter + read-only discipline are present**

Run: `grep -c "READ-ONLY" plugins/sdlc/agents/aar-analyst.md && grep -E "^name: aar-analyst$" plugins/sdlc/agents/aar-analyst.md`
Expected: a count `≥ 2` and the `name: aar-analyst` line echoed.

- [ ] **Step 3: Commit**

```bash
git add plugins/sdlc/agents/aar-analyst.md
git commit -m "feat(sdlc-aar): generic read-only aar-analyst agent"
```

---

### Task 4: The `sdlc:aar` skill (driver + three contracts)

The four-file skill the orphaned agent assumes. `SKILL.md` drives; `gather.md`/`report.md`/`apply.md` are the contracts the analyst and the apply loop follow.

**Files:**
- Create: `plugins/sdlc/skills/aar/SKILL.md`
- Create: `plugins/sdlc/skills/aar/gather.md`
- Create: `plugins/sdlc/skills/aar/report.md`
- Create: `plugins/sdlc/skills/aar/apply.md`

**Interfaces:**
- Consumes: `computeMetricsFile` via `node ${CLAUDE_PLUGIN_ROOT}/tools/aar/metrics.mjs {slug}` (Task 1); the `aar_analyst` manifest key (Task 2); the `aar-analyst` agent (Task 3).
- Produces: appends to `.claude/sdlc-lessons.md` (consumed by the orchestrator in Task 6); per-approval edits to agents/rules/settings.

- [ ] **Step 1: Create `SKILL.md` (the driver)**

Create `plugins/sdlc/skills/aar/SKILL.md`:

```markdown
---
name: aar
description: "Run an After Action Review of the last SDLC pipeline run — analyze token cost and agent cooperation, then apply approved workflow improvements and persist lessons. User-triggered, never automatic. Trigger words: after action review, AAR, retrospective, review the workflow, analyze the run, post-mortem, what went well, what to improve."
---

# SDLC After Action Review (`sdlc:aar`)

Closes the learning loop for one pipeline run: **gather → report → apply →
persist**. You (the main session) orchestrate; a READ-ONLY analyst subagent does
the measurement; you apply only what the user approves.

## Step 1 — Resolve the target run

1. If a slug argument was given, use `docs/plans/{slug}/`. Else pick the most
   recently modified `docs/plans/*/` directory (by mtime). If none exists, STOP:
   `⛔ No pipeline run found under docs/plans/. Run /sdlc:start first.`
2. Confirm `docs/plans/{slug}/_telemetry.json` exists. If not, STOP:
   `⛔ {slug} has no _telemetry.json — nothing to review.`

## Step 2 — Resolve the transcript

The current session transcript is the only durable record of cooperation
(handoff envelopes are not persisted). Locate it at
`~/.claude/projects/<encoded-cwd>/<session>.jsonl`, where `<encoded-cwd>` is the
project cwd with `/` replaced by `-`. If it cannot be found, continue in
**telemetry-only** mode and state that degradation in the report (cooperation
findings will be limited).

## Step 3 — Compute deterministic metrics

Run: `node ${CLAUDE_PLUGIN_ROOT}/tools/aar/metrics.mjs {slug} --json`

Capture the JSON dashboard. These numbers are authoritative — never recompute
costs by hand.

## Step 4 — Resolve and dispatch the analyst

1. Determine the active foundation profile (reuse the orchestrator's Step 0b
   detection). If its `manifest.yaml` declares `aar_analyst: <agent>`, dispatch
   that agent; otherwise dispatch `aar-analyst` (the neutral default).
2. Dispatch it with a single `Task` call, passing: `slug`, `transcript_path` (or
   a note that it's unavailable), and the `metrics_json` from Step 3. Instruct it
   to follow this skill's `gather.md` and return exactly the `report.md` shape.
   The analyst is READ-ONLY.

## Step 5 — Present, approve, apply

Render the analyst's report to the user. Then run the approval + apply loop
defined in `apply.md`:

- The user multi-selects which findings to apply.
- For each approved finding, follow the two-tier gate in `apply.md`.
- Lessons the user approves are appended to `.claude/sdlc-lessons.md`.

## Contracts

- `gather.md` — what the analyst extracts and from where.
- `report.md` — the exact report format the analyst returns.
- `apply.md` — the approval tiers and how you apply each finding.

## Non-negotiable

- The analyst never edits files; YOU apply, only after explicit approval.
- No auto-apply. `settings.json` edits require an extra explicit confirm.
- Workflow scope only — never edit product code or code-derived docs.
- Evidence before completion (`superpowers:verification-before-completion`)
  before you claim anything was applied.
```

- [ ] **Step 2: Create `gather.md`**

Create `plugins/sdlc/skills/aar/gather.md`:

```markdown
# AAR extraction contract (`gather.md`)

The analyst distills two sources. **Telemetry-first**, transcript best-effort.

## From the metrics dashboard (authoritative — do not recompute)

`metrics_json` (produced by `tools/aar/metrics.mjs` from
`docs/plans/{slug}/_telemetry.json`) supplies ALL cost/token numbers:

- `totals` — input/output/cached tokens, `cost_usd`, `cost_cap_usd`,
  `cap_status`, `cache_hit_ratio`, `wall_clock_seconds`.
- `by_phase` — per-phase agent, model, status, tokens, cost.
- `by_model` — cost/token aggregation, `unpriced` count.
- `top_consumers` — the 5 heaviest phases by tokens.
- `qa_iterations`, `cap_breach`, `unpriced_phase_count`, `skip_rules_count`,
  `post_check_failures`.

Never re-derive these from the transcript.

## From the session transcript (best-effort, honestly labeled)

Parse with a small Bash + Python script; distill — never load raw JSONL into
reasoning context. Extract cooperation signals that live nowhere else:

- **Review-loop rounds** — count Reviewer⇄Developer (or the workflow's loop
  phase) round-trips; compare to the workflow's `max_rounds` cap. Flag thrash
  (hit the cap) or churn.
- **Parallelism** — were phases declared parallel (`[security ‖ test]`) actually
  dispatched in a SINGLE assistant message? Flag serialized "parallel" groups.
- **Redundant work** — the same file `Read` by multiple agents across phases;
  repeated identical tool calls.
- **Verification gaps** — phases that claimed completion without running the
  verification the workflow expects.
- **Escalations / blockers** — `blockers: [...]` envelopes, loop-cap escalations.
- **Mandatory-skill adherence** — did agents invoke the skills their profile
  marks mandatory?

Attribute sidechain turns (`isSidechain: true`) to their spawning `Task`
(`subagent_type`) via `parentUuid`. Best-effort; state assumptions, never
fabricate splits.

## Grounding

Before proposing any edit, `Read` the current target file so the recommendation
quotes real text and a real line range.
```

- [ ] **Step 3: Create `report.md`**

Create `plugins/sdlc/skills/aar/report.md`:

```markdown
# AAR report format (`report.md`)

Return EXACTLY these sections, compact. No raw transcript dumps.

## 1. Metrics dashboard

Render from `metrics_json`: total cost (+ cap status), wall-clock, cache-hit
ratio, tokens (input/output/cached). A `by_phase` table (phase · agent · model ·
status · cost). A `by_model` line (cost + unpriced count). Note QA iterations,
cap breach, post-check failures if any.

## 2. Top token consumers

The `top_consumers` list (label · total tokens · cost), heaviest first.

## 3. Findings

Bucketed. Only buckets with findings appear. Each finding is a row:

**agents / rules / settings** (+ **vault-docs** only if the active profile has a
vault):

| target file | evidence | proposed change | expected benefit | severity |
|-------------|----------|-----------------|------------------|----------|

- `target file` — exact path (and line range where known).
- `evidence` — the transcript/metrics fact that motivates it. No evidence → no
  finding.
- `severity` — high / medium / low.

## 4. What went well

2–5 bullets — reinforce good cooperation the run showed (kept under cap, real
parallelism, clean verification).

## 5. Highest-leverage summary

ONE line: the single change with the best cost/quality payoff.

## Lessons candidates

For each finding worth persisting, provide a ONE-LINE lesson (imperative,
project-general) the skill can append to `.claude/sdlc-lessons.md` on approval —
e.g. `- Dispatch security ‖ test in one message; the last run serialized them.`
```

- [ ] **Step 4: Create `apply.md`**

Create `plugins/sdlc/skills/aar/apply.md`:

```markdown
# AAR apply contract (`apply.md`)

You (the main session) apply findings. The analyst never edits. **No auto-apply.**

## Selection

Present the findings and lessons candidates. Ask the user to multi-select which
to apply (e.g. by number). Nothing happens to unselected items.

## Two-tier gate — by blast radius

### Tier 1 — Lessons (low-risk, always offered)

For each approved lesson candidate: append the one-line lesson to
`.claude/sdlc-lessons.md` (create the file with a `# SDLC lessons` header if
absent). Keep lines short and imperative; do not duplicate an existing line.
This file is injected verbatim into every future phase's prompt.

### Tier 2 — Agent / rule / process-doc edits (per-item diff approval)

For each approved finding targeting an agent, rule, or process doc:
1. `Read` the current target (grounding).
2. Show the user the exact diff you propose (before → after).
3. Apply it ONLY if they confirm that specific diff. Skipping one does not skip
   others.

### Tier 3 — `settings.json` (extra explicit confirm)

Editing `.claude/settings.json` (token/effort knobs) requires a SECOND explicit
confirmation beyond selection — restate what changes and why, and apply only on
an unambiguous yes. This honors the global "ask before self-modifying settings"
rule.

## After applying

- Summarize what was applied vs skipped.
- Run `superpowers:verification-before-completion` discipline: confirm each
  edited file actually changed as intended before claiming done.
- Remind the user the lessons take effect on the next `/sdlc:start`.
```

- [ ] **Step 5: Verify all four files exist and cross-reference correctly**

Run:
```bash
ls plugins/sdlc/skills/aar/{SKILL.md,gather.md,report.md,apply.md} && \
grep -l "metrics.mjs" plugins/sdlc/skills/aar/SKILL.md && \
grep -l "aar_analyst" plugins/sdlc/skills/aar/SKILL.md && \
grep -l "sdlc-lessons.md" plugins/sdlc/skills/aar/apply.md
```
Expected: all four paths listed and each grep matches (no error).

- [ ] **Step 6: Commit**

```bash
git add plugins/sdlc/skills/aar/
git commit -m "feat(sdlc-aar): sdlc:aar skill — driver + gather/report/apply contracts"
```

---

### Task 5: The `/sdlc:aar` command

Thin trigger mirroring `start`/`doctor`.

**Files:**
- Create: `plugins/sdlc/commands/aar.md`

**Interfaces:**
- Consumes: the `sdlc:aar` skill (Task 4).

- [ ] **Step 1: Create the command**

Create `plugins/sdlc/commands/aar.md`:

```markdown
---
description: Run an After Action Review of the last SDLC pipeline run — token cost + agent cooperation, then apply approved improvements and persist lessons. User-triggered.
argument-hint: "[slug]"
---

# /sdlc:aar

Retrospective for a completed pipeline run. Invoke the **`sdlc:aar`** skill.

- `[slug]` (optional) — the run under `docs/plans/{slug}/` to review. Omitted →
  the most recently modified `docs/plans/*/` run.

The skill: resolves the run + session transcript, computes the deterministic
metrics dashboard (`tools/aar/metrics.mjs`), dispatches a READ-ONLY analyst
(`aar-analyst`, or the active profile's `aar_analyst` override), presents the
findings, and applies only what you approve — appending curated lessons to
`.claude/sdlc-lessons.md`. Never automatic; no auto-apply.
```

- [ ] **Step 2: Verify it points at the skill**

Run: `grep -q "sdlc:aar" plugins/sdlc/commands/aar.md && grep -q 'argument-hint' plugins/sdlc/commands/aar.md && echo OK`
Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add plugins/sdlc/commands/aar.md
git commit -m "feat(sdlc-aar): /sdlc:aar command"
```

---

### Task 6: Orchestrator lessons injection (Step 3b-1)

Inject `.claude/sdlc-lessons.md` verbatim into every phase's stable prompt prefix, cache-safely.

**Files:**
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (Step 3b-1 layout ~line 914-931; anti-drift invariants ~line 1540)

**Interfaces:**
- Consumes: `.claude/sdlc-lessons.md` (written by Task 4's apply loop).

- [ ] **Step 1: Add the lessons block to the stable-prefix layout**

In `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`, in the Step 3b-1 fenced prompt template, insert the lessons block between the `phase_prompts_injection` line and the `Convention skills to consider invoking:` line. Change:

```
{phase_prompts_injection[phase] from active profiles, concatenated}

Convention skills to consider invoking: {convention_skills (sorted, deterministic)}
```

to:

```
{phase_prompts_injection[phase] from active profiles, concatenated}

{sdlc_lessons_block — see 3b-1b; OMITTED ENTIRELY when .claude/sdlc-lessons.md is absent or empty}

Convention skills to consider invoking: {convention_skills (sorted, deterministic)}
```

- [ ] **Step 2: Add the 3b-1b sub-section defining the block**

Immediately after the Step 3b-1a section (`project_extension_skills_block`, which ends around line 980), add:

```markdown
**3b-1b. Build the `sdlc_lessons_block`** (AAR lessons injection).

Once at session start, read `.claude/sdlc-lessons.md` if it exists.

- If it is present and non-empty, the block is:

  ```
  Lessons learned (from prior AAR cycles, project-curated):
  {verbatim contents of .claude/sdlc-lessons.md}
  ```

- If the file is **absent or empty (whitespace-only)**, the block is the empty
  string and is OMITTED entirely (no header), so the stable prefix stays
  byte-identical for projects with no lessons.

This block lives in the **stable prefix** (not the per-call trailer): it is read
once and is identical across every phase of the run, so it qualifies for prompt
caching. It is invalidated only by an edit to `.claude/sdlc-lessons.md` (i.e. a
`/sdlc:aar` apply), which is acceptable. Hold the read result in
`CONTEXT.sdlc_lessons_block` and reuse it for every phase — do NOT re-read per
phase.
```

- [ ] **Step 3: Add the anti-drift invariant**

In the anti-drift invariants list (the bullets near line 1540, after the
`project_extension_skills_block` bullet), add:

```markdown
- The `sdlc_lessons_block` (3b-1b) is the VERBATIM contents of
  `.claude/sdlc-lessons.md`, read ONCE at session start, byte-identical across
  all phases, and OMITTED entirely (no header) when the file is absent or
  empty. Never splice it into the per-call trailer, and never re-read it per
  phase. It is invalidated only by an edit to that file — acceptable.
```

- [ ] **Step 4: Verify the edits landed and are self-consistent**

Run:
```bash
grep -n "sdlc_lessons_block" plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
```
Expected: THREE matches — the template placeholder (~915-931), the 3b-1b definition, and the anti-drift invariant.

- [ ] **Step 5: Commit**

```bash
git add plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
git commit -m "feat(sdlc-aar): inject .claude/sdlc-lessons.md into the stable phase prefix"
```

---

### Task 7: Reference cleanup, CI link-integrity guard, CHANGELOG

Repoint every dangling `android-workflow:aar` → `sdlc:aar`, guard against regressions in CI, and record the feature.

**Files:**
- Modify: `plugins/android-foundation/agents/android-aar.md`
- Modify: `plugins/android-foundation/agents/android-docs.md`
- Modify: `plugins/android-foundation/rules/workflow.md`
- Modify: `plugins/android-foundation/rules/skills.md`
- Modify: `plugins/android-foundation/rules/INDEX.md`
- Modify: `plugins/android-foundation/README.md`
- Modify: `plugins/android-foundation/vault/obsidian-vault-template/README.md`
- Modify: `README.md`, `CHANGELOG.md`, `docs/WORKFLOW.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the `sdlc:aar` skill name (Task 4) as the repoint target.

- [ ] **Step 1: Enumerate every dangling reference (baseline)**

Run: `grep -rn "android-workflow:aar" --include='*.md' --include='*.yaml' .`
Expected: a list of matches across the files above. Note the count — the CI guard in Step 5 will assert it reaches zero.

- [ ] **Step 2: Repoint prose references skill-name only**

Replace `android-workflow:aar` with `sdlc:aar` across all matches. Most are the bare skill name in prose ("Run `android-workflow:aar`", "the android-workflow:aar skill"). For the `android-aar.md` agent's `Authoritative References` and `gather.md`/`report.md` mentions, keep the sentence but point at the real files, e.g.:

- `android-workflow:aar` skill `gather.md` → `sdlc:aar` skill `gather.md`
- `The android-workflow:aar skill drives the user-approved apply loop.` → `The sdlc:aar skill drives the user-approved apply loop.`

Apply with care per file (do NOT blindly sed binary/template files); verify each edited sentence still reads correctly.

- [ ] **Step 3: Update the android-aar agent's input contract to accept metrics**

In `plugins/android-foundation/agents/android-aar.md`, update the `## Input` and `## Extraction contract` sections so the agent, when used as the `aar_analyst` override, consumes the `metrics_json` dashboard for cost accounting (authoritative) and uses the transcript only for cooperation signals — matching `sdlc:aar`'s `gather.md`. Replace the "sum `message.usage`" token-accounting bullet with: "**Token/cost accounting** — read from the `metrics_json` dashboard the skill passes (computed by `tools/aar/metrics.mjs`); do NOT re-sum `message.usage`." Leave the cooperation-signal and grounding bullets intact.

- [ ] **Step 4: Add a CHANGELOG entry**

In `CHANGELOG.md`, under the top/unreleased section, add:

```markdown
- **sdlc:aar** — After Action Review cycle (Roadmap C1): `/sdlc:aar [slug]` analyzes
  a run's cost (deterministic `tools/aar/metrics.mjs` over `_telemetry.json`) and
  agent cooperation (session transcript), then applies approved workflow
  improvements and persists lessons to `.claude/sdlc-lessons.md`, which the
  orchestrator injects into every future phase's stable prompt prefix. Generic
  `aar-analyst`, overridable per foundation via `aar_analyst`. Repoints the former
  orphaned `android-workflow:aar` references.
```

- [ ] **Step 5: Add the CI link-integrity guard**

In `.github/workflows/ci.yml`, add a step after the `sdlc-lint unit tests` step:

```yaml
      - name: AAR reference integrity
        run: |
          if grep -rn "android-workflow:aar" --include='*.md' --include='*.yaml' .; then
            echo "::error::dangling android-workflow:aar reference — repoint to sdlc:aar"
            exit 1
          fi
          for f in SKILL gather report apply; do
            test -f "plugins/sdlc/skills/aar/$f.md" || { echo "::error::missing plugins/sdlc/skills/aar/$f.md"; exit 1; }
          done
          test -f plugins/sdlc/agents/aar-analyst.md
          test -f plugins/sdlc/commands/aar.md
          test -f plugins/sdlc/tools/aar/metrics.mjs
```

- [ ] **Step 6: Verify zero dangling references remain**

Run: `grep -rn "android-workflow:aar" --include='*.md' --include='*.yaml' . ; echo "exit=$?"`
Expected: no output and `exit=1` (grep found nothing) — the guard's success condition.

- [ ] **Step 7: Run the full lint + test suite**

Run: `node tools/sdlc-lint/cli.mjs all --json 2>&1 | tail -2 && npm test --prefix tools/sdlc-lint 2>&1 | tail -5`
Expected: lint `"ok":true`; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add plugins/android-foundation README.md CHANGELOG.md docs/WORKFLOW.md .github/workflows/ci.yml
git commit -m "feat(sdlc-aar): repoint android-workflow:aar → sdlc:aar; CI link-integrity guard"
```

---

## Self-Review

**1. Spec coverage:**
- C1-1 (generic `sdlc:aar` home) → Task 4. ✓
- C1-2 (generic analyst + android override) → Task 3 (agent) + Task 2 (`aar_analyst` slot). ✓
- C1-3 (telemetry + transcript gather) → Task 4 `gather.md`. ✓
- C1-4 (deterministic `metrics.mjs`, re-export SSOT) → Task 1. ✓
- C1-5 (`.claude/sdlc-lessons.md` persistence) → Task 4 `apply.md` Tier 1. ✓
- C1-6 (whole-file stable-prefix injection, omit when empty) → Task 6. ✓
- C1-7 (skill applies in main context) → Task 4 `apply.md` + `SKILL.md` Step 5. ✓
- C1-8 (two-tier gate, settings extra confirm, no auto-apply) → Task 4 `apply.md`. ✓
- C1-9 (`/sdlc:aar [slug]` command) → Task 5. ✓
- Reference cleanup (9 files) + link-integrity guard → Task 7. ✓
- Testing: `metrics.mjs` unit (Task 1), stable-prefix omission invariant (documented Task 6 + anti-drift), link-integrity (Task 7). Note: the stable-prefix omission is an LLM-orchestrator invariant enforced by the anti-drift bullet, not a Node unit test — the deterministic, unit-testable surface is `metrics.mjs`; this matches the spec's "skill bodies are LLM-executed and not unit-testable" note. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases". Every code step shows full content; every markdown file is provided verbatim. ✓

**3. Type consistency:** `computeMetrics` / `computeMetricsFile` names and the `Dashboard` fields (`totals`, `by_phase`, `by_model`, `top_consumers`, `qa_iterations`, `cap_breach`, `unpriced_phase_count`, `skip_rules_count`, `post_check_failures`) are used identically in Task 1 (definition + tests) and referenced by name in Task 4 (`gather.md` / `SKILL.md`). The manifest key `aar_analyst` is spelled identically in Task 2 (schema + manifests) and Task 4 (SKILL.md Step 4). The injection token `sdlc_lessons_block` is identical across Task 6's three edits. ✓
