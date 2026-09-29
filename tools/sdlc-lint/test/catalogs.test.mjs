// ADR-0036 — the doctor's catalog report (resolve/catalogs.mjs): role impact of a missing skill,
// drift against the matrix, stale installed copies, duplicates, untriaged upstream skills, and the
// remediation each finding calls for. Read-only by construction: nothing here writes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { catalogReport, catalogSkills, skillDirHash, renderCatalogReport } from "../../../plugins/sdlc/tools/resolve/catalogs.mjs";

const SET = [
  "set: cat",
  "source: { homepage: h, catalog_version: '1.0.1', synced_at: '2026-09-28' }",
  "categories: {}",
  "skills:",
  "  - { id: sec, upstream_path: security/sec, category: c, summary: s, roles: { security-analyst: { policy: mandatory, when: w } } }",
  "  - { id: cli, upstream_path: devtools/cli, category: c, summary: s, requires_tools: [fakebin], roles: { developer: { when: w } } }",
  "  - { id: cam, upstream_path: media/cam, category: c, summary: s, roles: { developer: { when: w } } }",
  "  - { id: gone, upstream_path: x/gone, category: c, summary: s, unassigned: retired upstream }",
  "",
].join("\n");

function scratch() { return mkdtempSync(join(tmpdir(), "sdlc-catalogs-")); }
function skillDir(dir, body = "---\nname: x\n---\n") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body);
}

/** A catalog clone, a user skills root, a second root, and the dependency as the preflight merges it. */
function fixture(dir, { version = "1.0.1" } = {}) {
  writeFileSync(join(dir, "cat.yaml"), SET);
  const catalog = join(dir, "home", "catalog");
  skillDir(join(catalog, "security", "sec"), "sec v2");
  skillDir(join(catalog, "devtools", "cli"), "cli");
  skillDir(join(catalog, "media", "cam"), "cam");
  skillDir(join(catalog, "new", "deep", "fresh"), "fresh");          // upstream nesting varies
  mkdirSync(join(catalog, ".claude-plugin"), { recursive: true });    // metadata, never a skill
  writeFileSync(join(catalog, "version"), `${version}\n`);
  const user = join(dir, "user-skills");
  skillDir(join(user, "sec"), "sec v1");                              // installed before the update
  skillDir(join(user, "cli"), "cli");
  const other = join(dir, "other-plugin-skills");
  skillDir(join(other, "cli"), "someone else's cli");
  const dep = {
    name: "cat", kind: "skill-catalog", policy: "warn", skill_set_file: join(dir, "cat.yaml"),
    version_file: "$HOME/catalog/version", catalog_dir: "$HOME/catalog",
    skills_used: ["sec", "cli"],                                      // `cam` gated off in this project
    skill_tools: { cli: ["fakebin"] },
    install_command: ["cat add --all"], update_command: ["cat update --all"], alt_install_command: ["/plugin install cat@cat"],
  };
  return {
    dep, env: { HOME: join(dir, "home") },
    skillRoots: [{ root: user, kind: "user" }, { root: other, kind: "plugin", key: "other@m" }],
  };
}

test("catalogSkills finds nested skill dirs by id and ignores dot-dir metadata", () => {
  const dir = scratch();
  try {
    fixture(dir);
    assert.deepEqual(catalogSkills(join(dir, "home", "catalog")),
      { sec: "security/sec", cli: "devtools/cli", cam: "media/cam", fresh: "new/deep/fresh" });
    assert.deepEqual(catalogSkills(join(dir, "nowhere")), {});
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("skillDirHash covers every file, not just SKILL.md", () => {
  const dir = scratch();
  try {
    skillDir(join(dir, "a"), "same");
    skillDir(join(dir, "b"), "same");
    assert.equal(skillDirHash(join(dir, "a")), skillDirHash(join(dir, "b")));
    mkdirSync(join(dir, "b", "references"));
    writeFileSync(join(dir, "b", "references", "more.md"), "x");
    assert.notEqual(skillDirHash(join(dir, "a")), skillDirHash(join(dir, "b")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("report: missing skills name the roles they cost; gated-off skills are not missing", () => {
  const dir = scratch();
  try {
    const { dep, env, skillRoots } = fixture(dir);
    const status = { cat: { status: "missing", missing_skills: ["sec"], missing_tools: ["fakebin"], unavailable_skills: ["sec", "cli"] } };
    const roleExpertise = {
      "security-analyst": { skills: [{ skill: "sec", policy: "mandatory", requires: "cat" }] },
      developer: { skills: [{ skill: "cli", policy: "recommended", requires: "cat" }, { skill: "sec", policy: "mandatory" }] },
    };
    const [r] = catalogReport({ dependencies: [dep], status, skillRoots, roleExpertise, env, which: () => null });

    assert.equal(r.status, "degraded");
    assert.equal(r.assigned, 3);
    assert.equal(r.applicable, 2);
    assert.deepEqual(r.gated_off, ["cam"]);
    assert.deepEqual(r.assigned_missing, [{ skill: "sec", roles: [{ role: "security-analyst", policy: "mandatory" }] }],
      "a row without `requires: cat` is not the catalog's");
    assert.deepEqual(r.tool_blocked, [{ skill: "cli", tools: ["fakebin"], roles: [{ role: "developer", policy: "recommended" }] }]);
    assert.deepEqual(r.tools, [{ name: "fakebin", path: null, required_by: ["cli"] }], "no probe → no version key");
    assert.deepEqual(r.remediation.install, ["cat add --all"]);
    assert.deepEqual(r.remediation.alt_install, ["/plugin install cat@cat"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("report: stale copies, duplicates, untriaged and retired upstream skills, drift → update command", () => {
  const dir = scratch();
  try {
    const { dep, env, skillRoots } = fixture(dir, { version: "1.0.2" });
    const [r] = catalogReport({ dependencies: [dep], status: {}, skillRoots, env, which: () => "/bin/fakebin" });

    assert.equal(r.status, "available");
    assert.deepEqual(r.version, { installed: "1.0.2", matrix: "1.0.1", drift: true });
    assert.deepEqual(r.stale.map((x) => [x.skill, x.installed_at]), [
      ["sec", join(dir, "user-skills", "sec")],
      ["cli", join(dir, "other-plugin-skills", "cli")],
    ], "an identical copy is not stale; a differing one is, wherever it lives");
    assert.deepEqual(r.duplicate_roots, [{ skill: "cli", roots: [join(dir, "user-skills", "cli"), join(dir, "other-plugin-skills", "cli")] }]);
    assert.deepEqual(r.unknown_to_matrix, ["fresh"]);
    assert.deepEqual(r.removed_upstream, ["gone"]);
    assert.deepEqual(r.remediation.install, [], "nothing missing → no install command");
    assert.deepEqual(r.remediation.update, ["cat update --all"]);
    assert.match(r.remediation.rematrix, /re-triage/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("report: --probe asks each present tool for its version; the plain report never spawns", () => {
  const dir = scratch();
  try {
    const { dep, env, skillRoots } = fixture(dir);
    let spawned = 0;
    const version = () => { spawned += 1; return "fakebin 9.9"; };
    const [plain] = catalogReport({ dependencies: [dep], skillRoots, env, which: () => "/bin/fakebin", version });
    assert.equal(spawned, 0);
    assert.equal("version" in plain.tools[0], false);
    const [probed] = catalogReport({ dependencies: [dep], skillRoots, env, which: () => "/bin/fakebin", probe: true, version });
    assert.equal(probed.tools[0].version, "fakebin 9.9");
    const [absent] = catalogReport({ dependencies: [dep], skillRoots, env, which: () => null, probe: true, version });
    assert.equal(absent.tools[0].version, null, "an absent tool is not run");
    assert.equal(spawned, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("report: no catalog clone → nothing to compare, and nothing invented", () => {
  const dir = scratch();
  try {
    const { dep, skillRoots } = fixture(dir);
    const [r] = catalogReport({ dependencies: [dep, { name: "plain", policy: "warn" }], skillRoots, env: { HOME: join(dir, "elsewhere") }, which: () => null });
    assert.equal(r.catalog_present, false);
    assert.deepEqual([r.stale, r.unknown_to_matrix, r.removed_upstream], [[], [], []]);
    assert.equal(r.version.drift, false, "an unknown installed version is not drift");
    assert.equal(readdirSync(dir).includes("elsewhere"), false, "the report creates nothing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("render: the human section names roles, marks MANDATORY, and prints the fix", () => {
  const dir = scratch();
  try {
    const { dep, env, skillRoots } = fixture(dir);
    const status = { cat: { status: "missing", missing_skills: ["sec"], unavailable_skills: ["sec"] } };
    const roleExpertise = { "security-analyst": { skills: [{ skill: "sec", policy: "mandatory", requires: "cat" }] } };
    const text = renderCatalogReport(catalogReport({ dependencies: [dep], status, skillRoots, roleExpertise, env, which: () => null }));
    assert.match(text, /missing sec — security-analyst \(MANDATORY\)/);
    assert.match(text, /tool fakebin: ❌ not on PATH/);
    assert.match(text, /gated off here: cam/);
    assert.match(text, /fix:\n {6}cat add --all/);
    assert.equal(renderCatalogReport([]), "Skill catalogs: none declared by the installed plugins.");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
