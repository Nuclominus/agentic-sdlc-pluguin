#!/usr/bin/env node
// Harvest one finished benchmark run: validate provenance recorded at prepare
// time against live state, reject telemetry that cannot answer the question,
// archive the scratch tree unconditionally, and store the result.
//
// The archive is unconditional on purpose: storage is far cheaper than a
// repeat run, and a run already paid for should never be discarded because
// someone judged its value prematurely.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { readManifest, diffManifest, buildManifest, resolveConfigDir, resolvePluginVersion } from "./lib/manifest.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const die = (msg) => { console.error(`harvest: ${msg}`); process.exit(1); };

const arm = arg("arm");
const run = Number(arg("run"));
const resultsDir = resolve(arg("results", "bench/results"));
const archiveDir = resolve(arg("archive", "bench/archive"));

if (arm !== "a" && arm !== "b") die(`--arm must be "a" or "b", got ${JSON.stringify(arm)}`);
if (!Number.isInteger(run) || run < 1) die(`--run must be a positive integer`);

const scratchRoot = process.env.BENCH_SCRATCH_ROOT || join(tmpdir(), "sdlc-bench");
const dest = join(scratchRoot, `${arm}-${run}`);
if (!existsSync(dest)) die(`scratch directory not found: ${dest}`);

let manifest;
try { manifest = readManifest(dest); } catch (e) { die(e.message); }

if (manifest.arm !== arm) {
  die(`arm mismatch: directory says "${arm}" but the manifest recorded "${manifest.arm}". ` +
      `Provenance is untrustworthy for this run — do not include it.`);
}

// Cross-check the recorded provenance against live state. Divergence means the
// environment moved between prepare and harvest; neither value is preferred.
if (process.env.BENCH_SKIP_LIVE_CHECK !== "1") {
  const git = (cwd, ...a) => { try { return execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" }).trim(); } catch { return ""; } };
  // Resolved by the SAME helpers prepare.mjs used — if the two ever diverged,
  // every run would report a false provenance divergence.
  const configDir = resolveConfigDir();
  const cacheDir = join(configDir, "plugins", "cache", "agentic-sdlc", "sdlc");
  let pluginVersion = "";
  try { pluginVersion = resolvePluginVersion(cacheDir); } catch (e) { die(e.message); }
  const live = buildManifest({
    ...manifest,
    plugin_version: pluginVersion,
    marketplace_sha: git(join(configDir, "plugins", "marketplaces", "agentic-sdlc"), "rev-parse", "HEAD"),
    config_dir: configDir,
  });
  const divergence = diffManifest(manifest, live);
  if (divergence.length) {
    die(`provenance diverged between prepare and harvest:\n  ${divergence.join("\n  ")}\n` +
        `Neither value can be trusted for this run. Discard it and re-run.`);
  }
}

// Locate the single telemetry file the run produced.
const plansDir = join(dest, "docs", "plans");
const slugs = existsSync(plansDir)
  ? readdirSync(plansDir).filter((d) => statSync(join(plansDir, d)).isDirectory() && existsSync(join(plansDir, d, "_telemetry.json")))
  : [];
if (slugs.length !== 1) {
  die(`expected exactly one docs/plans/*/_telemetry.json under ${dest}, found ${slugs.length}`);
}
const telemetry = JSON.parse(readFileSync(join(plansDir, slugs[0], "_telemetry.json"), "utf8"));

if (telemetry.cost_basis !== "transcript") {
  die(`cost_basis is "${telemetry.cost_basis}", not "transcript". ` +
      `Aggregate telemetry has no meaningful peak_prefix_tokens; harvesting it would poison the median.`);
}

const flags = [];
for (const p of telemetry.phases ?? []) {
  if (p.status && p.status !== "completed") flags.push(`phase ${p.phase} status=${p.status}`);
}

mkdirSync(archiveDir, { recursive: true });
execFileSync("tar", ["-czf", join(archiveDir, `${arm}-${run}.tar.gz`), "-C", scratchRoot, `${arm}-${run}`]);

mkdirSync(resultsDir, { recursive: true });
writeFileSync(
  join(resultsDir, `${arm}-${run}.json`),
  JSON.stringify({ manifest, telemetry, flags, harvested_at: new Date().toISOString() }, null, 2) + "\n",
);

console.log(`harvested arm ${arm} run ${run}${flags.length ? ` (FLAGGED: ${flags.join("; ")})` : ""}`);
console.log(`  result:  ${join(resultsDir, `${arm}-${run}.json`)}`);
console.log(`  archive: ${join(archiveDir, `${arm}-${run}.tar.gz`)}`);
