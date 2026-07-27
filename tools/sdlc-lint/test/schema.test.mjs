import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { checkSchemas } from "../lib/schema.mjs";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
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

test("manifest.schema accepts heal_checks", () => {
  const v = compile("schemas/manifest.schema.json");
  assert.ok(v({
    kind: "foundation", stack: "android", priority: 50,
    detect: { any: ["*"] },
    heal_checks: ["sh -c './gradlew compileDebugKotlin'"],
  }));
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
const healOf = (r, phase) => {
  const p = r.phases.find((x) => (typeof x === "string" ? x : x.name) === phase);
  return typeof p === "string" ? undefined : p?.heal;
};

test("code-writing phases in the core recipes are heal-guarded at 2 attempts", () => {
  for (const [file, phases] of [
    ["plugins/sdlc/workflows/default.yaml", ["development", "security", "qa"]],
    ["plugins/sdlc/workflows/bugfix.yaml", ["development", "security", "qa"]],
    ["plugins/sdlc/workflows/hotfix.yaml", ["development", "security", "qa"]],
    ["plugins/sdlc/workflows/refactor.yaml", ["development", "security", "qa"]],
    ["plugins/sdlc/workflows/debug.yaml", ["development", "qa"]],
    ["plugins/sdlc/workflows/testing.yaml", ["qa"]],
    ["plugins/sdlc/workflows/analysis.yaml", ["security"]],
  ]) {
    const r = recipe(file);
    for (const ph of phases) {
      assert.deepEqual(healOf(r, ph), { max_attempts: 2 }, `${file} phase ${ph}`);
    }
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

test("android heal_checks exclude unit tests", () => {
  const m = YAML.parse(readFileSync(resolve(REPO, "plugins/android-foundation/manifest.yaml"), "utf8"));
  assert.ok(Array.isArray(m.heal_checks) && m.heal_checks.length > 0);
  for (const c of m.heal_checks) {
    assert.doesNotMatch(c, /testDebugUnitTest/,
      "heal scope is compile+lint only — unit tests stay with the qa agent's own cap");
  }
});
