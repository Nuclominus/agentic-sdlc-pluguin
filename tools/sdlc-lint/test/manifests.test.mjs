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
  loadManifestsFromTree, loadInstalledManifests, readEnabledPlugins, readInstalledPlugins, mergePathLoaded,
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

// Issue #164 — the path-load case, and the shadowing it must not create.
//
// The repro that opened the issue: `CLAUDE_PLUGIN_ROOT=$PWD/plugins/sdlc` with an empty config
// dir halted at "Workflow 'default' not found. Available: (none)" while default.yaml sat next to
// the code printing the halt. `vanilla` ships in that very plugin, so "none installed" was wrong
// whenever the plugin itself was the thing loaded.

test("a path-loaded plugin joins the installs map under its own name", () => {
  const dir = scratch();
  try {
    const dev = join(dir, "sdlc");
    write(join(dev, "manifest.yaml"), manifest("vanilla"));
    write(join(dev, ".claude-plugin", "plugin.json"), { name: "sdlc", version: "2.4.1" });
    const merged = mergePathLoaded(new Map(), [dev]);
    assert.deepEqual([...merged.keys()], ["sdlc@path"]);
    assert.equal(merged.get("sdlc@path").installPath, dev);
    assert.equal(merged.get("sdlc@path").version, "2.4.1", "the version comes from plugin.json, not from a guess");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a path load REPLACES the installed copy of the same plugin, keeping its key", () => {
  // Two roots of one plugin would both be read, and two `vanilla` foundations of equal priority
  // make stack detection a coin toss decided by iteration order. Keeping the registered key is
  // what keeps an enabledPlugins entry — and every plugin:skill label — pointing at the same
  // plugin it did before.
  const dir = scratch();
  try {
    const cached = join(dir, "cache", "sdlc", "2.4.0");
    const dev = join(dir, "checkout", "sdlc");
    write(join(cached, "manifest.yaml"), manifest("vanilla"));
    write(join(dev, "manifest.yaml"), manifest("vanilla"));
    write(join(dev, ".claude-plugin", "plugin.json"), { name: "sdlc", version: "2.4.1" });
    const installs = new Map([["sdlc@m", { installPath: cached, version: "2.4.0", scope: "user" }]]);
    const merged = mergePathLoaded(installs, [dev]);
    assert.deepEqual([...merged.keys()], ["sdlc@m"], "one plugin, one entry");
    assert.equal(merged.get("sdlc@m").installPath, dev, "the tree being edited wins over the installed copy");
    assert.deepEqual(merged.get("sdlc@m").shadows, [cached], "and the copy it displaced is reported, not dropped silently");
    assert.equal(merged.get("sdlc@m").version, "2.4.1");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a path load alongside a cache install of the same plugin yields ONE foundation", () => {
  const dir = scratch();
  try {
    const cached = join(dir, "cache", "sdlc", "2.4.0");
    const dev = join(dir, "checkout", "sdlc");
    write(join(cached, "manifest.yaml"), manifest("vanilla"));
    write(join(dev, "manifest.yaml"), manifest("vanilla"));
    write(join(dev, ".claude-plugin", "plugin.json"), { name: "sdlc", version: "2.4.1" });
    const { configDir } = fakeConfig(dir, {
      installs: { "sdlc@m": [{ scope: "user", installPath: cached, version: "2.4.0" }] },
      enabled: {},
    });
    const r = loadInstalledManifests({ configDir, extraRoots: [dev] });
    assert.equal(r.foundations.length, 1, "duplicate-priority vanilla is exactly the ambiguity this must not create");
    assert.equal(r.foundations[0].file, join(dev, "manifest.yaml"));
    assert.equal(r.foundations[0].scope, "path");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an enabledPlugins veto on the registered key does NOT disable an explicitly path-loaded copy", () => {
  // Disabling the installed copy before running the checkout with --plugin-dir is the natural
  // thing to do, and the replacement inherits the registered key — so honouring the veto here
  // restored the #164 halt in exactly the setup the fix exists for. `enabledPlugins` governs the
  // registered install; pointing the harness at a directory IS enabling that directory.
  const dir = scratch();
  try {
    const cached = join(dir, "cache", "sdlc", "2.4.0");
    const dev = join(dir, "checkout", "sdlc");
    write(join(cached, "manifest.yaml"), manifest("vanilla"));
    write(join(dev, "manifest.yaml"), manifest("vanilla"));
    write(join(dev, ".claude-plugin", "plugin.json"), { name: "sdlc", version: "2.4.1" });
    const { configDir } = fakeConfig(dir, {
      installs: { "sdlc@m": [{ scope: "user", installPath: cached, version: "2.4.0" }] },
      enabled: { "sdlc@m": false },
    });
    const r = loadInstalledManifests({ configDir, extraRoots: [dev] });
    assert.equal(r.foundations.length, 1, "the checkout the harness was pointed at must still resolve");
    assert.equal(r.foundations[0].scope, "path");
    assert.equal(r.skipped.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Findings 3 and 4 of the review of #166.

test("an undeclared path root never replaces a registered plugin of the same directory name", () => {
  // identifyRoot falls back to basename. A checkout sitting in a directory called `superpowers`
  // must not take over `superpowers@obra`, whose skills/ the dependency preflight would then
  // look for in the wrong tree and report as missing on a plugin that is installed and fine.
  const dir = scratch();
  try {
    const real = join(dir, "cache", "superpowers", "6.2.0");
    const impostor = join(dir, "checkout", "superpowers");
    write(join(real, "manifest.yaml"), manifest("sp"));
    write(join(impostor, "manifest.yaml"), manifest("sp"));   // no .claude-plugin/plugin.json
    const installs = new Map([["superpowers@obra", { installPath: real, version: "6.2.0", scope: "user" }]]);
    const merged = mergePathLoaded(installs, [impostor]);
    assert.equal(merged.get("superpowers@obra").installPath, real, "the registered install keeps its path");
    assert.equal(merged.get("superpowers@path").installPath, impostor, "the checkout resolves as a plugin of its own");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a plugin installed from two marketplaces collapses to the path load, not to a tie", () => {
  // Replacing only the FIRST match leaves the second pointing at its own copy, and both then
  // contribute a `vanilla` foundation of equal priority — the coin toss the replacement exists
  // to remove, reintroduced by a `find` where a `filter` was needed.
  const dir = scratch();
  try {
    const a = join(dir, "cache", "a", "sdlc", "2.4.0");
    const b = join(dir, "cache", "b", "sdlc", "2.4.0");
    const dev = join(dir, "checkout", "sdlc");
    for (const p of [a, b, dev]) write(join(p, "manifest.yaml"), manifest("vanilla"));
    write(join(dev, ".claude-plugin", "plugin.json"), { name: "sdlc", version: "2.4.1" });
    const { configDir } = fakeConfig(dir, {
      installs: {
        "sdlc@mkt-a": [{ scope: "user", installPath: a, version: "2.4.0" }],
        "sdlc@mkt-b": [{ scope: "user", installPath: b, version: "2.4.0" }],
      },
      enabled: {},
    });
    const merged = mergePathLoaded(new Map([
      ["sdlc@mkt-a", { installPath: a, version: "2.4.0", scope: "user" }],
      ["sdlc@mkt-b", { installPath: b, version: "2.4.0", scope: "user" }],
    ]), [dev]);
    assert.deepEqual([...merged.keys()], ["sdlc@mkt-a"], "the duplicate key is dropped, not left pointing elsewhere");
    assert.deepEqual(merged.get("sdlc@mkt-a").shadows, [a, b], "and both displaced copies are reported");

    const r = loadInstalledManifests({ configDir, extraRoots: [dev] });
    assert.equal(r.foundations.length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a path root that declares no version keeps the version the registry knew", () => {
  // Overwriting it with null makes dependencyVersions() report an unknown version for a plugin
  // the registry had pinned, and invalidates the preflight stamp's fast path on every run.
  const dir = scratch();
  try {
    const cached = join(dir, "cache", "sdlc", "2.4.0");
    const dev = join(dir, "checkout", "sdlc");
    write(join(cached, "manifest.yaml"), manifest("vanilla"));
    write(join(dev, "manifest.yaml"), manifest("vanilla"));
    write(join(dev, ".claude-plugin", "plugin.json"), { name: "sdlc" });   // name, no version
    const merged = mergePathLoaded(new Map([["sdlc@m", { installPath: cached, version: "2.4.0", scope: "user" }]]), [dev]);
    assert.equal(merged.get("sdlc@m").version, "2.4.0");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- ADR-0026: embedded frameworks (Story 2 — the dual-mode equality test) ----------------
//
// The whole point of the merge: tree mode (globs plugins/**/manifest.yaml) and installed mode
// (reads exactly one manifest per installPath) MUST resolve the identical additive set from a
// foundation's embedded `frameworks:` array. A file-move-only implementation would pass this
// test today (before any file moves) and then silently regress it the moment the synthesis
// logic diverges between the two loaders — which is exactly the trap `manifests.mjs:10-13`
// already documents once happening for real.
const SEVEN_FRAMEWORKS = ["retrofit", "ktor", "room", "datastore-proto", "dagger", "koin", "workmanager"];

function embeddedFoundationManifest() {
  const rows = SEVEN_FRAMEWORKS.map((stack) => `  - stack: ${stack}
    enriches_aspect: network
    dependency: com.example.${stack}
    convention_skills: [android-foundation:${stack}-conventions]
    phase_injections:
      development: "${stack} guidance"
`).join("");
  return `kind: foundation\nstack: android\npriority: 300\ndetect:\n  any:\n    - file_exists: settings.gradle.kts\nframeworks:\n${rows}`;
}

test("Story 2: tree mode and installed mode resolve the identical embedded-framework set", () => {
  const dir = scratch();
  try {
    // Tree mode fixture: a bare marketplace checkout with one foundation manifest.
    const treeRoot = join(dir, "tree");
    write(join(treeRoot, "plugins", "android-foundation", "manifest.yaml"), embeddedFoundationManifest());

    // Installed mode fixture: the same single manifest, at its installPath.
    const installPath = join(dir, "installed", "android-foundation");
    write(join(installPath, "manifest.yaml"), embeddedFoundationManifest());
    const { configDir } = fakeConfig(dir, {
      installs: { "android-foundation@m": [{ scope: "user", installPath, version: "1.0.0" }] },
      enabled: { "android-foundation@m": true },
    });

    const tree = loadManifestsFromTree(treeRoot);
    const installed = loadInstalledManifests({ configDir });

    assert.equal(tree.foundations.length, 1);
    assert.equal(installed.foundations.length, 1);

    const treeStacks = tree.frameworks.map((f) => f.doc.stack).sort();
    const installedStacks = installed.frameworks.map((f) => f.doc.stack).sort();
    assert.deepEqual(treeStacks, [...SEVEN_FRAMEWORKS].sort(), "tree mode must expand all 7 rows");
    assert.deepEqual(installedStacks, [...SEVEN_FRAMEWORKS].sort(), "installed mode must expand all 7 rows");
    assert.deepEqual(treeStacks, installedStacks, "tree and installed mode must resolve the identical additive set");

    for (const stack of SEVEN_FRAMEWORKS) {
      const t = tree.frameworks.find((f) => f.doc.stack === stack);
      const i = installed.frameworks.find((f) => f.doc.stack === stack);
      assert.equal(t.doc.kind, "framework", `${stack}: synthesized record must carry kind: framework`);
      assert.equal(i.doc.kind, "framework");
      assert.deepEqual(t.doc, i.doc, `${stack}: synthesized doc must be identical in both modes`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Story 1/4: an embedded row's synthesized record carries dependency + enriches_aspect for gated activation", () => {
  const dir = scratch();
  try {
    const installPath = join(dir, "installed", "android-foundation");
    write(join(installPath, "manifest.yaml"), embeddedFoundationManifest());
    const { configDir } = fakeConfig(dir, {
      installs: { "android-foundation@m": [{ scope: "user", installPath, version: "1.0.0" }] },
      enabled: { "android-foundation@m": true },
    });
    const { frameworks } = loadInstalledManifests({ configDir });
    const retrofit = frameworks.find((f) => f.doc.stack === "retrofit");
    assert.equal(retrofit.doc.dependency, "com.example.retrofit");
    assert.equal(retrofit.doc.enriches_aspect, "network");
    assert.deepEqual(retrofit.doc.convention_skills, ["android-foundation:retrofit-conventions"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("edge case 1: a stale standalone copy of an embedded framework is shadowed, not duplicated", () => {
  const dir = scratch();
  try {
    const foundationPath = join(dir, "installed", "android-foundation");
    write(join(foundationPath, "manifest.yaml"), embeddedFoundationManifest());
    const stalePath = join(dir, "installed", "retrofit-plugin");
    write(join(stalePath, "manifest.yaml"), `kind: framework\nstack: retrofit\npriority: 150\nenriches_aspect: network\ndependency: com.squareup.retrofit2\n`);
    const { configDir } = fakeConfig(dir, {
      installs: {
        "android-foundation@m": [{ scope: "user", installPath: foundationPath, version: "1.0.0" }],
        "retrofit-plugin@m": [{ scope: "user", installPath: stalePath, version: "0.9.0" }],
      },
      enabled: { "android-foundation@m": true, "retrofit-plugin@m": true },
    });
    const { frameworks, shadowed_frameworks } = loadInstalledManifests({ configDir });
    const retrofits = frameworks.filter((f) => f.doc.stack === "retrofit");
    assert.equal(retrofits.length, 1, "must not double-attach the same stack");
    assert.equal(retrofits[0].file, join(foundationPath, "manifest.yaml"), "the embedded row wins");
    assert.equal(shadowed_frameworks.length, 1);
    assert.equal(shadowed_frameworks[0].stack, "retrofit");
    assert.equal(shadowed_frameworks[0].reason, "superseded-by-embedded");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Every optional `frameworks[]` row key is passed through `synthesizeEmbeddedFrameworks`
// behind its own `!== undefined` guard (manifests.mjs:72-77). SEVEN_FRAMEWORKS/
// embeddedFoundationManifest() above only ever sets `convention_skills` + `phase_injections`,
// so a dropped or misnamed key among `priority`, `extra_phases`, `pre_phase_commands` or
// `post_pipeline_checks` would silently strip that framework's guidance without failing any
// existing test. Exercise all six optional keys on one row, plus a second row that omits them
// all, to also confirm the guard truly omits absent keys rather than writing them as
// `undefined`.
test("synthesized embedded-framework record passes through every optional row key, and omits absent ones", () => {
  const dir = scratch();
  try {
    const installPath = join(dir, "installed", "android-foundation");
    write(join(installPath, "manifest.yaml"), `kind: foundation
stack: android
priority: 300
detect:
  any:
    - file_exists: settings.gradle.kts
frameworks:
  - stack: retrofit
    enriches_aspect: network
    dependency: com.example.retrofit
    priority: 150
    convention_skills: [android-foundation:retrofit-conventions]
    phase_injections:
      development: "retrofit guidance"
    extra_phases: [contract-test]
    pre_phase_commands: ["echo pre"]
    post_pipeline_checks: ["echo post"]
  - stack: ktor
    enriches_aspect: network
    dependency: com.example.ktor
`);
    const { configDir } = fakeConfig(dir, {
      installs: { "android-foundation@m": [{ scope: "user", installPath, version: "1.0.0" }] },
      enabled: { "android-foundation@m": true },
    });
    const { frameworks } = loadInstalledManifests({ configDir });

    const retrofit = frameworks.find((f) => f.doc.stack === "retrofit");
    assert.equal(retrofit.doc.priority, 150, "priority must pass through");
    assert.deepEqual(retrofit.doc.extra_phases, ["contract-test"], "extra_phases must pass through");
    assert.deepEqual(retrofit.doc.pre_phase_commands, ["echo pre"], "pre_phase_commands must pass through");
    assert.deepEqual(retrofit.doc.post_pipeline_checks, ["echo post"], "post_pipeline_checks must pass through");
    assert.deepEqual(retrofit.doc.convention_skills, ["android-foundation:retrofit-conventions"]);
    assert.deepEqual(retrofit.doc.phase_injections, { development: "retrofit guidance" });

    const ktor = frameworks.find((f) => f.doc.stack === "ktor");
    for (const key of ["priority", "convention_skills", "phase_injections", "extra_phases", "pre_phase_commands", "post_pipeline_checks"]) {
      assert.equal(key in ktor.doc, false, `absent optional key "${key}" must not be synthesized as undefined`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- ADR-0026 follow-ups: de-dup determinism and reason accuracy -------------------------
//
// The de-dup tie-break used to be `group.find(isEmbedded) ?? group[0]` — "first match wins",
// where "first" is an artifact of enumeration order (a glob in tree mode, installed_plugins.json
// order in installed mode). Two foundations embedding the same `stack` could therefore resolve
// DIFFERENT winners in the two modes: the precise dual-mode divergence ADR-0026 exists to make
// impossible. It also reported every loser as `superseded-by-embedded`, which names a stale
// standalone install — sending the user to uninstall a plugin when the real fault is a `stack`
// id declared twice.

function foundationEmbedding(stack, ownStack) {
  return `kind: foundation\nstack: ${ownStack}\npriority: 300\ndetect:\n  any:\n    - file_exists: settings.gradle.kts\nframeworks:\n  - stack: ${stack}\n    enriches_aspect: network\n    dependency: com.example.${stack}\n`;
}

test("two foundations embedding the same stack pick the SAME winner in both loader modes", () => {
  const dir = scratch();
  try {
    // `zeta` sorts after `alpha`, so a file-order-dependent pick is visible: whichever loader
    // happens to enumerate zeta first would otherwise win there and lose in the other mode.
    const alpha = join(dir, "installed", "alpha-foundation");
    const zeta = join(dir, "installed", "zeta-foundation");
    write(join(alpha, "manifest.yaml"), foundationEmbedding("retrofit", "alpha"));
    write(join(zeta, "manifest.yaml"), foundationEmbedding("retrofit", "zeta"));

    const treeRoot = join(dir, "tree");
    write(join(treeRoot, "plugins", "alpha-foundation", "manifest.yaml"), foundationEmbedding("retrofit", "alpha"));
    write(join(treeRoot, "plugins", "zeta-foundation", "manifest.yaml"), foundationEmbedding("retrofit", "zeta"));

    const { configDir } = fakeConfig(dir, {
      installs: {
        "zeta-foundation@m": [{ scope: "user", installPath: zeta, version: "1.0.0" }],
        "alpha-foundation@m": [{ scope: "user", installPath: alpha, version: "1.0.0" }],
      },
      enabled: { "alpha-foundation@m": true, "zeta-foundation@m": true },
    });

    const installed = loadInstalledManifests({ configDir });
    const tree = loadManifestsFromTree(treeRoot);

    const pick = (r) => r.frameworks.filter((f) => f.doc.stack === "retrofit");
    assert.equal(pick(installed).length, 1, "installed mode must not double-attach");
    assert.equal(pick(tree).length, 1, "tree mode must not double-attach");
    // Both modes resolve the alphabetically-lowest manifest path — the only tie-break that
    // does not depend on enumeration order.
    assert.ok(pick(installed)[0].file.includes("alpha-foundation"), "installed mode picks the lowest path");
    assert.ok(pick(tree)[0].file.includes("alpha-foundation"), "tree mode picks the lowest path");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an embedded row losing to another embedded row reports duplicate-embedded-row, not superseded-by-embedded", () => {
  const dir = scratch();
  try {
    const alpha = join(dir, "installed", "alpha-foundation");
    const zeta = join(dir, "installed", "zeta-foundation");
    write(join(alpha, "manifest.yaml"), foundationEmbedding("retrofit", "alpha"));
    write(join(zeta, "manifest.yaml"), foundationEmbedding("retrofit", "zeta"));
    const { configDir } = fakeConfig(dir, {
      installs: {
        "alpha-foundation@m": [{ scope: "user", installPath: alpha, version: "1.0.0" }],
        "zeta-foundation@m": [{ scope: "user", installPath: zeta, version: "1.0.0" }],
      },
      enabled: { "alpha-foundation@m": true, "zeta-foundation@m": true },
    });

    const { shadowed_frameworks } = loadInstalledManifests({ configDir });
    assert.equal(shadowed_frameworks.length, 1);
    assert.equal(shadowed_frameworks[0].stack, "retrofit");
    assert.equal(shadowed_frameworks[0].reason, "duplicate-embedded-row");
    assert.ok(shadowed_frameworks[0].file.includes("zeta-foundation"), "the loser is the higher path");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a foundation with an empty frameworks array is valid and synthesizes nothing", () => {
  const dir = scratch();
  try {
    const p = join(dir, "installed", "bare-foundation");
    write(join(p, "manifest.yaml"), `kind: foundation\nstack: bare\npriority: 100\ndetect:\n  any:\n    - file_exists: go.mod\nframeworks: []\n`);
    const { configDir } = fakeConfig(dir, {
      installs: { "bare-foundation@m": [{ scope: "user", installPath: p, version: "1.0.0" }] },
      enabled: { "bare-foundation@m": true },
    });
    const { foundations, frameworks, errors } = loadInstalledManifests({ configDir });
    assert.equal(errors.length, 0);
    assert.equal(foundations.length, 1);
    assert.equal(frameworks.length, 0, "an empty array synthesizes zero records");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
