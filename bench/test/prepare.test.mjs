import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MANIFEST_NAME } from "../lib/manifest.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PREPARE = join(REPO, "bench", "prepare.mjs");

function specimen() {
  const dir = mkdtempSync(join(tmpdir(), "spec-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "A.kt"), "fun a() {}\n");
  writeFileSync(join(dir, "build.gradle.kts"), "// build\n");
  return dir;
}

function run(args, env = {}) {
  return execFileSync("node", [PREPARE, ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "cfg-")),
      ...env,
    },
  });
}

test("copies the specimen tree file for file", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "scratch-"));
  const spec = specimen();
  run(["--arm", "a", "--run", "1", "--specimen", spec, "--gap", "60"], { BENCH_SCRATCH_ROOT: scratchRoot });
  const dest = join(scratchRoot, "a-1");
  assert.equal(readFileSync(join(dest, "src", "A.kt"), "utf8"), "fun a() {}\n");
  assert.equal(readFileSync(join(dest, "build.gradle.kts"), "utf8"), "// build\n");
});

test("the copy is a git repo with exactly one commit", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "scratch-"));
  run(["--arm", "a", "--run", "2", "--specimen", specimen(), "--gap", "60"], { BENCH_SCRATCH_ROOT: scratchRoot });
  const dest = join(scratchRoot, "a-2");
  assert.ok(existsSync(join(dest, ".git")), "expected a .git directory");
  const count = execFileSync("git", ["-C", dest, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(count, "1");
});

test("writes a complete manifest", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "scratch-"));
  run(["--arm", "b", "--run", "3", "--specimen", specimen(), "--gap", "900"], { BENCH_SCRATCH_ROOT: scratchRoot });
  const m = JSON.parse(readFileSync(join(scratchRoot, "b-3", MANIFEST_NAME), "utf8"));
  assert.equal(m.arm, "b");
  assert.equal(m.run, 3);
  assert.equal(m.inter_run_gap_seconds, 900);
  // prepared_at has no external dependency — always populated.
  assert.ok(m.prepared_at != null && m.prepared_at !== "", `manifest.prepared_at must be populated, got ${JSON.stringify(m.prepared_at)}`);
  // plugin_version/marketplace_sha/config_dir depend on the live ~/.claude environment
  // and are legitimately empty in a hermetic test environment — only presence is asserted.
  for (const k of ["plugin_version", "marketplace_sha", "config_dir"]) {
    assert.ok(k in m, `manifest.${k} must be present`);
  }
  // task_sha256/answers_sha256 hash bench/task.md and bench/answers.md, which are real,
  // committed files as of Task 7 — assert non-empty so a silent hashing failure (wrong
  // path, swallowed read error) is caught rather than passing on an empty string.
  for (const k of ["task_sha256", "answers_sha256"]) {
    assert.ok(typeof m[k] === "string" && m[k].length > 0, `manifest.${k} must be non-empty, got ${JSON.stringify(m[k])}`);
  }
});

test("refuses to overwrite an existing run directory", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "scratch-"));
  const spec = specimen();
  run(["--arm", "a", "--run", "9", "--specimen", spec, "--gap", "60"], { BENCH_SCRATCH_ROOT: scratchRoot });
  assert.throws(
    () => run(["--arm", "a", "--run", "9", "--specimen", spec, "--gap", "60"], { BENCH_SCRATCH_ROOT: scratchRoot }),
    (e) => /a-9/.test(e.stderr ?? "") && e.status !== 0,
  );
});

test("rejects an unknown arm", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "scratch-"));
  assert.throws(
    () => run(["--arm", "c", "--run", "1", "--specimen", specimen(), "--gap", "60"], { BENCH_SCRATCH_ROOT: scratchRoot }),
    (e) => e.status !== 0,
  );
});

test("prepare refuses to run against an ambiguous plugin cache", () => {
  const cfg = mkdtempSync(join(tmpdir(), "cfg-"));
  const cache = join(cfg, "plugins", "cache", "agentic-sdlc", "sdlc");
  mkdirSync(join(cache, "1.9.1"), { recursive: true });
  mkdirSync(join(cache, "1.10.0"), { recursive: true });
  const scratchRoot = mkdtempSync(join(tmpdir(), "scratch-"));
  assert.throws(
    () => run(["--arm", "a", "--run", "1", "--specimen", specimen(), "--gap", "60"],
              { BENCH_SCRATCH_ROOT: scratchRoot, CLAUDE_CONFIG_DIR: cfg }),
    (e) => /found 2:/.test(e.stderr ?? "") && e.status !== 0,
  );
});
