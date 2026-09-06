// Step 1d as code. The cap half is small and exact; the estimate half is heuristic and its
// tests pin the RELATIONSHIPS the prose argues for, not the magnitudes, which are registry data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveCostCap, renderCapOverridePrint, priceBaseline, resolveTier, expandRows,
  estimate, capVerdict, renderDryRun, renderHeadlessDryRun,
} from "../../../plugins/sdlc/tools/resolve/caps.mjs";

const REPO = new URL("../../../", import.meta.url).pathname;
const registry = JSON.parse(readFileSync(join(REPO, "plugins", "sdlc", "config", "models.json"), "utf8"));

const AGENTS = {
  business_analysis: "business-analyst",
  development: { android: "developer" },
  review: "reviewer",
  security: "security-analyst",
  test: "tester",
  documentation: "document-writer",
};

test("the cap comes from the recipe when the project says nothing", () => {
  const r = resolveCostCap({ recipe: { caps: { max_total_cost_usd: 4.25 } }, workflowName: "android-feature" });
  assert.equal(r.cost_cap, 4.25);
  assert.equal(r.cost_cap_source, "recipe");
  assert.equal(renderCapOverridePrint(r, {}), null, "no override, no announcement");
});

test("an exact recipe name beats '*', and both beat the recipe", () => {
  const recipe = { caps: { max_total_cost_usd: 4.25 } };
  const exact = resolveCostCap({ recipe, workflowName: "android-feature", costCaps: { "*": 5, "android-feature": 8 } });
  assert.equal(exact.cost_cap, 8);
  assert.equal(exact.cost_cap_source, "project:android-feature");

  const star = resolveCostCap({ recipe, workflowName: "hotfix", costCaps: { "*": 5 } });
  assert.equal(star.cost_cap, 5);
  assert.equal(star.cost_cap_source, "project:*");
});

test("an explicit null is an OWN-KEY hit and uncaps the run", () => {
  // The whole reason parseCostCaps preserves null: a truthiness test here would silently
  // reinstate the shipped cap and a project could then only ever tighten, never loosen.
  const r = resolveCostCap({ recipe: { caps: { max_total_cost_usd: 4.25 } }, workflowName: "hotfix", costCaps: { hotfix: null } });
  assert.equal(r.cost_cap, null);
  assert.equal(r.cost_cap_source, "project:hotfix");
  assert.match(renderCapOverridePrint(r, { caps: { max_total_cost_usd: 4.25 } }), /none \(uncapped\) \(was 4\.25\)/);
});

test("a missing key is NOT an override", () => {
  const r = resolveCostCap({ recipe: { caps: { max_total_cost_usd: 4.25 } }, workflowName: "hotfix", costCaps: { "android-feature": 8 } });
  assert.equal(r.cost_cap, 4.25);
  assert.equal(r.cost_cap_source, "recipe");
});

test("a recipe with no cap at all resolves to uncapped", () => {
  assert.equal(resolveCostCap({ recipe: { name: "x" }, workflowName: "x" }).cost_cap, null);
});

test("pricing uses the registry's own rates and the cache-write multiplier", () => {
  const opus = priceBaseline(registry, "opus");
  const b = registry.estimation_baselines.opus;
  const p = registry.models.find((m) => m.tag === "opus").pricing;
  const expected = (b.input / 1e6) * p.input + (b.cache_read / 1e6) * p.cached_input
    + (b.cache_write / 1e6) * p.input * registry.cache_write_multipliers.ephemeral_5m
    + (b.output / 1e6) * p.output;
  assert.equal(opus, expected, "the estimate must value tokens exactly as the real cost path does");
  assert.equal(priceBaseline(registry, "nope"), null);
});

test("cache_read dominates the baseline — the shape the old model got wrong", () => {
  const b = registry.estimation_baselines.sonnet;
  assert.ok(b.cache_read > b.input * 1000, "uncached input is negligible against the re-read prefix");
});

test("tier precedence: per-agent override, then project default, then frontmatter, then sonnet", () => {
  const fm = { "business-analyst": "opus" };
  assert.equal(resolveTier("business-analyst", { modelOverrides: { agents: { "business-analyst": "haiku" }, default: "fable" }, frontmatterTiers: fm }), "haiku");
  assert.equal(resolveTier("business-analyst", { modelOverrides: { default: "fable" }, frontmatterTiers: fm }), "fable");
  assert.equal(resolveTier("business-analyst", { frontmatterTiers: fm }), "opus");
  assert.equal(resolveTier("unknown-agent", {}), "sonnet");
  assert.equal(resolveTier("sdlc:business-analyst", { frontmatterTiers: fm }), "opus", "the plugin prefix is an install detail");
});

test("rows: parallel groups and aspect fan-out each become their own dispatch", () => {
  const phases = [{ name: "development" }, { parallel: ["security", "test"] }, { name: "documentation" }];
  const rows = expandRows(phases, { agentsPerPhase: AGENTS });
  assert.deepEqual(rows.map((r) => r.phase), ["development", "security", "test", "documentation"]);
  assert.equal(rows[0].aspect, "android");
  assert.equal(rows[1].parallel, true, "parallelism saves wall-clock, not tokens");
});

test("development carries its measured multiplier; a gated phase is weighted half", () => {
  const base = priceBaseline(registry, "sonnet");
  const rows = expandRows([{ name: "development" }, { name: "remediation", gate: { after: ["security"], min_severity: "high" } }],
    { agentsPerPhase: { development: { android: "dev" }, remediation: "dev" } });
  const est = estimate(rows, registry);
  assert.ok(Math.abs(est.rows[0].est - base * 5.4) < 1e-9, "development is ×5.4 per aspect, measured over 9 runs");
  assert.ok(Math.abs(est.rows[1].est - base * 0.5) < 1e-9, "a gate costs est(G) or $0 — weight it half");
  assert.ok(est.worst_total > est.expected_total, "the worst case restores the gated half");
});

test("a loop adds an average half-pass and a worst-case (max_rounds − 1) passes", () => {
  const phases = [{ name: "development" }, { name: "review", loop: { return_to: "development", max_rounds: 3 } }];
  const rows = expandRows(phases, { agentsPerPhase: { development: { android: "dev" }, review: "rev" } });
  const est = estimate(rows, registry);
  const pair = est.rows[0].est + est.rows[1].est;
  assert.ok(Math.abs(est.expected_total - (est.base_total + 0.5 * pair)) < 1e-9);
  assert.ok(Math.abs(est.worst_total - (est.base_total + 2 * pair)) < 1e-9);
});

test("heal costs NOTHING when the profile supplies no checks", () => {
  // Healing cannot fire without a check to run, so a heal: block over an empty heal_checks
  // list must add exactly $0 — this is the vanilla-stack case, and a phantom estimate here
  // would inflate every generic recipe on a stack that cannot heal at all.
  const phases = [{ name: "development", heal: { max_attempts: 2 } }];
  const rows = expandRows(phases, { agentsPerPhase: { development: { android: "dev" } } });
  const off = estimate(rows, registry, { healEnabled: false });
  const on = estimate(rows, registry, { healEnabled: true });
  assert.equal(off.expected_total, off.base_total, "no checks, no heal term");
  assert.ok(on.expected_total > on.base_total);
  assert.ok(on.worst_total > off.worst_total);
});

test("est(H) is the SINGLE-dispatch baseline, never the development multiplier", () => {
  const base = priceBaseline(registry, "sonnet");
  const rows = expandRows([{ name: "development", heal: { max_attempts: 2 } }], { agentsPerPhase: { development: { android: "dev" } } });
  const est = estimate(rows, registry, { healEnabled: true });
  const healTerm = est.expected_total - est.base_total;
  assert.ok(Math.abs(healTerm - 1 * 0.3 * base) < 1e-9,
    "a heal attempt is one implement-only dispatch — not the ×5.4 two-pass figure");
});

test("resumed rows contribute $0 and are excluded from the totals", () => {
  const phases = [{ name: "development" }, { name: "documentation" }];
  const rows = expandRows(phases, { agentsPerPhase: AGENTS, resumedDone: new Set(["development:android"]) });
  const est = estimate(rows, registry);
  assert.equal(est.rows[0].est, 0);
  assert.ok(est.base_total > 0, "the remaining phase is still counted");
  assert.equal(est.base_total, est.rows[1].est, "the estimate is the cost to FINISH, not to redo");
});

test("the cap verdict is computed from expected_total, and no cap is always WITHIN", () => {
  assert.equal(capVerdict(10, null).cap_estimate, "within");
  assert.equal(capVerdict(4, 8).cap_estimate, "within");
  const over = capVerdict(9.5, 8);
  assert.equal(over.cap_estimate, "exceeds");
  assert.match(over.verdict, /EXCEEDS by \$1\.50/);
});

test("the dry-run block prints flags concatenated and names an inactive heal honestly", () => {
  const phases = [{ name: "development" }, { name: "review", loop: { return_to: "development", max_rounds: 3 }, heal: { max_attempts: 2 } }];
  const rows = expandRows(phases, { agentsPerPhase: { development: { android: "dev" }, review: "rev" } });
  const est = estimate(rows, registry, { healEnabled: false });
  const out = renderDryRun({ estimate: est, slots: 2, stack: "android", workflow: "android-feature", autoselected: true, cap: 8, healEnabled: false, healBlocks: 1 });

  assert.match(out, /^🔎 DRY RUN — no agents dispatched, no code written\./);
  assert.match(out, /Workflow: android-feature \(auto-selected\)/);
  assert.match(out, /loops ⇄ development, ≤3×/);
  assert.ok(!/🔧 heals/.test(out), "the heal flag is suppressed when healing cannot fire");
  assert.match(out, /⚙ Healing inactive on this stack — 1 guarded phase\(s\)/);
  assert.match(out, /Skip-rules applied: none/);
  assert.match(out, /Cap: \$8\.00/);
});

test("the headless line uses cap_estimate, not cap_status", () => {
  const rows = expandRows([{ name: "documentation" }], { agentsPerPhase: AGENTS });
  const est = estimate(rows, registry);
  const line = JSON.parse(renderHeadlessDryRun({ estimate: est, slots: 1, workflow: "docs-only", cap: 0.01 }));
  assert.equal(line.dry_run, true);
  assert.equal(line.cap_estimate, "exceeds");
  assert.ok(!("cap_status" in line), "cap_status is the real-run enforcement outcome and must not be conflated");
  assert.ok(!("resumed" in line), "resume fields appear only under --resume");
});

test("an aspect-aware phase inside a parallel group still fans out", () => {
  const rows = expandRows([{ parallel: ["security", "qa"] }], {
    agentsPerPhase: { security: "sec", qa: { android: "qa-android" } },
  });
  assert.deepEqual(rows.map((r) => r.agent), ["sec", "qa-android"], "never the mapping object itself");
  assert.equal(rows[1].aspect, "android");
  assert.ok(rows.every((r) => r.parallel));
});

test("a looped AND healed phase: expected uses avg rounds, worst uses max_rounds (Track G1 F3)", () => {
  // This invariant used to be guarded by a prose assertion over SKILL.md Step 1d-1. When the
  // prose moved into code the guard had nothing to anchor on, and the invariant was briefly
  // untested — using rounds(H)=max_rounds in expected_total would apply a worst-case round count
  // to the heal term while the loop term beside it stays average-case, making the WITHIN/EXCEEDS
  // verdict inconsistent with itself.
  const base = priceBaseline(registry, "sonnet");
  const phases = [
    { name: "development", heal: { max_attempts: 2 } },
    { name: "review", loop: { return_to: "development", max_rounds: 3 } },
  ];
  const rows = expandRows(phases, { agentsPerPhase: { development: { android: "dev" }, review: "rev" } });
  const est = estimate(rows, registry, { healEnabled: true });

  const loopPair = est.rows[0].est + est.rows[1].est;
  const expectedHeal = est.expected_total - est.base_total - 0.5 * loopPair;
  const worstHeal = est.worst_total - est.base_total - 2 * loopPair;

  assert.ok(Math.abs(expectedHeal - 1.5 * 0.3 * base) < 1e-9, "expected: avg_rounds(H) = 1.5, the same ~1.5 the loop term assumes");
  assert.ok(Math.abs(worstHeal - 3 * 2 * base) < 1e-9, "worst: max_rounds × max_attempts — every round hitting the cap");
  assert.ok(worstHeal > expectedHeal * 5, "the two must not collapse into one figure");
});
