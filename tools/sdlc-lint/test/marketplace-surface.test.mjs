// ADR-0028: a marketplace entry means "this repo redistributes this plugin". The two entries this
// rule exists to forbid were real and shipped for months — `superpowers` (source: url ->
// obra/superpowers.git) and `security-guidance` (source: git-subdir -> claude-plugins-official),
// which Claude Code cloned into our namespace as `<name>@agentic-sdlc`, producing a second install
// of a plugin we never authored. This test pins both sides: the shipped tree is clean, and each
// foreign source shape fails with a message naming the shadowing it causes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMarketplaceSurface } from "../lib/marketplace-surface.mjs";

const REPO = join(import.meta.dirname, "..", "..", "..");

function scratch() { return mkdtempSync(join(tmpdir(), "sdlc-marketplace-surface-")); }
function seed(root, plugins, dirs = []) {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "agentic-sdlc", plugins }));
  for (const d of dirs) mkdirSync(join(root, "plugins", d), { recursive: true });
}
const failures = (rows) => rows.filter((r) => !r.ok);

test("the shipped marketplace lists only plugins this repo owns", () => {
  const rows = checkMarketplaceSurface(REPO);
  assert.deepEqual(failures(rows), [], "every entry must be a local ./plugins/<name>");
  assert.ok(rows.length >= 2, "expected at least sdlc and android-foundation");
});

test("a foreign `url` source FAILS — this is the superpowers@agentic-sdlc defect", () => {
  const root = scratch();
  try {
    seed(root, [
      { name: "sdlc", source: "./plugins/sdlc" },
      { name: "superpowers", source: { source: "url", url: "https://github.com/obra/superpowers.git" } },
    ], ["sdlc"]);
    const bad = failures(checkMarketplaceSurface(root));
    assert.equal(bad.length, 1);
    assert.match(bad[0].file, /superpowers/);
    assert.match(bad[0].errors[0], /superpowers@agentic-sdlc/);
    assert.match(bad[0].errors[0], /runtime-dependencies\.json/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a foreign `git-subdir` source FAILS — this is the security-guidance defect", () => {
  const root = scratch();
  try {
    seed(root, [{
      name: "security-guidance",
      source: { source: "git-subdir", url: "https://github.com/anthropics/claude-plugins-official.git", path: "plugins/security-guidance" },
    }]);
    const bad = failures(checkMarketplaceSurface(root));
    assert.equal(bad.length, 1);
    assert.match(bad[0].errors[0], /git-subdir/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a local source whose directory does not exist FAILS", () => {
  const root = scratch();
  try {
    seed(root, [{ name: "ghost", source: "./plugins/ghost" }]);
    const bad = failures(checkMarketplaceSurface(root));
    assert.equal(bad.length, 1);
    assert.match(bad[0].errors[0], /names no directory on disk/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a local source that does not match its entry name FAILS", () => {
  const root = scratch();
  try {
    seed(root, [{ name: "sdlc", source: "./plugins/core" }], ["core"]);
    const bad = failures(checkMarketplaceSurface(root));
    assert.equal(bad.length, 1);
    assert.match(bad[0].errors[0], /expected "\.\/plugins\/sdlc"/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a missing or unparseable manifest is reported, not thrown", () => {
  const root = scratch();
  try {
    assert.match(checkMarketplaceSurface(root)[0].errors[0], /not found/);
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "marketplace.json"), "{ not json");
    assert.match(checkMarketplaceSurface(root)[0].errors[0], /not valid JSON/);
    writeFileSync(join(root, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "x" }));
    assert.match(checkMarketplaceSurface(root)[0].errors[0], /missing or not an array/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
