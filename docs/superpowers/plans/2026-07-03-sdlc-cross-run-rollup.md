# SDLC cross-run rollup (`/sdlc:report`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, dependency-free `/sdlc:report` that globs every run's
`docs/plans/*/_telemetry.json`, aggregates a cross-run rollup, and renders both
`docs/plans/rollup/index.html` and a terminal digest.

**Architecture:** New plugin tool dir `plugins/sdlc/tools/rollup/` with a pure-function core
(`rollup.mjs`) reusing the existing per-run `computeMetrics` (`tools/aar/metrics.mjs`) plus a
dep-free `cli.mjs`. A thin `/sdlc:report` command (no LLM skill) runs the CLI. Dev/CI SSOT via a
re-export shim, an `sdlc-lint rollup` verb, a fixture, and a `node --test` suite.

**Tech Stack:** Node.js ESM (`.mjs`), node builtins only (`fs`, `path`, `url`, `os`), `node:test`.

## Global Constraints

- **Dependency-free**: node builtins only in `plugins/sdlc/tools/rollup/*` — no `ajv`, `yaml`,
  `tinyglobby`, etc. (a consumer install has no `node_modules`).
- **Deterministic**: no `Date.now()`, `new Date()`, `Math.random()`. Same telemetry set →
  byte-identical HTML and text.
- **Ships inside the plugin**: runtime code lives under `plugins/sdlc/tools/rollup/` and is
  invoked via `${CLAUDE_PLUGIN_ROOT}` — never a repo-root path. Dev/CI copy is a thin re-export
  so tests exercise the shipped bytes.
- **Reuse, don't reinvent**: per-run reduction goes through `computeMetrics` from
  `../aar/metrics.mjs`; do not re-implement per-run math.
- **Self-contained HTML**: no `http(s)://`, no `src=`, no `<link>`, no `@import`; escape every
  untrusted field.
- **Empty run-set is success**: `run_count: 0` → valid "no runs yet" page, exit 0.

---

### Task 1: `computeRollup` core aggregation + fixtures + SSOT shim

**Files:**
- Create: `plugins/sdlc/tools/rollup/rollup.mjs`
- Create: `tools/sdlc-lint/lib/rollup.mjs` (re-export shim)
- Create: `tools/sdlc-lint/fixtures/rollup-multi/docs/plans/run-a/_telemetry.json`
- Create: `tools/sdlc-lint/fixtures/rollup-multi/docs/plans/run-b/_telemetry.json`
- Create: `tools/sdlc-lint/fixtures/rollup-multi/docs/plans/run-c/_telemetry.json`
- Test: `tools/sdlc-lint/test/rollup.test.mjs`

**Interfaces:**
- Consumes: `computeMetrics(telemetry)` from `plugins/sdlc/tools/aar/metrics.mjs` (returns
  `{ task_slug, stack, resumed, totals:{ input_tokens, output_tokens, cached_input_tokens,
  cost_usd, cost_cap_usd, cap_status, cache_hit_ratio }, by_phase:[{phase,cost_usd,input_tokens,
  output_tokens,...}], by_model:[{model,phases,cost_usd,input_tokens,output_tokens,unpriced}],
  qa_iterations, cap_breach, unpriced_phase_count, skip_rules_count }`).
- Produces: `computeRollup(runs)` where `runs = [{ slug: string, telemetry: object }]` →
  aggregate object (shape asserted below). Pure, no I/O.

- [ ] **Step 1: Create the three fixture telemetry files**

`tools/sdlc-lint/fixtures/rollup-multi/docs/plans/run-a/_telemetry.json`:
```json
{
  "task_slug": "billing",
  "stack": "android",
  "primary_profile": "android",
  "resumed": true,
  "started_at": "2026-07-01T09:00:00Z",
  "phases": [
    { "phase": "business_analysis", "agent": "business-analyst", "model": "claude-opus-4-8", "status": "completed", "input_tokens": 30000, "output_tokens": 2500, "cached_input_tokens": 18000, "cost_usd": 0.14 },
    { "phase": "development", "aspect": "backend", "agent": "developer", "model": "claude-sonnet-5", "status": "completed", "input_tokens": 20000, "output_tokens": 1500, "cached_input_tokens": 9000, "cost_usd": 0.06, "qa_iterations_used": 0 },
    { "phase": "qa", "agent": "qa-engineer", "model": "claude-sonnet-5", "status": "completed", "qa_iterations_used": 2, "input_tokens": 10000, "output_tokens": 800, "cached_input_tokens": 5000, "cost_usd": 0.0 }
  ],
  "skip_rules_applied": [ { "rule": "config-only", "phase_skipped": "security", "reason": "config paths only" } ],
  "total_input_tokens": 60000,
  "total_output_tokens": 4800,
  "total_cached_input_tokens": 32000,
  "total_cost_usd": 0.20,
  "cost_cap_usd": 0.60,
  "cap_status": "within",
  "cache_hit_ratio": 0.53
}
```

`tools/sdlc-lint/fixtures/rollup-multi/docs/plans/run-b/_telemetry.json`:
```json
{
  "task_slug": "auth-refresh",
  "stack": "android",
  "primary_profile": "android",
  "resumed": false,
  "started_at": "2026-07-02T09:00:00Z",
  "phases": [
    { "phase": "business_analysis", "agent": "business-analyst", "model": "claude-opus-4-8", "status": "completed", "input_tokens": 40000, "output_tokens": 3200, "cached_input_tokens": 20000, "cost_usd": 0.30 },
    { "phase": "development", "agent": "developer", "model": "claude-opus-4-8", "status": "completed", "input_tokens": 35000, "output_tokens": 3000, "cached_input_tokens": 12000, "cost_usd": 0.20, "qa_iterations_used": 0 },
    { "phase": "qa", "agent": "qa-engineer", "model": "claude-haiku-4-5-20251001", "status": "completed", "qa_iterations_used": 1, "input_tokens": 8000, "output_tokens": 600, "cached_input_tokens": 3000, "cost_usd": 0.05 }
  ],
  "total_input_tokens": 83000,
  "total_output_tokens": 6800,
  "total_cached_input_tokens": 35000,
  "total_cost_usd": 0.55,
  "cost_cap_usd": 0.50,
  "cap_status": "over",
  "cache_hit_ratio": 0.42
}
```

`tools/sdlc-lint/fixtures/rollup-multi/docs/plans/run-c/_telemetry.json`:
```json
{
  "task_slug": "search-index",
  "stack": "android",
  "primary_profile": "android",
  "resumed": false,
  "started_at": "2026-07-03T09:00:00Z",
  "phases": [
    { "phase": "development", "agent": "developer", "model": "claude-sonnet-5", "status": "completed", "input_tokens": 22000, "output_tokens": 1800, "cached_input_tokens": 11000, "cost_usd": 0.07, "qa_iterations_used": 0 },
    { "phase": "security", "agent": "security-analyst", "model": "claude-haiku-4-5-20251001", "status": "completed", "input_tokens": 9000, "output_tokens": 700, "cached_input_tokens": 4000, "cost_usd": null }
  ],
  "total_input_tokens": 31000,
  "total_output_tokens": 2500,
  "total_cached_input_tokens": 15000,
  "total_cost_usd": 0.07,
  "cost_cap_usd": 0.40,
  "cap_status": "within",
  "cache_hit_ratio": 0.48
}
```

- [ ] **Step 2: Write the failing test**

Create `tools/sdlc-lint/test/rollup.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeRollup } from "../lib/rollup.mjs";

const FIXROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "rollup-multi", "docs", "plans");
const load = (slug) => JSON.parse(readFileSync(join(FIXROOT, slug, "_telemetry.json"), "utf8"));
const runs = () => [
  { slug: "run-c", telemetry: load("run-c") }, // intentionally unsorted input
  { slug: "run-a", telemetry: load("run-a") },
  { slug: "run-b", telemetry: load("run-b") },
];
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test("run_count and run order (started_at asc)", () => {
  const agg = computeRollup(runs());
  assert.equal(agg.run_count, 3);
  assert.deepEqual(agg.runs.map((r) => r.slug), ["run-a", "run-b", "run-c"]);
});

test("totals sum across runs; cache-hit is token-weighted", () => {
  const agg = computeRollup(runs());
  close(agg.totals.cost_usd, 0.82);
  assert.equal(agg.totals.input_tokens, 174000);
  assert.equal(agg.totals.output_tokens, 14100);
  close(agg.totals.cache_hit_ratio_weighted, 82000 / 174000); // NOT the mean of per-run ratios
  assert.equal(agg.totals.cap_breaches, 1);
  assert.equal(agg.totals.skip_rules, 1);
  assert.equal(agg.totals.qa_iterations, 3);
  assert.equal(agg.totals.unpriced_runs, 1);
});

test("per-run rows carry cost/cache/cap flags", () => {
  const agg = computeRollup(runs());
  const b = agg.runs.find((r) => r.slug === "run-b");
  assert.equal(b.cap_breach, true);
  assert.equal(b.cap_status, "over");
  const c = agg.runs.find((r) => r.slug === "run-c");
  assert.equal(c.unpriced, true);
});

test("by_model folds cost/tokens, sorted cost desc, model asc tiebreak", () => {
  const agg = computeRollup(runs());
  assert.deepEqual(agg.by_model.map((m) => m.model), [
    "claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001",
  ]);
  close(agg.by_model[0].cost_usd, 0.64);
  const haiku = agg.by_model.find((m) => m.model === "claude-haiku-4-5-20251001");
  assert.equal(haiku.unpriced, 1); // run-c security phase
});

test("by_phase folds by phase name, sorted cost desc", () => {
  const agg = computeRollup(runs());
  assert.equal(agg.by_phase[0].phase, "business_analysis");
  close(agg.by_phase[0].cost_usd, 0.44);
  const dev = agg.by_phase.find((p) => p.phase === "development");
  assert.equal(dev.runs, 3); // 3 occurrences
  close(dev.cost_usd, 0.33);
});

test("cost_over_time cumulative is monotonic and ordered like runs", () => {
  const agg = computeRollup(runs());
  assert.deepEqual(agg.cost_over_time.map((c) => c.slug), ["run-a", "run-b", "run-c"]);
  const cum = agg.cost_over_time.map((c) => c.cumulative_usd);
  for (let i = 1; i < cum.length; i++) assert.ok(cum[i] >= cum[i - 1]);
  close(cum[cum.length - 1], 0.82);
});

test("qa_distribution counts iteration frequencies", () => {
  const agg = computeRollup(runs());
  assert.deepEqual(agg.qa_distribution, { "2": 1, "1": 1, "0": 1 });
});

test("incidents capture cap breach and skips", () => {
  const agg = computeRollup(runs());
  assert.equal(agg.incidents.cap_breaches.length, 1);
  assert.equal(agg.incidents.cap_breaches[0].slug, "run-b");
  assert.equal(agg.incidents.skips.length, 1);
  assert.equal(agg.incidents.skips[0].phase_skipped, "security");
});

test("deterministic (deep-equal across calls)", () => {
  assert.deepEqual(computeRollup(runs()), computeRollup(runs()));
});

test("empty run-set → run_count 0, null cost", () => {
  const agg = computeRollup([]);
  assert.equal(agg.run_count, 0);
  assert.equal(agg.totals.cost_usd, null);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/rollup.test.mjs`
Expected: FAIL — `Cannot find module '../lib/rollup.mjs'` (shim + source not created yet).

- [ ] **Step 4: Create the SSOT re-export shim**

Create `tools/sdlc-lint/lib/rollup.mjs`:
```js
// Dev/CI re-export shim. The canonical, dependency-free cross-run rollup is
// SHIPPED with the sdlc plugin at plugins/sdlc/tools/rollup/rollup.mjs (so
// marketplace consumers get it via ${CLAUDE_PLUGIN_ROOT} — see the /sdlc:report
// command). This file keeps the `sdlc-lint rollup` verb and the rollup test-suite
// pointed at that single source of truth, so they exercise the exact code that ships.
export { computeRollup } from "../../../plugins/sdlc/tools/rollup/rollup.mjs";
```

- [ ] **Step 5: Create `rollup.mjs` with helpers + `computeRollup`**

Create `plugins/sdlc/tools/rollup/rollup.mjs`:
```js
// SSOT for the SDLC cross-run rollup (/sdlc:report).
//
// Lives INSIDE the shipped `sdlc` plugin payload so the /sdlc:report command can
// run it via `${CLAUDE_PLUGIN_ROOT}/tools/rollup/cli.mjs`. Dependency-free (node
// builtins only). Deterministic: no Date.now()/new Date()/Math.random(). The
// dev/CI copy at tools/sdlc-lint/lib/rollup.mjs re-exports from here.
import { computeMetrics } from "../aar/metrics.mjs";

const num = (n) => (typeof n === "number" && isFinite(n) ? n : 0);
const byNameAsc = (a, b, k) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0);

// dated asc, undated last, slug-asc tiebreak
function cmpStartedAt(a, b) {
  if (a.started_at && b.started_at) {
    if (a.started_at !== b.started_at) return a.started_at < b.started_at ? -1 : 1;
    return byNameAsc(a, b, "slug");
  }
  if (a.started_at && !b.started_at) return -1;
  if (!a.started_at && b.started_at) return 1;
  return byNameAsc(a, b, "slug");
}

export function computeRollup(runs) {
  const rows = (Array.isArray(runs) ? runs : []).map(({ slug, telemetry }) => {
    const m = computeMetrics(telemetry);
    return {
      slug: slug ?? m.task_slug ?? "(unknown)",
      started_at: telemetry.started_at ?? null,
      stack: m.stack,
      resumed: m.resumed === true,
      cost_usd: m.totals.cost_usd,
      input_tokens: num(m.totals.input_tokens),
      output_tokens: num(m.totals.output_tokens),
      cached_input_tokens: num(m.totals.cached_input_tokens),
      cache_hit_ratio: m.totals.cache_hit_ratio,
      cap_status: m.totals.cap_status,
      cost_cap_usd: m.totals.cost_cap_usd,
      cap_breach: m.cap_breach,
      qa_iterations: num(m.qa_iterations),
      skip_rules_count: num(m.skip_rules_count),
      phase_count: m.by_phase.length,
      unpriced: m.unpriced_phase_count > 0,
      _by_phase: m.by_phase,
      _by_model: m.by_model,
      _skips: Array.isArray(telemetry.skip_rules_applied) ? telemetry.skip_rules_applied : [],
    };
  }).sort(cmpStartedAt);

  let costSum = 0, anyCost = false, inSum = 0, outSum = 0, cachedSum = 0;
  let capBreaches = 0, skipRules = 0, qaIters = 0, unpricedRuns = 0;
  for (const r of rows) {
    if (r.cost_usd != null) { costSum += r.cost_usd; anyCost = true; }
    inSum += r.input_tokens;
    outSum += r.output_tokens;
    cachedSum += r.cached_input_tokens;
    if (r.cap_breach) capBreaches += 1;
    skipRules += r.skip_rules_count;
    qaIters += r.qa_iterations;
    if (r.unpriced) unpricedRuns += 1;
  }

  const modelMap = new Map();
  for (const r of rows) {
    for (const m of r._by_model) {
      const e = modelMap.get(m.model) ?? { model: m.model, runs: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0, unpriced: 0 };
      e.runs += 1;
      e.cost_usd += num(m.cost_usd);
      e.input_tokens += num(m.input_tokens);
      e.output_tokens += num(m.output_tokens);
      e.unpriced += num(m.unpriced);
      modelMap.set(m.model, e);
    }
  }
  const by_model = [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd || byNameAsc(a, b, "model"));

  const phaseMap = new Map();
  for (const r of rows) {
    for (const p of r._by_phase) {
      const e = phaseMap.get(p.phase) ?? { phase: p.phase, runs: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 };
      e.runs += 1;
      e.cost_usd += num(p.cost_usd);
      e.input_tokens += num(p.input_tokens);
      e.output_tokens += num(p.output_tokens);
      phaseMap.set(p.phase, e);
    }
  }
  const by_phase = [...phaseMap.values()].sort((a, b) => b.cost_usd - a.cost_usd || byNameAsc(a, b, "phase"));

  let cum = 0;
  const cost_over_time = rows.map((r) => { cum += num(r.cost_usd); return { slug: r.slug, started_at: r.started_at, cost_usd: r.cost_usd, cumulative_usd: cum }; });
  const cache_trend = rows.map((r) => ({ slug: r.slug, started_at: r.started_at, cache_hit_ratio: r.cache_hit_ratio }));

  const qa_distribution = {};
  for (const r of rows) { const k = String(r.qa_iterations); qa_distribution[k] = (qa_distribution[k] ?? 0) + 1; }

  const cap_breach_incidents = rows.filter((r) => r.cap_breach).map((r) => ({ slug: r.slug, cap_status: r.cap_status, cost_usd: r.cost_usd, cost_cap_usd: r.cost_cap_usd }));
  const skips = [];
  for (const r of rows) for (const s of r._skips) skips.push({ slug: r.slug, phase_skipped: s.phase_skipped, rule: s.rule });

  const publicRows = rows.map(({ _by_phase, _by_model, _skips, cost_cap_usd, cached_input_tokens, ...pub }) => pub);

  return {
    run_count: rows.length,
    runs: publicRows,
    totals: {
      cost_usd: anyCost ? costSum : null,
      input_tokens: inSum,
      output_tokens: outSum,
      cache_hit_ratio_weighted: inSum > 0 ? cachedSum / inSum : null,
      cap_breaches: capBreaches,
      skip_rules: skipRules,
      qa_iterations: qaIters,
      unpriced_runs: unpricedRuns,
    },
    by_model,
    by_phase,
    cost_over_time,
    cache_trend,
    qa_distribution,
    incidents: { cap_breaches: cap_breach_incidents, skips },
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd tools/sdlc-lint && node --test test/rollup.test.mjs`
Expected: PASS (all Task 1 tests green).

- [ ] **Step 7: Commit**

```bash
git add plugins/sdlc/tools/rollup/rollup.mjs tools/sdlc-lint/lib/rollup.mjs \
  tools/sdlc-lint/fixtures/rollup-multi tools/sdlc-lint/test/rollup.test.mjs
git commit -m "feat(sdlc): cross-run rollup aggregation core (computeRollup)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `renderRollupText` terminal digest

**Files:**
- Modify: `plugins/sdlc/tools/rollup/rollup.mjs` (append renderer + fmt helpers)
- Modify: `tools/sdlc-lint/lib/rollup.mjs` (add export)
- Test: `tools/sdlc-lint/test/rollup.test.mjs` (append)

**Interfaces:**
- Consumes: the `computeRollup(runs)` aggregate from Task 1.
- Produces: `renderRollupText(agg): string` — deterministic fixed-width digest.

- [ ] **Step 1: Write the failing test (append)**

Append to `tools/sdlc-lint/test/rollup.test.mjs`:
```js
import { renderRollupText } from "../lib/rollup.mjs";

test("text digest lists totals, runs, models and phases", () => {
  const txt = renderRollupText(computeRollup(runs()));
  assert.match(txt, /3 run\(s\)/);
  assert.match(txt, /\$0\.82/);          // total cost
  assert.match(txt, /run-a/);            // per-run rows use the workspace slug (dir name)
  assert.match(txt, /OVER/);             // run-b cap breach
  assert.match(txt, /claude-opus-4-8/);  // by_model
  assert.match(txt, /business_analysis/);// by_phase
});

test("text digest flags partial cost when unpriced runs exist", () => {
  const txt = renderRollupText(computeRollup(runs()));
  assert.match(txt, /partial/);          // 1 unpriced run
});

test("text digest handles empty run-set", () => {
  assert.match(renderRollupText(computeRollup([])), /No pipeline runs recorded yet/);
});

test("text digest is deterministic", () => {
  assert.equal(renderRollupText(computeRollup(runs())), renderRollupText(computeRollup(runs())));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/rollup.test.mjs`
Expected: FAIL — `renderRollupText` is not exported.

- [ ] **Step 3: Add the export to the shim**

Edit `tools/sdlc-lint/lib/rollup.mjs` — replace the export line with:
```js
export { computeRollup, renderRollupText } from "../../../plugins/sdlc/tools/rollup/rollup.mjs";
```

- [ ] **Step 4: Append fmt helpers + `renderRollupText` to `rollup.mjs`**

Add near the top of `plugins/sdlc/tools/rollup/rollup.mjs`, directly after the `byNameAsc` line:
```js
const fmtUsd = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
const fmtInt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (r) => (r == null ? "—" : `${Math.round(Number(r) * 100)}%`);
```

Append at the end of `plugins/sdlc/tools/rollup/rollup.mjs`:
```js
export function renderRollupText(agg) {
  if (agg.run_count === 0) return "No pipeline runs recorded yet (no docs/plans/*/_telemetry.json).";
  const t = agg.totals;
  const lines = [];
  lines.push(`SDLC cross-run rollup — ${agg.run_count} run(s)`);
  lines.push(
    `Total cost ${fmtUsd(t.cost_usd)}${t.unpriced_runs ? ` (partial — ${t.unpriced_runs} unpriced)` : ""}` +
    ` · cache ${pct(t.cache_hit_ratio_weighted)} · cap breaches ${t.cap_breaches}` +
    ` · skips ${t.skip_rules} · QA iters ${t.qa_iterations}`
  );
  lines.push("");
  lines.push(`${"RUN".padEnd(24)} ${"WHEN".padEnd(20)} ${"COST".padStart(8)} ${"CACHE".padStart(6)} CAP`);
  for (const r of agg.runs) {
    lines.push(
      `${String(r.slug).padEnd(24).slice(0, 24)} ${String(r.started_at ?? "—").padEnd(20).slice(0, 20)}` +
      ` ${fmtUsd(r.cost_usd).padStart(8)} ${pct(r.cache_hit_ratio).padStart(6)} ${r.cap_breach ? "OVER" : "ok"}`
    );
  }
  lines.push("");
  lines.push("BY MODEL");
  for (const m of agg.by_model) {
    lines.push(`  ${String(m.model).padEnd(28)} ${fmtUsd(m.cost_usd).padStart(8)} ${fmtInt(m.input_tokens + m.output_tokens).padStart(11)} tok`);
  }
  lines.push("BY PHASE");
  for (const p of agg.by_phase) {
    lines.push(`  ${String(p.phase).padEnd(28)} ${fmtUsd(p.cost_usd).padStart(8)} ${fmtInt(p.input_tokens + p.output_tokens).padStart(11)} tok`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tools/sdlc-lint && node --test test/rollup.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/sdlc/tools/rollup/rollup.mjs tools/sdlc-lint/lib/rollup.mjs tools/sdlc-lint/test/rollup.test.mjs
git commit -m "feat(sdlc): terminal digest renderer for cross-run rollup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `renderRollupHtml` self-contained artifact

**Files:**
- Modify: `plugins/sdlc/tools/rollup/rollup.mjs` (append CSS + HTML renderer)
- Modify: `tools/sdlc-lint/lib/rollup.mjs` (add export)
- Test: `tools/sdlc-lint/test/rollup.test.mjs` (append)

**Interfaces:**
- Consumes: the `computeRollup(runs)` aggregate.
- Produces: `renderRollupHtml(agg): string` — complete `<!doctype html>` document, self-contained.

- [ ] **Step 1: Write the failing test (append)**

Append to `tools/sdlc-lint/test/rollup.test.mjs`:
```js
import { renderRollupHtml } from "../lib/rollup.mjs";

test("html is a complete self-contained document", () => {
  const html = renderRollupHtml(computeRollup(runs()));
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<\/html>\s*$/i);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /src=/);
  assert.doesNotMatch(html, /<link/i);
  assert.doesNotMatch(html, /@import url\(/i);
});

test("html surfaces totals, runs, models, phases, incidents", () => {
  const html = renderRollupHtml(computeRollup(runs()));
  assert.match(html, /\$0\.82/);              // total cost
  assert.match(html, /run-a/);
  assert.match(html, /claude-opus-4-8/);
  assert.match(html, /business_analysis/);
  assert.match(html, /over/i);                // cap breach incident
});

test("html escapes injected markup from untrusted fields", () => {
  const evil = { slug: "<script>alert(1)</script>", telemetry: {
    task_slug: "x", started_at: "2026-07-04T00:00:00Z",
    phases: [{ phase: "development", model: "m", status: "completed", input_tokens: 1, output_tokens: 1, cost_usd: 0.01 }],
    total_input_tokens: 1, total_output_tokens: 1, total_cost_usd: 0.01, cap_status: "within",
  } };
  const html = renderRollupHtml(computeRollup([evil]));
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("html empty-state renders a valid page", () => {
  const html = renderRollupHtml(computeRollup([]));
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /No pipeline runs recorded yet/);
});

test("html is deterministic (byte-identical across calls)", () => {
  assert.equal(renderRollupHtml(computeRollup(runs())), renderRollupHtml(computeRollup(runs())));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/rollup.test.mjs`
Expected: FAIL — `renderRollupHtml` is not exported.

- [ ] **Step 3: Add the export to the shim**

Edit `tools/sdlc-lint/lib/rollup.mjs` — replace the export line with:
```js
export { computeRollup, renderRollupText, renderRollupHtml } from "../../../plugins/sdlc/tools/rollup/rollup.mjs";
```

- [ ] **Step 4: Append `esc`, CSS, bar helper + `renderRollupHtml` to `rollup.mjs`**

Append at the end of `plugins/sdlc/tools/rollup/rollup.mjs`:
```js
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ROLLUP_CSS = `
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e3e3e3;--card:#f7f7f8;--bar:#4f6bed}
@media(prefers-color-scheme:dark){:root{--bg:#15161a;--fg:#e8e8ea;--muted:#9a9aa2;--line:#2b2d33;--card:#1e2026;--bar:#6b83f0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}
.sub{color:var(--muted);margin:0 0 2px}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-top:20px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.tv{font-size:20px;font-weight:600}.tl{color:var(--muted);font-size:12px;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:500}.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{width:160px}.bar span{display:block;height:8px;border-radius:4px;background:var(--bar)}
.badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;background:var(--card);color:var(--muted)}
.over{color:#cf222e;font-weight:600}.note{color:var(--muted);font-size:12px}ul{padding-left:18px}li{margin:3px 0}
`;

function barCell(value, max) {
  const w = max > 0 ? Math.round((num(value) / max) * 100) : 0;
  return `<td class="bar"><span style="width:${w}%"></span></td>`;
}

export function renderRollupHtml(agg) {
  const head = (body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SDLC cross-run rollup</title>
<style>${ROLLUP_CSS}</style>
</head>
<body><main class="wrap">
${body}
<footer class="note" style="margin-top:40px">Generated from docs/plans/*/_telemetry.json · ${agg.run_count} run(s)</footer>
</main></body>
</html>`;

  if (agg.run_count === 0) {
    return head(`<header><h1>SDLC cross-run rollup</h1><p class="sub">No pipeline runs recorded yet.</p></header>`);
  }

  const t = agg.totals;
  const tile = (label, value) => `<div class="tile"><div class="tv">${value}</div><div class="tl">${esc(label)}</div></div>`;
  const kpis = `<section class="kpis">
${tile("Runs", agg.run_count)}
${tile("Total cost", fmtUsd(t.cost_usd))}
${tile("Cache hit", pct(t.cache_hit_ratio_weighted))}
${tile("Cap breaches", t.cap_breaches)}
${tile("Skips", t.skip_rules)}
${tile("QA iterations", t.qa_iterations)}
</section>`;
  const partial = t.unpriced_runs ? `<p class="note">Cost partial — ${t.unpriced_runs} run(s) unpriced (no registry pricing).</p>` : "";

  const maxRunCost = Math.max(...agg.runs.map((r) => num(r.cost_usd)), 0.0001);
  const runRows = agg.runs.map((r) =>
    `<tr><td>${esc(r.slug)}${r.resumed ? ` <span class="badge">resumed</span>` : ""}</td>
<td>${esc(r.started_at ?? "—")}</td>
<td><code>${esc(r.stack ?? "—")}</code></td>
<td class="num">${fmtUsd(r.cost_usd)}</td>
<td class="num">${pct(r.cache_hit_ratio)}</td>
<td>${r.cap_breach ? `<span class="over">${esc(r.cap_status)}</span>` : "ok"}</td>
${barCell(r.cost_usd, maxRunCost)}</tr>`).join("\n");
  const runsSection = `<section><h2>Runs (${agg.run_count})</h2>
<table><thead><tr><th>Run</th><th>Started</th><th>Stack</th><th class="num">Cost</th><th class="num">Cache</th><th>Cap</th><th>Cost share</th></tr></thead>
<tbody>${runRows}</tbody></table>${partial}</section>`;

  const maxCum = Math.max(...agg.cost_over_time.map((c) => num(c.cumulative_usd)), 0.0001);
  const cotRows = agg.cost_over_time.map((c) =>
    `<tr><td>${esc(c.slug)}</td><td>${esc(c.started_at ?? "—")}</td><td class="num">${fmtUsd(c.cost_usd)}</td><td class="num">${fmtUsd(c.cumulative_usd)}</td>${barCell(c.cumulative_usd, maxCum)}</tr>`).join("\n");
  const cotSection = `<section><h2>Cost over time</h2>
<table><thead><tr><th>Run</th><th>Started</th><th class="num">Cost</th><th class="num">Cumulative</th><th>Trend</th></tr></thead>
<tbody>${cotRows}</tbody></table></section>`;

  const modelRows = agg.by_model.map((m) =>
    `<tr><td><code>${esc(m.model)}</code></td><td class="num">${m.runs}</td><td class="num">${fmtInt(m.input_tokens)}</td><td class="num">${fmtInt(m.output_tokens)}</td><td class="num">${fmtUsd(m.cost_usd)}</td></tr>`).join("\n");
  const modelSection = `<section><h2>Cost by model</h2>
<table><thead><tr><th>Model</th><th class="num">Runs</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cost</th></tr></thead>
<tbody>${modelRows}</tbody></table></section>`;

  const phaseRows = agg.by_phase.map((p) =>
    `<tr><td>${esc(p.phase)}</td><td class="num">${p.runs}</td><td class="num">${fmtInt(p.input_tokens + p.output_tokens)}</td><td class="num">${fmtUsd(p.cost_usd)}</td></tr>`).join("\n");
  const phaseSection = `<section><h2>Cost by phase</h2>
<table><thead><tr><th>Phase</th><th class="num">Occurrences</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
<tbody>${phaseRows}</tbody></table></section>`;

  const qaKeys = Object.keys(agg.qa_distribution).sort((a, b) => Number(a) - Number(b));
  const maxQa = Math.max(...qaKeys.map((k) => agg.qa_distribution[k]), 1);
  const qaRows = qaKeys.map((k) =>
    `<tr><td class="num">${esc(k)}</td><td class="num">${agg.qa_distribution[k]}</td>${barCell(agg.qa_distribution[k], maxQa)}</tr>`).join("\n");
  const qaSection = qaKeys.length ? `<section><h2>QA-iteration distribution</h2>
<table><thead><tr><th class="num">Iterations</th><th class="num">Runs</th><th>Frequency</th></tr></thead>
<tbody>${qaRows}</tbody></table></section>` : "";

  const capItems = agg.incidents.cap_breaches.map((c) =>
    `<li><code>${esc(c.slug)}</code> — <span class="over">${esc(c.cap_status)}</span> · ${fmtUsd(c.cost_usd)} / ${fmtUsd(c.cost_cap_usd)} cap</li>`).join("");
  const skipItems = agg.incidents.skips.map((s) =>
    `<li><code>${esc(s.slug)}</code> — skipped <b>${esc(s.phase_skipped)}</b> (${esc(s.rule)})</li>`).join("");
  const incidentsSection = (capItems || skipItems)
    ? `<section><h2>Incidents</h2>${capItems ? `<h3 class="note">Cap breaches</h3><ul>${capItems}</ul>` : ""}${skipItems ? `<h3 class="note">Skips</h3><ul>${skipItems}</ul>` : ""}</section>`
    : "";

  return head([
    `<header><h1>SDLC cross-run rollup</h1><p class="sub">${agg.run_count} run(s) · ${fmtUsd(t.cost_usd)} total</p></header>`,
    kpis, runsSection, cotSection, modelSection, phaseSection, qaSection, incidentsSection,
  ].filter(Boolean).join("\n"));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tools/sdlc-lint && node --test test/rollup.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/sdlc/tools/rollup/rollup.mjs tools/sdlc-lint/lib/rollup.mjs tools/sdlc-lint/test/rollup.test.mjs
git commit -m "feat(sdlc): self-contained HTML renderer for cross-run rollup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `rollupWorkspace` I/O wrapper + `cli.mjs`

**Files:**
- Modify: `plugins/sdlc/tools/rollup/rollup.mjs` (append `rollupWorkspace`)
- Create: `plugins/sdlc/tools/rollup/cli.mjs`
- Modify: `tools/sdlc-lint/lib/rollup.mjs` (add export)
- Test: `tools/sdlc-lint/test/rollup.test.mjs` (append)

**Interfaces:**
- Consumes: `computeRollup`, `renderRollupHtml`, `renderRollupText`.
- Produces: `rollupWorkspace(root): { htmlPath, agg, text, warnings }` — globs
  `<root>/docs/plans/*/_telemetry.json`, writes `<root>/docs/plans/rollup/index.html`.

- [ ] **Step 1: Write the failing test (append)**

Append to `tools/sdlc-lint/test/rollup.test.mjs`:
```js
import { rollupWorkspace } from "../lib/rollup.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";

function seedWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "sdlc-rollup-"));
  const plans = join(root, "docs", "plans");
  for (const slug of ["run-a", "run-b", "run-c"]) {
    mkdirSync(join(plans, slug), { recursive: true });
    cpSync(join(FIXROOT, slug, "_telemetry.json"), join(plans, slug, "_telemetry.json"));
  }
  return root;
}

test("rollupWorkspace writes docs/plans/rollup/index.html and returns agg", () => {
  const root = seedWorkspace();
  try {
    const { htmlPath, agg, text } = rollupWorkspace(root);
    assert.equal(agg.run_count, 3);
    assert.ok(existsSync(htmlPath));
    assert.match(htmlPath.replace(/\\/g, "/"), /docs\/plans\/rollup\/index\.html$/);
    assert.match(readFileSync(htmlPath, "utf8"), /SDLC cross-run rollup/);
    assert.match(text, /3 run\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollupWorkspace on empty workspace → run_count 0, valid page, no throw", () => {
  const root = mkdtempSync(join(tmpdir(), "sdlc-rollup-empty-"));
  try {
    const { agg, htmlPath } = rollupWorkspace(root);
    assert.equal(agg.run_count, 0);
    assert.ok(existsSync(htmlPath));
    assert.match(readFileSync(htmlPath, "utf8"), /No pipeline runs recorded yet/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rollupWorkspace skips malformed telemetry with a warning", () => {
  const root = seedWorkspace();
  try {
    const plans = join(root, "docs", "plans");
    mkdirSync(join(plans, "run-bad"), { recursive: true });
    writeFileSync(join(plans, "run-bad", "_telemetry.json"), "{ not json");
    const { agg, warnings } = rollupWorkspace(root);
    assert.equal(agg.run_count, 3);                 // the 3 good runs still aggregate
    assert.ok(warnings.some((w) => /run-bad/.test(w)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/rollup.test.mjs`
Expected: FAIL — `rollupWorkspace` is not exported.

- [ ] **Step 3: Add the export to the shim**

Edit `tools/sdlc-lint/lib/rollup.mjs` — replace the export line with:
```js
export { computeRollup, renderRollupText, renderRollupHtml, rollupWorkspace } from "../../../plugins/sdlc/tools/rollup/rollup.mjs";
```

- [ ] **Step 4: Append imports + `rollupWorkspace` to `rollup.mjs`**

Add to the import block at the top of `plugins/sdlc/tools/rollup/rollup.mjs` (after the
`computeMetrics` import):
```js
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
```

Append at the end of `plugins/sdlc/tools/rollup/rollup.mjs`:
```js
export function rollupWorkspace(root) {
  const plansDir = join(root, "docs", "plans");
  const warnings = [];
  const runs = [];
  let entries = [];
  try {
    entries = readdirSync(plansDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "rollup");
  } catch {
    entries = []; // docs/plans absent → empty rollup, still valid
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const tel = join(plansDir, e.name, "_telemetry.json");
    if (!existsSync(tel)) continue;
    try {
      runs.push({ slug: e.name, telemetry: JSON.parse(readFileSync(tel, "utf8")) });
    } catch (err) {
      warnings.push(`skipped ${e.name}: unreadable _telemetry.json (${err.message})`);
    }
  }
  const agg = computeRollup(runs);
  const text = renderRollupText(agg);
  const html = renderRollupHtml(agg);
  const outDir = join(plansDir, "rollup");
  mkdirSync(outDir, { recursive: true });
  const htmlPath = join(outDir, "index.html");
  writeFileSync(htmlPath, html);
  return { htmlPath, agg, text, warnings };
}
```

- [ ] **Step 5: Create `cli.mjs`**

Create `plugins/sdlc/tools/rollup/cli.mjs`:
```js
#!/usr/bin/env node
// Dependency-free entry for the cross-run rollup, shipped inside the sdlc plugin.
// Invoked by the /sdlc:report command as:
//   node ${CLAUDE_PLUGIN_ROOT}/tools/rollup/cli.mjs report [--json]
// Paths resolve against the CONSUMER's project cwd (where docs/plans/ lives);
// only the script itself is loaded from the plugin root. Node builtins + the
// sibling rollup module only — no node_modules on a consumer install.
import { rollupWorkspace } from "./rollup.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const jsonOut = args.includes("--json");
const root = process.cwd();

function usage() {
  console.error("usage: report [--json]");
  return 2;
}

let code = 0;
if (cmd !== "report") {
  code = usage();
} else {
  try {
    const { htmlPath, agg, text, warnings } = rollupWorkspace(root);
    for (const w of warnings) console.error(`⚠ ${w}`);
    if (jsonOut) {
      console.log(JSON.stringify({ command: "report", ok: true, html_path: htmlPath, run_count: agg.run_count, agg }));
    } else {
      console.log(text);
      console.log(`\nwrote ${htmlPath}`);
    }
  } catch (e) {
    if (jsonOut) console.log(JSON.stringify({ command: "report", ok: false, error: e.message }));
    else console.error(`✗ report: ${e.message}`);
    code = 2;
  }
}
process.exit(code);
```

- [ ] **Step 6: Run tests + a manual CLI smoke**

Run: `cd tools/sdlc-lint && node --test test/rollup.test.mjs`
Expected: PASS.

Manual smoke against the fixture, then discard the generated artifact so git stays clean:
```bash
( cd tools/sdlc-lint/fixtures/rollup-multi && node ../../../../plugins/sdlc/tools/rollup/cli.mjs report )
rm -rf tools/sdlc-lint/fixtures/rollup-multi/docs/plans/rollup
```
Expected: a digest table listing 3 runs, then `wrote .../docs/plans/rollup/index.html`. The
`rm` removes the generated artifact (the fixture ships only the three `_telemetry.json` inputs).

- [ ] **Step 7: Commit**

```bash
git add plugins/sdlc/tools/rollup/rollup.mjs plugins/sdlc/tools/rollup/cli.mjs \
  tools/sdlc-lint/lib/rollup.mjs tools/sdlc-lint/test/rollup.test.mjs
git commit -m "feat(sdlc): rollupWorkspace I/O wrapper + dep-free CLI entry

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `sdlc-lint rollup` verb + `/sdlc:report` command

**Files:**
- Modify: `tools/sdlc-lint/cli.mjs` (add `rollup` verb + import)
- Create: `plugins/sdlc/commands/report.md`
- Test: `tools/sdlc-lint/test/rollup.test.mjs` (append a verb smoke)

**Interfaces:**
- Consumes: `rollupWorkspace(root)` via the shim.
- Produces: `sdlc-lint rollup [<root>] [--json]` CLI verb; `/sdlc:report` command.

- [ ] **Step 1: Write the failing test (append)**

Append to `tools/sdlc-lint/test/rollup.test.mjs`:
```js
import { execFileSync } from "node:child_process";

const LINT_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

test("sdlc-lint rollup <root> --json reports run_count", () => {
  const root = seedWorkspace();
  try {
    const out = execFileSync("node", [LINT_CLI, "rollup", root, "--json"], { encoding: "utf8" });
    const parsed = JSON.parse(out.trim().split("\n").pop());
    assert.equal(parsed.command, "rollup");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.run_count, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/rollup.test.mjs`
Expected: FAIL — `sdlc-lint` prints `unknown command: rollup` (exit 2), JSON parse/assert fails.

- [ ] **Step 3: Wire the `rollup` verb into `sdlc-lint`**

Edit `tools/sdlc-lint/cli.mjs`. Add the import after the existing `renderReportFile` import
(around line 8):
```js
import { rollupWorkspace } from "./lib/rollup.mjs";
```

Add a `case` to the `switch (cmd)` block, directly after the `case "report": { … }` block and
before `case "all":`:
```js
  case "rollup": {
    const target = args[1] && !args[1].startsWith("--") ? resolve(root, args[1]) : root;
    try {
      const { htmlPath, agg, text, warnings } = rollupWorkspace(target);
      for (const w of warnings) console.error(`⚠ ${w}`);
      if (jsonOut) console.log(JSON.stringify({ command: "rollup", ok: true, html_path: htmlPath, run_count: agg.run_count }));
      else { console.log(text); console.log(`\nwrote ${htmlPath}`); }
      code = 0;
    } catch (e) {
      if (jsonOut) console.log(JSON.stringify({ command: "rollup", ok: false, error: e.message }));
      else console.error(`✗ rollup: ${e.message}`);
      code = 2;
    }
    break;
  }
```

Update the usage line (the `case "--help"` / `case undefined` block) to include `rollup`:
```js
    console.log("Usage: sdlc-lint <schema|cycles|detect|resume|report|rollup|all> [--json]");
```

> Note: `rollup` is intentionally NOT added to `runAll()` — the `all` verb is a fixture-diff gate
> with a single pass/fail per check, whereas rollup has no pass/fail; its correctness is covered
> by `rollup.test.mjs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tools/sdlc-lint && node --test test/rollup.test.mjs`
Expected: PASS.

- [ ] **Step 5: Create the `/sdlc:report` command**

Create `plugins/sdlc/commands/report.md`:
```markdown
---
description: Cross-run cost rollup across all SDLC pipeline runs — total spend, cost over time, by phase/model, cache-hit trend, cap breaches, skip frequency, QA-iteration distribution. Deterministic, no LLM tokens.
---

# /sdlc:report

Aggregate every `docs/plans/*/_telemetry.json` in this project into a single cross-run
rollup. Runs a deterministic, dependency-free script — no agents, no LLM tokens.

Run exactly this from the project root:

```bash
node ${CLAUDE_PLUGIN_ROOT}/tools/rollup/cli.mjs report
```

Then relay to the user:
- the terminal digest the script prints (totals, per-run table, by-model, by-phase), and
- the path it wrote: `docs/plans/rollup/index.html` (self-contained HTML artifact with the
  cost-over-time trend, QA-iteration distribution, and incident lists).

If the script prints "No pipeline runs recorded yet", tell the user there is no telemetry to
roll up yet (run `/sdlc:start` first). Pass `--json` instead of the bare `report` only when the
user wants the raw aggregate object.
```

- [ ] **Step 6: Run the full sdlc-lint suite (no regressions)**

Run: `cd tools/sdlc-lint && npm test`
Expected: PASS — all suites including `rollup.test.mjs`, existing `report`/`aar`/`resume`/etc.
green.

- [ ] **Step 7: Commit**

```bash
git add tools/sdlc-lint/cli.mjs tools/sdlc-lint/test/rollup.test.mjs plugins/sdlc/commands/report.md
git commit -m "feat(sdlc): /sdlc:report command + sdlc-lint rollup verb (Roadmap B2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Cross-run glob of `_telemetry.json` → Task 4 `rollupWorkspace`. ✓
- Reuse `computeMetrics` → Task 1 imports it, no new per-run math. ✓
- HTML artifact at `docs/plans/rollup/index.html` → Task 4. ✓
- Terminal digest → Task 2. ✓
- Dimensions: total cost, cost-over-time, by-phase, by-model, cache-hit trend, cap-breach,
  skip frequency, QA-iteration distribution → Task 1 aggregate + Task 3 HTML sections + Task 2
  digest. ✓ (cache-hit trend = `cache_trend` array, surfaced per-run in the runs/trend tables.)
- Thin command, no skill → Task 5 `report.md`. ✓
- SSOT re-export + `sdlc-lint` verb + fixture + tests → Tasks 1–5. ✓
- Determinism, dep-free, ship-in-plugin, self-contained HTML, empty-state exit-clean →
  Global Constraints + asserted in Tasks 1/3/4. ✓
- Edge cases: empty (Task 4), malformed (Task 4), unpriced (Tasks 1–3), undated sort (Task 1
  `cmpStartedAt`), `rollup/` self-exclusion (Task 4 filter + glob). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `computeRollup(runs)` → aggregate shape is consumed identically by
`renderRollupText`, `renderRollupHtml`, and `rollupWorkspace`. Function names stable across
tasks: `computeRollup`, `renderRollupText`, `renderRollupHtml`, `rollupWorkspace`. Shim export
list grows monotonically (Task 1 → 4) and ends matching the spec. ✓

**Note on `cache_trend`:** the aggregate computes a `cache_trend` array (per-run ratios in time
order); the HTML surfaces cache per run in the Runs table and the weighted headline KPI. A
dedicated cache-trend chart is intentionally folded into the runs table to keep the artifact
compact (YAGNI) — the data is present for any future dedicated view.
