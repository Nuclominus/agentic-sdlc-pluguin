// Step 1c as code, plus the differential gate that keeps the shipped validator honest.
//
// The plugin ships no dependencies, so schemas/workflow.schema.json cannot be enforced with
// ajv at runtime and the structural rules are reimplemented. That is a second implementation
// of one contract — exactly the thing ADR-0019 exists to remove — so it is allowed only
// because both run over the same inputs in CI and must agree.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import {
  discoverRecipes, validateWorkflow, normalizePhases, phaseNames, validateAcyclic,
  evaluateMatch, autoSelect, resolveWorkflowName, locateRecipe, buildResolvedPhases,
  availableNames, matchNamedRecipe,
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

// -------------------------------------------------- tier 1b: a recipe named in the request

// The recipe set a consumer could name. Only `name`/`origin` matter to this tier — it resolves a
// NAME, and locateRecipe is what turns the name back into a file.
const NAMED = ["default", "docs-only", "hotfix", "bugfix", "refactor", "analysis", "testing", "debug"]
  .map((name) => ({ name, origin: "plugin", doc: { name, phases: ["documentation"] } }));

test("tier 1b: a recipe named in the request resolves as if the flag had been typed", () => {
  const r = resolveWorkflowName({
    args: "Would the docs-only SDLC workflow for 'Document the growth log screen' fit under its cost cap? --dry-run",
    recipes: NAMED,
  });
  assert.equal(r.name, "docs-only");
  assert.equal(r.tier, "named_in_prose");
  assert.equal(r.autoselected, false, "naming a recipe is an explicit request, not auto-selection");
  assert.equal(
    r.print,
    "🧭 Recipe 'docs-only' named in the request — resolved as --workflow=docs-only. Override with --workflow=NAME.",
  );
});

test("tier 1b sits BELOW the flag and ABOVE active_workflow", () => {
  const flag = resolveWorkflowName({ args: "run the docs-only workflow --workflow=hotfix", recipes: NAMED });
  assert.equal(flag.name, "hotfix", "an explicit flag still wins");
  assert.equal(flag.tier, "--workflow");

  const active = resolveWorkflowName({ args: "use the hotfix workflow", recipes: NAMED, activeWorkflow: "android-feature" });
  assert.equal(active.name, "hotfix", "a name in the request beats the project's standing choice");
  assert.equal(active.tier, "named_in_prose");
});

test("tier 1b needs a workflow cue word — 'analysis' and 'debug' are ordinary English", () => {
  const prose = resolveWorkflowName({ args: "Add debug logging to the analysis screen", recipes: NAMED, profileDefault: "demo-flow" });
  assert.equal(prose.name, "demo-flow", "a feature description is not a recipe selection");
  assert.equal(prose.tier, "profile_default");

  const cued = resolveWorkflowName({ args: "run the analysis workflow over the codebase", recipes: NAMED, profileDefault: "demo-flow" });
  assert.equal(cued.name, "analysis");
});

test("tier 1b is skipped entirely when the resolution is pinned by a flag", () => {
  const off = resolveWorkflowName({ args: "the hotfix workflow, please --no-auto-workflow", recipes: NAMED, profileDefault: "demo-flow" });
  assert.equal(off.name, "demo-flow", "--no-auto-workflow opts out of every inferred tier");
  assert.equal(off.tier, "profile_default");
});

test("tier 1b: two recipe names in one request choose neither, and say both", () => {
  const r = resolveWorkflowName({ args: "is the hotfix workflow cheaper than the refactor recipe?", recipes: NAMED, profileDefault: "demo-flow" });
  assert.equal(r.name, "demo-flow", "an ambiguous request falls through rather than guessing");
  assert.equal(r.tier, "profile_default");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^WARN: /);
  assert.match(r.warnings[0], /hotfix/);
  assert.match(r.warnings[0], /refactor/);
});

test("tier 1b: a name-like token matching no installed recipe is reported, not swallowed", () => {
  const r = resolveWorkflowName({ args: "run the docs-onli workflow --dry-run", recipes: NAMED, profileDefault: "demo-flow" });
  assert.equal(r.name, "demo-flow", "it falls through — reporting is not halting");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /docs-onli/);
  assert.match(r.warnings[0], /Available: analysis, bugfix, debug, default, docs-only, hotfix, refactor, testing/,
    "the same list the not-found halt prints");
});

test("tier 1b: a cue word with no name-like token beside it says nothing", () => {
  const r = resolveWorkflowName({ args: "how much would the SDLC pipeline cost?", recipes: NAMED, profileDefault: "demo-flow" });
  assert.equal(r.name, "demo-flow");
  assert.deepEqual(r.warnings, [], "'the', 'SDLC' and friends are not recipe names anyone typed");
});

test("tier 1b: co-occurrence is not naming — the name must STAND AT the cue word", () => {
  // The cue word guards the tier, but on its own it only proves the word exists somewhere. Every
  // string below carries a cue word AND a recipe name, and every one of them is a change to make,
  // not a recipe to run — `/sdlc:start` is documented to the user as "run the SDLC pipeline".
  for (const args of [
    "run the SDLC pipeline to add debug logging to the growth screen",
    "Refactor the data pipeline module",
    "Add a testing stage to the release pipeline",
    "Document the hotfix rollback runbook in the CI pipeline docs",
    "Speed up the ingestion pipeline; refactor the mapper",
  ]) {
    const r = resolveWorkflowName({ args, recipes: NAMED, profileDefault: "demo-flow" });
    assert.equal(r.name, "demo-flow", `'${args}' describes a change — it does not select a recipe`);
  }
});

test("tier 1b: an ordinary word standing beside the cue word is not a mistyped recipe", () => {
  // The unknown-name report reaches the user through prints[], so a false alarm costs a line of
  // output and the whole recipe list on an ordinary feature request.
  for (const args of [
    "run the SDLC pipeline: implement offline-first sync",
    "Fix the login crash and update the CI pipeline config",
    "Add a growth-log pipeline for analytics events",
    "Wire up the multi-tenant workflow engine for orders",
  ]) {
    const r = resolveWorkflowName({ args, recipes: NAMED, profileDefault: "demo-flow" });
    assert.deepEqual(r.warnings, [], `'${args}' names no recipe and must say nothing`);
  }
});

test("tier 1b: a name spelled one character off IS reported", () => {
  const r = resolveWorkflowName({ args: "run the docs-onli workflow --dry-run", recipes: NAMED, profileDefault: "demo-flow" });
  assert.equal(r.name, "demo-flow");
  assert.match(r.warnings[0], /'docs-onli' reads like a workflow recipe/);
});

test("tier 1b: a recipe REFERRED TO by name and not installed is reported, not silently replaced", () => {
  // Issue #180. `--workflow=mobile-release` halts; the same name in prose used to resolve
  // `default` — a different pipeline under a different cap — and say nothing at all.
  const r = resolveWorkflowName({ args: "Run the mobile-release workflow for 'Ship 2.1' --dry-run", recipes: NAMED, profileDefault: "demo-flow" });
  assert.equal(r.name, "demo-flow", "prose never halts and never picks — it falls through");
  assert.equal(r.tier, "profile_default");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^WARN: 'mobile-release' reads like a workflow recipe/);
  assert.match(r.warnings[0], /Available: analysis, bugfix, debug, default, docs-only, hotfix, refactor, testing/);
});

test("tier 1b: the reference reads in every tense, determiner and word order", () => {
  // A first cut inflected `run` and `use` but not `start`/`launch`/`execute`/`trigger`, and
  // admitted only a bare `the` — so four of these silently resolved the default pipeline,
  // which IS the #180 bug, merely spelt differently.
  for (const args of [
    "Starting the mobile-release workflow for Ship 2.1",
    "Launching the mobile-release workflow now",
    "Triggering the mobile-release workflow",
    "Executing the mobile-release workflow",
    "Run our mobile-release workflow",
    "Run the full mobile-release workflow",
    "Kick off the mobile-release workflow",
    "run mobile-release workflow --dry-run",
    "run workflow mobile-release",
    "use recipe mobile-release",
    "Ship 2.1 with the mobile-release workflow",
    "Please use the mobile-release recipe",
  ]) {
    const r = resolveWorkflowName({ args, recipes: NAMED, profileDefault: "demo-flow" });
    assert.equal(r.name, "demo-flow", `'${args}' must still fall through — prose never halts`);
    assert.equal(r.warnings.length, 1, `'${args}' refers to a recipe by name`);
    assert.match(r.warnings[0], /mobile-release/);
  }
});

test("tier 1b: naming an application's own workflow is not naming a recipe", () => {
  // The verb alone is NOT enough, and leaning on it warned at nine ordinary feature requests in
  // ten: `start`, `launch` and `trigger` are app-lifecycle verbs first. What separates these
  // from the block above is the shape of the name — a single English noun, never a compound.
  // The warning reaches the user verbatim (pipeline-orchestrator echoes every `WARN:` line), so
  // a false alarm here costs a wrong line plus the whole recipe list on a routine run.
  for (const args of [
    "Trigger the approval workflow when a doc is submitted",
    "Send analytics events through the ingestion pipeline",
    "Start the checkout workflow from the cart screen",
    "Make new users follow the onboarding workflow",
    "Integrate the exporter with the billing pipeline",
    "Replace the old uploader with the streaming pipeline",
    "Users can launch the signup workflow from the banner",
    "Stream uploads via the media pipeline",
  ]) {
    const r = resolveWorkflowName({ args, recipes: NAMED, profileDefault: "demo-flow" });
    assert.deepEqual(r.warnings, [], `'${args}' describes the product, not a recipe to run`);
  }
});

test("tier 1b: an unknown name only DESCRIBED beside the cue word stays silent", () => {
  // The widened report must not reach the prose that the tier was deliberately narrowed for.
  for (const args of [
    "Document the growth log screen",
    "Fix the hotfix button label on the settings screen",
    "Speed up the ingestion pipeline; refactor the mapper",
    "Wire up the multi-tenant workflow engine for orders",
    "Add a growth-log pipeline for analytics events",
    "Add a release-train stage to the build pipeline",
  ]) {
    const r = resolveWorkflowName({ args, recipes: NAMED, profileDefault: "demo-flow" });
    assert.deepEqual(r.warnings, [], `'${args}' names no recipe and must say nothing`);
  }
});

test("tier 1b: referring to an INSTALLED recipe still selects it, warning nothing", () => {
  const r = resolveWorkflowName({ args: "Would the docs-only SDLC workflow fit under its cost cap?", recipes: NAMED, profileDefault: "demo-flow" });
  assert.equal(r.name, "docs-only");
  assert.equal(r.tier, "named_in_prose");
  assert.deepEqual(r.warnings, []);
});

test("an unknown name passed as the FLAG still halts — prose is soft, the flag is not", () => {
  const r = resolveWorkflowName({ args: "Ship 2.1 --workflow=mobile-release --dry-run", recipes: NAMED, profileDefault: "demo-flow" });
  assert.equal(r.name, "mobile-release");
  assert.equal(r.tier, "--workflow");
  const located = locateRecipe("mobile-release", NAMED);
  assert.equal(located.recipe, null);
  assert.equal(located.halt, ["❌ Workflow 'mobile-release' not found.",
    "   Available: analysis, bugfix, debug, default, docs-only, hotfix, refactor, testing",
    "   Omit --workflow=NAME to use the default workflow."].join("\n"),
  "asserted whole: a first cut re-mapped the already-mapped NAMED fixture, and the halt it "
  + "matched listed '[object Object]' eight times behind a first line that looked right");
});

test("tier 1b: a QUOTED name nothing answers to is reported, however unlike a recipe it looks", () => {
  const r = resolveWorkflowName({ args: "run the 'frobnicate' workflow", recipes: NAMED, profileDefault: "demo-flow" });
  assert.match(r.warnings[0], /frobnicate/, "quoting it leaves no doubt it was meant as a name");
});

test("tier 1b: two names that are BOTH really named stay ambiguous", () => {
  const recipes = [...NAMED, { name: "docs", origin: "plugin", doc: { name: "docs", phases: ["documentation"] } }];
  const r = resolveWorkflowName({ args: "compare the docs workflow with the docs-only workflow", recipes, profileDefault: "demo-flow" });
  assert.equal(r.name, "demo-flow", "an overlap in spelling is not a licence to pick one");
  assert.match(r.warnings[0], /names more than one workflow recipe/);
  assert.match(r.warnings[0], /docs/);
  assert.match(r.warnings[0], /docs-only/);
});

test("tier 1b: the longer of two overlapping names is the one the text contains", () => {
  const recipes = [...NAMED, { name: "docs", origin: "plugin", doc: { name: "docs", phases: ["documentation"] } }];
  const r = resolveWorkflowName({ args: "the docs-only workflow", recipes });
  assert.equal(r.name, "docs-only", "the token at the cue word is the whole name, not its prefix");
});

test("matchNamedRecipe is inert without recipes to name", () => {
  assert.equal(matchNamedRecipe({ args: "the docs-only workflow", recipes: [] }), null);
});

test("availableNames dedupes for machines and annotates for humans", () => {
  const recipes = [
    { name: "bugfix", origin: "project" },
    { name: "bugfix", origin: "plugin" },
    { name: "default", origin: "plugin" },
  ];
  assert.deepEqual(availableNames(recipes), ["bugfix", "default"], "the discoverable set, once each");
  assert.deepEqual(availableNames(recipes, { annotate: true }), ["bugfix", "bugfix (project)", "default"]);
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
    { name: "bugfix", origin: "project", file: "/p/.sdlc/sdlc-workflows/bugfix.yaml", doc: {} },
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
    recipeFile(join(dir, "proj", ".sdlc", "sdlc-workflows"), "bugfix", { name: "bugfix", phases: ["development"] });
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

// PR-4 — the core `debug` recipe must use the core debugger.
//
// PR-1 added `debugger` to the core roster and bound `debugging: debugger` in the core manifest,
// but debug.yaml kept the shape it had when vanilla shipped no such agent: root-cause analysis
// went to `development`, which holds Edit. The recipe's own description asserted that absence,
// which stopped being true the moment the roster landed.
test("the core debug recipe opens with the debugging phase, not with development", () => {
  const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const raw = readFileSync(join(REPO_ROOT, "plugins/sdlc/workflows/debug.yaml"), "utf8");
  const doc = parseYaml(raw);
  assert.equal(phaseNames(normalizePhases(doc.phases))[0], "debugging",
    "root cause is diagnosed by the read-only debugger before anything edits code");
  assert.match(doc.description, /debugger/,
    "the description must not still claim vanilla ships no debugger agent");
  assert.ok(!/ships no dedicated debugger/.test(doc.description));
});

// Issue #239 / ADR-0040 — an unknown Step-0 size must not decide auto-selection either way.
const EMPTY = { loc_touched: 999999, loc_measured: 0, has_migrations: false, config_only: false, empty_diff: true,
  base_ref: "origin/develop", size_unknown: "the diff against origin/develop is empty" };

test("issue #239: a loc_touched bound does not match while the size is unknown", () => {
  assert.deepEqual(evaluateMatch({ loc_touched_max: 500 }, EMPTY),
    { matched: false, satisfied: [], size_unknown: true, assumed: ["loc_touched_max"] },
    "0 LOC on a fresh branch is not a small change");
  assert.equal(evaluateMatch({ loc_touched_min: 1 }, EMPTY).matched, false, "nor a large one");
  assert.deepEqual(evaluateMatch({ arguments_pattern: "fix", loc_touched_max: 500 }, EMPTY, "fix it").assumed,
    ["arguments_pattern", "loc_touched_max"]);
  assert.equal(evaluateMatch({ arguments_pattern: "fix", loc_touched_max: 500 }, EMPTY, "add it").size_unknown, undefined,
    "a recipe that failed on another condition was not held back by the size");
  assert.equal(evaluateMatch({ arguments_pattern: "fix" }, EMPTY, "fix it").matched, true, "no size bound, no change");
  assert.equal(evaluateMatch({ loc_touched_min: 0 }, EMPTY).matched, true, "a bound the measured part settles still holds");
  assert.equal(evaluateMatch({ loc_touched_max: 500 }, { ...EMPTY, size_unknown: null, loc_touched: 0 }).matched, true,
    "a measured 0 still matches");
});

test("issue #239: when the unknown size would decide the winner, auto-select abstains", () => {
  const recipes = [
    { name: "bugfix", doc: { name: "bugfix", match: { arguments_pattern: "\\bfix\\b", loc_touched_max: 500 }, phases: ["a"] } },
    { name: "hotfix", doc: { name: "hotfix", match: { arguments_pattern: "\\bfix\\b", loc_touched_max: 200 }, phases: ["a"] } },
  ];
  const r = resolveWorkflowName({ args: "fix the purchase flow", recipes, signals: EMPTY, profileDefault: "android-feature" });
  assert.equal(r.name, "android-feature");
  assert.equal(r.tier, "profile_default");
  assert.equal(r.print, "🧭 Auto-select withheld 'bugfix' — its loc_touched bound cannot be judged: the diff against origin/develop is empty. Falling back to the default workflow; pass --workflow=bugfix to choose it.");

  const real = resolveWorkflowName({ args: "fix the purchase flow", recipes, signals: { ...EMPTY, size_unknown: null, loc_touched: 40 }, profileDefault: "p" });
  assert.equal(real.name, "bugfix", "with a known size the bounds are judged as before");
});

test("review of #246: a held-back recipe does not hand the tie to the runner-up", () => {
  // The defect: on a fresh branch "Fix crash …" lost `bugfix` and fell to `debug`, which runs
  // no security phase. The runner-up must not win a tie the unknown size decided.
  const recipes = [
    { name: "bugfix", doc: { name: "bugfix", match: { arguments_pattern: "crash", loc_touched_max: 500 }, phases: ["a"] } },
    { name: "debug", doc: { name: "debug", match: { arguments_pattern: "crash" }, phases: ["a"] } },
  ];
  const r = resolveWorkflowName({ args: "crash on launch", recipes, signals: EMPTY, profileDefault: "p" });
  assert.equal(r.name, "p");
  assert.match(r.print, /^🧭 Auto-select withheld 'bugfix'/);
});

test("review of #246: a winner the unknown size did not affect is selected, with no withheld print", () => {
  const recipes = [
    { name: "bugfix", doc: { name: "bugfix", match: { arguments_pattern: "crash", loc_touched_max: 500 }, phases: ["a"] } },
    { name: "android-debug", doc: { name: "android-debug", match: { arguments_pattern: "crash", priority: 10 }, phases: ["a"] } },
  ];
  const r = resolveWorkflowName({ args: "crash on launch", recipes, signals: EMPTY, profileDefault: "p" });
  assert.equal(r.name, "android-debug", "priority wins whatever the size, so the size decided nothing");
  assert.ok(!/withheld/.test(r.print));
});

test("review of #246: on the SHIPPED recipes, an unknown size never drops security a known small one keeps", () => {
  // The guard the synthetic fixtures above could not give: the real recipe set, the real tie-breaks.
  const load = (dir) => readdirSync(join(REPO, dir)).filter((f) => f.endsWith(".yaml")).map((f) => join(REPO, dir, f)).map((file) => {
    const doc = parseYaml(readFileSync(file, "utf8"));
    return { name: doc.name, doc, origin: "plugin", file };
  });
  const flat = (doc) => normalizePhases(doc.phases).flatMap((p) => (Array.isArray(p.parallel) ? p.parallel : [p.name]));
  const stacks = [
    { recipes: load("plugins/sdlc/workflows"), profileDefault: "default" },
    { recipes: [...load("plugins/sdlc/workflows"), ...load("plugins/android-foundation/workflows")], profileDefault: "android-feature" },
  ];
  const requests = ["Fix crash when the purchase list is empty", "fix the login bug", "urgent hotfix for payments",
    "production fix: emergency crash in checkout", "rename Foo to Bar", "Add the purchase screens"];
  const SMALL = { ...EMPTY, empty_diff: false, size_unknown: null, loc_touched: 10, loc_measured: 10 };
  for (const { recipes, profileDefault } of stacks) {
    const phasesOf = (name) => flat(recipes.find((r) => r.name === name).doc);
    for (const args of requests) {
      const known = resolveWorkflowName({ args, recipes, signals: SMALL, profileDefault }).name;
      const fresh = resolveWorkflowName({ args, recipes, signals: EMPTY, profileDefault }).name;
      if (phasesOf(known).includes("security")) {
        assert.ok(phasesOf(fresh).includes("security"),
          `${profileDefault}: "${args}" keeps security on a small diff ('${known}') but not on a fresh branch ('${fresh}')`);
      }
    }
  }
});
