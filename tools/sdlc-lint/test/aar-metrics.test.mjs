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

test("by_phase carries heal fields, defaulting cleanly when absent", () => {
  const d = computeMetrics({
    task_slug: "t",
    phases: [
      { phase: "development", usage_source: "reported", heal_attempts_used: 1, heal_status: "healed" },
      { phase: "security", usage_source: "reported" },
    ],
  });
  const dev = d.by_phase.find((p) => p.phase === "development");
  assert.equal(dev.heal_attempts_used, 1);
  assert.equal(dev.heal_status, "healed");
  const sec = d.by_phase.find((p) => p.phase === "security");
  assert.equal(sec.heal_attempts_used, 0);
  assert.equal(sec.heal_status, null);
});

test("heal_attempts sums across phases", () => {
  const d = computeMetrics({
    task_slug: "t",
    phases: [
      { phase: "development", usage_source: "reported", heal_attempts_used: 2, heal_status: "exhausted" },
      { phase: "qa", usage_source: "reported", heal_attempts_used: 1, heal_status: "healed" },
    ],
  });
  assert.equal(d.heal_attempts, 3);
});

test("heal_exhausted_phases lists only exhausted phases, phase-name ascending", () => {
  const d = computeMetrics({
    task_slug: "t",
    phases: [
      { phase: "security", usage_source: "reported", heal_attempts_used: 2, heal_status: "exhausted" },
      { phase: "development", usage_source: "reported", heal_attempts_used: 2, heal_status: "exhausted" },
      { phase: "qa", usage_source: "reported", heal_attempts_used: 1, heal_status: "healed" },
    ],
  });
  assert.deepEqual(d.heal_exhausted_phases, [
    { phase: "development", heal_attempts_used: 2 },
    { phase: "security", heal_attempts_used: 2 },
  ]);
});

test("a run with no healing reports zero and an empty exhausted list", () => {
  const d = computeMetrics({ task_slug: "t", phases: [{ phase: "qa", usage_source: "reported" }] });
  assert.equal(d.heal_attempts, 0);
  assert.deepEqual(d.heal_exhausted_phases, []);
});
