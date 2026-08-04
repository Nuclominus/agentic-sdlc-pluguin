// Step 0a as code, including the boundary a subprocess cannot cross.
//
// The load-bearing test here is the per-SKILL one. Three consecutive real runs recorded
// `superpowers: available, missing_skills: []` while `thinking-deeply` existed in neither
// installed version — the aggregate looked healthy and the per-skill check never happened.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  enumerateSkills, skillsFromList, collectDependencies, computeDepsStatus,
  enforcePolicies, renderPreflightPrint, writeStamp, readStamp, preflight, stampIsFresh,
} from "../../../plugins/sdlc/tools/resolve/deps.mjs";

function scratch() { return mkdtempSync(join(tmpdir(), "sdlc-deps-")); }
function skill(root, name) {
  mkdirSync(join(root, "skills", name), { recursive: true });
  writeFileSync(join(root, "skills", name, "SKILL.md"), `---\nname: ${name}\n---\n`);
}
function deps(root, dependencies) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "runtime-dependencies.json"), JSON.stringify({ dependencies }));
}
const installsOf = (obj) => new Map(Object.entries(obj).map(([k, p]) => [k, { installPath: p, version: "1.0.0", scope: "user" }]));

test("a declared skill that the dependency does not ship is MISSING, per skill", () => {
  const dir = scratch();
  try {
    const sp = join(dir, "superpowers", "6.2.0");
    skill(sp, "test-driven-development");
    skill(sp, "verification-before-completion");           // note: no thinking-deeply
    deps(join(dir, "sdlc"), [{ name: "superpowers", policy: "warn", skills_used: ["thinking-deeply", "test-driven-development", "verification-before-completion"] }]);

    const installs = installsOf({ "superpowers@m": sp, "sdlc@m": join(dir, "sdlc") });
    const available = enumerateSkills({ installs, enabled: {} });
    const { dependencies } = collectDependencies({ installs, enabled: {} });
    const status = computeDepsStatus(dependencies, available);

    assert.equal(status.superpowers.status, "missing");
    assert.deepEqual(status.superpowers.missing_skills, ["thinking-deeply"],
      "the plugin being installed is not the same as every declared skill existing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a DISABLED plugin contributes no skills, even though they are on disk", () => {
  const dir = scratch();
  try {
    const sp = join(dir, "superpowers", "6.2.0");
    skill(sp, "test-driven-development");
    const installs = installsOf({ "superpowers@m": sp });
    const on = enumerateSkills({ installs, enabled: {} });
    const off = enumerateSkills({ installs, enabled: { "superpowers@m": false } });
    assert.ok(on.skills.has("superpowers:test-driven-development"));
    assert.equal(off.skills.size, 0, "disabled means not loaded, whatever the filesystem holds");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("user- and project-level skill roots are enumerated — the prose fallback is blind to both", () => {
  const dir = scratch();
  try {
    const configDir = join(dir, "cfg");
    const projectRoot = join(dir, "proj");
    skill(configDir, "android-cli");
    mkdirSync(join(projectRoot, ".claude"), { recursive: true });
    skill(join(projectRoot, ".claude"), "house-style");

    const av = enumerateSkills({ configDir, projectRoot });
    assert.ok(av.skills.has("android-cli"), "a user skill is invocable and must be counted");
    assert.ok(av.skills.has("user:android-cli"));
    assert.ok(av.skills.has("project:house-style"));
    assert.deepEqual(av.roots.map((r) => r.kind).sort(), ["project", "user"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a bare user skill of the same name satisfies a plugin dependency", () => {
  const dir = scratch();
  try {
    const configDir = join(dir, "cfg");
    skill(configDir, "test-driven-development");
    const av = enumerateSkills({ configDir });
    const status = computeDepsStatus([{ name: "superpowers", policy: "warn", skills_used: ["test-driven-development"] }], av);
    assert.equal(status.superpowers.status, "available");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the source of the skill list is reported, and fs says what it cannot see", () => {
  const fs = enumerateSkills({});
  assert.equal(fs.source, "fs");
  assert.ok(fs.fs_blind_to.length > 0, "an fs answer must name its blind spots");
  const mcp = skillsFromList("superpowers:brainstorming, superpowers:writing-plans");
  assert.equal(mcp.source, "mcp");
  assert.deepEqual(mcp.fs_blind_to, [], "an authoritative list has no blind spots");
  assert.ok(mcp.skills.has("superpowers:writing-plans"), "whitespace around entries is tolerated");
});

test("the strictest policy wins when two plugins declare the same dependency", () => {
  const dir = scratch();
  try {
    deps(join(dir, "a"), [{ name: "x", policy: "warn", skills_used: ["one"] }]);
    deps(join(dir, "b"), [{ name: "x", policy: "block", skills_used: ["two"] }]);
    const { dependencies } = collectDependencies({ installs: installsOf({ "a@m": join(dir, "a"), "b@m": join(dir, "b") }) });
    assert.equal(dependencies.length, 1);
    assert.equal(dependencies[0].policy, "block", "a warn must never soften somebody else's block");
    assert.deepEqual(dependencies[0].skills_used.sort(), ["one", "two"], "skill needs union rather than replace");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("policies: block aborts and aggregates, warn flags and speaks, degrade flags silently", () => {
  const status = {
    hard: { status: "missing", missing_skills: ["a"], policy: "block", install_command: ["/install hard"] },
    hard2: { status: "missing", missing_skills: ["b"], policy: "block", install_command: [] },
    soft: { status: "missing", missing_skills: ["c"], policy: "warn" },
    quiet: { status: "missing", missing_skills: ["d"], policy: "graceful-degrade" },
    fine: { status: "available", missing_skills: [] },
  };
  const r = enforcePolicies(status, { headless: true });
  assert.equal(r.abort, true);
  assert.deepEqual(r.blocking, ["hard", "hard2"], "all block failures aggregate: one exit, multiple grievances");
  assert.equal(r.stdout.filter((l) => l.startsWith("{")).length, 2, "one JSON object per blocking dep");
  assert.ok(r.stdout.includes("WARN: soft missing skills: c"));
  assert.ok(!r.stdout.some((l) => l.includes("quiet")), "graceful-degrade is silent by contract");
  assert.deepEqual(r.flags, { soft_unavailable: true, quiet_unavailable: true });
  assert.ok(!("hard_unavailable" in r.flags), "a blocking dep aborts rather than degrading");
});

test("the verbatim print is suppressed in headless mode and shaped in interactive mode", () => {
  const status = { superpowers: { status: "missing", missing_skills: ["thinking-deeply"], policy: "warn" } };
  assert.equal(renderPreflightPrint(status, { headless: true }), null);
  const out = renderPreflightPrint(status, { versions: { superpowers: ">=1.0.0" } });
  assert.match(out, /🔌 Dependency preflight:/);
  assert.match(out, /superpowers \(>=1\.0\.0, policy=warn\): ⚠️ degraded/);
  assert.match(out, /missing: thinking-deeply/);
  assert.equal(renderPreflightPrint({}), "🔌 Dependency preflight: no external dependencies declared.");
});

test("no stamp is written when a block policy aborted, so the next run re-scans", () => {
  const dir = scratch();
  try {
    const status = { x: { status: "missing", missing_skills: ["a"], policy: "block" } };
    assert.equal(writeStamp(dir, status, { aborted: true }), null);
    assert.equal(existsSync(join(dir, ".sdlc-deps-preflight.json")), false);

    writeStamp(dir, { x: { status: "available", missing_skills: [] } }, { now: "2026-08-04T00:00:00.000Z" });
    const stamp = readStamp(dir);
    assert.equal(stamp.all_satisfied, true);
    assert.deepEqual(stamp.results, { x: "available" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a stamp goes stale when a dependency's installed version moves", () => {
  // The real defect this closes: the documented invalidation triggers are /sdlc:doctor,
  // --force-preflight and a block abort — a dependency changing underneath the stamp is not
  // one of them. The stamp on this machine reads 2026-06-22 / all_satisfied, while
  // superpowers was reinstalled on 06-25 and updated on 07-24 with thinking-deeply absent.
  const versions = { superpowers: "6.2.0" };
  assert.equal(stampIsFresh({ all_satisfied: true, versions }, versions).fresh, true);

  const moved = stampIsFresh({ all_satisfied: true, versions: { superpowers: "6.1.1" } }, versions);
  assert.equal(moved.fresh, false);
  assert.match(moved.reason, /superpowers changed: stamped 6\.1\.1, installed 6\.2\.0/);

  const legacy = stampIsFresh({ all_satisfied: true, results: { superpowers: "available" } }, versions);
  assert.equal(legacy.fresh, false, "a stamp with no versions cannot be trusted");
  assert.match(legacy.reason, /predates version keying/);

  const dropped = stampIsFresh({ all_satisfied: true, versions: { gone: "1.0.0" } }, versions);
  assert.equal(dropped.fresh, false, "a dependency that is no longer declared also invalidates");
});

test("the written stamp carries the versions it was computed against", () => {
  const dir = scratch();
  try {
    writeStamp(dir, { x: { status: "available", missing_skills: [] } }, { versions: { x: "2.0.0" }, now: "2026-08-04T00:00:00.000Z" });
    const stamp = readStamp(dir);
    assert.deepEqual(stamp.versions, { x: "2.0.0" });
    assert.equal(stampIsFresh(stamp, { x: "2.0.0" }).fresh, true);
    assert.equal(stampIsFresh(stamp, { x: "2.0.1" }).fresh, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("preflight reports the fast path but never trusts it — the status is always recomputed", () => {
  const dir = scratch();
  try {
    const sp = join(dir, "sp");
    skill(sp, "kept");
    deps(join(dir, "sdlc"), [{ name: "sp", policy: "warn", skills_used: ["kept", "removed-upstream"] }]);
    const installs = installsOf({ "sp@m": sp, "sdlc@m": join(dir, "sdlc") });
    // A green stamp from before the skill disappeared.
    writeStamp(dir, { sp: { status: "available", missing_skills: [] } }, { versions: { sp: "0.9.0" }, now: "2026-06-22T00:00:00.000Z" });

    const r = preflight({ configDir: dir, installs, enabled: {} });
    assert.equal(r.cache_hit, false, "the stamped version no longer matches what is installed");
    assert.deepEqual(r.deps_preflight.sp.missing_skills, ["removed-upstream"],
      "a stale green stamp must not be able to report a missing skill as available");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("preflight end to end: an authoritative --skills list overrides the filesystem", () => {
  const dir = scratch();
  try {
    const sp = join(dir, "sp");
    skill(sp, "on-disk-only");
    deps(join(dir, "sdlc"), [{ name: "sp", policy: "warn", skills_used: ["on-disk-only"] }]);
    const installs = installsOf({ "sp@m": sp, "sdlc@m": join(dir, "sdlc") });

    const fromFs = preflight({ configDir: dir, installs, enabled: {} });
    assert.equal(fromFs.deps_preflight.sp.status, "available");
    assert.equal(fromFs.skills_source, "fs");

    const fromMcp = preflight({ configDir: dir, installs, enabled: {}, skills: "sp:something-else" });
    assert.equal(fromMcp.deps_preflight.sp.status, "missing", "the harness list is authoritative when supplied");
    assert.equal(fromMcp.skills_source, "mcp");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
