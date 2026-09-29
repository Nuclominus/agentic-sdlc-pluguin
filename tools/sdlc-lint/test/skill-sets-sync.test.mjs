// ADR-0036 — the maintainer sync (scripts/skill-sets.mjs): read a catalog directory, diff it against
// the matrix, and refresh ONLY the lines the script owns, so a sync diff shows the upstream change
// and nothing else. New skills arrive as TRIAGE, which lint then refuses until someone decides.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { readCatalog, diffCatalog, applyRefresh, guessCategory, summarize } from "../scripts/skill-sets.mjs";
import { validateSkillSet } from "../lib/skill-sets.mjs";

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "skill-sets.mjs");

const MATRIX = [
  "# hand-written header — must survive",
  "set: cat",
  "source:",
  "  homepage: h",
  '  catalog_version: "1.0.1"',
  '  synced_at: "2026-09-28"',
  "",
  "categories:",
  "  sec: { label: S, upstream: [security], roles: [security-analyst] }",
  "  play-a: { label: A, upstream: [play], roles: [developer] }",
  "  play-b: { label: B, upstream: [play], roles: [business-analyst] }",
  "",
  "skills:",
  "  # ---- security ----",
  "  - id: sec",
  "    upstream_path: security/sec",
  '    upstream_updated: "2026-09-01"',
  "    category: sec",
  "    summary: s",
  "    # a gate comment inside the entry",
  "    applies_if: { file_exists: x }",
  "    roles:",
  "      security-analyst: { policy: mandatory, when: before auditing }",
  "  - id: bill",
  "    upstream_path: play/old/bill",
  "    category: play-a",
  "    summary: b",
  "    roles:",
  "      developer: { when: when billing }",
  "  - id: gone",
  "    upstream_path: play/gone",
  "    category: play-a",
  "    summary: g",
  "    unassigned: retired",
  "  - id: dropped",
  "    upstream_path: play/dropped",
  "    category: play-a",
  "    summary: d",
  "    roles:",
  "      developer: { when: when dropping }",
  "",
].join("\n");

function skill(root, path, { updated, description = "Does a thing. Use when X." } = {}) {
  mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, path, "SKILL.md"),
    `---\nname: ${path.split("/").pop()}\ndescription: ${description}\n${updated ? `metadata:\n  last-updated: '${updated}'\n` : ""}---\n# body\n`);
}

/** Upstream moved on: sec re-dated, bill relocated, gone removed, fresh added, version bumped. */
function catalog(dir, { marketplace = true } = {}) {
  skill(dir, "security/sec", { updated: "2026-10-02" });
  skill(dir, "play/bill", { updated: "2026-09-05" });
  skill(dir, "play/fresh", { updated: "2026-10-01", description: "Integrate the Fresh API to verify things. Use when adding it." });
  writeFileSync(join(dir, "version"), "1.0.2\n");
  if (marketplace) {
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, ".claude-plugin", "marketplace.json"), JSON.stringify({ plugins: [{ skills: ["./security/sec", "./play/bill", "./play/fresh/"] }] }));
  }
  return dir;
}

const scratch = () => mkdtempSync(join(tmpdir(), "sdlc-skillsync-"));

test("readCatalog: marketplace paths, frontmatter date and description, version file; walk as fallback", () => {
  const dir = scratch();
  try {
    const c = readCatalog(catalog(join(dir, "c")));
    assert.equal(c.version, "1.0.2");
    assert.deepEqual(Object.keys(c.skills), ["bill", "fresh", "sec"]);
    assert.deepEqual(c.skills.sec, { upstream_path: "security/sec", updated: "2026-10-02", description: "Does a thing. Use when X." });
    const walked = readCatalog(catalog(join(dir, "w"), { marketplace: false }), { version: "9" });
    assert.deepEqual(Object.keys(walked.skills).sort(), ["bill", "fresh", "sec"]);
    assert.equal(walked.version, "9", "an explicit --version wins over the file");
    mkdirSync(join(dir, "empty"));
    assert.throws(() => readCatalog(join(dir, "empty")), /holds no skills/, "an empty catalog is not 'everything was removed'");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("diffCatalog: added, removed, moved, re-dated, and the version", () => {
  const dir = scratch();
  try {
    const d = diffCatalog(YAML.parse(MATRIX), readCatalog(catalog(dir)));
    assert.deepEqual(d.added.map((a) => a.id), ["fresh"]);
    assert.deepEqual(d.removed, ["dropped"], "gone upstream while a role still receives it: drift");
    assert.deepEqual(d.retired, ["gone"], "gone upstream but already kept unassigned: settled");
    assert.deepEqual(d.moved, [{ id: "bill", from: "play/old/bill", to: "play/bill" }]);
    assert.deepEqual(d.updated, [{ id: "bill", from: null, to: "2026-09-05" }, { id: "sec", from: "2026-09-01", to: "2026-10-02" }]);
    assert.deepEqual(d.catalog_version, { matrix: "1.0.1", catalog: "1.0.2", changed: true, unknown: false });
    assert.equal(d.in_sync, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("applyRefresh: touches only the owned lines, appends TRIAGE, never deletes a row", () => {
  const dir = scratch();
  try {
    const { text } = applyRefresh(MATRIX, readCatalog(catalog(dir)), { today: "2026-10-03" });
    const before = MATRIX.split("\n"), after = text.split("\n");
    const changed = before.filter((l) => !after.includes(l));
    assert.deepEqual(changed, [
      '  catalog_version: "1.0.1"', '  synced_at: "2026-09-28"', '    upstream_updated: "2026-09-01"', "    upstream_path: play/old/bill",
    ], "exactly four lines replaced — flow maps, comments and the header are byte-identical");
    assert.ok(after.includes('  catalog_version: "1.0.2"') && after.includes('  synced_at: "2026-10-03"'));
    const bill = after.indexOf("  - id: bill");
    assert.deepEqual(after.slice(bill + 1, bill + 3), ["    upstream_path: play/bill", '    upstream_updated: "2026-09-05"'],
      "a missing upstream_updated is inserted right after upstream_path");
    assert.ok(after.includes("  - id: gone"), "a skill gone upstream is reported, not deleted");

    const doc = YAML.parse(text);
    const fresh = doc.skills.find((s) => s.id === "fresh");
    assert.deepEqual(fresh, {
      id: "fresh", upstream_path: "play/fresh", upstream_updated: "2026-10-01", category: "play-a",
      summary: "Integrate the Fresh API to verify things",
      unassigned: "TRIAGE — new in 1.0.2; upstream 'play' fits play-a | play-b — pick one",
    });
    const errs = validateSkillSet(doc, { coreRoles: ["developer", "business-analyst", "security-analyst"] });
    assert.ok(errs.some((e) => /fresh/.test(e) && /TRIAGE/.test(e)), "lint refuses the sync until the new skill is triaged");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("applyRefresh: a catalog already in sync returns the text unchanged", () => {
  const dir = scratch();
  try {
    const c = readCatalog(catalog(dir));
    const once = applyRefresh(MATRIX, c, { today: "2026-10-03" }).text;
    const twice = applyRefresh(once, { ...c, skills: Object.fromEntries(Object.entries(c.skills).filter(([id]) => id !== "gone")) }, { today: "2099-01-01" });
    assert.equal(twice.diff.added.length, 0);
    assert.equal(twice.text.split("\n").filter((l) => /TRIAGE \(sync/.test(l)).length, 1, "idempotent: no second TRIAGE block");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("guessCategory and summarize", () => {
  const cats = { a: { upstream: ["play"] }, b: { upstream: ["play"] }, c: { upstream: ["tv"] } };
  assert.deepEqual(guessCategory(cats, "tv/leanback"), { category: "c", candidates: ["c"], top: "tv" });
  assert.deepEqual(guessCategory(cats, "xr/glasses").candidates, []);
  assert.equal(summarize("One. Two."), "One");
  assert.equal(summarize("x".repeat(200)).length, 120);
  assert.equal(summarize(""), "(no upstream description)");
});

test("CLI: diff --exit-code signals drift; refresh writes; the live matrix is in sync with its own tables", () => {
  const dir = scratch();
  try {
    const repo = join(dir, "repo");
    mkdirSync(join(repo, "sets"), { recursive: true });
    writeFileSync(join(repo, "sets", "cat.yaml"), MATRIX);
    const cat = catalog(join(dir, "c"));
    const run = (...a) => spawnSync(process.execPath, [SCRIPT, ...a, "--set", "sets/cat.yaml", "--catalog", cat], { cwd: repo, encoding: "utf8" });
    const d = run("diff", "--json", "--exit-code");
    assert.equal(d.status, 1);
    assert.equal(JSON.parse(d.stdout).removed[0], "dropped");
    const r = run("refresh", "--today", "2026-10-03");
    assert.equal(r.status, 0);
    assert.match(readFileSync(join(repo, "sets", "cat.yaml"), "utf8"), /TRIAGE — new in 1\.0\.2/);
    assert.match(r.stdout, /1 skill\(s\) appended as TRIAGE/);
    assert.equal(spawnSync(process.execPath, [SCRIPT, "bogus"], { encoding: "utf8" }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- review of #228 ---------------------------------------------------------------------------

test("a row kept unassigned after upstream dropped it does not hold the matrix out of sync forever", () => {
  const dir = scratch();
  try {
    const c = readCatalog(catalog(dir));
    // Resolve everything the way the command would: refresh, triage `fresh`, keep `dropped` unassigned.
    const refreshed = applyRefresh(MATRIX, c, { today: "2026-10-03" }).text
      .replace(/unassigned: "TRIAGE[^"]*"/, 'unassigned: "not for this marketplace"')
      .replace("    roles:\n      developer: { when: when dropping }", '    unassigned: "gone upstream in 1.0.2"');
    const d = diffCatalog(YAML.parse(refreshed), c);
    assert.deepEqual(d.retired, ["dropped", "gone"]);
    assert.equal(d.in_sync, true, "settled rows are not drift");
    assert.equal(applyRefresh(refreshed, c, { today: "2099-01-01" }).text, refreshed, "so a refresh is a no-op — synced_at stays put");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refresh refuses a catalog without a version rather than move synced_at alone", () => {
  const dir = scratch();
  try {
    const c = { ...readCatalog(catalog(dir)), version: null };
    const d = diffCatalog(YAML.parse(MATRIX), c);
    assert.equal(d.catalog_version.unknown, true);
    assert.throws(() => applyRefresh(MATRIX, c, { today: "2026-10-03" }), /no version .* pass --version/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("two upstream skills with one directory name are reported as a collision, never merged", () => {
  const dir = scratch();
  try {
    const cat = catalog(dir);
    skill(cat, "xr/sec", { updated: "2026-10-05" });
    const mk = JSON.parse(readFileSync(join(cat, ".claude-plugin", "marketplace.json"), "utf8"));
    mk.plugins[0].skills.push("./xr/sec");
    writeFileSync(join(cat, ".claude-plugin", "marketplace.json"), JSON.stringify(mk));
    const c = readCatalog(cat);
    assert.deepEqual(c.collisions, [{ id: "sec", paths: ["security/sec", "xr/sec"] }]);
    assert.equal(c.skills.sec.upstream_path, "security/sec", "the first path is kept, not silently replaced");
    const d = diffCatalog(YAML.parse(MATRIX), c);
    assert.equal(d.in_sync, false);
    assert.deepEqual(d.moved.filter((m) => m.id === "sec"), [], "the existing row does not read as moved");
    assert.throws(() => applyRefresh(MATRIX, c, { today: "2026-10-03" }), /more than one skill under the same id — sec: security\/sec, xr\/sec/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
