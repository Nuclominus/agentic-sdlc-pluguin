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
