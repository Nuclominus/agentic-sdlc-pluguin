import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { checkSchemas } from "../lib/schema.mjs";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync } from "node:fs";
import YAML from "yaml";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function compile(path) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(resolve(REPO, path), "utf8")));
}

test("all real plugin files pass their schema", () => {
  const results = checkSchemas(REPO);
  const failed = results.filter(r => !r.ok);
  assert.equal(failed.length, 0, JSON.stringify(failed, null, 2));
  assert.ok(results.some(r => r.schema.endsWith("manifest.schema.json")));
  assert.ok(results.some(r => r.schema.endsWith("workflow.schema.json")));
});

test("checkpoint.schema accepts a valid completed unit", () => {
  const v = compile("schemas/checkpoint.schema.json");
  assert.ok(v({ phase: "security", aspect: null, status: "completed", completed_at: "2026-07-03T10:15:00Z" }));
});

test("checkpoint.schema rejects an unknown status", () => {
  const v = compile("schemas/checkpoint.schema.json");
  assert.equal(v({ phase: "security", status: "half", completed_at: "2026-07-03T10:15:00Z" }), false);
});

test("checkpoint.schema accepts transcript cache-pressure fields", () => {
  const v = compile("schemas/checkpoint.schema.json");
  assert.ok(v({
    phase: "development", status: "completed", completed_at: "2026-07-08T10:00:00Z",
    usage_source: "transcript", turns: 39, peak_prefix_tokens: 101000, cache_pressure: true,
  }));
});

test("run.schema accepts a resolved phase list", () => {
  const v = compile("schemas/run.schema.json");
  assert.ok(v({ task_slug: "x", workflow: "default", resolved_phases: [{ name: "qa", kind: "plain", aspects: null }] }));
});

test("workflow.schema accepts a phase with a heal block", () => {
  const v = compile("schemas/workflow.schema.json");
  assert.ok(v({ name: "xx", phases: [{ name: "development", heal: { max_attempts: 2 } }] }));
});

test("workflow.schema rejects max_attempts above the ceiling of 3", () => {
  const v = compile("schemas/workflow.schema.json");
  assert.equal(v({ name: "xx", phases: [{ name: "development", heal: { max_attempts: 4 } }] }), false);
});

test("workflow.schema rejects a heal block with no max_attempts", () => {
  const v = compile("schemas/workflow.schema.json");
  assert.equal(v({ name: "xx", phases: [{ name: "development", heal: {} }] }), false);
});

test("workflow.schema allows heal and loop on the same phase", () => {
  const v = compile("schemas/workflow.schema.json");
  assert.ok(v({
    name: "xx",
    phases: [{ name: "development", heal: { max_attempts: 2 }, loop: { return_to: "qa", max_rounds: 3 } }],
  }));
});

test("workflow.schema accepts a phase with a gate block", () => {
  const v = compile("schemas/workflow.schema.json");
  assert.ok(v({
    name: "xx",
    phases: [{ name: "remediation", gate: { after: ["security"], min_severity: "high" } }],
  }));
});

test("workflow.schema rejects a gate with no after list", () => {
  const v = compile("schemas/workflow.schema.json");
  assert.equal(v({ name: "xx", phases: [{ name: "remediation", gate: { min_severity: "high" } }] }), false);
});

test("workflow.schema rejects an unknown gate severity", () => {
  const v = compile("schemas/workflow.schema.json");
  assert.equal(
    v({ name: "xx", phases: [{ name: "remediation", gate: { after: ["security"], min_severity: "urgent" } }] }),
    false);
});

test("workflow.schema allows gate and heal on the same phase", () => {
  // remediation is both conditional (gate) and code-writing (heal) — the shipped recipes use both.
  const v = compile("schemas/workflow.schema.json");
  assert.ok(v({
    name: "xx",
    phases: [{ name: "remediation", gate: { after: ["security"], min_severity: "high" }, heal: { max_attempts: 2 } }],
  }));
});

test("workflow.schema rejects a gate inside a parallel group — members are bare strings", () => {
  // The gate exists precisely because a parallel member cannot carry control flow: security runs
  // inside parallel:[security, test], so its hand-off has to be a separate phase after the group.
  const v = compile("schemas/workflow.schema.json");
  assert.equal(
    v({ name: "xx", phases: [{ parallel: [{ name: "security", gate: { after: ["x"], min_severity: "high" } }, "test"] }] }),
    false);
});

test("manifest.schema accepts heal_checks", () => {
  const v = compile("schemas/manifest.schema.json");
  assert.ok(v({
    kind: "foundation", stack: "android", priority: 50,
    detect: { any: ["*"] },
    heal_checks: ["sh -c './gradlew compileDebugKotlin'"],
  }));
});

// ---- ADR-0021: role_expertise — the foundation's per-role expertise declaration ---------------

const FOUNDATION = { kind: "foundation", stack: "android", priority: 300, aspects: ["android"], detect: { any: ["*"] } };

test("manifest.schema accepts a role_expertise block keyed by core role, with rules as strings or {path, note}", () => {
  const v = compile("schemas/manifest.schema.json");
  assert.ok(v({
    ...FOUNDATION,
    role_expertise: {
      developer: {
        invariants: "Never block main.",
        rules: ["rules/logging.md", { path: "rules/snippets/non-negotiable.md", note: "forbidden patterns" }],
        skills: [{ skill: "superpowers:test-driven-development", when: "before the first edit" }, { skill: "acme:x", policy: "recommended" }],
      },
      "aar-analyst": { rules: ["rules/workflow.md"] },
    },
  }), JSON.stringify(v.errors));
});

test("manifest.schema rejects a role_expertise key that is not a core role", () => {
  const v = compile("schemas/manifest.schema.json");
  assert.equal(v({ ...FOUNDATION, role_expertise: { "android-developer": { invariants: "x" } } }), false,
    "the legacy roster name is not a role the core dispatches");
});

test("manifest.schema caps invariants at the stable-prefix budget and refuses an empty role entry", () => {
  const v = compile("schemas/manifest.schema.json");
  assert.equal(v({ ...FOUNDATION, role_expertise: { developer: { invariants: "x".repeat(1401) } } }), false, "1400 chars ≈ 300 tokens per role");
  assert.equal(v({ ...FOUNDATION, role_expertise: { developer: {} } }), false, "an entry must declare something");
  assert.equal(v({ ...FOUNDATION, role_expertise: { developer: { skills: [{ policy: "mandatory" }] } } }), false, "a skill row needs a skill id");
});

test("manifest.schema lets a framework declare role_expertise too — the merge is additive", () => {
  const v = compile("schemas/manifest.schema.json");
  assert.ok(v({
    kind: "framework", stack: "room", priority: 150, enriches_aspect: "persistence", dependency: "androidx.room",
    role_expertise: { developer: { invariants: "Room DAOs are suspend or Flow." } },
  }), JSON.stringify(v.errors));
});

test("checkpoint.schema accepts heal result fields", () => {
  const v = compile("schemas/checkpoint.schema.json");
  assert.ok(v({
    phase: "development", status: "completed", completed_at: "2026-07-27T10:00:00Z",
    heal_attempts_used: 1, heal_status: "healed",
  }));
});

test("checkpoint.schema rejects an unknown heal_status", () => {
  const v = compile("schemas/checkpoint.schema.json");
  assert.equal(v({
    phase: "development", status: "completed", completed_at: "2026-07-27T10:00:00Z",
    heal_status: "partially-healed",
  }), false);
});

const recipe = (p) => YAML.parse(readFileSync(resolve(REPO, p), "utf8"));
// Every shipped recipe, as repo-relative paths.
const recipeFiles = () => ["plugins/sdlc/workflows", "plugins/android-foundation/workflows"]
  .flatMap((d) => readdirSync(resolve(REPO, d)).filter((f) => f.endsWith(".yaml")).map((f) => `${d}/${f}`));
const healOf = (r, phase) => {
  const p = r.phases.find((x) => (typeof x === "string" ? x : x.name) === phase);
  return typeof p === "string" ? undefined : p?.heal;
};

test("code-writing phases in the core recipes are heal-guarded at 2 attempts", () => {
  for (const [file, phases] of [
    ["plugins/sdlc/workflows/default.yaml", ["development", "remediation", "qa"]],
    ["plugins/sdlc/workflows/bugfix.yaml", ["development", "remediation", "qa"]],
    ["plugins/sdlc/workflows/hotfix.yaml", ["development", "remediation", "qa"]],
    ["plugins/sdlc/workflows/refactor.yaml", ["development", "remediation", "qa"]],
    ["plugins/sdlc/workflows/debug.yaml", ["development", "qa"]],
    ["plugins/sdlc/workflows/testing.yaml", ["qa"]],
    ["plugins/sdlc/workflows/analysis.yaml", []],
    ["plugins/android-foundation/workflows/android-bugfix.yaml", ["development", "remediation", "qa"]],
    ["plugins/android-foundation/workflows/android-debug.yaml", ["development", "test"]],
  ]) {
    const r = recipe(file);
    for (const ph of phases) {
      assert.deepEqual(healOf(r, ph), { max_attempts: 2 }, `${file} phase ${ph}`);
    }
  }
});

test("security is NOT heal-guarded — a read-only reviewer cannot heal a compile error", () => {
  // heal re-dispatches THIS phase's agent with the captured stderr and expects it to fix the
  // build. security-analyst / android-security have no Edit tool by design, so a heal block on
  // them buys nothing but a second full-price dispatch that can only report the same failure.
  // The code-writing phase that answers their findings is `remediation`, which IS guarded above.
  for (const file of [
    "plugins/sdlc/workflows/default.yaml",
    "plugins/sdlc/workflows/bugfix.yaml",
    "plugins/sdlc/workflows/hotfix.yaml",
    "plugins/sdlc/workflows/refactor.yaml",
    "plugins/sdlc/workflows/analysis.yaml",
  ]) {
    assert.equal(healOf(recipe(file), "security"), undefined, `${file} phase security`);
  }
});

test("every recipe running security routes its findings to a gated remediation phase", () => {
  // A read-only security phase that nothing acts on is a phase that reports Critical
  // vulnerabilities into a file no one opens. analysis.yaml is the deliberate exception: it is a
  // read-only BA+security assessment that ships no code to remediate.
  const phaseNames = (r) => r.phases.flatMap((p) =>
    typeof p === "string" ? [p] : p.parallel ? p.parallel : [p.name]);
  for (const file of recipeFiles()) {
    const r = recipe(file);
    if (!phaseNames(r).includes("security")) continue;
    if (file.endsWith("analysis.yaml")) continue;
    const rem = r.phases.find((p) => typeof p === "object" && p.name === "remediation");
    assert.ok(rem, `${file} runs security but never routes its findings anywhere`);
    assert.deepEqual(rem.gate, { after: ["security"], min_severity: "high" }, `${file} remediation gate`);
  }
});

test("docs-only declares no heal — documentation writes no compilable source", () => {
  const r = recipe("plugins/sdlc/workflows/docs-only.yaml");
  assert.equal(healOf(r, "documentation"), undefined);
});

test("android-feature guards development and qa", () => {
  const r = recipe("plugins/android-foundation/workflows/android-feature.yaml");
  for (const ph of ["development", "qa"]) {
    assert.deepEqual(healOf(r, ph), { max_attempts: 2 }, `android-feature phase ${ph}`);
  }
});

test("android-feature's parallel security is unguarded — parallel groups take strings only", () => {
  const r = recipe("plugins/android-foundation/workflows/android-feature.yaml");
  const group = r.phases.find((p) => p.parallel);
  assert.deepEqual(group.parallel, ["security", "test"]);
  assert.equal(healOf(r, "security"), undefined);
});

test("android-debug leaves debugging unguarded — it's investigation, not implementation", () => {
  const r = recipe("plugins/android-foundation/workflows/android-debug.yaml");
  assert.equal(healOf(r, "debugging"), undefined);
});

test("android heal_checks exclude unit tests", () => {
  const m = YAML.parse(readFileSync(resolve(REPO, "plugins/android-foundation/manifest.yaml"), "utf8"));
  assert.ok(Array.isArray(m.heal_checks) && m.heal_checks.length > 0);
  for (const c of m.heal_checks) {
    assert.doesNotMatch(c, /testDebugUnitTest/,
      "heal scope is compile+lint only — unit tests stay with the qa agent's own cap");
  }
});

test("android heal_checks are trimmed to compile-only — lint stays in post_pipeline_checks", () => {
  const m = YAML.parse(readFileSync(resolve(REPO, "plugins/android-foundation/manifest.yaml"), "utf8"));
  // G1 perf fix: heal_checks fires after EVERY guarded-phase dispatch (not just on failure), so
  // a lint entry here doubled the Gradle-invocation tax for no heal-relevant benefit — lint is
  // style debt, not a mechanical build break, and is still fully covered (unconditionally) by
  // post_pipeline_checks below. Exactly one entry, and it must be able to fail (no `|| true`).
  assert.equal(m.heal_checks.length, 1, "heal_checks should carry exactly the compile check");
  assert.match(m.heal_checks[0], /compileDebugKotlin/);
  assert.doesNotMatch(m.heal_checks[0], /\|\|\s*true\b/, "the heal compile check must be able to fail");
  for (const c of m.heal_checks) {
    assert.doesNotMatch(c, /detekt|ktlintCheck/,
      "lint is no longer part of the heal loop — it still runs unconditionally in post_pipeline_checks");
  }
  // The claim the perf fix relies on: lint coverage is not lost overall, only ungated mid-pipeline.
  assert.ok(m.post_pipeline_checks.some((c) => /detekt/.test(c) && /ktlintCheck/.test(c)),
    "post_pipeline_checks must still run the full detekt/ktlintCheck sweep at the end of every run");
});

// Cost caps are sized against MEASURED transcript cost (p90 of 56 transcript-priced phases across
// 10 real runs). Caps derived from the older SKILL.md 1d-1 estimate — which modelled a dispatch as
// a single API call and so under-reported a multi-turn phase by 6-10x — sat below their own
// recipe's MEDIAN run and were breached the moment the cost gate started working. That estimate is
// now recalibrated (config/models.json `estimation_baselines`), but caps still come from measured
// p90: an estimate predicts a typical run, a cap must clear the tail.
// A cap below the median run is not a budget — it is a tripwire that fires every time.
const P90 = {                    // measured per-phase p90, USD
  development: 5.41, business_analysis: 2.97, review: 0.95, qa: 1.48,
  test: 2.21, security: 0.40, documentation: 0.21,
};
const HEADROOM = 1.2;            // heal + variance allowance; heal cost itself is still unmeasured

test("analysis.yaml cap clears measured p90 phase spend (not just the heuristic baseline)", () => {
  const r = recipe("plugins/sdlc/workflows/analysis.yaml");
  const measuredP90 = P90.business_analysis + P90.security;          // $3.37
  assert.ok(r.caps.max_total_cost_usd >= measuredP90 * HEADROOM,
    `cap ${r.caps.max_total_cost_usd} must clear measured p90 ${measuredP90} + headroom`);
  // Regression: the observed run that exposed the dead gate spent exactly this and reported "within".
  assert.ok(r.caps.max_total_cost_usd > 3.37, "cap must not sit below the run that proved the gate dead");
  // The old heuristic worst-case must still fit, or the recipe got cheaper without anyone noticing.
  assert.ok(r.caps.max_total_cost_usd > 2 * 0.1555 + 2 * 0.1555);
  assert.equal(r.caps.max_total_cost_usd, 4.25);
});

test("hotfix.yaml cap clears measured p90 phase spend (not just the heuristic baseline)", () => {
  const r = recipe("plugins/sdlc/workflows/hotfix.yaml");
  const measuredP90 = P90.development + P90.qa + P90.security + P90.documentation;   // $7.50
  assert.ok(r.caps.max_total_cost_usd >= measuredP90 * HEADROOM,
    `cap ${r.caps.max_total_cost_usd} must clear measured p90 ${measuredP90} + headroom`);
  assert.ok(r.caps.max_total_cost_usd > P90.development,
    "a cap below one phase's p90 can only ever fire mid-run");
  const heuristicWorst = 0.05076 * 1.6 + 0.05076 + 0.1555 + 0.01578 + 2 * (0.05076 * 1.6 + 0.05076 + 0.1555);
  assert.ok(r.caps.max_total_cost_usd > heuristicWorst);
  // `remediation` is gated, so it enters base_total at half a development dispatch
  // (0.5 x $5.41 = $2.71). $7.50 + $2.71 = $10.21, x 1.2 headroom = $12.25 -> $12.50.
  assert.ok(r.caps.max_total_cost_usd >= (measuredP90 + 0.5 * P90.development) * HEADROOM,
    "cap must survive the gate opening — a remediation dispatch is full development cost");
  assert.equal(r.caps.max_total_cost_usd, 12.50);
});

test("every shipped workflow recipe declares a cost cap", () => {
  // An absent cap is not "unlimited by choice" — it makes CONTEXT.cost_cap null, which skips the
  // Step 3d-cap gate entirely. Until this was fixed, 8 of 11 shipped recipes were ungated,
  // including `default` (what runs when nothing else matches) and every android-* recipe, which
  // measured $3.02-$9.67 of phase spend per run. Project-local recipes under
  // .claude/sdlc-workflows/ may still opt out; shipped ones may not.
  const files = recipeFiles();
  assert.ok(files.length >= 11, `expected the full recipe set, found ${files.length}`);
  const uncapped = files.filter((f) => typeof recipe(f).caps?.max_total_cost_usd !== "number");
  assert.deepEqual(uncapped, [], "these shipped recipes would run ungated");
});

test("every shipped cap clears the most expensive single phase it can dispatch", () => {
  // The sharpest failure mode of an undersized cap: if one phase costs more than the whole cap,
  // the gate fires on the first boundary of every single run. That is what analysis ($0.75 vs a
  // $2.97 business_analysis) and docs-only ($0.10 vs a $0.21 documentation) both did.
  const phasesOf = (r) => r.phases.flatMap((p) =>
    typeof p === "string" ? [p] : p.parallel ? p.parallel : [p.name]);
  for (const f of recipeFiles()) {
    const r = recipe(f);
    const worst = Math.max(...phasesOf(r).map((p) => P90[p] ?? 0));
    assert.ok(r.caps.max_total_cost_usd > worst,
      `${f}: cap ${r.caps.max_total_cost_usd} <= p90 ${worst} of its most expensive phase`);
  }
});

test("docs-only.yaml cap clears its single measured phase", () => {
  const r = recipe("plugins/sdlc/workflows/docs-only.yaml");
  // Single-phase recipe: the 3d-cap gate can never fire (it needs a next dispatch), so this cap is
  // only a post-hoc Step 5b(d) signal. A value under the measured phase cost would flag every run
  // as a breach nobody could have acted on.
  assert.equal(r.phases.length, 1, "if this grows a second phase, the gate becomes live — re-derive");
  assert.ok(r.caps.max_total_cost_usd > P90.documentation,
    "cap must clear the measured documentation phase, else every run reports a false breach");
  assert.equal(r.caps.max_total_cost_usd, 0.35);
});

// ── project-local cost-cap override: keep spec and config in sync ─────────────

const ORCHESTRATOR = "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md";
const skillText = () => readFileSync(resolve(REPO, ORCHESTRATOR), "utf8");

// RETIRED — parsing and application are no longer two places in prose. profile.mjs parses
// cost_caps (preserving an explicit null, the only way to opt out of a shipped cap) and caps.mjs
// applies it in one place. Both halves are asserted in profile.test.mjs and caps.test.mjs.

test("the cost cap is resolved in the command, never in prose", () => {
  // This used to bound CONTEXT.cost_cap assignments to Step 1d-0's section. That section is gone,
  // so both `indexOf` calls returned -1, the slice was empty, and the assertion compared 0 to 0 —
  // it passed by construction while guarding nothing. What survives the collapse is the stronger
  // invariant: Step 3d-cap's auditability rests on CONTEXT.cost_cap having exactly one writer, and
  // that writer is now caps.mjs. A prose assignment reappearing would restore the two-places
  // failure the gate depends on not having.
  const writes = skillText().split("\n").filter((l) => /^\s*CONTEXT\.cost_cap\s*=/.test(l));
  assert.equal(writes.length, 0,
    `CONTEXT.cost_cap must be assigned only by tools/resolve/caps.mjs; prose assigns it at: ${writes.join(" | ")}`);
});

// RETIRED — see caps.test.mjs, "an exact recipe name beats '*', and both beat the recipe" and
// "a missing key is NOT an override". Precedence is now executable rather than documented.

