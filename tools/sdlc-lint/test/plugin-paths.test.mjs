import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  scanPluginText, checkContractReference, checkPluginPaths, CONTRACT_PATH,
} from "../lib/plugin-paths.mjs";
import { claudeConfigDir } from "../lib/usage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "plugin-paths");
const REPO = resolve(HERE, "..", "..", "..");
const fixture = (name) => readFileSync(join(FIX, name), "utf8");

test("install-resolved paths pass — including the guarded CLAUDE_CONFIG_DIR fallback", () => {
  assert.deepEqual(scanPluginText(fixture("clean.md")), { ok: true, errors: [] });
});

test("each home-anchored spelling is flagged exactly once", () => {
  const { ok, errors } = scanPluginText(fixture("violations.md"));
  assert.equal(ok, false);
  assert.equal(errors.length, 4);
  assert.match(errors[0], /^line 2: "~\/\.claude"/);
  assert.match(errors[1], /^line 3: "~\/\.claude"/);
  assert.match(errors[2], /^line 4: "\$HOME\/\.claude"/);
  assert.match(errors[3], /^line 5: "\$\{HOME\}\/\.claude"/);
});

test("a violation names the contract so the fix is discoverable", () => {
  assert.match(scanPluginText(fixture("violations.md")).errors[0], /PLUGIN-PATHS\.md/);
});

test("marker on the matching line suppresses it", () => {
  assert.equal(scanPluginText(fixture("suppressed-same-line.md")).ok, true);
});

test("marker on the preceding line suppresses it", () => {
  assert.equal(scanPluginText(fixture("suppressed-prev-line.md")).ok, true);
});

test("a bare marker with no stated reason does not suppress", () => {
  assert.equal(scanPluginText(fixture("bare-marker.md")).ok, false);
});

test("a project-relative .claude path is not a violation", () => {
  assert.equal(scanPluginText("Write `<project>/.claude/sdlc.local.yaml`.\n").ok, true);
});

test("the orchestrator must reference the contract and resolve from CLAUDE_PLUGIN_ROOT", () => {
  assert.deepEqual(checkContractReference("see PLUGIN-PATHS.md; CLAUDE_PLUGIN_ROOT is ground truth"), { ok: true, errors: [] });
  const { ok, errors } = checkContractReference("# nothing here\n");
  assert.equal(ok, false);
  assert.equal(errors.length, 2);
});

test("the live plugin tree is clean — this is the #70 regression guard", () => {
  const failed = checkPluginPaths(REPO).filter(r => !r.ok);
  assert.deepEqual(failed.map(r => `${r.file}: ${r.errors.join("; ")}`), []);
});

test("the contract doc itself is scanned, not skipped", () => {
  const scanned = checkPluginPaths(REPO).filter(r => r.file.endsWith("PLUGIN-PATHS.md"));
  assert.equal(scanned.length, 1, `expected ${CONTRACT_PATH} in the scan set`);
});

test("claudeConfigDir honors CLAUDE_CONFIG_DIR, then the running plugin root, then $HOME", () => {
  assert.equal(claudeConfigDir({ CLAUDE_CONFIG_DIR: "/tmp/cfg-probe" }), "/tmp/cfg-probe");
  assert.equal(
    claudeConfigDir({ CLAUDE_PLUGIN_ROOT: "/tmp/cfg-probe/plugins/cache/agentic-sdlc/sdlc/1.10.1" }),
    "/tmp/cfg-probe",
  );
  assert.match(claudeConfigDir({}), /\.claude$/);
});
