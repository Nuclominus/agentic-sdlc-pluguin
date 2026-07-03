# HTML Run-Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the end of an SDLC pipeline run, deterministically render one self-contained `docs/plans/{slug}/report.html` from `_telemetry.json` (+ sibling phase files).

**Architecture:** A new pure renderer `lib/report.mjs` (`renderReport(telemetry, extras) -> htmlString`) plus a thin file wrapper `renderReportFile(dir)`, exposed as a `sdlc-lint report <slug|dir>` CLI verb — inside the existing `tools/sdlc-lint` Node ESM CLI. The orchestrator auto-invokes it in a new Step 5b.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, zero new dependencies (node builtins only). Spec: `docs/superpowers/specs/2026-07-03-sdlc-html-run-report-design.md`.

## Global Constraints

- Renderer lives in `tools/sdlc-lint/` (verb `report`), NOT a new tool. (Spec D1)
- Deterministic: NO `Date.now()` / `new Date()` in render; the "generated" stamp is `telemetry.completed_at`. (Spec D5)
- Self-contained HTML: inline CSS only, **zero** external refs — no `https?://`, `src=`, `<link`, `<script src`, `@import url(`. (Spec D4)
- Every interpolated value HTML-escaped via one `esc()` helper. (Spec D4)
- Theme-aware (light/dark via `prefers-color-scheme`).
- `_telemetry.json` is the authoritative structured input; never re-derive costs. (Spec D3)
- Sections whose source data is absent are omitted, never rendered empty. (Spec content rules)
- No new npm dependencies.

---

### Task 1: Renderer skeleton — doc wrapper, `esc()`, header + KPI, invariant tests

**Files:**
- Create: `tools/sdlc-lint/lib/report.mjs`
- Create: `tools/sdlc-lint/fixtures/report-basic/_telemetry.json`
- Create: `tools/sdlc-lint/test/report.test.mjs`

**Interfaces:**
- Produces: `renderReport(telemetry: object, extras?: { postChecksMarkdown?: string, artifactFiles?: string[] }) -> string` (full HTML document). Also internal `esc`, `fmtUsd`, `fmtInt`, `pct` helpers used by later tasks.

- [ ] **Step 1: Create the golden fixture** `tools/sdlc-lint/fixtures/report-basic/_telemetry.json`

```json
{
  "task_slug": "add-subscription-billing",
  "stack": "android",
  "primary_profile": "android",
  "additive_profiles": ["retrofit"],
  "narrative_language": "uk",
  "resumed": true,
  "started_at": "2026-07-03T10:00:00Z",
  "completed_at": "2026-07-03T10:03:07Z",
  "wall_clock_seconds": 187,
  "model_enforcement_corrections": 0,
  "phases": [
    { "phase": "business_analysis", "aspect": null, "agent": "business-analyst", "model": "claude-opus-4-8", "status": "completed", "origin": "resumed", "input_tokens": 35000, "output_tokens": 3000, "cached_input_tokens": 21000, "cost_usd": 0.16 },
    { "phase": "qa", "aspect": null, "agent": "qa-engineer", "model": "claude-sonnet-5", "status": "completed", "origin": "fresh", "qa_iterations_used": 2, "qa_status": "completed", "input_tokens": 28000, "output_tokens": 2100, "cached_input_tokens": 18000, "cost_usd": 0.04 },
    { "phase": "security", "aspect": null, "agent": "security-analyst", "model": "claude-haiku-4-5-20251001", "status": "completed", "origin": "fresh", "input_tokens": 12000, "output_tokens": 900, "cached_input_tokens": 6000, "cost_usd": null }
  ],
  "skip_rules_applied": [
    { "rule": "config-only", "phase_skipped": "qa", "reason": "all changed paths matched config globs" }
  ],
  "post_pipeline_checks": [
    { "command": "./gradlew detekt", "exit_code": 0 },
    { "command": "echo <script>alert(1)</script>", "exit_code": 1 }
  ],
  "touched_files": [
    { "status": "A", "path": "feature/billing/SubscriptionRepository.kt" },
    { "status": "M", "path": "app/build.gradle.kts" }
  ],
  "total_input_tokens": 75000,
  "total_output_tokens": 6000,
  "total_cached_input_tokens": 45000,
  "total_cost_usd": 0.20,
  "cost_cap_usd": 0.60,
  "cap_status": "within",
  "cache_hit_ratio": 0.6,
  "deps_preflight": { "superpowers": { "status": "available", "missing_skills": [] } }
}
```

- [ ] **Step 2: Write the failing test** `tools/sdlc-lint/test/report.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderReport } from "../lib/report.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "report-basic");
const tel = JSON.parse(readFileSync(join(FIX, "_telemetry.json"), "utf8"));

test("renders a complete, self-contained HTML document", () => {
  const html = renderReport(tel);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<\/html>\s*$/i);
  // self-contained: no external references of any kind
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /src=/);
  assert.doesNotMatch(html, /<link/i);
  assert.doesNotMatch(html, /@import url\(/i);
});

test("header + KPI content is present", () => {
  const html = renderReport(tel);
  assert.match(html, /add-subscription-billing/);
  assert.match(html, /RESUMED/);            // resumed badge
  assert.match(html, /\$0\.20/);            // total cost
  assert.match(html, /60%/);                // cache hit
});

test("escapes injected markup from untrusted fields", () => {
  const html = renderReport(tel);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/); // raw form absent
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); // escaped form present
});

test("output is deterministic (byte-identical across calls)", () => {
  assert.equal(renderReport(tel), renderReport(tel));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/report.test.mjs`
Expected: FAIL — `Cannot find module '../lib/report.mjs'`.

- [ ] **Step 4: Implement `lib/report.mjs`** (skeleton: helpers, CSS, doc wrapper, header + KPI; later tasks add sections)

```js
// Pure renderer — no imports. The file-I/O wrapper (Task 4) adds node:fs / node:path.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtUsd = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
const fmtInt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (r) => `${Math.round((Number(r) || 0) * 100)}%`;

const CSS = `
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e3e3e3;--card:#f7f7f8;--bar:#4f6bed;--accent:#4f6bed}
@media(prefers-color-scheme:dark){:root{--bg:#15161a;--fg:#e8e8ea;--muted:#9a9aa2;--line:#2b2d33;--card:#1e2026;--bar:#6b83f0;--accent:#8ea2ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}
.sub{color:var(--muted);margin:0 0 2px}.meta{color:var(--muted);font-size:13px;margin:0}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;background:var(--card);color:var(--muted);vertical-align:middle}
.badge-resume{background:var(--accent);color:#fff}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-top:20px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.tv{font-size:20px;font-weight:600}.tl{color:var(--muted);font-size:12px;margin-top:2px}.ts{color:var(--muted);font-size:11px;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:500}.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{width:120px}.bar span{display:block;height:8px;border-radius:4px;background:var(--bar)}
.note{color:var(--muted);font-size:12px}.sig li,.files li{margin:3px 0}ul{padding-left:18px}
.st{display:inline-block;width:16px;font-weight:600}.st-A{color:#2ea043}.st-M{color:#bf8700}.st-D{color:#cf222e}
details{margin-top:10px}pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto}
`;

function doc(t, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SDLC run — ${esc(t.task_slug)}</title>
<style>${CSS}</style>
</head>
<body><main class="wrap">
${body}
<footer class="meta" style="margin-top:40px">Generated from _telemetry.json · ${esc(t.completed_at || "")}</footer>
</main></body>
</html>`;
}

function headerSection(t) {
  const profiles = [t.primary_profile, ...(t.additive_profiles || [])].filter(Boolean).join(" + ");
  const resumed = t.resumed ? ` <span class="badge badge-resume">RESUMED</span>` : "";
  return `<header><h1>${esc(t.task_slug)}${resumed}</h1>
<p class="sub">${esc(t.stack || "—")} · <code>${esc(profiles || "—")}</code></p>
<p class="meta">${esc(t.started_at || "?")} → ${esc(t.completed_at || "?")} · ${fmtInt(t.wall_clock_seconds)}s</p></header>`;
}

function tile(label, value, sub) {
  return `<div class="tile"><div class="tv">${value}</div><div class="tl">${esc(label)}</div>${sub ? `<div class="ts">${sub}</div>` : ""}</div>`;
}
function kpiSection(t) {
  const capNote = t.cost_cap_usd != null ? `${fmtUsd(t.cost_cap_usd)} cap · ${esc(t.cap_status || "—")}` : "no cap";
  return `<section class="kpis">
${tile("Total cost", fmtUsd(t.total_cost_usd), capNote)}
${tile("Input tokens", fmtInt(t.total_input_tokens))}
${tile("Output tokens", fmtInt(t.total_output_tokens))}
${tile("Cache hit", pct(t.cache_hit_ratio))}
${tile("Phases", fmtInt((t.phases || []).length))}
${tile("Model corrections", fmtInt(t.model_enforcement_corrections))}
</section>`;
}

export function renderReport(t, extras = {}) {
  const sections = [
    headerSection(t),
    kpiSection(t),
  ].filter(Boolean);
  return doc(t, sections.join("\n"));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tools/sdlc-lint && node --test test/report.test.mjs`
Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/lib/report.mjs tools/sdlc-lint/test/report.test.mjs tools/sdlc-lint/fixtures/report-basic/_telemetry.json
git commit -m "feat(sdlc-lint): report renderer skeleton — header + KPI + invariant tests"
```

---

### Task 2: Phase timeline + cost-by-model breakdown

**Files:**
- Modify: `tools/sdlc-lint/lib/report.mjs`
- Modify: `tools/sdlc-lint/test/report.test.mjs`

**Interfaces:**
- Consumes: `renderReport`, `esc`, `fmtUsd`, `fmtInt` from Task 1.
- Produces: internal `timelineSection(t)`, `costBreakdownSection(t)` wired into `renderReport`'s section list.

- [ ] **Step 1: Add failing tests** (append to `test/report.test.mjs`)

```js
test("phase timeline lists every phase with agent and model", () => {
  const html = renderReport(tel);
  assert.match(html, /business_analysis/);
  assert.match(html, /qa-engineer/);
  assert.match(html, /claude-sonnet-5/);
  assert.match(html, /resumed<\/span>/); // origin badge on the resumed phase
});

test("cost-by-model note flags unpriced phases", () => {
  const html = renderReport(tel);
  // security phase has cost_usd:null → partial note with count 1
  assert.match(html, /1 phase\(s\) unpriced/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tools/sdlc-lint && node --test test/report.test.mjs`
Expected: FAIL — timeline/model markup not present yet.

- [ ] **Step 3: Add the two section functions** to `lib/report.mjs` (above `renderReport`)

```js
const ICON = { completed: "✅", skipped: "⏩", aborted: "⏸", approved: "✅" };

function timelineSection(t) {
  const phases = t.phases || [];
  if (!phases.length) return "";
  const maxCost = Math.max(...phases.map((p) => p.cost_usd || 0), 0.0001);
  const rows = phases.map((p) => {
    const name = p.aspect ? `${p.phase} · ${p.aspect}` : p.phase;
    const w = Math.round(((p.cost_usd || 0) / maxCost) * 100);
    const origin = p.origin === "resumed" ? ` <span class="badge">resumed</span>` : "";
    return `<tr><td>${ICON[p.status] || "•"}</td>
<td>${esc(name)}${origin}</td>
<td>${esc(p.agent || "—")}</td>
<td><code>${esc(p.model || "—")}</code></td>
<td class="num">${fmtInt((p.input_tokens || 0) + (p.output_tokens || 0))}</td>
<td class="num">${fmtUsd(p.cost_usd)}</td>
<td class="bar"><span style="width:${w}%"></span></td></tr>`;
  }).join("\n");
  return `<section><h2>Phase timeline</h2>
<table><thead><tr><th></th><th>Phase</th><th>Agent</th><th>Model</th><th class="num">Tokens</th><th class="num">Cost</th><th>Cost share</th></tr></thead>
<tbody>${rows}</tbody></table></section>`;
}

function costBreakdownSection(t) {
  const phases = t.phases || [];
  if (!phases.length) return "";
  const byModel = new Map();
  let unpriced = 0;
  for (const p of phases) {
    const k = p.model || "—";
    const m = byModel.get(k) || { input: 0, output: 0, cost: 0 };
    m.input += p.input_tokens || 0;
    m.output += p.output_tokens || 0;
    if (p.cost_usd == null) unpriced++; else m.cost += p.cost_usd;
    byModel.set(k, m);
  }
  const rows = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([model, m]) =>
    `<tr><td><code>${esc(model)}</code></td><td class="num">${fmtInt(m.input)}</td><td class="num">${fmtInt(m.output)}</td><td class="num">${fmtUsd(m.cost)}</td></tr>`).join("\n");
  const note = unpriced ? `<p class="note">Cost partial — ${unpriced} phase(s) unpriced (no registry pricing).</p>` : "";
  return `<section><h2>Cost by model</h2>
<table><thead><tr><th>Model</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cost</th></tr></thead>
<tbody>${rows}</tbody></table>${note}</section>`;
}
```

- [ ] **Step 4: Wire them into `renderReport`'s section list**

```js
  const sections = [
    headerSection(t),
    kpiSection(t),
    timelineSection(t),
    costBreakdownSection(t),
  ].filter(Boolean);
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `cd tools/sdlc-lint && node --test test/report.test.mjs`
Expected: PASS (6/6). Self-contained/escaping/determinism tests still green.

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/lib/report.mjs tools/sdlc-lint/test/report.test.mjs
git commit -m "feat(sdlc-lint): phase timeline + cost-by-model breakdown"
```

---

### Task 3: Signals, post-checks, touched-files, deps, artifact links

**Files:**
- Modify: `tools/sdlc-lint/lib/report.mjs`
- Modify: `tools/sdlc-lint/test/report.test.mjs`

**Interfaces:**
- Consumes: `renderReport`, `esc`, `fmtInt` from Tasks 1–2; `extras.postChecksMarkdown` and `extras.artifactFiles` (supplied by the Task 4 wrapper; optional here).
- Produces: `signalsSection(t)`, `postChecksSection(t, md)`, `touchedFilesSection(t)`, `depsSection(t)`, `artifactsSection(t, files)` wired into `renderReport`.

- [ ] **Step 1: Add failing tests** (append to `test/report.test.mjs`)

```js
test("signals panel surfaces QA and skip-rules", () => {
  const html = renderReport(tel);
  assert.match(html, /QA:\s*completed/);
  assert.match(html, /Skipped/);
  assert.match(html, /config-only/);
});

test("touched-files section lists files, and is omitted when absent", () => {
  const withFiles = renderReport(tel);
  assert.match(withFiles, /Touched files \(2\)/);
  assert.match(withFiles, /SubscriptionRepository\.kt/);

  const { touched_files, ...noFiles } = tel; // omit the key
  const html = renderReport(noFiles);
  assert.doesNotMatch(html, /Touched files/);
});

test("post-checks render commands and pass/fail", () => {
  const html = renderReport(tel);
  assert.match(html, /gradlew detekt/);
});

test("deps preflight and artifact links render", () => {
  const html = renderReport(tel, { artifactFiles: ["01-business-analysis.md"] });
  assert.match(html, /superpowers/);
  assert.match(html, /href="01-business-analysis\.md"/);
  assert.match(html, /href="_telemetry\.json"/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd tools/sdlc-lint && node --test test/report.test.mjs`
Expected: FAIL — these sections not rendered yet.

- [ ] **Step 3: Add the five section functions** to `lib/report.mjs`

```js
function signalsSection(t) {
  const items = [];
  const qa = (t.phases || []).find((p) => p.phase === "qa");
  if (qa && (qa.qa_status || qa.qa_iterations_used != null)) {
    items.push(`QA: ${esc(qa.qa_status || "—")} (${fmtInt(qa.qa_iterations_used)} iteration(s))`);
  }
  for (const s of t.skip_rules_applied || []) {
    items.push(`Skipped <b>${esc(s.phase_skipped)}</b> — ${esc(s.rule)}`);
  }
  if (t.cap_status && t.cap_status !== "within") items.push(`Cap: <b>${esc(t.cap_status)}</b>`);
  if (t.aborted_at_phase) items.push(`Aborted at <b>${esc(t.aborted_at_phase)}</b>`);
  if (!items.length) return "";
  return `<section><h2>Signals</h2><ul class="sig">${items.map((i) => `<li>${i}</li>`).join("")}</ul></section>`;
}

function postChecksSection(t, md) {
  const checks = t.post_pipeline_checks || [];
  if (!checks.length && !md) return "";
  const rows = checks.map((c) => {
    const icon = c.skipped ? "⏭" : c.exit_code === 0 ? "✅" : "❌";
    const ec = c.exit_code == null ? "skip" : esc(c.exit_code);
    return `<tr><td>${icon}</td><td><code>${esc(c.command)}</code></td><td class="num">${ec}</td></tr>`;
  }).join("\n");
  const excerpt = md ? `<details><summary>Output tail</summary><pre>${esc(md)}</pre></details>` : "";
  return `<section><h2>Post-pipeline checks</h2>${checks.length ? `<table><tbody>${rows}</tbody></table>` : ""}${excerpt}</section>`;
}

function touchedFilesSection(t) {
  const files = t.touched_files;
  if (!Array.isArray(files) || !files.length) return "";
  const rows = files.map((f) =>
    `<li><span class="st st-${esc(f.status)}">${esc(f.status)}</span> <code>${esc(f.path)}</code></li>`).join("");
  return `<section><h2>Touched files (${files.length})</h2><ul class="files">${rows}</ul></section>`;
}

function depsSection(t) {
  const d = t.deps_preflight;
  if (!d || !Object.keys(d).length) return "";
  const rows = Object.entries(d).map(([name, v]) => {
    const miss = v && v.missing_skills && v.missing_skills.length ? ` — missing ${esc(v.missing_skills.join(", "))}` : "";
    return `<li><code>${esc(name)}</code>: ${esc(v ? v.status : "—")}${miss}</li>`;
  }).join("");
  return `<section><h2>Dependency preflight</h2><ul>${rows}</ul></section>`;
}

function artifactsSection(t, files) {
  const list = (files || []).map((f) => `<li><a href="${esc(f)}">${esc(f)}</a></li>`).join("");
  return `<section><h2>Artifacts</h2><ul class="files">${list}<li><a href="_telemetry.json">_telemetry.json</a></li></ul></section>`;
}
```

- [ ] **Step 4: Extend `renderReport`'s section list** to the full set

```js
export function renderReport(t, extras = {}) {
  const sections = [
    headerSection(t),
    kpiSection(t),
    timelineSection(t),
    costBreakdownSection(t),
    signalsSection(t),
    postChecksSection(t, extras.postChecksMarkdown),
    touchedFilesSection(t),
    depsSection(t),
    artifactsSection(t, extras.artifactFiles),
  ].filter(Boolean);
  return doc(t, sections.join("\n"));
}
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `cd tools/sdlc-lint && node --test test/report.test.mjs`
Expected: PASS (10/10). Escaping test still passes — the `<script>` in the post-check command now renders through `postChecksSection` via `esc()`.

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/lib/report.mjs tools/sdlc-lint/test/report.test.mjs
git commit -m "feat(sdlc-lint): signals, post-checks, touched-files, deps, artifact links"
```

---

### Task 4: File wrapper + `report` CLI verb

**Files:**
- Modify: `tools/sdlc-lint/lib/report.mjs`
- Modify: `tools/sdlc-lint/cli.mjs`
- Modify: `tools/sdlc-lint/test/report.test.mjs`

**Interfaces:**
- Consumes: `renderReport` from Tasks 1–3.
- Produces: `renderReportFile(dir: string) -> { htmlPath: string, ok: true }` (reads `<dir>/_telemetry.json`, optional `05-post-checks.md` tail + `NN-*.md` list, writes `<dir>/report.html`); CLI verb `report <slug-or-dir> [--json]`.

- [ ] **Step 1: Add failing test** (append to `test/report.test.mjs`)

```js
import { mkdtempSync, writeFileSync, existsSync, readFileSync as rf } from "node:fs";
import { tmpdir } from "node:os";
import { renderReportFile } from "../lib/report.mjs";

test("renderReportFile writes report.html next to telemetry", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-report-"));
  writeFileSync(join(dir, "_telemetry.json"), JSON.stringify(tel));
  writeFileSync(join(dir, "01-business-analysis.md"), "# BA\n...");
  const { htmlPath, ok } = renderReportFile(dir);
  assert.equal(ok, true);
  assert.ok(existsSync(htmlPath));
  const html = rf(htmlPath, "utf8");
  assert.match(html, /add-subscription-billing/);
  assert.match(html, /href="01-business-analysis\.md"/); // picked up the NN-*.md sibling
});

test("renderReportFile throws a clear error when telemetry is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-report-empty-"));
  assert.throws(() => renderReportFile(dir), /_telemetry\.json/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/report.test.mjs`
Expected: FAIL — `renderReportFile` not exported.

- [ ] **Step 3: Add `renderReportFile` to `lib/report.mjs`**

First add the node builtins this wrapper needs at the **top** of `lib/report.mjs` (Task 1 keeps the pure renderer import-free; the file-I/O layer brings its own imports):

```js
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
```

Then append the function:

```js
export function renderReportFile(dir) {
  const telPath = join(dir, "_telemetry.json");
  if (!existsSync(telPath)) throw new Error(`no _telemetry.json in ${dir}`);
  let t;
  try { t = JSON.parse(readFileSync(telPath, "utf8")); }
  catch (e) { throw new Error(`unparseable _telemetry.json in ${dir}: ${e.message}`); }

  let postChecksMarkdown;
  const pc = join(dir, "05-post-checks.md");
  if (existsSync(pc)) {
    try { postChecksMarkdown = readFileSync(pc, "utf8").split("\n").slice(-30).join("\n"); } catch { /* degrade */ }
  }
  let artifactFiles = [];
  try { artifactFiles = readdirSync(dir).filter((f) => /^\d\d-.*\.md$/.test(f)).sort(); } catch { /* degrade */ }

  const html = renderReport(t, { postChecksMarkdown, artifactFiles });
  const htmlPath = join(dir, "report.html");
  writeFileSync(htmlPath, html);
  return { htmlPath, ok: true };
}
```

- [ ] **Step 4: Add the `report` verb to `cli.mjs`**

Add the import near the other lib imports (top of `cli.mjs`):

```js
import { renderReportFile } from "./lib/report.mjs";
```

Add a `case` in the `switch (cmd)` block (after the `resume` case):

```js
  case "report": {
    const target = args[1] && !args[1].startsWith("--") ? args[1] : null;
    if (!target) { console.error("usage: sdlc-lint report <slug-or-dir> [--json]"); code = 2; break; }
    const direct = join(root, target);
    const dir = existsSync(join(direct, "_telemetry.json")) ? direct : join(root, "docs", "plans", target);
    try {
      const { htmlPath } = renderReportFile(dir);
      if (jsonOut) console.log(JSON.stringify({ command: "report", ok: true, html_path: htmlPath }));
      else console.log(`report: wrote ${htmlPath}`);
      code = 0;
    } catch (e) {
      if (jsonOut) console.log(JSON.stringify({ command: "report", ok: false, error: e.message }));
      else console.error(`✗ report: ${e.message}`);
      code = 2;
    }
    break;
  }
```

Update the `--help` usage line:

```js
    console.log("Usage: sdlc-lint <schema|cycles|detect|resume|report|all> [--json]");
```

Add `existsSync` to the `node:fs` import at the top of `cli.mjs` if not already present:

```js
import { readdirSync, readFileSync, existsSync } from "node:fs";
```

- [ ] **Step 5: Run the full suite + a smoke CLI run**

Run: `cd tools/sdlc-lint && node --test`
Expected: PASS (all suites, including the new 12 report assertions).

Run: `cd tools/sdlc-lint && node cli.mjs report fixtures/report-basic --json`
Expected: `{"command":"report","ok":true,"html_path":".../fixtures/report-basic/report.html"}` and exit 0.

- [ ] **Step 6: Clean up the smoke artifact and commit**

```bash
rm -f tools/sdlc-lint/fixtures/report-basic/report.html
git add tools/sdlc-lint/lib/report.mjs tools/sdlc-lint/cli.mjs tools/sdlc-lint/test/report.test.mjs
git commit -m "feat(sdlc-lint): renderReportFile wrapper + report CLI verb"
```

(Also add `report.html` under fixtures to `.gitignore` if the smoke run may recur — optional: `echo 'tools/sdlc-lint/fixtures/**/report.html' >> .gitignore`.)

---

### Task 5: Orchestrator wiring — persist `touched_files`, add Step 5b render

**Files:**
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (Step 5 telemetry block ~line 1174–1238; add new Step 5b after Step 5; final-summary Artifacts block ~line 1279–1291)

**Interfaces:**
- Consumes: `node tools/sdlc-lint/cli.mjs report {task_slug}` from Task 4.
- Produces: `touched_files` key in `_telemetry.json`; `report.html` generated per run; report path in the printed summary. This task is prose (LLM-executed markdown) — no unit test; verification is a green `node --test`, a green `sdlc-lint all`, and a manual read-through.

- [ ] **Step 1: Add `touched_files` to the telemetry JSON example** in Step 5

In the `_telemetry.json` example object (after the `deps_preflight` block, before the closing `}`), add:

```json
  "touched_files": [
    { "status": "M", "path": "app/src/main/Foo.kt" }
  ]
```

- [ ] **Step 2: Add a computation bullet** to the "Compute aggregates from `phases[]`" list in Step 5

```markdown
- `touched_files` (optional) = `git diff --name-status <merge-base>...HEAD` parsed into
  `[{ "status": "A|M|D|R...", "path": "<repo-relative>" }]`, reusing the git already run in Step 0c.
  On any git error, **omit the key** (never fabricate). Consumed by the HTML report (Step 5b).
```

- [ ] **Step 3: Insert a new "Step 5b — Render HTML report" section** immediately after Step 5 (before the `---` that precedes "## Base prompts per phase")

```markdown
### Step 5b — Render the HTML run-report

After `_telemetry.json` is written, render a self-contained HTML report — unless the user passed
`--no-report` or the effective profile sets `report: false`.

1. If `command -v node` fails → print `HTML report: skipped (node unavailable)` and skip to the
   final summary.
2. Else run via `Bash`: `node tools/sdlc-lint/cli.mjs report {task_slug}`.
   - On exit 0 → the file is at `docs/plans/{task_slug}/report.html`. Add it to the **Artifacts**
     block of the final summary and print `HTML report: docs/plans/{task_slug}/report.html`.
   - On non-zero exit → print `HTML report: failed — {stderr tail}` and continue. The report is a
     convenience; a render failure NEVER fails the pipeline (the run already succeeded).

Skipped entirely under `--dry-run` (nothing ran; consistent with "Do NOT run Step 5").
Under `--resume`, the report is regenerated from the reassembled telemetry, so it reflects the full
multi-session picture.
```

- [ ] **Step 4: Add `report.html` to the final-summary Artifacts block** (Step 5 printed summary)

In the `Artifacts:` list of the final summary template, add a line after `_telemetry.json`:

```
  docs/plans/{task_slug}/report.html
```

- [ ] **Step 5: Verify nothing regressed**

Run: `cd tools/sdlc-lint && node --test` → Expected: PASS (all suites).
Run: `cd tools/sdlc-lint && node cli.mjs all --json` → Expected: `"ok":true` (SKILL.md is prose; schema/cycles/detect/resume unaffected).
Manually re-read the three edited SKILL.md regions to confirm the prose is coherent and the JSON example is valid.

- [ ] **Step 6: Commit**

```bash
git add plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
git commit -m "feat(sdlc): auto-render HTML run-report in Step 5b + persist touched_files"
```

---

## Self-Review

**Spec coverage:**
- D1 renderer = sdlc-lint subcommand → Tasks 1–4. ✅
- D2 deterministic Node → Task 1 (determinism test). ✅
- D3 telemetry authoritative → all sections read `t.*`; costs never re-derived. ✅
- D4 self-contained + escaped → Task 1 tests (no external refs; escaping). ✅
- D5 no clock in render → footer uses `t.completed_at`; determinism test guards. ✅
- D6 trigger Step 5b + opt-out + node-gate + dry-run skip → Task 5. ✅
- D7 touched_files optional, omit-if-absent → Task 3 (omission test) + Task 5 (persist). ✅
- Content sections 1–9 → Tasks 1–3. ✅
- Testing invariants 1–6 → Tasks 1–4 tests (content, self-contained, escaping, determinism, graceful omission, unpriced footnote). ✅
- Error handling (missing/unparseable telemetry, soft-fail in orchestrator) → Task 4 throw test + Task 5 non-zero handling. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅

**Type consistency:** `renderReport(t, extras)` / `renderReportFile(dir)` signatures and `extras.{postChecksMarkdown,artifactFiles}` used identically across Tasks 1, 3, 4. Section helpers named consistently. ✅
