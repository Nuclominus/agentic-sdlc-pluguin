import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MANIFEST_NAME, buildManifest, writeManifest, readManifest, diffManifest, resolveConfigDir, resolvePluginVersion } from "../lib/manifest.mjs";

const base = {
  arm: "a", run: 1, plugin_version: "1.9.1", marketplace_sha: "9d1af30",
  config_dir: "/tmp/arm-a", task_sha256: "aaa", answers_sha256: "bbb",
  inter_run_gap_seconds: 3600, prepared_at: "2026-07-25T12:00:00.000Z",
};

test("manifest round-trips through disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "man-"));
  const m = buildManifest(base);
  writeManifest(dir, m);
  assert.deepEqual(readManifest(dir), m);
});

test("reading a missing manifest throws a named error", () => {
  const dir = mkdtempSync(join(tmpdir(), "man-"));
  assert.throws(() => readManifest(dir), /_bench-manifest\.json/);
});

test("identical manifests diff to nothing", () => {
  assert.deepEqual(diffManifest(buildManifest(base), buildManifest(base)), []);
});

test("a changed plugin version is reported as divergence", () => {
  const live = buildManifest({ ...base, plugin_version: "1.10.0" });
  const d = diffManifest(buildManifest(base), live);
  assert.equal(d.length, 1);
  assert.match(d[0], /plugin_version.*1\.9\.1.*1\.10\.0/);
});

test("every provenance field is compared", () => {
  const live = buildManifest({ ...base, marketplace_sha: "deadbee", config_dir: "/tmp/arm-b", task_sha256: "zzz" });
  assert.equal(diffManifest(buildManifest(base), live).length, 3);
});

test("prepared_at and run are not divergence — they are recorded, not compared", () => {
  const live = buildManifest({ ...base, prepared_at: "2026-07-26T09:00:00.000Z" });
  assert.deepEqual(diffManifest(buildManifest(base), live), []);
});

test("MANIFEST_NAME is the agreed filename", () => {
  assert.equal(MANIFEST_NAME, "_bench-manifest.json");
});

test("resolveConfigDir does not append .claude to CLAUDE_CONFIG_DIR", () => {
  assert.equal(resolveConfigDir({ CLAUDE_CONFIG_DIR: "/tmp/arm-a" }), "/tmp/arm-a");
  assert.equal(resolveConfigDir({ HOME: "/home/x" }), join("/home/x", ".claude"));
});

test("resolvePluginVersion returns the single installed version", () => {
  const cache = mkdtempSync(join(tmpdir(), "cache-"));
  mkdirSync(join(cache, "1.10.0"));
  assert.equal(resolvePluginVersion(cache), "1.10.0");
});

test("an ambiguous plugin cache is a hard error, not a guess", () => {
  const cache = mkdtempSync(join(tmpdir(), "cache-"));
  mkdirSync(join(cache, "1.9.1"));
  mkdirSync(join(cache, "1.10.0"));
  // Lexicographic "latest" would pick 1.9.1 here — exactly the two arm versions.
  assert.throws(() => resolvePluginVersion(cache), /found 2:/);
});

test("an absent plugin cache records an empty version rather than throwing", () => {
  assert.equal(resolvePluginVersion(join(tmpdir(), "definitely-not-there-12345")), "");
});

test("a Finder .DS_Store alongside one real version still resolves cleanly", () => {
  const cache = mkdtempSync(join(tmpdir(), "cache-"));
  mkdirSync(join(cache, "1.9.1"));
  writeFileSync(join(cache, ".DS_Store"), "");
  assert.equal(resolvePluginVersion(cache), "1.9.1");
});
