// Step 1c as code, plus the differential gate that keeps the shipped validator honest.
//
// The plugin ships no dependencies, so schemas/workflow.schema.json cannot be enforced with
// ajv at runtime and the structural rules are reimplemented. That is a second implementation
// of one contract — exactly the thing ADR-0019 exists to remove — so it is allowed only
// because both run over the same inputs in CI and must agree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import {
  discoverRecipes, validateWorkflow, normalizePhases, phaseNames, validateAcyclic,
  evaluateMatch, autoSelect, resolveWorkflowName, locateRecipe, buildResolvedPhases,
} from "../../../plugins/sdlc/tools/resolve/workflow.mjs";
import { parseYaml } from "../../../plugins/sdlc/tools/resolve/yaml.mjs";
import { iterFiles } from "../../../plugins/sdlc/tools/resolve/fsglob.mjs";

const REPO = new URL("../../../", import.meta.url).pathname;
const schema = JSON.parse(readFileSync(join(REPO, "schemas", "workflow.schema.json"), "utf8"));
const ajvValidate = new Ajv({ allErrors: true, strict: false }).compile(schema);

const SIGNALS = { loc_touched: 20, has_migrations: false, config_only: false };
function scratch() { return mkdtempSync(join(tmpdir(), "sdlc-wf-")); }
function recipeFile(dir, name, doc) {
  mkdirSync(dir, { recursive: true });
  const body = typeof doc === "string" ? doc : `name: ${doc.name}\nphases:\n${(doc.phases || []).map((p) => `  - ${p}`).join("\n")}\n`;
  writeFileSync(join(dir, `${name}.yaml`), body);
}

// ---------------------------------------------------------------- differential gate

const shipped = [...iterFiles(join(REPO, "plugins"), "**/workflows/*.yaml")].filter((f) => !f.includes("/test-fixtures/"));

test("the repository ships recipes for this gate to be about", () => {
  assert.ok(shipped.length >= 5, `expected several shipped recipes, got ${shipped.length}`);
});

for (const file of shipped) {
  test(`validator parity: ${file.replace(REPO, "")}`, () => {
    const doc = parseYaml(readFileSync(file, "utf8"));
    const mine = validateWorkflow(doc);
    const theirs = ajvValidate(doc);
    assert.equal(mine.length === 0, theirs, `shipped validator says ${mine.length === 0 ? "valid" : mine.join("; ")}, ajv says ${theirs}`);
  });
}

const MALFORMED = {
  "missing phases": { name: "x-y" },
  "empty phases": { name: "x-y", phases: [] },
  "bad name casing": { name: "BadName", phases: ["a"] },
  "unknown top-level key": { name: "x-y", phases: ["a"], colour: "red" },
  "unknown phase key": { name: "x-y", phases: [{ name: "a", nope: 1 }] },
  "parallel with one member": { name: "x-y", phases: [{ parallel: ["a"] }] },
  "loop missing max_rounds": { name: "x-y", phases: [{ name: "a", loop: { return_to: "b" } }] },
  "loop max_rounds out of range": { name: "x-y", phases: [{ name: "a", loop: { return_to: "b", max_rounds: 99 } }] },
  "heal max_attempts over ceiling": { name: "x-y", phases: [{ name: "a", heal: { max_attempts: 9 } }] },
  "gate bad severity": { name: "x-y", phases: [{ name: "a", gate: { after: ["b"], min_severity: "urgent" } }] },
  "gate empty after": { name: "x-y", phases: [{ name: "a", gate: { after: [], min_severity: "high" } }] },
  "negative cap": { name: "x-y", phases: ["a"], caps: { max_total_cost_usd: -1 } },
  "unknown match key": { name: "x-y", phases: ["a"], match: { vibes: true } },
  "match wrong type": { name: "x-y", phases: ["a"], match: { loc_touched_max: "many" } },
};

for (const [label, doc] of Object.entries(MALFORMED)) {
  test(`validator parity (malformed): ${label}`, () => {
    assert.ok(validateWorkflow(doc).length > 0, "the shipped validator must reject it");
    assert.equal(ajvValidate(doc), false, "and ajv must agree it is invalid");
  });
}

// ---------------------------------------------------------------- resolution

test("name precedence: --workflow beats everything", () => {
  const r = resolveWorkflowName({ args: "fix thing --workflow=hotfix", activeWorkflow: "android-feature", profileDefault: "p" });
  assert.equal(r.name, "hotfix");
  assert.equal(r.tier, "--workflow");
});

test("name precedence: active_workflow beats auto-selection and the profile default", () => {
  const recipes = [{ name: "debug", doc: { name: "debug", match: { arguments_pattern: "." }, phases: ["a"] } }];
  const r = resolveWorkflowName({ args: "anything", activeWorkflow: "android-feature", recipes, signals: SIGNALS, profileDefault: "p" });
  assert.equal(r.tier, "active_workflow");
});

test("--no-auto-workflow falls straight through to the profile default", () => {
  const recipes = [{ name: "debug", doc: { name: "debug", match: { arguments_pattern: "." }, phases: ["a"] } }];
  const r = resolveWorkflowName({ args: "crash --no-auto-workflow", recipes, signals: SIGNALS, profileDefault: "android-feature" });
  assert.equal(r.name, "android-feature");
  assert.equal(r.tier, "profile_default");
});

test("with nothing at all it falls back to 'default'", () => {
  assert.equal(resolveWorkflowName({}).name, "default");
});

test("a recipe with no match block is never auto-selected", () => {
  assert.equal(evaluateMatch(undefined, SIGNALS), null);
  assert.equal(evaluateMatch({}, SIGNALS), null);
  assert.equal(evaluateMatch({ priority: 5 }, SIGNALS), null, "priority alone is not a condition");
});

test("all present conditions must hold; false booleans impose no constraint", () => {
  assert.equal(evaluateMatch({ loc_touched_max: 50 }, SIGNALS).matched, true);
  assert.equal(evaluateMatch({ loc_touched_max: 5 }, SIGNALS).matched, false);
  assert.equal(evaluateMatch({ has_migrations: false }, SIGNALS).matched, true, "false is not a constraint");
  assert.equal(evaluateMatch({ has_migrations: true }, SIGNALS).matched, false);
  assert.deepEqual(evaluateMatch({ loc_touched_max: 50, config_only: false }, SIGNALS).satisfied, ["loc_touched_max", "config_only"]);
});

test("arguments_pattern is case-insensitive, and an uncompilable regex simply does not match", () => {
  assert.equal(evaluateMatch({ arguments_pattern: "^FIX" }, SIGNALS, "fix the crash").matched, true);
  assert.equal(evaluateMatch({ arguments_pattern: "[unclosed" }, SIGNALS, "anything").matched, false);
});

test("tie-break 1: explicit priority wins before specificity", () => {
  const generic = { name: "debug", doc: { name: "debug", match: { arguments_pattern: "crash", loc_touched_max: 999 }, phases: ["a"] } };
  const specific = { name: "android-debug", doc: { name: "android-debug", match: { arguments_pattern: "crash", priority: 10 }, phases: ["a"] } };
  assert.equal(autoSelect([generic, specific], SIGNALS, "crash").name, "android-debug",
    "priority is the author-controlled override and is applied first");
});

test("tie-break 2 then 3: specificity, then the most conservative cap", () => {
  const one = { name: "a-one", doc: { name: "a-one", match: { arguments_pattern: "x" }, phases: ["p"] } };
  const two = { name: "b-two", doc: { name: "b-two", match: { arguments_pattern: "x", loc_touched_max: 999 }, phases: ["p"] } };
  assert.equal(autoSelect([one, two], SIGNALS, "x").name, "b-two", "more satisfied conditions wins");

  const capped = { name: "b-capped", doc: { name: "b-capped", match: { arguments_pattern: "x" }, caps: { max_total_cost_usd: 4 }, phases: ["p"] } };
  assert.equal(autoSelect([one, capped], SIGNALS, "x").name, "b-capped", "a present cap always beats no cap");
});

test("tie-break 4: alphabetical is the final backstop", () => {
  const z = { name: "z-one", doc: { name: "z-one", match: { arguments_pattern: "x" }, phases: ["p"] } };
  const a = { name: "a-one", doc: { name: "a-one", match: { arguments_pattern: "x" }, phases: ["p"] } };
  const r = autoSelect([z, a], SIGNALS, "x");
  assert.equal(r.name, "a-one");
  assert.match(r.print, /^🧭 Auto-selected workflow 'a-one' — matched: arguments_pattern\./);
});

test("a project recipe SHADOWS a plugin one; two plugins colliding halts", () => {
  const recipes = [
    { name: "bugfix", origin: "project", file: "/p/.claude/sdlc-workflows/bugfix.yaml", doc: {} },
    { name: "bugfix", origin: "plugin", file: "/cache/sdlc/workflows/bugfix.yaml", doc: {} },
  ];
  const r = locateRecipe("bugfix", recipes);
  assert.equal(r.recipe.origin, "project", "shadowing is intentional, not an ambiguity");
  assert.deepEqual(r.shadowed, ["/cache/sdlc/workflows/bugfix.yaml"]);

  const collide = locateRecipe("bugfix", recipes.filter((x) => x.origin === "plugin").concat({ name: "bugfix", origin: "plugin", file: "/cache/other/workflows/bugfix.yaml", doc: {} }));
  assert.equal(collide.recipe, null);
  assert.match(collide.halt, /ambiguous — defined in multiple plugins/);
});

test("an unknown name halts and lists what is available, annotating project recipes", () => {
  const r = locateRecipe("nope", [{ name: "bugfix", origin: "project" }, { name: "default", origin: "plugin" }]);
  assert.match(r.halt, /Workflow 'nope' not found/);
  assert.match(r.halt, /bugfix \(project\), default/);
});

test("acyclic: duplicates halt, a backward loop target does not", () => {
  const ok = normalizePhases(["development", { name: "review", loop: { return_to: "development", max_rounds: 3 } }]);
  assert.deepEqual(validateAcyclic(ok, "w", "f"), [], "return_to is a back-edge, not a second occurrence");

  const dup = normalizePhases(["a", "a"]);
  assert.match(validateAcyclic(dup, "w", "f")[0], /duplicate phase 'a'/);

  const forward = normalizePhases([{ name: "review", loop: { return_to: "development", max_rounds: 3 } }, "development"]);
  assert.match(validateAcyclic(forward, "w", "f")[0], /not an earlier phase/);
});

test("parallel members count toward the flat phase list", () => {
  const phases = normalizePhases(["development", { parallel: ["security", "test"] }, "documentation"]);
  assert.deepEqual(phaseNames(phases), ["development", "security", "test", "documentation"]);
  assert.match(validateAcyclic(normalizePhases(["security", { parallel: ["security", "test"] }]), "w", "f")[0], /duplicate phase 'security'/);
});

test("extra phases insert after their anchor; a missing anchor warns rather than halts", () => {
  const phases = normalizePhases(["development", "qa"]);
  const r = buildResolvedPhases({ phases, extraPhases: [{ name: "audit", after: "development" }, { name: "orphan", after: "nowhere" }], workflowName: "w", file: "f" });
  assert.deepEqual(r.phases.map((p) => p.name), ["development", "audit", "qa"]);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /'orphan' has after='nowhere'/);
  assert.equal(r.halt, null);
});

test("skips remove phases, and prune parallel groups without emptying the slot silently", () => {
  const phases = normalizePhases(["development", { parallel: ["security", "test"] }, "documentation"]);
  const r = buildResolvedPhases({ phases, skipPhases: ["security"], workflowName: "w", file: "f" });
  assert.deepEqual(r.phases[1].parallel, ["test"], "a skipped member leaves the group with its survivors");

  const both = buildResolvedPhases({ phases, skipPhases: ["security", "test"], workflowName: "w", file: "f" });
  assert.deepEqual(both.phases.map((p) => p.name), ["development", "documentation"], "an emptied group disappears entirely");
});

test("discovery finds project recipes first and skips disabled plugins", () => {
  const dir = scratch();
  try {
    recipeFile(join(dir, "proj", ".claude", "sdlc-workflows"), "bugfix", { name: "bugfix", phases: ["development"] });
    recipeFile(join(dir, "plug", "workflows"), "default", { name: "default", phases: ["development"] });
    recipeFile(join(dir, "off", "workflows"), "hidden", { name: "hidden", phases: ["development"] });
    const installs = new Map([
      ["p@m", { installPath: join(dir, "plug"), version: "1" }],
      ["off@m", { installPath: join(dir, "off"), version: "1" }],
    ]);
    const recipes = discoverRecipes({ projectRoot: join(dir, "proj"), installs, enabled: { "off@m": false } });
    assert.deepEqual(recipes.map((r) => `${r.origin}:${r.name}`), ["project:bugfix", "plugin:default"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
