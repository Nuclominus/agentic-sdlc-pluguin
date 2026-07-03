import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { computeRollup, renderRollupText, renderRollupHtml, rollupWorkspace } from "../lib/rollup.mjs";

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

test("rollupWorkspace skips non-object telemetry (null) with a warning, others still aggregate", () => {
  const root = seedWorkspace();
  try {
    const plans = join(root, "docs", "plans");
    mkdirSync(join(plans, "run-null"), { recursive: true });
    writeFileSync(join(plans, "run-null", "_telemetry.json"), "null");
    const { agg, warnings } = rollupWorkspace(root);
    assert.equal(agg.run_count, 3);                 // 3 good runs still aggregate; null skipped
    assert.ok(warnings.some((w) => /run-null/.test(w)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

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
