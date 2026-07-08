# E5 — Cache-pressure signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute per-phase cache-pressure facts (`turns`, `peak_prefix_tokens`) at telemetry-enrich time, flag heavy phases (`cache_pressure`), render `reads/turn · peak` + a flag in the HTML report, and surface flagged phases to the AAR.

**Architecture:** Single source of truth is the enrich step in `tools/usage/usage.mjs`: it already reads each phase's subagent transcript, so it computes the facts once and writes them onto `_telemetry.json` phases. The two consumers — `tools/report/report.mjs` and `tools/aar/metrics.mjs` — only render/pass-through the stored fields; no threshold logic is duplicated in them. `reads/turn` is derived at render time (`cached ÷ turns`), never stored.

**Tech Stack:** Dependency-free ES modules (node builtins only), `node --test`. Shipped code under `plugins/sdlc/tools/{usage,report,aar}/`; each is re-exported by a shim in `tools/sdlc-lint/lib/` so the test suite exercises the shipped source. Schemas validated with ajv 2020.

## Global Constraints

- Node builtins only — **no** new npm dependencies in any `plugins/sdlc/tools/**` file.
- Deterministic: no `Date.now()` / `new Date()` / `Math.random()` in shipped tools.
- Threshold is one constant: `CACHE_PRESSURE_PEAK_TOKENS = 80_000`, defined once in `plugins/sdlc/tools/usage/usage.mjs`. Consumers read the stored boolean, not the constant.
- `peak_prefix_tokens` combines across a phase's transcripts as **max**; `turns` combines as **sum**.
- Telemetry stays factual: store `turns`, `peak_prefix_tokens`, `cache_pressure`; do **not** store `reads/turn`.
- Version bump target: `sdlc` `1.7.1` → `1.8.0` (feature). No ADR.
- Every shipped-file edit is mirrored by an existing re-export shim; update a shim only when adding a **new export**.
- Run the full suite with `node --test tools/sdlc-lint/test/*.test.mjs` (the trailing-slash dir form does not auto-discover on Node 22).

---

### Task 1: Register cache-pressure fields in the checkpoint schema

**Files:**
- Modify: `schemas/checkpoint.schema.json` (add 3 properties after `billed_tokens`, line ~19)
- Test: `tools/sdlc-lint/test/schema.test.mjs`

**Interfaces:**
- Produces: telemetry phase / checkpoint objects may now carry `turns` (int ≥0), `peak_prefix_tokens` (int ≥0), `cache_pressure` (bool). Required by Task 2, which writes them (the schema has `additionalProperties: false`, so it must accept them first).

- [ ] **Step 1: Write the failing test**

Add to `tools/sdlc-lint/test/schema.test.mjs`:

```js
test("checkpoint.schema accepts transcript cache-pressure fields", () => {
  const v = compile("schemas/checkpoint.schema.json");
  assert.ok(v({
    phase: "development", status: "completed", completed_at: "2026-07-08T10:00:00Z",
    usage_source: "transcript", turns: 39, peak_prefix_tokens: 101000, cache_pressure: true,
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/sdlc-lint/test/schema.test.mjs`
Expected: FAIL — the new test errors because `additionalProperties: false` rejects `turns`/`peak_prefix_tokens`/`cache_pressure`.

- [ ] **Step 3: Add the properties to the schema**

In `schemas/checkpoint.schema.json`, immediately after the `billed_tokens` property (line ~19), insert:

```json
    "turns": { "type": "integer", "minimum": 0, "description": "Distinct API responses (deduped on message.id) in the phase's subagent transcript(s), summed across passes (usage_source \"transcript\")." },
    "peak_prefix_tokens": { "type": "integer", "minimum": 0, "description": "Largest single-turn cache-read (worst-case re-read prefix) across the phase's transcript(s), max across passes." },
    "cache_pressure": { "type": "boolean", "description": "peak_prefix_tokens exceeded the cache-pressure threshold (default 80k) at enrich time." },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/schema.test.mjs`
Expected: PASS (all schema tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add schemas/checkpoint.schema.json tools/sdlc-lint/test/schema.test.mjs
git commit -m "feat(sdlc): register cache-pressure checkpoint fields (E5)"
```

---

### Task 2: Compute turns + peak_prefix_tokens + cache_pressure at enrich time

**Files:**
- Modify: `plugins/sdlc/tools/usage/usage.mjs` (constant; `zeroUsage`; `extractUsage`; `priceTranscripts`; `priceMainLoop`; `enrichTelemetry`)
- Modify: `tools/sdlc-lint/lib/usage.mjs` (add `CACHE_PRESSURE_PEAK_TOKENS` to the re-export list)
- Test: `tools/sdlc-lint/test/usage.test.mjs`

**Interfaces:**
- Consumes: existing `extractUsage`, `priceTranscripts`, `enrichTelemetry` (see current signatures).
- Produces:
  - `CACHE_PRESSURE_PEAK_TOKENS` — exported number (`80_000`).
  - `extractUsage(path)` usage records gain `peak_prefix_tokens` (max cache-read across turns; `combined` uses max).
  - `priceTranscripts(paths, reg)` return gains `peak_prefix_tokens` (max across transcripts) and keeps `turns` (sum).
  - `enrichTelemetry` writes `p.turns`, `p.peak_prefix_tokens`, `p.cache_pressure` onto each transcript-enriched phase.

- [ ] **Step 1: Write the failing tests**

Add to `tools/sdlc-lint/test/usage.test.mjs` (helpers `turn`, `writeAgent`, `reg` already exist):

```js
test("extractUsage records peak_prefix_tokens as the max single-turn cache-read", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const p = writeAgent(dir, "peak00000000", [
    turn("claude-sonnet-5", { input_tokens: 5, output_tokens: 8, cache_read_input_tokens: 20000 }),
    turn("claude-sonnet-5", { input_tokens: 5, output_tokens: 8, cache_read_input_tokens: 90000 }),
    turn("claude-sonnet-5", { input_tokens: 5, output_tokens: 8, cache_read_input_tokens: 45000 }),
  ]);
  const u = extractUsage(p).byModel["claude-sonnet-5"];
  assert.equal(u.peak_prefix_tokens, 90000);
  assert.equal(u.turns, 3);
});

test("priceTranscripts takes peak as max across transcripts and turns as the sum", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const a = writeAgent(dir, "planaaaa0000", [turn("claude-sonnet-5", { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 30000 })]);
  const b = writeAgent(dir, "implbbbb0000", [
    turn("claude-sonnet-5", { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 101000 }),
    turn("claude-sonnet-5", { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 60000 }),
  ]);
  const r = priceTranscripts([a, b], reg);
  assert.equal(r.peak_prefix_tokens, 101000);
  assert.equal(r.turns, 3);
});

test("enrichTelemetry sets turns, peak_prefix_tokens and cache_pressure per phase", () => {
  const { runDir, sess } = buildRun();
  enrichTelemetry(runDir, { sessionTranscript: sess, registry: reg });
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  const dev = tel.phases.find((p) => p.phase === "development");   // agent bbbb33334444, cache_read 1_000_000
  assert.equal(dev.turns, 1);
  assert.equal(dev.peak_prefix_tokens, 1000000);
  assert.equal(dev.cache_pressure, true);
  const ba = tel.phases.find((p) => p.phase === "business_analysis"); // cache_read 200_000 < 80k? no, 200k > 80k
  assert.equal(ba.cache_pressure, true);
});
```

Also add `priceTranscripts` and `CACHE_PRESSURE_PEAK_TOKENS` are already imported? The test imports `extractUsage, priceUsage, priceTranscripts, ...` at the top (line 7-10) — `priceTranscripts` is already imported. No import change needed for these tests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/usage.test.mjs`
Expected: FAIL — `u.peak_prefix_tokens` is `undefined`; `r.peak_prefix_tokens` is `undefined`; `dev.cache_pressure` is `undefined`.

- [ ] **Step 3: Add the threshold constant**

In `plugins/sdlc/tools/usage/usage.mjs`, just above `export function extractUsage` (line ~60), add:

```js
// Cache-pressure threshold: a phase is flagged when its worst-case single-turn
// cache-read (peak_prefix_tokens) exceeds this. One documented constant, tuned
// here; consumers (report, metrics) read the stored `cache_pressure` boolean.
export const CACHE_PRESSURE_PEAK_TOKENS = 80_000;
```

- [ ] **Step 4: Track peak in the usage accumulator**

In `zeroUsage()` (line ~112) add `peak_prefix_tokens: 0`:

```js
function zeroUsage() {
  return {
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
    cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, peak_prefix_tokens: 0, turns: 0,
  };
}
```

In `extractUsage`'s `add` (after `t.cache_read_tokens += num(u.cache_read_input_tokens);`, line ~68) add:

```js
    t.peak_prefix_tokens = Math.max(t.peak_prefix_tokens, num(u.cache_read_input_tokens));
```

In `extractUsage`'s combine loop (line ~107), replace the summing loop with a max-aware one:

```js
  const combined = zeroUsage();
  for (const t of Object.values(byModel)) for (const k of Object.keys(combined)) {
    combined[k] = k === "peak_prefix_tokens" ? Math.max(combined[k], t[k]) : combined[k] + t[k];
  }
```

- [ ] **Step 5: Combine peak as max in the rollups**

In `priceTranscripts` (line ~150), replace the total-merge loop:

```js
      for (const k of Object.keys(total)) total[k] = k === "peak_prefix_tokens" ? Math.max(total[k], u[k]) : total[k] + u[k];
```

and add to its returned object (after the `turns: total.turns,` line ~165):

```js
    peak_prefix_tokens: total.peak_prefix_tokens,
```

In `priceMainLoop` (line ~341), replace its merge loop the same way (keeps the discarded peak correct; it is not returned):

```js
    for (const k of Object.keys(total)) total[k] = k === "peak_prefix_tokens" ? Math.max(total[k], u[k]) : total[k] + u[k];
```

- [ ] **Step 6: Write the fields onto each phase**

In `enrichTelemetry`, after `p.billed_tokens = r.billed_tokens;` (line ~278) add:

```js
    p.turns = r.turns;
    p.peak_prefix_tokens = r.peak_prefix_tokens;
    p.cache_pressure = r.peak_prefix_tokens > CACHE_PRESSURE_PEAK_TOKENS;
```

- [ ] **Step 7: Export the constant from the mirror shim**

In `tools/sdlc-lint/lib/usage.mjs`, add `CACHE_PRESSURE_PEAK_TOKENS` to the re-export list:

```js
export {
  loadRegistry, extractUsage, priceUsage, priceTranscripts,
  findAgentTranscript, sessionSubagentsDir, deriveDispatchMap, enrichTelemetry,
  CACHE_PRESSURE_PEAK_TOKENS,
} from "../../../plugins/sdlc/tools/usage/usage.mjs";
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/usage.test.mjs`
Expected: PASS (all usage tests, including the 3 new ones).

- [ ] **Step 9: Commit**

```bash
git add plugins/sdlc/tools/usage/usage.mjs tools/sdlc-lint/lib/usage.mjs tools/sdlc-lint/test/usage.test.mjs
git commit -m "feat(sdlc): compute per-phase turns + peak-prefix + cache_pressure (E5)"
```

---

### Task 3: Render reads/turn + peak-prefix + flag in the HTML report

**Files:**
- Modify: `plugins/sdlc/tools/report/report.mjs` (`cacheLine` helper; `tokenCell`; `signalsSection`)
- Test: `tools/sdlc-lint/test/report.test.mjs`

**Interfaces:**
- Consumes: telemetry phases with `turns`, `peak_prefix_tokens`, `cache_pressure`, `cached_input_tokens` (from Task 2). Uses existing `hasSplit`, `fmtTok`, `esc`.
- Produces: no new exports; `renderReport(tel)` output now includes the cache subline and Signals flag.

- [ ] **Step 1: Write the failing test**

Add to `tools/sdlc-lint/test/report.test.mjs` (it already imports `renderReport` and builds inline where needed):

```js
test("cache-pressure signal: timeline subline + Signals flag for a flagged phase", () => {
  const t = {
    task_slug: "cache-demo", stack: "android", started_at: "2026-07-08T10:00:00Z",
    completed_at: "2026-07-08T10:30:00Z", wall_clock_seconds: 1800,
    phases: [{
      phase: "development", agent: "android-developer", model: "claude-sonnet-5", status: "completed",
      usage_source: "transcript", input_tokens: 186, output_tokens: 27124,
      cached_input_tokens: 2780000, cache_creation_tokens: 494153, billed_tokens: 3301463,
      turns: 39, peak_prefix_tokens: 101000, cache_pressure: true, cost_usd: 0.98,
    }],
  };
  const html = renderReport(t);
  assert.match(html, /cache 71k\/turn · peak 101k ⚠/);        // subline in the token cell (2.78M/39 ≈ 71k)
  assert.match(html, /High cache-pressure:.*development.*peak 101k/); // Signals flag
});

test("cache-pressure signal absent when a phase is under threshold", () => {
  const t = {
    task_slug: "calm", stack: "android", phases: [{
      phase: "qa", agent: "android-qa", model: "claude-sonnet-5", status: "completed",
      usage_source: "transcript", input_tokens: 40, output_tokens: 3361,
      cached_input_tokens: 490000, cache_creation_tokens: 143805, billed_tokens: 637206,
      turns: 10, peak_prefix_tokens: 59000, cache_pressure: false, cost_usd: 0.24,
    }],
  };
  const html = renderReport(t);
  assert.match(html, /cache 49k\/turn · peak 59k/);   // subline present (490k/10 = 49k)
  assert.doesNotMatch(html, /⚠/);                      // no warning glyph
  assert.doesNotMatch(html, /High cache-pressure/);    // no Signals flag
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/sdlc-lint/test/report.test.mjs`
Expected: FAIL — the `cache …/turn · peak …` subline and `High cache-pressure` flag are not rendered.

- [ ] **Step 3: Add the `cacheLine` helper**

In `plugins/sdlc/tools/report/report.mjs`, immediately after `billedTokens` (line ~35), add:

```js
// Cache-pressure subline: average cache-read prefix per turn + the worst-case
// single-turn prefix, with a ⚠ when the phase tripped `cache_pressure` (set at
// enrich time). Only for transcript-split phases that recorded turns.
const cacheLine = (p) => {
  if (!hasSplit(p) || !p.turns) return "";
  const perTurn = Math.round((p.cached_input_tokens || 0) / p.turns);
  const warn = p.cache_pressure ? " ⚠" : "";
  return `<div class="ts">cache ${fmtTok(perTurn)}/turn · peak ${fmtTok(p.peak_prefix_tokens)}${warn}</div>`;
};
```

- [ ] **Step 4: Append the subline in `tokenCell`**

In `tokenCell` (line ~117), append `${cacheLine(p)}` to the returned split cell:

```js
  return `<td class="num">${fmtInt(billed)}<div class="ts">${split}</div>${cacheLine(p)}</td>`;
```

- [ ] **Step 5: Add flagged phases to `signalsSection`**

In `signalsSection` (line ~192), after the `aborted_at_phase` push and before `if (!items.length)` (line ~203), add:

```js
  for (const p of t.phases || []) {
    if (p.cache_pressure) items.push(`High cache-pressure: <b>${esc(p.phase)}</b> (peak ${fmtTok(p.peak_prefix_tokens)} &gt; 80k)`);
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/report.test.mjs`
Expected: PASS (all report tests, including the 2 new ones).

- [ ] **Step 7: Commit**

```bash
git add plugins/sdlc/tools/report/report.mjs tools/sdlc-lint/test/report.test.mjs
git commit -m "feat(sdlc): show cache reads/turn + peak-prefix + flag in report (E5)"
```

---

### Task 4: Add cache-pressure to AAR metrics + analyst prose

**Files:**
- Modify: `plugins/sdlc/tools/aar/metrics.mjs` (`by_phase` fields; `cache_pressure_phases`; return object)
- Modify: `plugins/sdlc/agents/aar-analyst.md` and `plugins/sdlc/skills/aar/gather.md` (document the signal — prose)
- Test: `tools/sdlc-lint/test/aar-metrics.test.mjs`

**Interfaces:**
- Consumes: telemetry phases with `turns`, `peak_prefix_tokens`, `cache_pressure`, `cached_input_tokens`.
- Produces: `computeMetrics(tel)` `by_phase[]` entries gain `turns`, `peak_prefix_tokens`, `reads_per_turn`, `cache_pressure`; the dashboard gains a top-level `cache_pressure_phases[]` (`{ phase, peak_prefix_tokens, reads_per_turn }`, peak desc).

- [ ] **Step 1: Write the failing test**

Add to `tools/sdlc-lint/test/aar-metrics.test.mjs`:

```js
test("by_phase carries cache-pressure fields and cache_pressure_phases lists flagged phases", () => {
  const t = { task_slug: "cache-demo", phases: [
    { phase: "development", agent: "android-developer", model: "claude-sonnet-5", status: "completed",
      usage_source: "transcript", cached_input_tokens: 2780000, billed_tokens: 3301463,
      turns: 39, peak_prefix_tokens: 101000, cache_pressure: true, cost_usd: 0.98 },
    { phase: "qa", agent: "android-qa", model: "claude-sonnet-5", status: "completed",
      usage_source: "transcript", cached_input_tokens: 490000, billed_tokens: 637206,
      turns: 10, peak_prefix_tokens: 59000, cache_pressure: false, cost_usd: 0.24 },
  ] };
  const d = computeMetrics(t);
  const dev = d.by_phase.find((p) => p.phase === "development");
  assert.equal(dev.turns, 39);
  assert.equal(dev.peak_prefix_tokens, 101000);
  assert.equal(dev.reads_per_turn, Math.round(2780000 / 39)); // 71282
  assert.equal(dev.cache_pressure, true);
  assert.equal(d.cache_pressure_phases.length, 1);
  assert.equal(d.cache_pressure_phases[0].phase, "development");
  assert.equal(d.cache_pressure_phases[0].peak_prefix_tokens, 101000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/sdlc-lint/test/aar-metrics.test.mjs`
Expected: FAIL — `dev.reads_per_turn` / `dev.peak_prefix_tokens` are `undefined`; `d.cache_pressure_phases` is `undefined`.

- [ ] **Step 3: Add the fields to `by_phase`**

In `plugins/sdlc/tools/aar/metrics.mjs`, inside the `by_phase` mapped object (after `billed_tokens: billed,`, line ~37), add:

```js
      turns: num(p.turns),
      peak_prefix_tokens: num(p.peak_prefix_tokens),
      reads_per_turn: num(p.turns) > 0 ? Math.round(num(p.cached_input_tokens) / num(p.turns)) : 0,
      cache_pressure: p.cache_pressure === true,
```

- [ ] **Step 4: Build `cache_pressure_phases` and return it**

After the `top_consumers` block (line ~64), add:

```js
  // Phases whose worst-case prefix tripped the cache-pressure flag (set at enrich
  // time). Ordered by peak desc for stable, most-severe-first reporting.
  const cache_pressure_phases = by_phase
    .filter((p) => p.cache_pressure)
    .map((p) => ({ phase: p.phase, peak_prefix_tokens: p.peak_prefix_tokens, reads_per_turn: p.reads_per_turn }))
    .sort((a, b) => b.peak_prefix_tokens - a.peak_prefix_tokens || (a.phase < b.phase ? -1 : a.phase > b.phase ? 1 : 0));
```

In the returned object (after `top_consumers,`, line ~91), add:

```js
    cache_pressure_phases,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tools/sdlc-lint/test/aar-metrics.test.mjs`
Expected: PASS (all metrics tests, including the new one).

- [ ] **Step 6: Document the signal for the analyst (prose)**

In `plugins/sdlc/skills/aar/gather.md`, under the "From the metrics dashboard" list (after the `by_phase` bullet), add:

```markdown
- `cache_pressure_phases` — phases whose worst-case per-turn prompt-cache read
  (`peak_prefix_tokens`) tripped the cache-pressure threshold (~80k), each with
  `reads_per_turn`. These are the top targets for cache-read reduction.
```

In `plugins/sdlc/agents/aar-analyst.md`, in the "Cost/token accounting" area (the `metrics_json` bullet, line ~33), append a sentence:

```markdown
When `cache_pressure_phases` is non-empty, call out each flagged phase (peak prefix + reads/turn) and recommend a cache-read remedy — surgical reads (`offset/limit`, grep-first, no re-reads) and/or a smaller injected prefix — rather than a raw token cut.
```

- [ ] **Step 7: Commit**

```bash
git add plugins/sdlc/tools/aar/metrics.mjs plugins/sdlc/agents/aar-analyst.md plugins/sdlc/skills/aar/gather.md tools/sdlc-lint/test/aar-metrics.test.mjs
git commit -m "feat(sdlc): surface cache_pressure_phases in AAR metrics + analyst (E5)"
```

---

### Task 5: Release 1.8.0 + vault updates

**Files:**
- Modify: `plugins/sdlc/.claude-plugin/plugin.json` (`version` 1.7.1 → 1.8.0)
- Modify: `.claude-plugin/marketplace.json` (`version` 1.7.1 → 1.8.0)
- Modify: `CHANGELOG.md` (new `[1.8.0]` section)
- Modify: `.brain/planning/roadmap.md` (E5 → done)
- Modify: `.brain/releases/_moc-releases.md` (v1.8.0 entry)

**Interfaces:**
- Consumes: nothing from prior tasks at runtime — this is release bookkeeping. Depends on Tasks 1–4 being committed.

- [ ] **Step 1: Bump the plugin + marketplace version**

`plugins/sdlc/.claude-plugin/plugin.json`: change `"version": "1.7.1"` → `"version": "1.8.0"`.
`.claude-plugin/marketplace.json`: change the top-level `"version": "1.7.1"` → `"version": "1.8.0"`.

- [ ] **Step 2: Add the CHANGELOG section**

In `CHANGELOG.md`, immediately after `## [Unreleased]`, insert (replace `#NN` with the PR number when opened):

```markdown
## [1.8.0] — 2026-07-08

`sdlc` → `1.8.0` (other plugins unchanged). Track E enabler: a per-phase
cache-pressure signal built on the transcript-derived usage (1.7.0/1.7.1).

### Added

- **Cache-pressure signal (E5, #NN).** `tools/usage` now records per phase `turns`,
  `peak_prefix_tokens` (largest single-turn cache-read), and a `cache_pressure` flag
  (peak > 80k). The HTML report shows `reads/turn · peak` under each phase and flags
  heavy phases in Signals; `tools/aar/metrics` adds those fields to `by_phase` plus a
  `cache_pressure_phases` list the AAR analyst uses to target cache-read reduction.
  `schemas/checkpoint.schema.json` registers the new fields.
```

- [ ] **Step 3: Mark E5 done on the roadmap**

In `.brain/planning/roadmap.md`, change the Track E row status/landing and note. Set the table row:

```markdown
| E  | pipeline cache/cost efficiency    | in-progress | #NN |
```

and append to the Track E paragraph:

```markdown
**E5 (cache-pressure signal) shipped in #NN (1.8.0):** per-phase `reads/turn` + `peak_prefix_tokens` in the report and `cache_pressure_phases` in the AAR. Remaining: E2 (surgical reads), E1 (trim floor), E3 (fewer turns), E4 (routing).
```

- [ ] **Step 4: Add the releases MOC entry**

In `.brain/releases/_moc-releases.md`, above the `v1.7.1` line, add:

```markdown
- **v1.8.0** — 2026-07-08 — E5 cache-pressure signal: per-phase reads/turn + peak-prefix in the report, `cache_pressure_phases` in the AAR (`sdlc` 1.8.0).
```

- [ ] **Step 5: Validate vault + run the full suite + verifier**

Run: `node tools/brain-sync/cli.mjs check --vault .brain`
Expected: `check: clean`

Run: `node --test tools/sdlc-lint/test/*.test.mjs`
Expected: PASS — all tests green.

Run: `node tools/sdlc-lint/cli.mjs` (or the repo's plugin verifier entry, if different)
Expected: verifier passes (schemas + structure).

- [ ] **Step 6: Commit**

```bash
git add plugins/sdlc/.claude-plugin/plugin.json .claude-plugin/marketplace.json CHANGELOG.md .brain/planning/roadmap.md .brain/releases/_moc-releases.md
git commit -m "release(sdlc): 1.8.0 — cache-pressure signal (E5)"
```

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feat/e5-cache-pressure-signal
gh pr create --base develop --title "feat(sdlc): cache-pressure signal in report + AAR (1.8.0)" --body "<summary + DoD + test evidence>"
```

Then update the `#NN` placeholders in CHANGELOG / roadmap / releases MOC to the real PR number via a follow-up commit, and push.

---

## Self-Review

**Spec coverage:**
- Metric definitions (turns, peak_prefix, cache_pressure, reads/turn derived) → Task 2 (+ Task 4 for reads_per_turn). ✓
- Threshold constant single-source (usage.mjs, 80k) → Task 2 Step 3; consumers read the boolean → Tasks 3–4. ✓
- Schema fields → Task 1. ✓
- Report timeline subline + Signals flag → Task 3. ✓
- Metrics by_phase fields + cache_pressure_phases + analyst prose → Task 4. ✓
- Tests in usage/report/metrics → Tasks 2/3/4. ✓
- Release 1.8.0 + roadmap/CHANGELOG/releases MOC, no ADR → Task 5. ✓
- Edge cases: aggregate-only (guarded by `hasSplit`), `turns==0` (guards in `cacheLine` and `reads_per_turn`), backward compat (absent fields → no subline/flag) → covered by Task 3/4 guards. ✓

**Placeholder scan:** `#NN` in Task 5 is an intentional, resolved-at-PR-time value with explicit instructions to replace it (Step 7); no other placeholders. Every code step shows the exact code. ✓

**Type consistency:** field names `turns`, `peak_prefix_tokens`, `cache_pressure`, `reads_per_turn`, `cache_pressure_phases` are used identically across Tasks 1–4; `CACHE_PRESSURE_PEAK_TOKENS` defined once (Task 2) and only read there. `peak_prefix_tokens` = max, `turns` = sum in every rollup. ✓
