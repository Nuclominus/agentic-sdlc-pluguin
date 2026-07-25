#!/usr/bin/env node
// Harvest one finished benchmark run: validate provenance recorded at prepare
// time against live state, reject telemetry that cannot answer the question,
// archive the scratch tree unconditionally, and store the result.
//
// The archive is unconditional on purpose: storage is far cheaper than a
// repeat run, and a run already paid for should never be discarded because
// someone judged its value prematurely.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { readManifest, diffManifest, buildManifest, resolveConfigDir, resolvePluginVersion } from "./lib/manifest.mjs";
// Read-only import of the pipeline's own shipped cost-accounting code — same
// style compare.mjs already uses for computeMetrics. harvest.mjs adapts to
// usage.mjs, never the reverse (plugins/ is never modified from here).
import { enrichTelemetry, loadRegistry } from "../plugins/sdlc/tools/usage/usage.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

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

// Archive FIRST, before any validation can abort. Storage is far cheaper than a
// repeat run, and the runs most worth inspecting are the ones that failed — an
// aborted pipeline leaves the scratch tree as the only forensic evidence there
// is. Archiving after the checks would discard exactly those.
mkdirSync(archiveDir, { recursive: true });
execFileSync("tar", ["-czf", join(archiveDir, `${arm}-${run}.tar.gz`), "-C", scratchRoot, `${arm}-${run}`]);

let manifest;
try { manifest = readManifest(dest); } catch (e) { die(e.message); }

if (manifest.arm !== arm) {
  die(`arm mismatch: directory says "${arm}" but the manifest recorded "${manifest.arm}". ` +
      `Provenance is untrustworthy for this run — do not include it.`);
}

// Cross-check the recorded provenance against live state. Divergence means the
// environment moved between prepare and harvest; neither value is preferred.
//
// This check can be disabled (BENCH_SKIP_LIVE_CHECK=1), but a skipped check
// must never be silent: a run harvested without it is otherwise
// byte-indistinguishable from a validated one, so its outcome is recorded in
// the stored result as `live_check` and flagged loudly here.
let liveCheck;
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
  liveCheck = "passed";
} else {
  liveCheck = "skipped";
  console.error(`harvest: WARNING: BENCH_SKIP_LIVE_CHECK=1 — live provenance cross-check was skipped. ` +
                `This result is UNVALIDATED against live state and is recorded as such (live_check: "skipped").`);
}

// Locate the single telemetry file the run produced.
const plansDir = join(dest, "docs", "plans");
const slugs = existsSync(plansDir)
  ? readdirSync(plansDir).filter((d) => statSync(join(plansDir, d)).isDirectory() && existsSync(join(plansDir, d, "_telemetry.json")))
  : [];
if (slugs.length !== 1) {
  die(`expected exactly one docs/plans/*/_telemetry.json under ${dest}, found ${slugs.length}`);
}
const telDir = join(plansDir, slugs[0]);
const telPath = join(telDir, "_telemetry.json");
let telemetry = JSON.parse(readFileSync(telPath, "utf8"));

// The pipeline's own cost-enrichment step (usage.mjs) resolves transcripts from
// homedir() by default. That is exactly the wrong place to look here: arms are
// isolated via a per-arm CLAUDE_CONFIG_DIR, so a run's transcripts live under
// `<config_dir>/projects/...`, never under the operator's real `~/.claude`.
// Left alone, every single run would silently fall back to
// cost_basis:"subagent_aggregate" — no peak_prefix_tokens, no turns — and get
// rejected by the gate below. Perform the same enrichment usage.mjs would
// perform, but pointed at the arm's own projects root, so every run is
// enriched identically instead of by hand (hand-enrichment across runs risks
// each run getting subtly different arguments, which would make the arms
// incomparable).
let enriched;
if (telemetry.cost_basis === "transcript") {
  // Idempotent: telemetry already carries real transcript-derived numbers
  // (e.g. this run was harvested before, or enrichment already ran). Do not
  // re-enrich — there is nothing to add and re-running risks a different
  // result if the underlying transcripts have since been archived/pruned.
  enriched = "already";
} else {
  enriched = attemptEnrichment(dest, telDir, manifest);
  if (enriched === "performed") {
    // Re-read so the gate below (and the stored result) see the enriched
    // telemetry, not the pre-enrichment snapshot loaded above.
    telemetry = JSON.parse(readFileSync(telPath, "utf8"));
  }
}
console.log(`harvest: telemetry enrichment: ${enriched}`);

if (telemetry.cost_basis !== "transcript") {
  die(`cost_basis is "${telemetry.cost_basis}", not "transcript". ` +
      `Aggregate telemetry has no meaningful peak_prefix_tokens; harvesting it would poison the median.`);
}

// A truncated run must not be indistinguishable from a clean one: a pipeline
// that aborted early records fewer phases rather than failed ones, so counting
// only non-completed phases would report flags: [] and let it into the median.
const flags = [];
const phases = telemetry.phases ?? [];
if (!phases.length) flags.push("no phases recorded");
if (!telemetry.completed_at) flags.push("no completed_at — run did not finish");
for (const p of phases) {
  if (p.status && p.status !== "completed") flags.push(`phase ${p.phase} status=${p.status}`);
}

mkdirSync(resultsDir, { recursive: true });
writeFileSync(
  join(resultsDir, `${arm}-${run}.json`),
  JSON.stringify({ manifest, telemetry, flags, live_check: liveCheck, enriched, harvested_at: new Date().toISOString() }, null, 2) + "\n",
);

console.log(`harvested arm ${arm} run ${run}${flags.length ? ` (FLAGGED: ${flags.join("; ")})` : ""}`);
console.log(`  result:   ${join(resultsDir, `${arm}-${run}.json`)}`);
console.log(`  archive:  ${join(archiveDir, `${arm}-${run}.tar.gz`)}`);
console.log(`  enriched: ${enriched}`);

// ── enrichment ────────────────────────────────────────────────────────────────
//
// Everything below adapts usage.mjs's transcript enrichment to the arm-isolated
// layout instead of changing usage.mjs itself (that file ships inside the
// plugin payload and is not this harness's to modify).

/**
 * Attempt transcript enrichment for one run, in place. Returns:
 *   "performed"   — a session transcript was found and at least one phase was
 *                   enriched (the telemetry file on disk was rewritten).
 *   "unavailable" — no usable transcript was found, or enrichment resolved
 *                   nothing; the file was left untouched. The existing
 *                   cost_basis gate rejects the run with its normal message.
 */
function attemptEnrichment(dest, telDir, manifest) {
  // Deliberately taken from the RECORDED manifest, not the live environment
  // (e.g. process.env.CLAUDE_CONFIG_DIR / resolveConfigDir()). The manifest is
  // the arm's identity; reading the live environment here would reintroduce
  // exactly the provenance bug the live-check cross-validation elsewhere in
  // this file exists to catch.
  const projectsRoot = join(manifest.config_dir, "projects");
  const sessionTranscript = findSessionTranscript(dest, projectsRoot);
  if (!sessionTranscript) return "unavailable";

  let registry, result;
  try {
    registry = loadRegistry(join(REPO_ROOT, "plugins", "sdlc", "config", "models.json"));
    result = enrichTelemetry(telDir, { sessionTranscript, projectsRoot, registry });
  } catch (e) {
    console.error(`harvest: enrichment attempt failed, leaving telemetry as-is: ${e.message}`);
    return "unavailable";
  }
  return result.enriched?.length ? "performed" : "unavailable";
}

/**
 * Locate the orchestrator session transcript for a scratch run.
 *
 * Claude Code encodes a session's cwd into its projects-dir name by replacing
 * every "/" with "-". `realpathSync` is required first: on macOS `/tmp` (and
 * hence `$TMPDIR`) resolves to `/private/var/...`, and the encoding is built
 * from the RESOLVED path, not the one this process was handed.
 *
 * Falls back to the newest *.jsonl anywhere under projectsRoot when the
 * encoded directory does not exist (e.g. a differently-shaped test fixture,
 * or a projects root that was pruned down to one leftover transcript).
 */
function findSessionTranscript(dest, projectsRoot) {
  if (!existsSync(projectsRoot)) return null;

  let encoded;
  try { encoded = realpathSync(dest).replace(/\//g, "-"); } catch { encoded = null; }
  if (encoded) {
    const sessionDir = join(projectsRoot, encoded);
    if (existsSync(sessionDir)) {
      const direct = readdirSync(sessionDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(sessionDir, f));
      if (direct.length) return newestByMtime(direct);
    }
  }

  const anywhere = findJsonlFiles(projectsRoot);
  return anywhere.length ? newestByMtime(anywhere) : null;
}

function newestByMtime(paths) {
  return paths
    .map((p) => ({ p, mtime: statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].p;
}

function findJsonlFiles(root, depth = 8) {
  const out = [];
  const walk = (dir, d) => {
    if (d < 0) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, d - 1);
      else if (e.name.endsWith(".jsonl")) out.push(full);
    }
  };
  walk(root, depth);
  return out;
}
