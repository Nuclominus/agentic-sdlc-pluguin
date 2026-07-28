# H2 — Collapse the run tail into one command — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three mandated tool invocations at the end of an SDLC run (`date` clock
arithmetic, `usage/cli.mjs enrich`, `report/cli.mjs report`) with a single `run/cli.mjs finish
<slug>`, so the orchestrator has one chance to deviate instead of six.

**Architecture:** A third shipped tool, `plugins/sdlc/tools/run/`, composes the two existing ones
without changing either. `clock.mjs` becomes the sole writer of the run clock, deriving it from the
machine anchor `.checkpoint/_started_at` with `Date`/`toISOString` (no `date(1)`, therefore no
BSD-vs-GNU fallback). `finish.mjs` sequences clock → enrich → report, fail-open per stage, and
collects every warning into one ordered list. `cli.mjs` prints a block the orchestrator echoes.
The compliance contracts gain an `until:` field so the three replaced contracts can retire into an
archive file while the already-published 82.3% stays reproducible.

**Tech Stack:** Node 20+, ESM, `node:test` + `node:assert/strict`. The shipped tool is
dependency-free (node builtins only — no `ajv`, no `yaml`, no `node_modules` on a consumer install);
the dev/CI test suite lives in `tools/sdlc-lint/` and reaches the shipped code through a re-export
shim.

**Spec:** `docs/superpowers/specs/2026-07-28-h2-collapse-run-tail-design.md`

## Global Constraints

- Shipped code under `plugins/sdlc/tools/**` imports **node builtins and sibling modules only**.
  No third-party dependency, ever — consumers install the plugin without `npm install`.
- Every path a skill passes to `node` uses `${CLAUDE_PLUGIN_ROOT}` and is enforced by
  `node tools/sdlc-lint/cli.mjs plugin-paths` (part of `all`, run in CI).
- Tests live in `tools/sdlc-lint/test/*.test.mjs` and import through `tools/sdlc-lint/lib/*.mjs`
  re-export shims, never through a relative path into `plugins/` directly (existing pattern:
  `lib/usage.mjs`, `lib/report.mjs`).
- Run with `npm test --prefix tools/sdlc-lint` (which is `node --test`). A single file:
  `node --test tools/sdlc-lint/test/run.test.mjs`.
- Sealing a run **never fails the run.** Every stage is fail-open; the only non-zero exit is a usage
  error or an unreadable run directory.
- An unknown is `null`, never `0`. This already governs `total_cost_usd` and `cache_hit_ratio`; it
  now governs `started_at` / `wall_clock_seconds`.
- Timestamps written into `_telemetry.json` use the `YYYY-MM-DDTHH:MM:SSZ` shape (no milliseconds),
  matching the `date -u +%FT%TZ` format the rest of the corpus already carries.
- The compliance verb is an instrument, not a gate: it stays **out of** `sdlc-lint all`.
- Commit messages: conventional-commit prefix, and end with the two trailers used across this repo
  (`Co-Authored-By:` and `Claude-Session:` — copy them from `git log -1 --format=%B` of any recent
  commit on this branch).

---

### Task 1: `clock.mjs` — the run clock, from the anchor only

**Files:**
- Create: `plugins/sdlc/tools/run/clock.mjs`
- Create: `tools/sdlc-lint/lib/run.mjs` (re-export shim)
- Test: `tools/sdlc-lint/test/run.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `sealRunClock(runDir, { now } = {}) -> { anchored: boolean, started_at: string|null,
  completed_at: string|null, wall_clock_seconds: number|null, changed: boolean,
  degraded: null | "no-anchor" | "no-anchor-no-values" }`. Throws `Error("no _telemetry.json in
  <dir>")` when the run directory has no telemetry. `now` is milliseconds since epoch
  (`Date.now()` by default) and exists so tests are deterministic.

- [ ] **Step 1: Write the failing tests**

Create `tools/sdlc-lint/test/run.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sealRunClock } from "../lib/run.mjs";

// A run directory with the given telemetry and, optionally, a machine anchor.
function makeRun(tel, anchorEpoch) {
  const dir = mkdtempSync(join(tmpdir(), "run-"));
  writeFileSync(join(dir, "_telemetry.json"), JSON.stringify(tel, null, 2) + "\n");
  if (anchorEpoch !== undefined) {
    mkdirSync(join(dir, ".checkpoint"), { recursive: true });
    writeFileSync(join(dir, ".checkpoint", "_started_at"), `${anchorEpoch}\n`);
  }
  return dir;
}
const tel = (dir) => JSON.parse(readFileSync(join(dir, "_telemetry.json"), "utf8"));

// 2026-07-28T11:00:00Z. Verified: node -e 'console.log(new Date(1785236400000).toISOString())'
const ANCHOR = 1785236400;

test("sealRunClock derives all three keys from the anchor", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = sealRunClock(dir, { now: (ANCHOR + 12405) * 1000 });
  assert.equal(r.anchored, true);
  assert.equal(r.degraded, null);
  assert.equal(r.wall_clock_seconds, 12405);
  assert.equal(r.started_at, "2026-07-28T11:00:00Z");
  assert.equal(r.completed_at, "2026-07-28T14:26:45Z");
  const t = tel(dir);
  assert.equal(t.started_at, r.started_at);
  assert.equal(t.completed_at, r.completed_at);
  assert.equal(t.wall_clock_seconds, 12405);
});

test("timestamps carry no milliseconds — the corpus shape is %FT%TZ", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = sealRunClock(dir, { now: (ANCHOR + 1) * 1000 + 500 });
  assert.match(r.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(r.completed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("a clock that runs backwards clamps the duration to zero rather than going negative", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = sealRunClock(dir, { now: (ANCHOR - 1000) * 1000 });
  assert.equal(r.wall_clock_seconds, 0);
  assert.equal(r.started_at, r.completed_at);
});

test("no anchor, but telemetry already has timestamps: leave them alone and say so", () => {
  const dir = makeRun({ task_slug: "x", started_at: "2026-07-01T00:00:00Z",
    completed_at: "2026-07-01T00:10:00Z", wall_clock_seconds: 600, phases: [] });
  const r = sealRunClock(dir, { now: (ANCHOR + 12405) * 1000 });
  assert.equal(r.anchored, false);
  assert.equal(r.degraded, "no-anchor");
  assert.equal(r.changed, false);
  assert.equal(tel(dir).started_at, "2026-07-01T00:00:00Z");
  assert.equal(tel(dir).wall_clock_seconds, 600);
});

test("no anchor and no timestamps: unknown is null, never a measured zero", () => {
  const dir = makeRun({ task_slug: "x", phases: [] });
  const r = sealRunClock(dir, { now: (ANCHOR + 12405) * 1000 });
  assert.equal(r.degraded, "no-anchor-no-values");
  assert.equal(r.started_at, null);
  assert.equal(r.wall_clock_seconds, null);
  assert.equal(r.completed_at, "2026-07-28T14:26:45Z");
  const t = tel(dir);
  assert.equal(t.started_at, null);
  assert.equal(t.wall_clock_seconds, null);
});

test("a garbage anchor is treated as no anchor at all", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, "not-a-number");
  assert.equal(sealRunClock(dir, { now: (ANCHOR + 12405) * 1000 }).degraded, "no-anchor-no-values");
});

test("an anchor with surrounding whitespace still parses", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, `  ${ANCHOR}  `);
  assert.equal(sealRunClock(dir, { now: (ANCHOR + 10) * 1000 }).wall_clock_seconds, 10);
});

test("a run directory with no telemetry throws — there is nothing to seal", () => {
  const dir = mkdtempSync(join(tmpdir(), "run-"));
  assert.throws(() => sealRunClock(dir), /no _telemetry\.json/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/run.test.mjs`
Expected: FAIL — `Cannot find module .../tools/sdlc-lint/lib/run.mjs`.

- [ ] **Step 3: Write `clock.mjs`**

Create `plugins/sdlc/tools/run/clock.mjs`:

```js
// The run clock, derived from the machine anchor and nothing else. Shipped inside
// the sdlc plugin; node builtins only.
//
// This module exists because the orchestrator used to do this arithmetic in prose:
// read `.checkpoint/_started_at`, take `date -u +%s`, subtract, then render both
// epochs with a BSD-vs-GNU `date` flag fallback. H1 measured that step at 67% — the
// worst rate in the audited set, and the only genuinely multi-step one. Rendering
// through `Date` removes the portability hazard along with the step.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// `%FT%TZ`, the shape the rest of the corpus carries. toISOString() alone would add
// milliseconds and make new runs inconsistent with every older one.
function isoSeconds(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The write-once epoch from Step 2, or null when it is missing or unusable. */
function readAnchor(runDir) {
  try {
    const n = Number(readFileSync(join(runDir, ".checkpoint", "_started_at"), "utf8").trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

/**
 * Write `started_at`, `completed_at` and `wall_clock_seconds` into the run's
 * telemetry, derived from the machine anchor. The ONLY writer of these three keys:
 * the orchestrator must not author them (see ADR-0014).
 *
 * Degrades honestly. With no anchor it never invents a clock — it keeps whatever the
 * telemetry already had, and when there is nothing to keep it records `null`, because
 * an unknown duration and a zero-second run are different facts.
 */
export function sealRunClock(runDir, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const telPath = join(runDir, "_telemetry.json");
  if (!existsSync(telPath)) throw new Error(`no _telemetry.json in ${runDir}`);
  const tel = JSON.parse(readFileSync(telPath, "utf8"));
  const write = () => writeFileSync(telPath, JSON.stringify(tel, null, 2) + "\n");

  const start = readAnchor(runDir);
  if (start == null) {
    const hasValues = tel.started_at != null || tel.wall_clock_seconds != null;
    if (hasValues) {
      return { anchored: false, started_at: tel.started_at ?? null,
        completed_at: tel.completed_at ?? null, wall_clock_seconds: tel.wall_clock_seconds ?? null,
        changed: false, degraded: "no-anchor" };
    }
    tel.started_at = null;
    tel.wall_clock_seconds = null;
    tel.completed_at = isoSeconds(now);
    write();
    return { anchored: false, started_at: null, completed_at: tel.completed_at,
      wall_clock_seconds: null, changed: true, degraded: "no-anchor-no-values" };
  }

  // Clamp: a machine whose clock moved backwards must not produce a negative duration.
  const wall = Math.max(0, Math.floor(now / 1000) - start);
  tel.started_at = isoSeconds(start * 1000);
  tel.completed_at = isoSeconds((start + wall) * 1000);
  tel.wall_clock_seconds = wall;
  write();
  return { anchored: true, started_at: tel.started_at, completed_at: tel.completed_at,
    wall_clock_seconds: wall, changed: true, degraded: null };
}
```

Create `tools/sdlc-lint/lib/run.mjs`:

```js
// Dev/CI re-export shim. The canonical, dependency-free implementation is SHIPPED
// with the sdlc plugin at plugins/sdlc/tools/run/ (so marketplace consumers get it
// via ${CLAUDE_PLUGIN_ROOT} — see pipeline-orchestrator Step 5b). This file keeps the
// test-suite pointed at that single source of truth, so it exercises the exact code
// that ships.
export { sealRunClock } from "../../../plugins/sdlc/tools/run/clock.mjs";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/run.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/sdlc/tools/run/clock.mjs tools/sdlc-lint/lib/run.mjs tools/sdlc-lint/test/run.test.mjs
git commit -m "feat(sdlc): derive the run clock from the anchor in code, not in prose"
```

---

### Task 2: `finish.mjs` — clock → enrich → report, fail-open

**Files:**
- Create: `plugins/sdlc/tools/run/finish.mjs`
- Modify: `tools/sdlc-lint/lib/run.mjs` (add the export)
- Test: `tools/sdlc-lint/test/run.test.mjs` (append)

**Interfaces:**
- Consumes: `sealRunClock` from Task 1; `enrichTelemetry(runDir, { registryPath, projectsRoot })`
  from `plugins/sdlc/tools/usage/usage.mjs`; `renderReportFile(runDir) -> { htmlPath,
  cap_unverified }` from `plugins/sdlc/tools/report/report.mjs`.
- Produces: `finishRun(runDir, { now, noReport, registryPath, projectsRoot } = {}) -> { runDir,
  telPath, clock, enrich, report, warnings }` where `clock` is Task 1's result, `enrich` is
  `{ ok: true, ...enrichTelemetry result }` or `{ ok: false, error }`, `report` is
  `{ ok: true, html_path, cap_unverified }` / `{ ok: false, error }` / `{ skipped: "--no-report" }`,
  and `warnings` is an ordered `string[]` of ready-to-print `WARN: …` lines.

- [ ] **Step 1: Write the failing tests**

Append the tests to `tools/sdlc-lint/test/run.test.mjs`. First edit the file's **top** block: change
the shim import to `import { sealRunClock, finishRun } from "../lib/run.mjs";` and add the two new
imports beside the existing ones (all `import` statements stay at the top of the file):

```js
import { dirname, resolve } from "node:path";      // extend the existing node:path import
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const REGISTRY = join(REPO, "plugins", "sdlc", "config", "models.json");

// A run whose single phase has no resolvable transcript: enrichment finds nothing,
// which is the "leave telemetry unchanged" path, not an error.
function makeUnresolvableRun(anchorEpoch = ANCHOR) {
  const dir = mkdtempSync(join(tmpdir(), "finish-"));
  writeFileSync(join(dir, "_telemetry.json"), JSON.stringify({
    task_slug: "x", phases: [{ phase: "development", agent_id: "nosuchagent00" }],
  }, null, 2) + "\n");
  mkdirSync(join(dir, ".checkpoint"), { recursive: true });
  writeFileSync(join(dir, ".checkpoint", "_started_at"), `${anchorEpoch}\n`);
  return dir;
}

test("finishRun seals the clock even when enrichment resolves nothing", () => {
  const dir = makeUnresolvableRun();
  const r = finishRun(dir, { now: (ANCHOR + 300) * 1000, registryPath: REGISTRY,
    projectsRoot: join(dir, "no-projects") });
  assert.equal(r.clock.wall_clock_seconds, 300);
  assert.equal(r.enrich.ok, true);
  assert.equal(r.enrich.skipped_all, true);
  assert.equal(tel(dir).wall_clock_seconds, 300);
  assert.match(r.warnings.join("\n"), /cost enrichment incomplete/);
});

test("the clock is written BEFORE enrichment reads its overhead window", () => {
  // Proven by state, not by call order: enrichment's overhead window is derived from
  // the anchor plus wall_clock_seconds, so a telemetry that had no clock at entry must
  // still carry one by the time enrichment runs.
  const dir = makeUnresolvableRun();
  const r = finishRun(dir, { now: (ANCHOR + 300) * 1000, registryPath: REGISTRY,
    projectsRoot: join(dir, "no-projects") });
  assert.equal(r.clock.changed, true);
  assert.equal(typeof tel(dir).started_at, "string");
});

test("a report failure does not cost the run its enriched telemetry", () => {
  const dir = makeUnresolvableRun();
  const r = finishRun(dir, { now: (ANCHOR + 300) * 1000, registryPath: REGISTRY,
    projectsRoot: join(dir, "no-projects"), renderReport: () => { throw new Error("boom"); } });
  assert.equal(r.report.ok, false);
  assert.match(r.report.error, /boom/);
  assert.equal(tel(dir).wall_clock_seconds, 300);
  assert.match(r.warnings.join("\n"), /HTML report failed/);
});

test("an enrichment failure does not stop the report", () => {
  const dir = makeUnresolvableRun();
  let rendered = false;
  const r = finishRun(dir, { now: (ANCHOR + 300) * 1000,
    enrich: () => { throw new Error("registry gone"); },
    renderReport: () => { rendered = true; return { htmlPath: join(dir, "report.html"), cap_unverified: true }; } });
  assert.equal(r.enrich.ok, false);
  assert.equal(rendered, true);
  assert.equal(r.report.ok, true);
  assert.match(r.warnings.join("\n"), /cost enrichment failed/);
  assert.match(r.warnings.join("\n"), /unpriced/);
});

test("--no-report skips only the render", () => {
  const dir = makeUnresolvableRun();
  const r = finishRun(dir, { now: (ANCHOR + 300) * 1000, noReport: true, registryPath: REGISTRY,
    projectsRoot: join(dir, "no-projects") });
  assert.deepEqual(r.report, { skipped: "--no-report" });
  assert.equal(tel(dir).wall_clock_seconds, 300);
});

test("finishRun is idempotent — sealing twice does not double-count", () => {
  const dir = makeUnresolvableRun();
  const a = finishRun(dir, { now: (ANCHOR + 300) * 1000, registryPath: REGISTRY,
    projectsRoot: join(dir, "no-projects"), noReport: true });
  const b = finishRun(dir, { now: (ANCHOR + 400) * 1000, registryPath: REGISTRY,
    projectsRoot: join(dir, "no-projects"), noReport: true });
  assert.equal(a.enrich.total_cost_usd, b.enrich.total_cost_usd);
  assert.equal(tel(dir).started_at, a.clock.started_at);   // the anchor never moves
  assert.equal(tel(dir).wall_clock_seconds, 400);          // only the end advances
});

test("a run directory with no telemetry throws before anything is attempted", () => {
  const dir = mkdtempSync(join(tmpdir(), "finish-"));
  assert.throws(() => finishRun(dir), /no _telemetry\.json/);
});

test("cap-breach and clock-drift warnings from enrichment are surfaced verbatim", () => {
  const dir = makeUnresolvableRun();
  const r = finishRun(dir, { now: (ANCHOR + 300) * 1000, noReport: true,
    enrich: () => ({ telPath: join(dir, "_telemetry.json"), enriched: ["development"], skipped: [],
      total_cost_usd: 3.5, overhead_cost_usd: 1, overhead_window_fallback: true,
      cap_breach_usd: 1.51, cap_status: "exceeded-undetected",
      timestamps_corrected: { from: "2026-07-28T14:24:17Z", to: "2026-07-28T11:04:17Z", drift_seconds: 12000 } }) });
  const w = r.warnings.join("\n");
  assert.match(w, /exceeded the cost cap by \$1\.51/);
  assert.match(w, /exceeded-undetected/);
  assert.match(w, /overhead window fell back/);
  assert.match(w, /machine anchor says/);
});
```

The `enrich` / `renderReport` options are seams for testing only — real callers never pass them.
Declare them in the JSDoc as such.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/run.test.mjs`
Expected: FAIL — `finishRun is not a function` (the shim does not export it yet).

- [ ] **Step 3: Write `finish.mjs`**

Create `plugins/sdlc/tools/run/finish.mjs`:

```js
// Sealing a finished run: one call that does what Step 5's clock arithmetic and all of
// Step 5b used to ask the orchestrator to do in six prose sub-steps. Shipped inside the
// sdlc plugin; node builtins plus the two sibling tools it composes.
//
// Fail-open everywhere. The run has already succeeded by the time this executes — a
// failure to price it, or to render its report, must never turn a successful run into a
// failed one. Each stage records what happened and the next stage still runs.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sealRunClock } from "./clock.mjs";
import { enrichTelemetry } from "../usage/usage.mjs";
import { renderReportFile } from "../report/report.mjs";

/**
 * Seal a run: machine clock, transcript-derived cost, HTML report.
 *
 * @param {string} runDir  docs/plans/<slug>/
 * @param {object} [opts]
 * @param {number} [opts.now]           epoch ms; injected by tests
 * @param {boolean} [opts.noReport]     skip the HTML render only
 * @param {string} [opts.registryPath]  models.json override
 * @param {string} [opts.projectsRoot]  transcript root override
 * @param {Function} [opts.enrich]        TEST SEAM — replaces enrichTelemetry
 * @param {Function} [opts.renderReport]  TEST SEAM — replaces renderReportFile
 *
 * There is deliberately no `session` option. The enricher recovers the orchestrator
 * session from a resolved phase transcript by itself, which is why the model no longer
 * globs for one — and why it can no longer supply the wrong one (the worktree trap).
 */
export function finishRun(runDir, opts = {}) {
  const telPath = join(runDir, "_telemetry.json");
  if (!existsSync(telPath)) throw new Error(`no _telemetry.json in ${runDir}`);

  const warnings = [];
  const enrichFn = opts.enrich || ((dir) => enrichTelemetry(dir, {
    registryPath: opts.registryPath, projectsRoot: opts.projectsRoot }));
  const renderFn = opts.renderReport || ((dir) => renderReportFile(dir));

  // 1. Clock — first, so enrichment's overhead window is right on the first pass
  //    rather than repaired afterwards by reconcileRunWindow.
  const clock = sealRunClock(runDir, { now: opts.now });
  if (clock.degraded === "no-anchor") {
    warnings.push("WARN: no .checkpoint/_started_at — kept the timestamps already in telemetry; " +
      "this run's clock is not machine-anchored");
  } else if (clock.degraded === "no-anchor-no-values") {
    warnings.push("WARN: no .checkpoint/_started_at and no timestamps in telemetry — started_at " +
      "and wall_clock_seconds recorded as null (unknown, not zero)");
  }

  // 2. Cost.
  let enrich;
  try {
    const r = enrichFn(runDir);
    enrich = { ok: true, ...r };
    if (r.timestamps_corrected) {
      const d = r.timestamps_corrected;
      warnings.push(`WARN: started_at was ${d.from} but the machine anchor says ${d.to}` +
        (d.drift_seconds != null ? ` (off by ${d.drift_seconds}s)` : "") + " — corrected");
    }
    if (r.overhead_window_fallback) {
      warnings.push("WARN: overhead window fell back to the full transcript — the run window looks " +
        "wrong; verify the orchestration cost");
    }
    if (r.cap_breach_usd != null) {
      warnings.push(`WARN: phase spend exceeded the cost cap by $${r.cap_breach_usd.toFixed(2)} ` +
        `(cap_status: ${r.cap_status})` + (r.cap_status === "exceeded-undetected"
          ? " — the in-run gate did not catch this; check for cap_gate_blind phases" : ""));
    }
    // enrichTelemetry sets cost_basis:"transcript" on its success path only, so these
    // two fields are exactly the "not fully priced" condition — no re-read needed.
    if (r.skipped_all || (r.skipped && r.skipped.length)) {
      warnings.push("WARN: cost enrichment incomplete — cost may read as aggregate/$—" +
        (r.skipped && r.skipped.length ? ` (unresolved: ${r.skipped.join(", ")})` : ""));
    }
  } catch (e) {
    enrich = { ok: false, error: e.message };
    warnings.push(`WARN: cost enrichment failed — ${e.message}; the run stays unpriced`);
  }

  // 3. Report.
  let report;
  if (opts.noReport) {
    report = { skipped: "--no-report" };
  } else {
    try {
      const { htmlPath, cap_unverified } = renderFn(runDir);
      report = { ok: true, html_path: htmlPath, cap_unverified: !!cap_unverified };
      if (cap_unverified) {
        warnings.push("WARN: run is unpriced (cost_basis is not \"transcript\") — the cost cap " +
          "gated nothing and the report says \"unverified\"");
      }
    } catch (e) {
      report = { ok: false, error: e.message };
      warnings.push(`WARN: HTML report failed — ${e.message}`);
    }
  }

  return { runDir, telPath, clock, enrich, report, warnings };
}
```

Extend `tools/sdlc-lint/lib/run.mjs`:

```js
export { sealRunClock } from "../../../plugins/sdlc/tools/run/clock.mjs";
export { finishRun } from "../../../plugins/sdlc/tools/run/finish.mjs";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/run.test.mjs`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/sdlc/tools/run/finish.mjs tools/sdlc-lint/lib/run.mjs tools/sdlc-lint/test/run.test.mjs
git commit -m "feat(sdlc): seal a run in one call — clock, cost, report, fail-open"
```

---

### Task 3: `run/cli.mjs` — the `finish` verb

**Files:**
- Create: `plugins/sdlc/tools/run/cli.mjs`
- Test: `tools/sdlc-lint/test/run.test.mjs` (append)

**Interfaces:**
- Consumes: `finishRun` from Task 2.
- Produces: the shell contract
  `node "${CLAUDE_PLUGIN_ROOT}/tools/run/cli.mjs" finish <slug-or-dir> [--no-report] [--registry <p>] [--projects-root <d>] [--json]`.
  stdout carries the echo block (or one JSON line under `--json`); every `WARN:` goes to stderr.
  Exit `0` whenever the run directory was readable; `2` on a usage error or unreadable run.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/run.test.mjs`:

```js
import { execFileSync } from "node:child_process";

const CLI = join(REPO, "plugins", "sdlc", "tools", "run", "cli.mjs");
// Runs the CLI with cwd = the run's parent, so `finish <basename>` also exercises
// slug resolution. Returns { stdout, stderr, status }.
function runCli(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

test("the CLI prints a block shaped for the orchestrator to echo", () => {
  const dir = makeUnresolvableRun();
  const r = runCli(["finish", dir, "--no-report", "--registry", REGISTRY, "--projects-root", join(dir, "none")], REPO);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^finish: /m);
  assert.match(r.stdout, /clock:\s+\d{4}-\d{2}-\d{2}T/);
  assert.match(r.stdout, /cost:/);
});

test("WARN lines go to stderr, not into the stdout block", () => {
  const dir = makeUnresolvableRun();
  const r = runCli(["finish", dir, "--no-report", "--registry", REGISTRY, "--projects-root", join(dir, "none")], REPO);
  assert.match(r.stderr, /WARN: cost enrichment incomplete/);
  assert.doesNotMatch(r.stdout, /WARN:/);
});

test("--json emits exactly one parseable line", () => {
  const dir = makeUnresolvableRun();
  const r = runCli(["finish", dir, "--no-report", "--json", "--registry", REGISTRY, "--projects-root", join(dir, "none")], REPO);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  const j = JSON.parse(lines[0]);
  assert.equal(j.command, "finish");
  assert.equal(j.ok, true);
  assert.equal(j.clock.wall_clock_seconds >= 0, true);
  assert.equal(Array.isArray(j.warnings), true);
});

test("sealing never fails a run that already succeeded — exit stays 0 with warnings", () => {
  const dir = makeUnresolvableRun();
  const r = runCli(["finish", dir, "--registry", REGISTRY, "--projects-root", join(dir, "none")], REPO);
  assert.equal(r.status, 0);
});

test("an unreadable run is a usage error, exit 2", () => {
  const r = runCli(["finish", "no-such-slug"], REPO);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /finish/);
});

test("no verb, or an unknown one, prints usage and exits 2", () => {
  assert.equal(runCli([], REPO).status, 2);
  assert.equal(runCli(["seal", "x"], REPO).status, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/run.test.mjs`
Expected: FAIL — `Cannot find module .../plugins/sdlc/tools/run/cli.mjs`.

- [ ] **Step 3: Write `cli.mjs`**

Create `plugins/sdlc/tools/run/cli.mjs`:

```js
#!/usr/bin/env node
// Dependency-free entry for sealing a finished run, shipped inside the sdlc plugin.
// One command, invoked by pipeline-orchestrator Step 5b:
//   node ${CLAUDE_PLUGIN_ROOT}/tools/run/cli.mjs finish <slug-or-dir> [--no-report] [--json]
// It replaces three separate invocations (the Step 5 `date` arithmetic, `usage/cli.mjs
// enrich`, `report/cli.mjs report`) with one, because H1 measured that compliance tracks
// the number of things an instruction asks for. Paths resolve against the CONSUMER's
// project cwd; only the script itself is loaded from the plugin root.
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { finishRun } from "./finish.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const jsonOut = args.includes("--json");
const root = process.cwd();

function opt(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}
function usage() {
  console.error("usage: finish <slug-or-dir> [--no-report] [--registry <models.json>] [--projects-root <dir>] [--json]");
  return 2;
}
const money = (n) => (n == null ? "$—" : `$${n.toFixed(2)}`);

let code = 0;
if (cmd !== "finish") {
  code = usage();
} else {
  const target = args[1] && !args[1].startsWith("--") ? args[1] : null;
  if (!target) {
    code = usage();
  } else {
    const direct = resolve(root, target);
    const dir = existsSync(join(direct, "_telemetry.json")) ? direct : join(root, "docs", "plans", target);
    try {
      const r = finishRun(dir, {
        noReport: args.includes("--no-report"),
        registryPath: opt("--registry") || undefined,
        projectsRoot: opt("--projects-root") || undefined,
      });
      if (jsonOut) {
        console.log(JSON.stringify({ command: "finish", ok: true, run_dir: r.runDir,
          clock: r.clock, enrich: r.enrich, report: r.report, warnings: r.warnings }));
      } else {
        console.log(`finish: ${r.runDir}`);
        const c = r.clock;
        console.log(`  clock:   ${c.started_at ?? "—"} → ${c.completed_at ?? "—"}` +
          `  (${c.wall_clock_seconds == null ? "—" : `${c.wall_clock_seconds}s`}, ` +
          `${c.anchored ? "anchored" : "no anchor"})`);
        if (r.enrich.ok && !r.enrich.skipped_all) {
          const phases = (r.enrich.total_cost_usd ?? 0) - (r.enrich.overhead_cost_usd ?? 0);
          console.log(`  cost:    ${money(r.enrich.total_cost_usd)}  (phases ${money(round2(phases))}` +
            ` + overhead ${money(r.enrich.overhead_cost_usd)})   basis: transcript`);
          if (r.enrich.cap_status) {
            console.log(`  cap:     ${r.enrich.cap_status}` +
              (r.enrich.cap_breach_usd != null ? ` (breach ${money(r.enrich.cap_breach_usd)})` : ""));
          }
        } else {
          console.log(`  cost:    $— (unpriced — no phase transcript resolved)`);
        }
        if (r.report.ok) console.log(`  report:  ${r.report.html_path}`);
        else if (r.report.skipped) console.log(`  report:  skipped (${r.report.skipped})`);
        else console.log(`  report:  failed`);
      }
      // Warnings always go to stderr, including under --json where they also ride
      // inside the JSON: a headless consumer parses stdout, a human reads the log.
      for (const w of r.warnings) console.error(w);
    } catch (e) {
      if (jsonOut) console.log(JSON.stringify({ command: "finish", ok: false, error: e.message }));
      else console.error(`✗ finish: ${e.message}`);
      code = 2;
    }
  }
}
function round2(n) { return Math.round(n * 100) / 100; }
process.exit(code);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/run.test.mjs`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/sdlc/tools/run/cli.mjs tools/sdlc-lint/test/run.test.mjs
git commit -m "feat(sdlc): add the run/cli.mjs finish verb with an echo-shaped block"
```

---

### Task 4: `until:` on contracts, and parsing several files

**Files:**
- Modify: `tools/sdlc-lint/lib/contracts.mjs`
- Modify: `tools/sdlc-lint/fixtures/compliance/skill-contracts-ok.md`
- Modify: `tools/sdlc-lint/fixtures/compliance/skill-contracts-bad.md`
- Test: `tools/sdlc-lint/test/contracts.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: parsed contracts gain `until: string|null`; `parseContracts(pathOrPaths)` accepts a
  string **or** an array of strings and reports duplicate ids across the whole set.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/contracts.test.mjs`:

```js
test("until is optional and defaults to null", () => {
  const { contracts } = parseContracts(join(FIX, "skill-contracts-ok.md"));
  assert.equal(contracts[0].until, null);
});

test("a retired contract carries its until date", () => {
  const { contracts, errors } = parseContracts(join(FIX, "contracts-retired-ok.md"));
  assert.deepEqual(errors, []);
  assert.equal(contracts[0].id, "5-clock");
  assert.equal(contracts[0].until, "2026-07-28");
});

test("a malformed or backwards until is an error, not a throw", () => {
  const { errors } = parseContracts(join(FIX, "skill-contracts-bad.md"));
  const joined = errors.join("\n");
  assert.match(joined, /until must be YYYY-MM-DD/);
  assert.match(joined, /precedes since/);
});

test("parseContracts accepts a list of files and unions them", () => {
  const { contracts, errors } = parseContracts([
    join(FIX, "skill-contracts-ok.md"), join(FIX, "contracts-retired-ok.md")]);
  assert.deepEqual(errors, []);
  assert.deepEqual(contracts.map((c) => c.id), ["5b-0-enrich", "6-journal", "5-clock"]);
});

test("an id duplicated ACROSS files is reported once and excluded", () => {
  const { contracts, errors } = parseContracts([
    join(FIX, "skill-contracts-ok.md"), join(FIX, "skill-contracts-ok.md")]);
  assert.match(errors.join("\n"), /duplicate id '5b-0-enrich'/);
  assert.equal(contracts.filter((c) => c.id === "5b-0-enrich").length, 1);
});
```

Create the fixture `tools/sdlc-lint/fixtures/compliance/contracts-retired-ok.md`:

````markdown
# Fixture retired archive

```sdlc-contract
id: 5-clock
requires: bash_match
pattern: date -u (-r |-d @)
cardinality: once-per-run
since: 2026-07-06
until: 2026-07-28
```
````

Append to `tools/sdlc-lint/fixtures/compliance/skill-contracts-bad.md`:

````markdown
```sdlc-contract
id: bad-until
requires: bash_match
pattern: x
cardinality: once-per-run
since: 2026-07-06
until: yesterday
```

```sdlc-contract
id: backwards-window
requires: bash_match
pattern: x
cardinality: once-per-run
since: 2026-07-06
until: 2026-07-01
```
````

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/contracts.test.mjs`
Expected: FAIL — `until` is `undefined`, the list form throws, and neither `until` error is
reported.

- [ ] **Step 3: Implement**

In `tools/sdlc-lint/lib/contracts.mjs`, inside `validate()` after the `since` check:

```js
  if (raw.until != null) {
    if (typeof raw.until !== "string" || !ISO_DATE.test(raw.until) || Number.isNaN(Date.parse(raw.until))) {
      errs.push(`${label}: until must be YYYY-MM-DD, got '${raw.until}'`);
    } else if (typeof raw.since === "string" && ISO_DATE.test(raw.since) && raw.until < raw.since) {
      errs.push(`${label}: until '${raw.until}' precedes since '${raw.since}'`);
    }
  }
```

and in the returned contract object:

```js
      cardinality: raw.cardinality, since: raw.since, until: raw.until ?? null,
      applies_when: conditions,
```

Replace the body of `parseContracts` so it walks a list, and extend its doc comment:

```js
/**
 * Read every `sdlc-contract` block out of one or more files.
 *
 * Live contracts live inside `SKILL.md`, adjacent to the prose they describe, so that
 * renumbering a step without updating its contract shows up in one diff. RETIRED
 * contracts are read from a second file: a contract with an `until` describes a
 * procedure that no longer exists and therefore cannot drift from it, and keeping dead
 * blocks inside the live procedure would grow exactly the prompt surface Track H is
 * trying to shrink.
 *
 * Returns errors rather than throwing: the CLI decides whether a malformed contract is
 * fatal. `seen` spans the whole set, so an id duplicated across two files is caught.
 */
export function parseContracts(pathOrPaths) {
  const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];
  const contracts = [], errors = [], seen = new Set();
  for (const p of paths) {
    if (!p || !existsSync(p)) { errors.push(`cannot read ${p}`); continue; }
    let text;
    try { text = readFileSync(p, "utf8"); }
    catch (e) { errors.push(`cannot read ${p}: ${e.message}`); continue; }
    BLOCK.lastIndex = 0;
    for (const m of text.matchAll(BLOCK)) {
      let raw;
      try { raw = YAML.parse(m[1]); }
      catch (e) { errors.push(`contract block: unparseable YAML — ${e.message}`); continue; }
      const { errors: errs, contract } = validate(raw, seen);
      if (errs.length) { errors.push(...errs); continue; }
      seen.add(contract.id);
      contracts.push(contract);
    }
  }
  return { contracts, errors };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/contracts.test.mjs`
Expected: PASS. The pre-existing test `"a missing file is an error, not a throw"` must still pass —
the single-path form is preserved by the `Array.isArray` wrap.

- [ ] **Step 5: Commit**

```bash
git add tools/sdlc-lint/lib/contracts.mjs tools/sdlc-lint/test/contracts.test.mjs tools/sdlc-lint/fixtures/compliance/
git commit -m "feat(sdlc-lint): give contracts an until date and let the parser union files"
```

---

### Task 5: `retired` verdicts, and a run that is out of scope is not a deviation

**Files:**
- Modify: `tools/sdlc-lint/lib/compliance.mjs`
- Modify: `tools/sdlc-lint/lib/compliance-report.mjs`
- Test: `tools/sdlc-lint/test/compliance.test.mjs`, `tools/sdlc-lint/test/compliance-report.test.mjs`

**Interfaces:**
- Consumes: contracts with `until` from Task 4.
- Produces: `evaluate()` returns `{ verdict: "na", reason: "retired" }` for a run dated after a
  contract's `until`; `aggregate()` annotates such rows with `retired <until>`; `renderText()`
  stops listing `na` verdicts as per-run deviations.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/compliance.test.mjs`:

```js
test("a contract retired before the run is na: retired", () => {
  const retired = [{ id: "gone", requires: "bash_match", pattern: "date -u",
    cardinality: "once-per-run", since: "2026-07-06", until: "2026-07-10", applies_when: [] }];
  const res = auditRun(run("compliant"), retired, { projectsRoot: PROJECTS });   // run dated 2026-07-28
  assert.equal(res.verdicts[0].verdict, "na");
  assert.equal(res.verdicts[0].reason, "retired");
});

test("a run inside the retirement window is still judged", () => {
  const retired = [{ id: "still-live", requires: "bash_match", pattern: "date -u",
    cardinality: "once-per-run", since: "2026-07-06", until: "2026-07-31", applies_when: [] }];
  const res = auditRun(run("compliant"), retired, { projectsRoot: PROJECTS });
  assert.equal(res.verdicts[0].verdict, "pass");
});
```

Append to `tools/sdlc-lint/test/compliance-report.test.mjs`:

```js
test("a retired contract is annotated with its window", () => {
  const contracts = [{ id: "5-clock", since: "2026-07-06", until: "2026-07-28" }];
  const results = [{ status: "auditable", run: "r1", plugin_version: "1.15.0", date: "2026-07-29",
    verdicts: [{ id: "5-clock", verdict: "na", reason: "retired" }] }];
  const agg = aggregate(results, contracts);
  assert.match(agg.contracts[0].annotations.join(" "), /retired 2026-07-28/);
  assert.equal(agg.contracts[0].rate, null);
});

test("a run whose only non-pass verdicts are na renders as compliant, not as a failure", () => {
  const contracts = [{ id: "a", since: "2026-07-01" }, { id: "b", since: "2026-07-01", until: "2026-07-10" }];
  const results = [{ status: "auditable", run: "r1", plugin_version: "1.15.0", date: "2026-07-29",
    date_source: "started_at",
    verdicts: [{ id: "a", verdict: "pass" }, { id: "b", verdict: "na", reason: "retired" }] }];
  const text = renderText(aggregate(results, contracts), results);
  assert.match(text, /✓ r1/);
  assert.doesNotMatch(text, /✗ r1/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/compliance.test.mjs tools/sdlc-lint/test/compliance-report.test.mjs`
Expected: FAIL — the retired contract is evaluated as `fail`/`pass` rather than `na`, no `retired`
annotation exists, and the `na` run renders as `✗`.

- [ ] **Step 3: Implement**

In `tools/sdlc-lint/lib/compliance.mjs`, in `evaluate()`, directly after the `predates` line:

```js
  // Retired: the step existed, then was replaced. The contract still audits the runs
  // from its era — that is what keeps a published rate reproducible after the procedure
  // it measured is gone — but says nothing about a run that postdates the change.
  if (date && contract.until && contract.until < date) return na("retired");
```

In `tools/sdlc-lint/lib/compliance-report.mjs`, inside the `rows` map, beside the other
annotations:

```js
    if (c.until) annotations.push(`retired ${c.until}`);
```

and in `renderText`, change the per-run deviation filter:

```js
    // `na` is not a deviation: the contract did not apply to this run (it predates the
    // step, or the step has since been replaced). Listing it here made runs that did
    // everything asked of them render as ✗.
    const bad = r.verdicts.filter((v) => v.verdict !== "pass" && v.verdict !== "na");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --prefix tools/sdlc-lint`
Expected: PASS across the whole suite — the existing compliance tests still pass because none of
their contracts carry `until`.

- [ ] **Step 5: Commit**

```bash
git add tools/sdlc-lint/lib/compliance.mjs tools/sdlc-lint/lib/compliance-report.mjs tools/sdlc-lint/test/
git commit -m "feat(sdlc-lint): judge retired contracts by their window, not by the run"
```

---

### Task 6: Rewrite Steps 5 / 5b and retire the three contracts

**Files:**
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (Step 5 clock block ≈ lines
  1434–1465; Step 5b ≈ lines 1989–2100 — re-locate with
  `grep -n "sdlc-contract\|### Step 5" plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`)
- Create: `plugins/sdlc/skills/pipeline-orchestrator/contracts-retired.md`
- Modify: `tools/sdlc-lint/cli.mjs` (`printCompliance`)
- Modify: `tools/sdlc-lint/test/contracts.test.mjs` (the v1 contract-set assertion)
- Modify: `tools/sdlc-lint/test/compliance.test.mjs` (contract loading + the `compliant` fixture)
- Create: `tools/sdlc-lint/fixtures/compliance/runs/sealed/_telemetry.json`
- Create: `tools/sdlc-lint/fixtures/compliance/projects/-fake-proj/sess-d.jsonl`
- Create: `tools/sdlc-lint/fixtures/compliance/projects/-fake-proj/sess-d/subagents/agent-hhh888.jsonl`

**Interfaces:**
- Consumes: `until` parsing (Task 4), `retired` verdicts (Task 5), the `finish` verb (Task 3).
- Produces: `SKILL.md` declares exactly `2-4-anchor`, `3d-1b-phase-cost`, `5b-finish`, `6-journal`;
  the archive declares `5-clock`, `5b-0-enrich`, `5b-2-report`.

- [ ] **Step 1: Write the failing tests**

In `tools/sdlc-lint/test/contracts.test.mjs`, replace the `"the orchestrator declares exactly the
v1 contract set"` test with:

```js
test("the orchestrator declares exactly the live contract set", () => {
  const { contracts } = parseContracts(
    join(REPO, "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md"));
  assert.deepEqual(contracts.map((c) => c.id).sort(), [
    "2-4-anchor", "3d-1b-phase-cost", "5b-finish", "6-journal",
  ]);
  assert.equal(contracts.every((c) => c.until === null), true);
});

test("the archive declares exactly the retired set, each with a window", () => {
  const { contracts, errors } = parseContracts(
    join(REPO, "plugins/sdlc/skills/pipeline-orchestrator/contracts-retired.md"));
  assert.deepEqual(errors, []);
  assert.deepEqual(contracts.map((c) => c.id).sort(), ["5-clock", "5b-0-enrich", "5b-2-report"]);
  assert.equal(contracts.every((c) => c.until === "2026-07-28"), true);
});

test("live and retired sets parse together without a duplicate id", () => {
  const base = join(REPO, "plugins/sdlc/skills/pipeline-orchestrator");
  const { contracts, errors } = parseContracts([join(base, "SKILL.md"), join(base, "contracts-retired.md")]);
  assert.deepEqual(errors, []);
  assert.equal(contracts.length, 7);
});
```

In `tools/sdlc-lint/test/compliance.test.mjs`, change the contract loading to the union and update
the two era-sensitive tests:

```js
const SKILLDIR = join(REPO, "plugins/sdlc/skills/pipeline-orchestrator");
const { contracts } = parseContracts([join(SKILLDIR, "SKILL.md"), join(SKILLDIR, "contracts-retired.md")]);
```

```js
test("a fully compliant run of the old era passes every contract that applied to it", () => {
  const res = audit("compliant");                       // dated 2026-07-28
  assert.equal(res.status, "auditable");
  assert.deepEqual(res.verdicts.filter((v) => v.verdict !== "pass" && v.verdict !== "na"), []);
  // The tail was three calls back then, and the collapsed contract did not exist yet.
  assert.equal(verdict(res, "5b-finish").reason, "predates");
});

test("a run of the new era passes the collapsed contract and retires the old three", () => {
  const res = audit("sealed");                          // dated 2026-07-30
  assert.equal(verdict(res, "5b-finish").verdict, "pass");
  for (const id of ["5-clock", "5b-0-enrich", "5b-2-report"]) {
    assert.equal(verdict(res, id).reason, "retired", id);
  }
  assert.deepEqual(res.verdicts.filter((v) => v.verdict === "fail"), []);
});
```

Create `tools/sdlc-lint/fixtures/compliance/runs/sealed/_telemetry.json`:

```json
{
  "task_slug": "sealed",
  "started_at": "2026-07-30T10:00:00Z",
  "plugin_version": "1.15.0",
  "phases": [
    { "phase": "development", "agent_id": "hhh888" }
  ]
}
```

Create `tools/sdlc-lint/fixtures/compliance/projects/-fake-proj/sess-d/subagents/agent-hhh888.jsonl`
containing exactly one line: `{}`

Create `tools/sdlc-lint/fixtures/compliance/projects/-fake-proj/sess-d.jsonl` — the new-era tail,
one `tool_use` per line:

```
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"mkdir -p docs/plans/sealed/.checkpoint\n[ -f docs/plans/sealed/.checkpoint/_started_at ] || date -u +%s > docs/plans/sealed/.checkpoint/_started_at"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"node \"${CLAUDE_PLUGIN_ROOT}/tools/usage/cli.mjs\" phase-cost hhh888 --json"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Bash","input":{"command":"node \"${CLAUDE_PLUGIN_ROOT}/tools/run/cli.mjs\" finish sealed"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t4","name":"Agent","input":{"subagent_type":"sdlc:session-recorder","description":"Close SDLC session"}}]}}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/contracts.test.mjs tools/sdlc-lint/test/compliance.test.mjs`
Expected: FAIL — no `contracts-retired.md`, `SKILL.md` still declares six contracts, no `5b-finish`.

- [ ] **Step 3: Create the archive**

Create `plugins/sdlc/skills/pipeline-orchestrator/contracts-retired.md`:

````markdown
# Retired step contracts

Machine-owned. Read by `sdlc-lint compliance` together with `SKILL.md`; **not** read by the
orchestrator at run time and not part of any procedure.

A contract lands here when the step it describes is replaced. It keeps its original `since` and
gains an `until`, so a run from its era is still audited against the procedure that was actually in
force — which is what keeps an already-published compliance rate reproducible after the procedure
changes. Runs dated after `until` record `na: retired` for it.

The H1 rule "contracts live next to the prose they describe" does not apply here: it exists so a
contract cannot drift from a step still being edited, and a retired contract describes a step that
no longer exists. Nothing in this file may be edited except to add a newly retired block.

## Replaced 2026-07-29 by `5b-finish` (H2)

Steps 5 and 5b used to mandate three separate invocations: the run-clock arithmetic, the cost
enrichment, and the HTML render. H1 measured the multi-step clock at 67% — the worst rate in the
set — against 87–100% for every single-command step. `run/cli.mjs finish` now does all three.

```sdlc-contract
id: 5-clock
requires: bash_match
pattern: date -u (-r |-d @)
cardinality: once-per-run
since: 2026-07-06
until: 2026-07-28
```

```sdlc-contract
id: 5b-0-enrich
requires: bash_match
pattern: usage/cli\.mjs"?\s+enrich
cardinality: once-per-run
since: 2026-07-07
until: 2026-07-28
```

```sdlc-contract
id: 5b-2-report
requires: bash_match
pattern: report/cli\.mjs"?\s+report
cardinality: once-per-run
since: 2026-07-03
until: 2026-07-28
```
````

- [ ] **Step 4: Rewrite Step 5's clock block in `SKILL.md`**

Delete the `5-clock` contract block and the whole "Compute the timing from the real clock captured
in Step 2 (via `Bash`)" bullet list — from the `` ```sdlc-contract `` fence through the paragraph
ending "…that is a repair of your output, not a substitute for doing it right." Replace with:

```markdown
**Timing is not yours to write.** Do NOT put `started_at`, `completed_at` or `wall_clock_seconds`
into `_telemetry.json` — omit the three keys entirely. Step 5b's `finish` derives all three from the
machine anchor `.checkpoint/_started_at` written in Step 2, and is their only writer (ADR-0014). You
have no way to read a clock that is more authoritative than the one already on disk, and an observed
run proved the cost of trying: it stamped its **local** time with a `Z`, putting the run window
3h20m off the anchor while staying internally consistent and externally false.
```

Then re-read the aggregates paragraph that follows and delete the now-dangling reference to Step 5b
"overwriting" the timing (the cost aggregates sentence stays as-is).

- [ ] **Step 5: Rewrite Step 5b in `SKILL.md`**

Replace everything from the `### Step 5b` heading through the end of numbered item `2.` (the
`report/cli.mjs` block, ending "…a render failure NEVER fails the pipeline (the run already
succeeded).") with:

````markdown
### Step 5b — Seal the run (clock, cost, report) in one command

```sdlc-contract
id: 5b-finish
requires: bash_match
pattern: run/cli\.mjs"?\s+finish
cardinality: once-per-run
since: 2026-07-29
```

After `_telemetry.json` is written, seal the run with ONE `Bash` call:

```
node "${CLAUDE_PLUGIN_ROOT}/tools/run/cli.mjs" finish {task_slug}
```

Append `--no-report` when the user passed `--no-report` or the effective profile sets
`report: false` — the run still gets its clock and its transcript-derived cost, only the HTML render
is skipped. If `command -v node` fails, print `run sealing: skipped (node unavailable)` and go to
the final summary.

The command writes the run clock from the machine anchor, rewrites every phase's cost from its
subagent transcript (the authoritative cost path — ADR-0005), reconciles the cap verdict and the run
window, and renders `report.html`. It resolves the orchestrator's session transcript by itself; there
is no path for you to supply and no glob for you to run.

**Your one obligation: echo what it prints.** Copy its block into the final summary, and reproduce
every `WARN:` line **verbatim** — those lines are the only signal that a run is unpriced, that its
cap was breached without the gate noticing, or that its clock has no anchor. Each stage fails open,
so a non-zero exit means the run directory was unreadable, never that the pipeline failed.

**Reading the result** (this is judgement, and stays yours):

- `cost: $— (unpriced)` means no phase transcript resolved. Do **not** repair the appearance by
  hand-editing `cost_basis`, `cap_status` or `total_cost_usd` — the report deliberately renders
  `unverified — run unpriced` and names the `cap_gate_blind` phases. A run reported as priced
  without transcript pricing behind it is the failure this step exists to prevent.
- `cap: exceeded-undetected` has two causes, told apart by whether any phase carries
  `cap_gate_blind`. **With** blind phases, Step 3d-1b could not price them, they entered the gate as
  `$0`, and the gate genuinely failed — investigate. **Without** any, the overage landed on the run's
  LAST dispatch, where 3d-cap has nothing left to stop, or the recipe has a single phase and no gate
  boundary at all. That second case is the shape of a pre-dispatch gate, not a malfunction: it means
  the recipe's cap is sized below what one phase costs. Fix the cap, not the gate.
- `total_cost_usd` and the cap legitimately disagree: the gate compares **phase** spend only, and
  orchestration overhead — routinely larger than the phases it wraps — sits outside it by design.
  Never fold overhead into the gate to "reconcile" them; that silently re-tightens every recipe's cap.

Skipped entirely under `--dry-run` (nothing ran; consistent with "Do NOT run Step 5"). Under
`--resume`, sealing re-runs against the reassembled telemetry and is idempotent — the anchor never
moves, only the end of the window advances.
````

- [ ] **Step 6: Point the compliance verb at both files**

In `tools/sdlc-lint/cli.mjs`, in `printCompliance()`:

```js
  const skillDir = resolve(root, "plugins/sdlc/skills/pipeline-orchestrator");
  const { contracts, errors } = parseContracts([
    join(skillDir, "SKILL.md"),
    join(skillDir, "contracts-retired.md"),
  ]);
```

(`join` is already imported in that file; confirm with `grep -n "^import" tools/sdlc-lint/cli.mjs`
and add it to the `node:path` import if it is missing.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test --prefix tools/sdlc-lint`
Expected: PASS. Then confirm the skill itself still lints:
Run: `node tools/sdlc-lint/cli.mjs all --json`
Expected: exit 0 — in particular `plugin-paths` must accept the new
`${CLAUDE_PLUGIN_ROOT}/tools/run/cli.mjs` line.

- [ ] **Step 8: Commit**

```bash
git add plugins/sdlc/skills/pipeline-orchestrator/ tools/sdlc-lint/cli.mjs tools/sdlc-lint/test/ tools/sdlc-lint/fixtures/
git commit -m "feat(sdlc): collapse the run tail to one command and retire its three contracts"
```

---

### Task 7: Docs, changelog and the vault record

**Files:**
- Modify: `CHANGELOG.md` (the `## [Unreleased]` section)
- Modify: `plugins/sdlc/PLUGIN-PATHS.md` (the `tools/**` example list)
- Create: `.brain/decisions/ADR-0014-the-run-tail-is-one-command.md`
- Modify: `.brain/planning/h-instruction-fidelity.md` (H2 section + the dependency diagram)
- Modify: `.brain/planning/roadmap.md` (the H2 row)
- Modify: `.brain/components/sdlc.md` (the tools list)

**Interfaces:**
- Consumes: everything above; no code changes.
- Produces: no interfaces. `node tools/brain-sync/cli.mjs check --vault .brain` must be clean.

- [ ] **Step 1: Write the ADR**

Create `.brain/decisions/ADR-0014-the-run-tail-is-one-command.md` following
`.brain/_templates/adr.md` exactly (`adr: 0014`, `status: accepted`, `date: 2026-07-29`,
`supersedes: null`). Content, in the vault's voice:

- **Context** — H1's measured spread (100% for a one-line step, 67% for the one multi-step
  procedure, with the most emphatic prose in the file attached to the worst rate). The tail mandated
  three invocations across six sub-steps. Link `[[planning/h1-compliance-auditor]]`,
  `[[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]]`,
  `[[decisions/ADR-0007-overhead-window-authoritative-anchor]]`.
- **Decision** — two commitments. (1) The orchestrator does not author the run clock: `started_at`,
  `completed_at` and `wall_clock_seconds` are written only by `tools/run/clock.mjs` from
  `.checkpoint/_started_at`. (2) Sealing a run is exactly one invocation, `run/cli.mjs finish`,
  fail-open per stage, whose only requirement on the model is to echo its output including every
  `WARN:` line.
- **Consequences** — mandated tail invocations 3 → 1; the BSD/GNU `date` fallback leaves the prose;
  `--session` can no longer be supplied wrongly (the worktree trap is designed out rather than
  warned about); retired contracts keep the published 82.3% reproducible; H6's `Stop` hook becomes a
  call to one idempotent command. The limit, stated plainly: this removes a *procedure*, not the
  judgement around it — reading an `exceeded-undetected` verdict correctly is still prose the model
  can get wrong.
- **Related** — `Implemented by: #<pr>` as plain text (never a `[[changes/...]]` wikilink).

- [ ] **Step 2: Update the planning notes**

In `.brain/planning/h-instruction-fidelity.md`, rewrite the **H2** section: keep the original
statement of intent, then record what shipped (the `finish` verb, the contract retirement mechanism,
the two DoD numbers from Task 8) and link `[[decisions/ADR-0014-the-run-tail-is-one-command]]`.
Mark the H2 line in the dependency diagram as done. In the H4 section, note that one of the two
things its gate was waiting on has now landed.

In `.brain/planning/roadmap.md`, change the H2 row's status to `done` and put the PR number in
`Landed in`.

In `.brain/components/sdlc.md`, add `tools/run/` to the tool inventory beside `usage/` and
`report/`.

- [ ] **Step 3: Update the changelog and path docs**

Replace `_Nothing yet._` under `## [Unreleased]` with an `### Changed` entry in the file's
established voice: what broke (the tail was three prose-mandated calls, measured at 67% on its
worst step), what shipped (`run/cli.mjs finish`), and the consequence for anyone reading old runs
(`usage/cli.mjs enrich` and `report/cli.mjs report` still work unchanged for backfills). Reference
ADR-0014.

In `plugins/sdlc/PLUGIN-PATHS.md`, add `tools/run/cli.mjs` alongside the existing
`tools/usage/cli.mjs` example so the documented inventory matches what ships.

- [ ] **Step 4: Verify the vault**

Run: `node tools/brain-sync/cli.mjs check --vault .brain`
Expected: clean — no dangling wikilinks. A `[[changes/...]]` link inside the ADR is the usual
failure; the ADR references PRs as plain text.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md plugins/sdlc/PLUGIN-PATHS.md .brain/
git commit -m "docs: record ADR-0014 and mark H2 landed in the vault"
```

---

### Task 8: Measure the DoD

**Files:**
- Modify: `.brain/planning/h-instruction-fidelity.md` (the H2 DoD numbers)
- Modify: `docs/superpowers/specs/2026-07-28-h2-collapse-run-tail-design.md` (a short
  post-implementation note if anything shipped differently from the spec)

**Interfaces:**
- Consumes: the finished implementation.
- Produces: the two numbers H2's DoD asks for.

- [ ] **Step 1: Count the prose reduction**

Run:

```bash
git diff --stat track-h..HEAD -- plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
wc -l plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
grep -c "sdlc-contract" plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
```

Record: `SKILL.md` line count before (2509) and after; mandated tail invocations before (3) and
after (1); live contracts before (6) and after (4).

- [ ] **Step 2: Re-run the audit over the historical corpus**

Run:

```bash
node tools/sdlc-lint/cli.mjs compliance --runs "$HOME/parlor-android/docs/plans/*"
```

Expected: the three retired contracts still report the rates H1 published (100/87/87/80/67 across
15 auditable runs, 82.3% overall) — the retirement window is closed on 2026-07-28 precisely so this
stays true. `5b-finish` reports `n=0` with `na: retired`/`predates` counts, not `0%`. If any
historical rate moved, stop: the archive's `since`/`until` values are wrong, not the corpus.

If `$HOME/parlor-android` does not exist on this machine, say so in the record rather than
substituting another corpus — an unreproduced number is not a failed one, but it must not be
reported as reproduced.

- [ ] **Step 3: Write the numbers into the vault**

Put both measurements into the H2 section of `.brain/planning/h-instruction-fidelity.md`, with the
same `provisional` caveat H1 carries (no run in the corpus predates `plugin_version`, so step
availability is still dated from commits). State explicitly that H2's *own* effect — whether the
collapsed step scores better than the 67% it replaced — cannot be measured until real runs exist on
the new version, and name that as the next measurement.

- [ ] **Step 4: Commit**

```bash
git add .brain/planning/h-instruction-fidelity.md docs/superpowers/specs/2026-07-28-h2-collapse-run-tail-design.md
git commit -m "docs(brain): record H2's measured prose reduction and the reproduced baseline"
```

- [ ] **Step 5: Open the PR**

```bash
git push -u origin feat/h2-collapse-mandated-steps
gh pr create --base track-h --title "feat(sdlc): H2 — collapse the run tail into one command" --body "..."
```

Base is **`track-h`**, not `develop` — Track H integrates on its own branch (PR #101 set that
precedent). The body: the H1 finding that motivated it, the two DoD numbers from Steps 1–2, and the
retirement mechanism.

---

## Verification checklist

Before opening the PR:

- [ ] `npm test --prefix tools/sdlc-lint` — full suite green
- [ ] `node tools/sdlc-lint/cli.mjs all --json` — exit 0 (schema, cycles, read-discipline,
      plugin-paths)
- [ ] `node tools/brain-sync/cli.mjs check --vault .brain` — clean
- [ ] `node "$PWD/plugins/sdlc/tools/run/cli.mjs" finish <a real run dir> --json` on an actual run
      from a downstream project — the smoke test no unit test can stand in for
- [ ] `grep -rn "usage/cli.mjs enrich\|report/cli.mjs report\|date -u -r" plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`
      returns nothing — the collapsed steps left no stragglers in the prose
