import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  validateSkillSet, renderSkillSetTable, renderReadmeBlock, spliceBlock, checkSkillSets, coreRoleOrder,
} from "../lib/skill-sets.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CORE_ROLES = ["business-analyst", "developer", "reviewer", "security-analyst", "tester", "qa-engineer", "debugger", "document-writer", "devops", "cicd", "aar-analyst"];

function set(overrides = {}) {
  return {
    set: "demo",
    source: { homepage: "https://example.test", catalog_version: "1", synced_at: "2026-09-28" },
    categories: {
      ui: { label: "UI", upstream: ["jetpack-compose"], roles: ["developer", "qa-engineer"] },
      security: { label: "Security", upstream: ["security"], roles: ["security-analyst", "developer"] },
    },
    skills: [
      { id: "adaptive", upstream_path: "jetpack-compose/adaptive", category: "ui", summary: "s",
        roles: { developer: { when: "when building a layout" } } },
      { id: "intent-sec", upstream_path: "security/intent-sec", category: "security", summary: "s",
        roles: { "security-analyst": { policy: "mandatory", when: "before auditing intents in THIS dispatch" } } },
    ],
    ...overrides,
  };
}

test("coreRoleOrder: phase-bound roles in manifest order, then on-demand, deduplicated", () => {
  const order = coreRoleOrder({
    agents_per_phase: { development: "developer", review: "reviewer", remediation: "developer" },
    on_demand_agents: ["debugger", "developer"],
  });
  assert.deepEqual(order, ["developer", "reviewer", "debugger"]);
});

test("a well-formed set validates clean", () => {
  assert.deepEqual(validateSkillSet(set(), { coreRoles: CORE_ROLES }), []);
});

test("scope guard: a UI skill assigned to the security-analyst is rejected", () => {
  const doc = set();
  doc.skills[0].roles["security-analyst"] = { when: "when auditing" };
  const errors = validateSkillSet(doc, { coreRoles: CORE_ROLES });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /'security-analyst' is out of scope for category 'ui'/);
});

test("roster: an unknown role is rejected in categories and in rows", () => {
  const doc = set();
  doc.categories.ui.roles.push("designer");
  doc.skills[0].roles.designer = { when: "x" };
  const errors = validateSkillSet(doc, { coreRoles: CORE_ROLES });
  assert.ok(errors.some((e) => /categories\.ui\.roles: 'designer' is not a core role/.test(e)));
  assert.ok(errors.some((e) => /skills\.adaptive\.roles: 'designer' is not a core role/.test(e)));
});

test("triage marker, duplicate id, unknown category and wrong upstream are each reported", () => {
  const doc = set();
  doc.skills.push({ id: "new-thing", upstream_path: "security/new-thing", category: "security", summary: "s", unassigned: "TRIAGE — new in 2" });
  doc.skills.push({ ...doc.skills[0] });
  doc.skills.push({ id: "orphan", upstream_path: "x/orphan", category: "nope", summary: "s", unassigned: "niche" });
  doc.skills.push({ id: "misfiled", upstream_path: "security/misfiled", category: "ui", summary: "s", unassigned: "niche" });
  const errors = validateSkillSet(doc, { coreRoles: CORE_ROLES }).join("\n");
  assert.match(errors, /new-thing: still marked "TRIAGE/);
  assert.match(errors, /'adaptive' appears twice/);
  assert.match(errors, /orphan: category 'nope' is not declared/);
  assert.match(errors, /misfiled: upstream_path 'security\/misfiled' lives under 'security\/'/);
});

test("a run-scoped `when` is rejected with the same rule as role_expertise rows", () => {
  const doc = set();
  doc.skills[0].roles.developer.when = "before the first Write of production code";
  assert.match(validateSkillSet(doc, { coreRoles: CORE_ROLES }).join("\n"), /run-scoped/);
  doc.skills[0].roles.developer.when = "before the first Write in THIS dispatch";
  assert.deepEqual(validateSkillSet(doc, { coreRoles: CORE_ROLES }), []);
});

test("a catalog id that equals a shipped marketplace skill is a collision", () => {
  const errors = validateSkillSet(set(), { coreRoles: CORE_ROLES, shippedSkills: new Set(["adaptive"]) });
  assert.match(errors.join("\n"), /'adaptive' collides with a skill this marketplace ships/);
});

test("the table marks mandatory in bold, only renders roles some category allows, and shows gates", () => {
  const doc = set();
  doc.skills[0].applies_if = { dependency: "androidx.window" };
  const md = renderSkillSetTable(doc, CORE_ROLES, "demo.yaml");
  assert.match(md, /\| Skill \| Category \| DEV \| SEC \| QA \| Gate \/ needs \|/);
  assert.match(md, /\| `intent-sec` \| security \| — \| \*\*M\*\* \| — \| — \|/);
  assert.match(md, /\| `adaptive` \| ui \| R \| — \| — \| `androidx.window` \|/);
  assert.doesNotMatch(md, /\bREV\b/);
});

test("the README block lists each role's skills, mandatory first", () => {
  const doc = set();
  doc.skills[1].roles.developer = { when: "when adding an exported component" };
  const block = renderReadmeBlock(doc, CORE_ROLES, "skill-sets/demo.md");
  assert.match(block, /\| `developer` \| `adaptive`, `intent-sec` \|/);
  assert.match(block, /\| `security-analyst` \| \*\*`intent-sec`\*\* \|/);
});

test("spliceBlock replaces only between the markers and returns null without them", () => {
  const text = "a\n<!-- skill-set:demo:begin -->\nold\n<!-- skill-set:demo:end -->\nz\n";
  const out = spliceBlock(text, "demo", "NEW");
  assert.match(out, /^a\n<!-- skill-set:demo:begin -->\n<!-- GENERATED[^\n]*\nNEW\n<!-- skill-set:demo:end -->\nz\n$/);
  assert.equal(spliceBlock("no markers", "demo", "NEW"), null);
});

test("the repository's skill sets are valid and their generated files are current", () => {
  const results = checkSkillSets(REPO);
  assert.ok(results.length >= 1, "expected at least the android-skills set");
  for (const r of results) assert.deepEqual(r.errors, [], r.file);
});

test("the android-skills set covers the security-analyst with no UI, navigation or media skill", () => {
  const doc = YAML.parse(readFileSync(join(REPO, "plugins/android-foundation/skill-sets/android-skills.yaml"), "utf8"));
  const secCats = new Set(doc.skills.filter((s) => s.roles?.["security-analyst"]).map((s) => s.category));
  for (const banned of ["ui", "navigation", "media", "form-factor"]) assert.ok(!secCats.has(banned), banned);
});

// The gate is evaluated by the SHIPPED resolver grammar, so it is tested against that, not a copy.
test("agp-9-upgrade gate: every common way of declaring AGP 8 matches, AGP 9 and no AGP do not", async () => {
  const { evalRule } = await import("../../../plugins/sdlc/tools/resolve/detect.mjs");
  const doc = YAML.parse(readFileSync(join(REPO, "plugins/android-foundation/skill-sets/android-skills.yaml"), "utf8"));
  const gate = doc.skills.find((s) => s.id === "agp-9-upgrade").applies_if;
  const project = (files) => {
    const root = mkdtempSync(join(tmpdir(), "agp-gate-"));
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    return root;
  };
  const agp8 = {
    "catalog agp": { "gradle/libs.versions.toml": '[versions]\nagp = "8.7.2"\n' },
    "catalog androidGradlePlugin": { "gradle/libs.versions.toml": '[versions]\nandroidGradlePlugin = "8.5.0"\n' },
    "catalog android-gradle-plugin": { "gradle/libs.versions.toml": '[versions]\nandroid-gradle-plugin = "8.3.1"\n' },
    "catalog androidGradle": { "gradle/libs.versions.toml": '[versions]\nandroidGradle = "8.1.0"\n' },
    "legacy classpath": { "build.gradle": "buildscript { dependencies { classpath 'com.android.tools.build:gradle:8.2.0' } }\n" },
    "plugins DSL kts": { "build.gradle.kts": 'plugins {\n  id("com.android.application") version "8.6.0" apply false\n}\n' },
    "plugins DSL groovy": { "build.gradle": "plugins {\n  id 'com.android.library' version '8.4.0' apply false\n}\n" },
    "settings pluginManagement": { "settings.gradle.kts": 'pluginManagement { plugins { id("com.android.application") version "8.0.2" } }\n' },
  };
  for (const [name, files] of Object.entries(agp8)) assert.equal(evalRule(gate, project(files)), true, name);

  const notAgp8 = {
    "catalog AGP 9": { "gradle/libs.versions.toml": '[versions]\nagp = "9.0.0"\n' },
    "plugins DSL AGP 9": { "build.gradle.kts": 'plugins { id("com.android.application") version "9.1.0" }\n' },
    "unrelated 8.x key": { "gradle/libs.versions.toml": '[versions]\nkotlin = "8.0.0"\nmyagp = "8.0.0"\n' },
    "no Android": { "build.gradle.kts": 'plugins { kotlin("jvm") version "2.1.0" }\n' },
  };
  for (const [name, files] of Object.entries(notAgp8)) assert.equal(evalRule(gate, project(files)), false, name);
});

test("the table shows a file_contains gate's pattern with `|` escaped", () => {
  const doc = set();
  doc.skills[0].applies_if = { file_contains: { path: "a.toml", pattern: "(x|y)" } };
  const md = renderSkillSetTable(doc, CORE_ROLES, "demo.yaml");
  assert.match(md, /`a\.toml` ~ `\/\(x\\\|y\)\/`/);
});

function tree() {
  const root = mkdtempSync(join(tmpdir(), "skill-sets-"));
  mkdirSync(join(root, "plugins/sdlc"), { recursive: true });
  cpSync(join(REPO, "plugins/sdlc/manifest.yaml"), join(root, "plugins/sdlc/manifest.yaml"));
  mkdirSync(join(root, "plugins/p/skill-sets"), { recursive: true });
  writeFileSync(join(root, "plugins/p/skill-sets/demo.yaml"), YAML.stringify(set()));
  writeFileSync(join(root, "plugins/p/README.md"), "# p\n\n<!-- skill-set:demo:begin -->\n<!-- skill-set:demo:end -->\n");
  return root;
}

test("check reports stale output, --write regenerates it, and the next check is clean", () => {
  const root = tree();
  const before = checkSkillSets(root);
  assert.equal(before[0].ok, false);
  assert.match(before[0].errors.join("\n"), /demo\.md is stale or missing/);
  assert.match(before[0].errors.join("\n"), /README\.md skill-set block is stale/);

  const wrote = checkSkillSets(root, { write: true });
  assert.deepEqual(wrote[0].written.sort(), ["plugins/p/README.md", "plugins/p/skill-sets/demo.md"]);
  assert.deepEqual(checkSkillSets(root)[0].errors, []);

  // A hand edit to the generated table is drift.
  const md = join(root, "plugins/p/skill-sets/demo.md");
  writeFileSync(md, readFileSync(md, "utf8").replace("R", "**M**"));
  assert.match(checkSkillSets(root)[0].errors.join("\n"), /demo\.md is stale/);
});

test("a README without the markers is reported, not silently skipped", () => {
  const root = tree();
  writeFileSync(join(root, "plugins/p/README.md"), "# p\n");
  assert.match(checkSkillSets(root, { write: true })[0].errors.join("\n"), /has no <!-- skill-set:demo:begin -->/);
});
