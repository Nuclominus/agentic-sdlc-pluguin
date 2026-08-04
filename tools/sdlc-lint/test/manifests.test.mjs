// Tests for the shipped manifest loader — the two modes, and the enablement rules that
// close the open half of planning/backlog "Track H — plugin discovery correctness".
//
// The rules under test are not invented; each mirrors something observed on a real machine
// and is named in the assertion so a future change has to argue with the evidence.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadManifestsFromTree, loadInstalledManifests, readEnabledPlugins, readInstalledPlugins,
} from "../../../plugins/sdlc/tools/resolve/manifests.mjs";

const REPO = new URL("../../../", import.meta.url).pathname;

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-manifests-"));
  return dir;
}
function write(file, content) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}
function manifest(stack, kind = "foundation", extra = "") {
  return `kind: ${kind}\nstack: ${stack}\npriority: 100\n${extra}`;
}

/** A config dir with a plugin cache holding several versions, like a real machine. */
function fakeConfig(dir, { installs, enabled, projectEnabled }) {
  const cfg = join(dir, "config");
  write(join(cfg, "settings.json"), { enabledPlugins: enabled ?? {} });
  write(join(cfg, "plugins", "installed_plugins.json"), { version: 2, plugins: installs });
  if (projectEnabled) write(join(dir, "project", ".claude", "settings.json"), { enabledPlugins: projectEnabled });
  return { configDir: cfg, projectRoot: join(dir, "project") };
}

test("tree mode: reads every manifest in a marketplace checkout", () => {
  const { foundations, frameworks } = loadManifestsFromTree(REPO);
  assert.ok(foundations.some((f) => f.doc.stack === "android"), "the android foundation should be found");
  assert.ok(frameworks.length >= 3, `expected several frameworks, got ${frameworks.length}`);
});

test("tree mode is NOT the production answer: it sees plugins no consumer installed", () => {
  const { frameworks } = loadManifestsFromTree(REPO);
  const stacks = frameworks.map((f) => f.doc.stack);
  // datastore-proto lives in the marketplace tree and was not installed on the machine where
  // ADR-0019's pre-implementation check ran. Seeing it here is correct for the tree loader
  // and was the wrong answer for a real project — the reason the root is a parameter.
  assert.ok(stacks.includes("datastore-proto"), "the tree carries uninstalled plugins by design");
});

test("installed mode: resolves the exact installPath, never a cache glob", () => {
  const dir = scratch();
  try {
    const p17 = join(dir, "cache", "android-foundation", "1.7.0");
    const p14 = join(dir, "cache", "android-foundation", "1.4.0");
    write(join(p17, "manifest.yaml"), manifest("android"));
    write(join(p14, "manifest.yaml"), manifest("android-STALE"));
    const { configDir } = fakeConfig(dir, {
      installs: { "android-foundation@m": [{ scope: "user", installPath: p17, version: "1.7.0" }] },
      enabled: { "android-foundation@m": true },
    });
    const r = loadInstalledManifests({ configDir });
    assert.equal(r.foundations.length, 1, "the stale cached version must not be loaded");
    assert.equal(r.foundations[0].doc.stack, "android");
    assert.equal(r.foundations[0].version, "1.7.0");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("installed mode: an explicitly disabled plugin is SKIPPED and REPORTED, not dropped", () => {
  const dir = scratch();
  try {
    const p = join(dir, "cache", "off", "1.0.0");
    write(join(p, "manifest.yaml"), manifest("off"));
    const { configDir } = fakeConfig(dir, {
      installs: { "off@m": [{ scope: "user", installPath: p, version: "1.0.0" }] },
      enabled: { "off@m": false },
    });
    const r = loadInstalledManifests({ configDir });
    assert.equal(r.foundations.length, 0);
    assert.equal(r.skipped.length, 1, "a disabled foundation must be visible to the caller");
    assert.equal(r.skipped[0].reason, "disabled");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("absent from enabledPlugins is ENABLED, not disabled", () => {
  // Measured: both real consumer projects list only frontend-design/atlassian/github in
  // project settings, while sdlc@agentic-sdlc — active in every run — appears only in the
  // user settings. Treating absence as disabled would switch the pipeline off entirely.
  const dir = scratch();
  try {
    const p = join(dir, "cache", "quiet", "1.0.0");
    write(join(p, "manifest.yaml"), manifest("quiet"));
    const { configDir } = fakeConfig(dir, {
      installs: { "quiet@m": [{ scope: "user", installPath: p, version: "1.0.0" }] },
      enabled: { "someone-else@m": true },
    });
    const r = loadInstalledManifests({ configDir });
    assert.equal(r.foundations.length, 1, "a plugin absent from enabledPlugins stays enabled");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("project settings ADD to enabledPlugins; they do not replace the user map", () => {
  const dir = scratch();
  const { configDir, projectRoot } = fakeConfig(dir, {
    installs: {},
    enabled: { "a@m": true, "b@m": true },
    projectEnabled: { "c@m": true, "b@m": false },
  });
  const merged = readEnabledPlugins({ configDir, projectRoot });
  assert.equal(merged["a@m"], true, "user entries survive");
  assert.equal(merged["c@m"], true, "project entries are added");
  assert.equal(merged["b@m"], false, "project wins on a key both set");
  rmSync(dir, { recursive: true, force: true });
});

test("the most specific install scope wins, and a path conflict is reported", () => {
  const dir = scratch();
  try {
    const user = join(dir, "cache", "x", "1.0.0");
    const proj = join(dir, "cache", "x", "2.0.0");
    write(join(user, "manifest.yaml"), manifest("x-user"));
    write(join(proj, "manifest.yaml"), manifest("x-project"));
    const { configDir } = fakeConfig(dir, {
      installs: { "x@m": [
        { scope: "user", installPath: user, version: "1.0.0" },
        { scope: "project", installPath: proj, version: "2.0.0" },
      ] },
      enabled: {},
    });
    const { installs, conflicts } = readInstalledPlugins({ configDir });
    assert.equal(installs.get("x@m").scope, "project");
    assert.equal(conflicts.length, 1, "disagreeing scopes must not resolve silently");
    assert.equal(conflicts[0].chosen, proj);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a development checkout loaded from a path still resolves", () => {
  const dir = scratch();
  try {
    const dev = join(dir, "dev-plugin");
    write(join(dev, "manifest.yaml"), manifest("dev-stack"));
    const { configDir } = fakeConfig(dir, { installs: {}, enabled: {} });
    const r = loadInstalledManifests({ configDir, extraRoots: [dev] });
    assert.equal(r.foundations.length, 1);
    assert.equal(r.foundations[0].scope, "path");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an install entry whose directory carries no manifest is simply not an SDLC plugin", () => {
  const dir = scratch();
  try {
    const p = join(dir, "cache", "unrelated", "1.0.0");
    mkdirSync(p, { recursive: true });
    const { configDir } = fakeConfig(dir, {
      installs: { "unrelated@m": [{ scope: "user", installPath: p, version: "1.0.0" }] },
      enabled: {},
    });
    const r = loadInstalledManifests({ configDir });
    assert.equal(r.foundations.length + r.frameworks.length + r.errors.length, 0);
    assert.equal(r.skipped.length, 0, "a plugin without a manifest is not a skip, it is unrelated");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a missing installed_plugins.json is reported, not thrown on", () => {
  const dir = scratch();
  try {
    const r = loadInstalledManifests({ configDir: join(dir, "nowhere") });
    assert.equal(r.installs_present, false);
    assert.deepEqual(r.foundations, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a malformed manifest becomes an error record, never an exception", () => {
  const dir = scratch();
  try {
    const p = join(dir, "cache", "bad", "1.0.0");
    write(join(p, "manifest.yaml"), "kind: foundation\n\tstack: tabs-are-invalid\n");
    const { configDir } = fakeConfig(dir, {
      installs: { "bad@m": [{ scope: "user", installPath: p, version: "1.0.0" }] },
      enabled: {},
    });
    const r = loadInstalledManifests({ configDir });
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].error, /parse:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
