#!/usr/bin/env node
// Prepare one benchmark run: copy the specimen to a disposable scratch tree,
// make it a real git repo (the pipeline's dev/QA/docs phases expect branches,
// commits and diffs — a bare file tree would behave differently from real
// use), and record provenance BEFORE the run.
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildManifest, writeManifest, MANIFEST_NAME, resolveConfigDir, resolvePluginVersion } from "./lib/manifest.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const die = (msg) => { console.error(`prepare: ${msg}`); process.exit(1); };

const arm = arg("arm");
const run = Number(arg("run"));
const specimen = resolve(arg("specimen", "bench/reference-app"));
const gap = Number(arg("gap", "0"));

if (arm !== "a" && arm !== "b") die(`--arm must be "a" or "b", got ${JSON.stringify(arm)}`);
if (!Number.isInteger(run) || run < 1) die(`--run must be a positive integer, got ${JSON.stringify(arg("run"))}`);
if (!existsSync(specimen)) die(`specimen not found: ${specimen}`);

const scratchRoot = process.env.BENCH_SCRATCH_ROOT || join(tmpdir(), "sdlc-bench");
const dest = join(scratchRoot, `${arm}-${run}`);

if (existsSync(dest)) {
  die(`scratch directory already exists: ${dest}\n` +
      `Refusing to overwrite — it may hold an unharvested run. Harvest or remove it first.`);
}

mkdirSync(scratchRoot, { recursive: true });
cpSync(specimen, dest, { recursive: true });

execFileSync("git", ["-C", dest, "init", "-q"]);
execFileSync("git", ["-C", dest, "add", "-A"]);
execFileSync("git", ["-C", dest, "-c", "user.name=bench", "-c", "user.email=bench@local",
                     "commit", "-q", "-m", "bench: specimen baseline"]);

const sha256 = (p) => existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "";
const git = (cwd, ...a) => { try { return execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" }).trim(); } catch { return ""; } };

const configDir = resolveConfigDir();
const marketplaceDir = join(configDir, "plugins", "marketplaces", "agentic-sdlc");
const cacheDir = join(configDir, "plugins", "cache", "agentic-sdlc", "sdlc");

let pluginVersion = "";
try { pluginVersion = resolvePluginVersion(cacheDir); } catch (e) { die(e.message); }

writeManifest(dest, buildManifest({
  arm, run,
  plugin_version: pluginVersion,
  marketplace_sha: git(marketplaceDir, "rev-parse", "HEAD"),
  config_dir: configDir,
  task_sha256: sha256(resolve("bench/task.md")),
  answers_sha256: sha256(resolve("bench/answers.md")),
  inter_run_gap_seconds: gap,
  prepared_at: new Date().toISOString(),
}));

console.log(`prepared arm ${arm} run ${run}`);
console.log(`  scratch:  ${dest}`);
console.log(`  manifest: ${join(dest, MANIFEST_NAME)}`);
console.log(``);
console.log(`Next: launch Claude Code for arm ${arm}, then in ${dest} run:`);
console.log(`  /sdlc:start "$(cat ${resolve("bench/task.md")})"`);
console.log(`Answer any gates from bench/answers.md verbatim; anything not covered there: "proceed".`);
