// Step 0 as code. The precedence here is not a preference — it mirrors the shell block in
// SKILL.md Step 0, and one of these tests exists because an earlier draft inverted it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfigDir, resolveSdlcRoot, resolveRoots } from "../../../plugins/sdlc/tools/resolve/roots.mjs";

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
    const r = resolveSdlcRoot(dir, {});
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
    const r = resolveSdlcRoot(dir, {});
    assert.equal(r.source, "cache-newest");
    assert.equal(r.version, "1.10.1", "version order is numeric: 1.10.1 beats 1.9.0");
    assert.equal(r.ambiguous, true, "several candidates means the answer is a guess and must say so");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a cached directory without config/models.json is not a candidate", () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, "plugins", "cache", "mkt", "sdlc", "1.0.0"), { recursive: true });
    const r = resolveSdlcRoot(dir, {});
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
