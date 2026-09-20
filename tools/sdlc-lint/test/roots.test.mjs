// Step 0 as code. The precedence here is not a preference — it mirrors the shell block in
// SKILL.md Step 0, and one of these tests exists because an earlier draft inverted it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfigDir, resolveSdlcRoot, resolveRoots, pathLoadedRoots, ownPluginRoot, selfPluginRoot, registryListsSdlc } from "../../../plugins/sdlc/tools/resolve/roots.mjs";

function scratch() { return mkdtempSync(join(tmpdir(), "sdlc-roots-")); }
function write(file, content) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
}

test("a CLAUDE_PLUGIN_ROOT inside a cache OUTRANKS CLAUDE_CONFIG_DIR", () => {
  // The shell block this replaces does exactly this, and it is right: code executing from a
  // cache lives under that cache's config dir, whatever an env var claims elsewhere. An
  // earlier draft of manifests.mjs had the precedence backwards.
  const r = resolveConfigDir({
    CLAUDE_CONFIG_DIR: "/somewhere/else",
    CLAUDE_PLUGIN_ROOT: "/home/u/.claude/plugins/cache/mkt/sdlc/1.16.0",
  });
  assert.equal(r.value, "/home/u/.claude");
  assert.equal(r.source, "CLAUDE_PLUGIN_ROOT");
});

test("CLAUDE_CONFIG_DIR wins when the plugin root is not a cache path", () => {
  const r = resolveConfigDir({ CLAUDE_CONFIG_DIR: "/cfg", CLAUDE_PLUGIN_ROOT: "/dev/checkout/plugins/sdlc" });
  assert.equal(r.value, "/cfg");
  assert.equal(r.source, "CLAUDE_CONFIG_DIR");
});

test("with neither set it falls back to ~/.claude, and says the value is a default", () => {
  const r = resolveConfigDir({ HOME: "/home/u" });
  assert.equal(r.value, "/home/u/.claude");
  assert.equal(r.source, "default");
});

test("the harness's own CLAUDE_PLUGIN_ROOT is used verbatim when exported", () => {
  const r = resolveSdlcRoot("/cfg", { CLAUDE_PLUGIN_ROOT: "/exported/root" });
  assert.equal(r.value, "/exported/root");
  assert.equal(r.source, "CLAUDE_PLUGIN_ROOT");
});

test("without it, the installed registry answers — not a version sort over the cache", () => {
  const dir = scratch();
  try {
    const real = join(dir, "cache", "sdlc", "1.16.0");
    const stale = join(dir, "cache", "sdlc", "9.9.9");
    write(join(real, "config", "models.json"), {});
    write(join(stale, "config", "models.json"), {});
    write(join(dir, "plugins", "installed_plugins.json"), {
      version: 2,
      plugins: { "sdlc@m": [{ scope: "user", installPath: real, version: "1.16.0" }] },
    });
    const r = resolveSdlcRoot(dir, {}, null);
    assert.equal(r.value, real, "the registry wins over the higher version number in the cache");
    assert.equal(r.source, "installed_plugins.json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the cache is the last resort, picks the newest, and flags the ambiguity", () => {
  const dir = scratch();
  try {
    for (const v of ["1.9.0", "1.10.0", "1.10.1"]) {
      write(join(dir, "plugins", "cache", "mkt", "sdlc", v, "config", "models.json"), {});
    }
    const r = resolveSdlcRoot(dir, {}, null);
    assert.equal(r.source, "cache-newest");
    assert.equal(r.version, "1.10.1", "version order is numeric: 1.10.1 beats 1.9.0");
    assert.equal(r.ambiguous, true, "several candidates means the answer is a guess and must say so");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a cached directory without config/models.json is not a candidate", () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, "plugins", "cache", "mkt", "sdlc", "1.0.0"), { recursive: true });
    const r = resolveSdlcRoot(dir, {}, null);
    assert.equal(r.value, null);
    assert.equal(r.source, "unresolved");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("resolveRoots derives the cache root from the config dir", () => {
  const r = resolveRoots({ CLAUDE_PLUGIN_ROOT: "/home/u/.claude/plugins/cache/mkt/sdlc/1.16.0" });
  assert.equal(r.config_dir, "/home/u/.claude");
  assert.equal(r.plugin_cache_root, "/home/u/.claude/plugins/cache");
  assert.equal(r.sdlc_plugin_root, "/home/u/.claude/plugins/cache/mkt/sdlc/1.16.0");
});

// Issue #164 — a plugin loaded from a path is in no cache and in no installed_plugins.json, so
// every registry-keyed discovery is blind to it. These fix the boundary of the escape hatch.

test("a path-loaded plugin root is offered for discovery", () => {
  const dir = scratch();
  try {
    write(join(dir, "plug", "manifest.yaml"), "kind: foundation\nstack: dev\n");
    assert.deepEqual(pathLoadedRoots({ CLAUDE_PLUGIN_ROOT: join(dir, "plug") }), [join(dir, "plug")]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a plugin root inside the cache is NOT a path load", () => {
  // It is registered, and installed discovery already has it with the right key and version.
  // Offering it twice is how one plugin becomes two foundations of equal priority.
  assert.deepEqual(pathLoadedRoots({ CLAUDE_PLUGIN_ROOT: "/home/u/.claude/plugins/cache/mkt/sdlc/2.4.1" }), []);
});

test("with nothing exported and no self root offered, there is no path load", () => {
  // The caller decides whether the module's own tree may speak (see the #173 block below); with
  // no CLAUDE_PLUGIN_ROOT and no offer, nothing loaded this plugin and nothing is announced.
  assert.deepEqual(pathLoadedRoots({}), []);
});

test("a path root carrying no manifest is not a plugin root", () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, "empty"), { recursive: true });
    assert.deepEqual(pathLoadedRoots({ CLAUDE_PLUGIN_ROOT: join(dir, "empty") }), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Issue #173 — `claude plugin eval` loads the plugin from a path and exports NOTHING. Keying the
// whole path-load discovery off CLAUDE_PLUGIN_ROOT therefore left every should-fire eval case
// halting at Step 0, with the recipe sitting next to the code printing the halt. The module's own
// location answers where the environment is silent — as a LAST resort, never over a registered
// install, which is what keeps it from announcing a checkout to a consumer that never loaded it.

test("selfPluginRoot() is the plugin tree this module is executing from", () => {
  const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugins", "sdlc");
  assert.equal(ownPluginRoot(), checkout);
  assert.equal(selfPluginRoot(), checkout);
});

test("a module executing from a plugin cache has no self root — that copy is an install", () => {
  // Acceptance #2 of the issue: the normal install must never be read twice, once as itself and
  // once as a path load. Two `vanilla` foundations of equal priority make detection a coin toss.
  assert.equal(selfPluginRoot("/home/u/.claude/plugins/cache/mkt/sdlc/2.4.1"), null);
});

test("with no CLAUDE_PLUGIN_ROOT the offered self root IS the path load", () => {
  const dir = scratch();
  try {
    write(join(dir, "plug", "manifest.yaml"), "kind: foundation\nstack: dev\n");
    assert.deepEqual(pathLoadedRoots({}, join(dir, "plug")), [join(dir, "plug")]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an exported CLAUDE_PLUGIN_ROOT still outranks the self root", () => {
  const dir = scratch();
  try {
    write(join(dir, "exported", "manifest.yaml"), "kind: foundation\nstack: dev\n");
    write(join(dir, "self", "manifest.yaml"), "kind: foundation\nstack: dev\n");
    assert.deepEqual(
      pathLoadedRoots({ CLAUDE_PLUGIN_ROOT: join(dir, "exported") }, join(dir, "self")),
      [join(dir, "exported")],
    );
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the self root answers for SDLC_PLUGIN_ROOT when the consumer has no copy at all", () => {
  const dir = scratch();
  try {
    const self = join(dir, "checkout", "plugins", "sdlc");
    write(join(self, "config", "models.json"), {});
    const r = resolveSdlcRoot(dir, {}, self);
    assert.equal(r.value, self);
    assert.equal(r.source, "self", "the provenance says the answer came from the module's location");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a registered install outranks the self root", () => {
  // The module never overrides what the consumer installed: it speaks only where nobody else can.
  const dir = scratch();
  try {
    const installed = join(dir, "cache", "sdlc", "1.16.0");
    const self = join(dir, "checkout", "plugins", "sdlc");
    write(join(installed, "config", "models.json"), {});
    write(join(self, "config", "models.json"), {});
    write(join(dir, "plugins", "installed_plugins.json"), {
      version: 2,
      plugins: { "sdlc@m": [{ scope: "user", installPath: installed, version: "1.16.0" }] },
    });
    const r = resolveSdlcRoot(dir, {}, self);
    assert.equal(r.value, installed);
    assert.equal(r.source, "installed_plugins.json");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a self root that carries no model registry is not this plugin's root", () => {
  const dir = scratch();
  try {
    const self = join(dir, "not-a-plugin");
    mkdirSync(self, { recursive: true });
    const r = resolveSdlcRoot(dir, {}, self);
    assert.equal(r.value, null);
    assert.equal(r.source, "unresolved");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("resolveRoots carries the self root through with its provenance", () => {
  const dir = scratch();
  try {
    const self = join(dir, "checkout", "plugins", "sdlc");
    write(join(self, "config", "models.json"), {});
    const r = resolveRoots({ HOME: dir, CLAUDE_CONFIG_DIR: join(dir, "cfg") }, self);
    assert.equal(r.sdlc_plugin_root, self);
    assert.equal(r.sources.sdlc_plugin_root, "self");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("registryListsSdlc asks only whether the consumer HAS a copy, not whether it is readable", () => {
  // The stricter question — does that installPath carry config/models.json — belongs to
  // resolveSdlcRoot alone. Answering the two differently is how a partial install kept its place
  // in discovery while the self root took over the self-referential reads.
  assert.equal(registryListsSdlc(new Map([["sdlc@mkt", { installPath: "/anything" }]])), true);
  assert.equal(registryListsSdlc(new Map([["sdlc@other-marketplace", { installPath: "/x" }]])), true);
  assert.equal(registryListsSdlc(new Map([["superpowers@obra", { installPath: "/x" }]])), false);
  assert.equal(registryListsSdlc(new Map()), false);
});
