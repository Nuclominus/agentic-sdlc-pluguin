import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildManifest, writeManifest } from "../lib/manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const HARVEST = join(REPO, "bench", "harvest.mjs");

const manifestFields = (over = {}) => ({
  arm: "a", run: 1, plugin_version: "1.9.1", marketplace_sha: "9d1af30",
  config_dir: "/tmp/arm-a", task_sha256: "aaa", answers_sha256: "bbb",
  inter_run_gap_seconds: 60, prepared_at: "2026-07-25T12:00:00.000Z", ...over,
});

// Build a scratch tree that looks like a finished pipeline run.
function scratchRun(fixture, over = {}) {
  const root = mkdtempSync(join(tmpdir(), "scratch-"));
  const dest = join(root, `${over.arm ?? "a"}-${over.run ?? 1}`);
  mkdirSync(join(dest, "docs", "plans", "bench-validation"), { recursive: true });
  cpSync(join(HERE, "fixtures", fixture), join(dest, "docs", "plans", "bench-validation", "_telemetry.json"));
  writeManifest(dest, buildManifest(manifestFields(over)));
  return { root, dest };
}

function harvest(args, env = {}) {
  return execFileSync("node", [HARVEST, ...args], {
    cwd: REPO, encoding: "utf8", env: { ...process.env, BENCH_SKIP_LIVE_CHECK: "1", ...env },
  });
}

test("stores a result with the manifest and telemetry", () => {
  const { root } = scratchRun("telemetry-transcript.json");
  const out = mkdtempSync(join(tmpdir(), "results-"));
  harvest(["--arm", "a", "--run", "1", "--results", out], { BENCH_SCRATCH_ROOT: root });
  const r = JSON.parse(readFileSync(join(out, "a-1.json"), "utf8"));
  assert.equal(r.manifest.arm, "a");
  assert.equal(r.telemetry.total_cached_input_tokens, 900000);
  assert.deepEqual(r.flags, []);
});

test("rejects telemetry whose cost_basis is not transcript", () => {
  const { root } = scratchRun("telemetry-aggregate.json", { run: 2 });
  const out = mkdtempSync(join(tmpdir(), "results-"));
  assert.throws(
    () => harvest(["--arm", "a", "--run", "2", "--results", out], { BENCH_SCRATCH_ROOT: root }),
    (e) => /cost_basis/.test(e.stderr ?? "") && e.status !== 0,
  );
});

test("fails when no telemetry exists", () => {
  const root = mkdtempSync(join(tmpdir(), "scratch-"));
  mkdirSync(join(root, "a-3"), { recursive: true });
  writeManifest(join(root, "a-3"), buildManifest(manifestFields({ run: 3 })));
  const out = mkdtempSync(join(tmpdir(), "results-"));
  assert.throws(
    () => harvest(["--arm", "a", "--run", "3", "--results", out], { BENCH_SCRATCH_ROOT: root }),
    (e) => /_telemetry\.json/.test(e.stderr ?? "") && e.status !== 0,
  );
});

test("archives the whole scratch tree", () => {
  const { root } = scratchRun("telemetry-transcript.json", { run: 4 });
  const out = mkdtempSync(join(tmpdir(), "results-"));
  const arch = mkdtempSync(join(tmpdir(), "archive-"));
  harvest(["--arm", "a", "--run", "4", "--results", out, "--archive", arch], { BENCH_SCRATCH_ROOT: root });
  assert.ok(existsSync(join(arch, "a-4.tar.gz")), "expected an archive tarball");
});

test("flags a run whose arm disagrees with its filename", () => {
  const { root } = scratchRun("telemetry-transcript.json", { arm: "a", run: 5 });
  // Corrupt the manifest so the recorded arm no longer matches the CLI arm.
  const dest = join(root, "a-5");
  const m = JSON.parse(readFileSync(join(dest, "_bench-manifest.json"), "utf8"));
  writeFileSync(join(dest, "_bench-manifest.json"), JSON.stringify({ ...m, arm: "b" }, null, 2));
  const out = mkdtempSync(join(tmpdir(), "results-"));
  assert.throws(
    () => harvest(["--arm", "a", "--run", "5", "--results", out], { BENCH_SCRATCH_ROOT: root }),
    (e) => /arm/.test(e.stderr ?? "") && e.status !== 0,
  );
});
