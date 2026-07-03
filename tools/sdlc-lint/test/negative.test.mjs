import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { checkSchemas } from "../lib/schema.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CLI = resolve(REPO, "tools/sdlc-lint/cli.mjs");
const mkTmp = () => mkdtempSync(join(tmpdir(), "sdlc-neg-"));

test("checkSchemas flags missing schemas as tool_error (exit-2 source)", () => {
  const tmp = mkTmp();
  try {
    const results = checkSchemas(tmp);
    assert.ok(results.length > 0, "should attempt each schema mapping");
    assert.ok(results.every(r => r.tool_error === true && r.ok === false),
      "every entry is a tool_error when schemas are absent");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("checkSchemas flags an invalid manifest as a finding, not tool_error (exit-1 source)", () => {
  const tmp = mkTmp();
  try {
    cpSync(join(REPO, "schemas"), join(tmp, "schemas"), { recursive: true });
    mkdirSync(join(tmp, "plugins", "bad"), { recursive: true });
    writeFileSync(join(tmp, "plugins", "bad", "manifest.yaml"), "kind: bogus\nstack: bad\n");
    const results = checkSchemas(tmp);
    const bad = results.find(r => r.file.endsWith("plugins/bad/manifest.yaml"));
    assert.ok(bad, "the invalid manifest should be validated");
    assert.equal(bad.ok, false);
    assert.notEqual(bad.tool_error, true);
    assert.ok(bad.errors.length > 0);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("CLI `schema` exits 2 when schemas are missing (tool error)", () => {
  const tmp = mkTmp();
  try {
    let status = 0;
    try { execFileSync("node", [CLI, "schema"], { cwd: tmp, stdio: "pipe" }); }
    catch (e) { status = e.status; }
    assert.equal(status, 2);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("checkSchemas flags an invalid plugin.json (missing required field)", () => {
  const tmp = mkTmp();
  try {
    cpSync(join(REPO, "schemas"), join(tmp, "schemas"), { recursive: true });
    mkdirSync(join(tmp, "plugins", "x", ".claude-plugin"), { recursive: true });
    writeFileSync(join(tmp, "plugins", "x", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "x" }));  // missing required version/description
    const results = checkSchemas(tmp);
    const bad = results.find(r => r.file.endsWith(".claude-plugin/plugin.json"));
    assert.ok(bad, "plugin.json should be validated");
    assert.equal(bad.ok, false);
    assert.notEqual(bad.tool_error, true);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("CLI `all` exits non-zero on an invalid manifest", () => {
  const tmp = mkTmp();
  try {
    cpSync(join(REPO, "schemas"), join(tmp, "schemas"), { recursive: true });
    mkdirSync(join(tmp, "plugins", "bad"), { recursive: true });
    writeFileSync(join(tmp, "plugins", "bad", "manifest.yaml"), "kind: bogus\nstack: bad\n");
    let status = 0;
    try { execFileSync("node", [CLI, "all"], { cwd: tmp, stdio: "pipe" }); }
    catch (e) { status = e.status; }
    assert.ok(status >= 1, `expected non-zero exit, got ${status}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
