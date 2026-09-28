// ADR-0036 at runtime: a skill set becomes role rows (gated, bare, owned by `requires`), its
// dependency derives `skills_used` and per-skill tools from the same file, and a missing catalog
// skill is judged PER SKILL — a mandatory row is downgraded, a recommended one is not rendered.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkillSets, skillSetRoleRows, assignedSkills, skillTools, evalGate } from "../../../plugins/sdlc/tools/resolve/skillsets.mjs";
import { mergeRoleExpertise, renderSkillsBlock } from "../../../plugins/sdlc/tools/resolve/profile.mjs";
import {
  collectDependencies, computeDepsStatus, enforcePolicies, enumerateSkills, dependencyVersions, preflight,
} from "../../../plugins/sdlc/tools/resolve/deps.mjs";

const SET = [
  "set: cat",
  "source: { homepage: h, catalog_version: '1', synced_at: '2026-09-28' }",
  "categories:",
  "  sec: { label: S, upstream: [security], roles: [security-analyst, developer] }",
  "  ui: { label: U, upstream: [ui], roles: [developer] }",
  "  tool: { label: T, upstream: [devtools], roles: [developer, security-analyst] }",
  "skills:",
  "  - id: intent-sec",
  "    upstream_path: security/intent-sec",
  "    category: sec",
  "    summary: s",
  "    roles:",
  "      security-analyst: { policy: mandatory, when: before auditing }",
  "      developer: { when: when adding a component }",
  "  - id: camera",
  "    upstream_path: ui/camera",
  "    category: ui",
  "    summary: s",
  "    applies_if: { dependency: androidx.camera }",
  "    roles:",
  "      developer: { when: when touching the camera }",
  "  - id: the-cli",
  "    upstream_path: devtools/the-cli",
  "    category: tool",
  "    summary: s",
  "    requires_tools: [fakebin]",
  "    roles:",
  "      developer: { when: when scaffolding }",
  "  - id: glasses",
  "    upstream_path: ui/glasses",
  "    category: ui",
  "    summary: s",
  "    unassigned: niche form factor",
  "",
].join("\n");

function scratch() { return mkdtempSync(join(tmpdir(), "sdlc-skillsets-")); }
function plugin(dir) {
  mkdirSync(join(dir, "skill-sets"), { recursive: true });
  writeFileSync(join(dir, "skill-sets", "cat.yaml"), SET);
  writeFileSync(join(dir, "runtime-dependencies.json"), JSON.stringify({ dependencies: [
    { name: "cat", kind: "skill-catalog", policy: "warn", skill_set: "skill-sets/cat.yaml", version_file: "$HOME/cat/version" },
  ] }));
  return dir;
}
function skill(root, name) {
  mkdirSync(join(root, "skills", name), { recursive: true });
  writeFileSync(join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\n---\n`);
}

test("rows: bare ids owned by `requires`, recommended by default, gated on the project", () => {
  const dir = scratch();
  try {
    const sets = loadSkillSets(plugin(join(dir, "p")), [{ file: "skill-sets/cat.yaml" }]);
    const project = join(dir, "app");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "build.gradle.kts"), "dependencies { }\n");

    const rows = skillSetRoleRows(sets, { projectRoot: project, detectionPaths: ["build.gradle.kts"] });
    assert.deepEqual(rows["security-analyst"], [{ skill: "intent-sec", policy: "mandatory", when: "before auditing", requires: "cat" }]);
    assert.deepEqual(rows.developer.map((r) => r.skill), ["intent-sec", "the-cli"], "camera is gated off; glasses is unassigned");
    assert.ok(rows.developer.every((r) => r.policy === "recommended" && r.requires === "cat"));

    writeFileSync(join(project, "build.gradle.kts"), 'implementation("androidx.camera:camera-core:1.4.0")\n');
    const gated = skillSetRoleRows(sets, { projectRoot: project, detectionPaths: ["build.gradle.kts"] });
    assert.ok(gated.developer.some((r) => r.skill === "camera"), "the dependency is present, so the gate opens");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a role-level applies_if overrides the skill-level gate for that role only", () => {
  const sets = [{ set: "cat", skills: [{ id: "x", applies_if: { file_exists: "nope" },
    roles: { developer: { when: "w" }, "business-analyst": { when: "w", applies_if: { any: [{ file_exists: "nope" }, { file_glob: "*" }] } } } }] }];
  const dir = scratch();
  try {
    writeFileSync(join(dir, "a.txt"), "");
    const rows = skillSetRoleRows(sets, { projectRoot: dir });
    assert.equal(rows.developer, undefined);
    assert.equal(rows["business-analyst"].length, 1);
    assert.equal(evalGate({ all: [{ dependency: "zzz" }] }, { projectRoot: dir, detectionPaths: ["a.txt"] }), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("assignedSkills and skillTools read only the skills some role receives", () => {
  const dir = scratch();
  try {
    const [doc] = loadSkillSets(plugin(join(dir, "p")), [{ file: "skill-sets/cat.yaml" }]);
    assert.deepEqual(assignedSkills(doc), ["intent-sec", "camera", "the-cli"]);
    assert.deepEqual(skillTools(doc), { "the-cli": ["fakebin"] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an unreadable or foreign skill-set file is a WARN, never a crash", () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, "skill-sets"));
    writeFileSync(join(dir, "skill-sets", "bad.yaml"), "just: a mapping\n");
    const warnings = [];
    assert.deepEqual(loadSkillSets(dir, [{ file: "skill-sets/bad.yaml" }, { file: "skill-sets/gone.yaml" }], warnings), []);
    assert.equal(warnings.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("deps: a skill-catalog derives skills_used from its set; a missing host tool makes an INSTALLED skill unavailable", () => {
  const dir = scratch();
  try {
    const p = plugin(join(dir, "p"));
    const config = join(dir, "cfg");
    skill(config, "intent-sec");
    skill(config, "the-cli");                              // installed — but `fakebin` is not on PATH
    const installs = new Map([["p@m", { installPath: p, version: "1.0.0" }]]);

    const { dependencies } = collectDependencies({ installs, enabled: {} });
    const cat = dependencies.find((d) => d.name === "cat");
    assert.deepEqual(cat.skills_used, ["intent-sec", "camera", "the-cli"], "unassigned `glasses` is not required");

    const available = enumerateSkills({ configDir: config, installs, enabled: {} });
    const noTool = computeDepsStatus(dependencies, available, { which: () => null });
    assert.equal(noTool.cat.status, "missing");
    assert.deepEqual(noTool.cat.missing_skills, ["camera"]);
    assert.deepEqual(noTool.cat.missing_tools, ["fakebin"]);
    assert.deepEqual(noTool.cat.unavailable_skills, ["camera", "the-cli"]);

    const enforced = enforcePolicies(noTool);
    assert.deepEqual(enforced.unavailable_skills, { cat: ["camera", "the-cli"] });
    assert.ok(enforced.stdout.some((l) => /WARN: cat missing tools: fakebin/.test(l)));
    assert.equal(enforced.abort, false, "policy warn never aborts");

    const withTool = computeDepsStatus(dependencies, available, { which: () => "/bin/fakebin" });
    assert.deepEqual(withTool.cat.unavailable_skills, ["camera"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("deps: a catalog's version comes from its version_file, so an update invalidates the stamp", () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, "home", "cat"), { recursive: true });
    writeFileSync(join(dir, "home", "cat", "version"), "1.0.2\n");
    const deps = [{ name: "cat", kind: "skill-catalog", version_file: "$HOME/cat/version" }, { name: "sp" }];
    assert.deepEqual(dependencyVersions(deps, new Map(), { HOME: join(dir, "home") }), { cat: "1.0.2", sp: null });
    assert.deepEqual(dependencyVersions(deps, new Map(), { HOME: join(dir, "nowhere") }), { cat: null, sp: null });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("preflight: stamp:false writes nothing (the doctor's read-only call)", () => {
  const dir = scratch();
  try {
    const p = plugin(join(dir, "p"));
    const config = join(dir, "cfg");
    mkdirSync(config);
    const r = preflight({ configDir: config, installs: new Map([["p@m", { installPath: p }]]), enabled: {}, which: () => null, stamp: false, env: { HOME: dir } });
    assert.equal(r.stamp_written, null);
    assert.deepEqual(r.unavailable_skills.cat, ["intent-sec", "camera", "the-cli"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("merge: set rows join the role even where the manifest's role_expertise says nothing about it", () => {
  const { role_expertise } = mergeRoleExpertise([{
    stack: "s", dir: "",
    role_expertise: { developer: { skills: [{ skill: "own:thing", when: "w" }] } },
    skill_set_rows: {
      developer: [{ skill: "intent-sec", policy: "recommended", when: "a", requires: "cat" }],
      "security-analyst": [{ skill: "intent-sec", policy: "mandatory", when: "b", requires: "cat" }],
    },
  }]);
  assert.deepEqual(role_expertise.developer.skills.map((r) => r.skill), ["own:thing", "intent-sec"]);
  assert.deepEqual(role_expertise["security-analyst"].skills, [{ skill: "intent-sec", policy: "mandatory", when: "b", requires: "cat" }]);
});

test("render: an unavailable catalog skill — mandatory is downgraded, recommended is dropped, others untouched", () => {
  const roleSkills = [
    { skill: "intent-sec", policy: "mandatory", when: "before auditing", requires: "cat" },
    { skill: "camera", policy: "recommended", when: "when touching the camera", requires: "cat" },
    { skill: "the-cli", policy: "recommended", when: "when scaffolding", requires: "cat" },
    { skill: "superpowers:brainstorming", policy: "mandatory", when: "first" },
  ];
  const warnings = [];
  const block = renderSkillsBlock("security-analyst", {
    roleSkills, unavailableSkills: { cat: ["intent-sec", "camera"] }, unavailablePlugins: { cat_unavailable: true }, warnings,
  });
  assert.match(block, /RECOMMENDED — consider invoking `intent-sec` — before auditing \(skill not installed — best-effort\)/);
  assert.doesNotMatch(block, /`camera`/, "a recommended row for an unavailable skill is not rendered");
  assert.match(block, /RECOMMENDED — consider invoking `the-cli`/);
  assert.match(block, /MANDATORY — invoke `superpowers:brainstorming`/, "a plugin-owned row is not judged by the catalog's list");
  assert.deepEqual(warnings, ["WARN: role_expertise intent-sec (cat) not available — downgraded to recommended"]);

  const healthy = renderSkillsBlock("security-analyst", { roleSkills, unavailableSkills: {} });
  assert.match(healthy, /MANDATORY — invoke `intent-sec`/);
  assert.match(healthy, /`camera`/);
});

// The rows every Android dispatch carries regardless of the project ride in the stable prefix of
// every turn. Growth past this budget must be a decision (raise it here, with a reason), not drift.
test("android-skills: the ungated rows per role stay within budget, and the security-analyst gets no UI skill", async () => {
  const { fileURLToPath } = await import("node:url");
  const repo = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
  const sets = loadSkillSets(join(repo, "plugins", "android-foundation"), [{ file: "skill-sets/android-skills.yaml" }]);
  const empty = scratch();
  try {
    const rows = skillSetRoleRows(sets, { projectRoot: empty, detectionPaths: ["gradle/libs.versions.toml", "**/build.gradle.kts"] });
    const BUDGET = { developer: 8, "qa-engineer": 5, "security-analyst": 5, "business-analyst": 3 };
    for (const [role, max] of Object.entries(BUDGET)) {
      assert.ok((rows[role] ?? []).length <= max, `${role}: ${(rows[role] ?? []).map((r) => r.skill).join(", ")} exceeds ${max}`);
    }
    for (const role of Object.keys(rows)) assert.ok(rows[role].length <= 8, role);
    const sec = new Set(rows["security-analyst"].map((r) => r.skill));
    for (const ui of ["adaptive", "edge-to-edge", "styles", "navigation-3", "camerax"]) assert.ok(!sec.has(ui), ui);
    assert.deepEqual(rows["security-analyst"].filter((r) => r.policy === "mandatory").map((r) => r.skill).sort(),
      ["android-intent-security", "android-permissions-security"]);
  } finally { rmSync(empty, { recursive: true, force: true }); }
});
