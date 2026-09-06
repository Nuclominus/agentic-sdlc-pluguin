// ADR-0021 ships no aliases: a project's config is migrated once, deliberately, by /sdlc:doctor,
// instead of being translated on every read by four copies of one map. These tests pin the two
// halves of that promise — the scan finds every stale name, and the rewrite touches ONLY the agent
// names, leaving comments, formatting and unrelated prose intact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRenames, scanConfigs, applyRenames } from "../../../plugins/sdlc/tools/migrate/migrate.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

const YAML_SAMPLE = [
  "# project overrides — keep this comment",
  "active_workflow: android-feature",
  "extensions:",
  "  skills:",
  '    - skill: "superpowers:test-driven-development"',
  "      agents: [android-developer, developer, android-tester]",
  '      when: "before touching android-developer code"   # prose, not a target',
  '    - skill: "local:x"',
  "      agents:",
  "        - android-reviewer",
  "        - qa-engineer",
  "      policy: mandatory",
  "cost_caps:",
  "  android-feature: 8",
  "",
].join("\n");

function project(yaml = YAML_SAMPLE, json = { default: "sonnet", agents: { "android-ba": "opus", developer: "haiku" } }) {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-migrate-"));
  if (yaml != null) write(join(dir, ".claude", "sdlc.local.yaml"), yaml);
  if (json != null) write(join(dir, ".claude", "model.local.json"), `${JSON.stringify(json, null, 2)}\n`);
  return dir;
}

const RENAMES = {
  "android-ba": "business-analyst",
  "android-developer": "developer",
  "android-reviewer": "reviewer",
  "android-tester": "tester",
};

test("the shipped rename map is data, keyed old name to new, and covers the whole retired roster", () => {
  const renames = loadRenames(join(REPO, "plugins", "sdlc"));
  assert.equal(renames["android-developer"], "developer");
  assert.equal(renames["android-aar"], "aar-analyst");
  assert.equal(Object.keys(renames).length, 11, "one entry per agent android-foundation used to ship");
  for (const to of Object.values(renames)) {
    assert.ok(!(to in renames), `${to} is a destination and must not also be a source`);
  }
});

test("scan reports every stale name with the file and where it sits, and is silent on a clean project", () => {
  const dir = project();
  try {
    const found = scanConfigs(dir, RENAMES);
    assert.deepEqual(found.map((f) => [f.file, f.from, f.to]), [
      [".claude/model.local.json", "android-ba", "business-analyst"],
      [".claude/sdlc.local.yaml", "android-developer", "developer"],
      [".claude/sdlc.local.yaml", "android-reviewer", "reviewer"],
      [".claude/sdlc.local.yaml", "android-tester", "tester"],
    ], "sorted by file then name, so the report is stable");
    assert.equal(found[1].where, "extensions.skills[0].agents");
    assert.equal(found[3].where, "extensions.skills[0].agents");
    assert.equal(found[2].where, "extensions.skills[1].agents");
    assert.equal(found[0].where, "agents");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("scan finds nothing when the project is already migrated or has no config at all", () => {
  const clean = project("extensions:\n  skills:\n    - skill: \"a:b\"\n      agents: [developer]\n", { agents: { developer: "opus" } });
  try { assert.deepEqual(scanConfigs(clean, RENAMES), []); } finally { rmSync(clean, { recursive: true, force: true }); }
  const bare = project(null, null);
  try { assert.deepEqual(scanConfigs(bare, RENAMES), []); } finally { rmSync(bare, { recursive: true, force: true }); }
});

test("apply rewrites only the agent names, in both YAML sequence styles and in the JSON keys", () => {
  const dir = project();
  try {
    const changed = applyRenames(dir, scanConfigs(dir, RENAMES));
    assert.deepEqual(changed.sort(), [".claude/model.local.json", ".claude/sdlc.local.yaml"]);

    const yaml = readFileSync(join(dir, ".claude", "sdlc.local.yaml"), "utf8");
    assert.match(yaml, /^ {6}agents: \[developer, developer, tester\]$/m, "the flow sequence is rewritten in place");
    assert.match(yaml, /^ {8}- reviewer$/m, "and so is the block sequence");
    assert.match(yaml, /^# project overrides — keep this comment$/m, "comments survive");
    assert.match(yaml, /when: "before touching android-developer code"/, "prose that merely mentions the old name is NOT a target");
    assert.match(yaml, /^ {2}android-feature: 8$/m, "unrelated keys are untouched");

    const json = JSON.parse(readFileSync(join(dir, ".claude", "model.local.json"), "utf8"));
    assert.deepEqual(json, { default: "sonnet", agents: { "business-analyst": "opus", developer: "haiku" } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("apply is idempotent — a second run finds nothing left to do and rewrites no file", () => {
  const dir = project();
  try {
    applyRenames(dir, scanConfigs(dir, RENAMES));
    const before = readFileSync(join(dir, ".claude", "sdlc.local.yaml"), "utf8");
    assert.deepEqual(scanConfigs(dir, RENAMES), []);
    assert.deepEqual(applyRenames(dir, scanConfigs(dir, RENAMES)), []);
    assert.equal(readFileSync(join(dir, ".claude", "sdlc.local.yaml"), "utf8"), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a JSON key collision keeps the already-migrated value and reports the conflict rather than clobbering it", () => {
  const dir = project(null, { agents: { "android-developer": "opus", developer: "haiku" } });
  try {
    const found = scanConfigs(dir, RENAMES);
    assert.equal(found.length, 1);
    assert.equal(found[0].conflict, true, "both spellings present — the migrated one is authoritative");
    applyRenames(dir, found);
    const json = JSON.parse(readFileSync(join(dir, ".claude", "model.local.json"), "utf8"));
    assert.deepEqual(json.agents, { developer: "haiku" }, "the stale key is removed, the explicit one survives");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
