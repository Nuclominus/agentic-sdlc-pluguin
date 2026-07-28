import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { sealRunClock, finishRun } from "../lib/run.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const REGISTRY = join(REPO, "plugins", "sdlc", "config", "models.json");

// A run directory with the given telemetry and, optionally, a machine anchor.
function makeRun(tel, anchorEpoch) {
  const dir = mkdtempSync(join(tmpdir(), "run-"));
  writeFileSync(join(dir, "_telemetry.json"), JSON.stringify(tel, null, 2) + "\n");
  if (anchorEpoch !== undefined) {
    mkdirSync(join(dir, ".checkpoint"), { recursive: true });
    writeFileSync(join(dir, ".checkpoint", "_started_at"), `${anchorEpoch}\n`);
  }
  return dir;
}
const tel = (dir) => JSON.parse(readFileSync(join(dir, "_telemetry.json"), "utf8"));

// 2026-07-28T11:00:00Z. Verified: node -e 'console.log(new Date(1785236400000).toISOString())'
const ANCHOR = 1785236400;

test("sealRunClock derives all three keys from the anchor", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = sealRunClock(dir, { now: (ANCHOR + 12405) * 1000 });
  assert.equal(r.anchored, true);
  assert.equal(r.degraded, null);
  assert.equal(r.wall_clock_seconds, 12405);
  assert.equal(r.started_at, "2026-07-28T11:00:00Z");
  assert.equal(r.completed_at, "2026-07-28T14:26:45Z");
  const t = tel(dir);
  assert.equal(t.started_at, r.started_at);
  assert.equal(t.completed_at, r.completed_at);
  assert.equal(t.wall_clock_seconds, 12405);
});

test("timestamps carry no milliseconds — the corpus shape is %FT%TZ", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = sealRunClock(dir, { now: (ANCHOR + 1) * 1000 + 500 });
  assert.match(r.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(r.completed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("a clock that runs backwards clamps the duration to zero rather than going negative", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = sealRunClock(dir, { now: (ANCHOR - 1000) * 1000 });
  assert.equal(r.wall_clock_seconds, 0);
  assert.equal(r.started_at, r.completed_at);
});

test("no anchor, but telemetry already has timestamps: leave them alone and say so", () => {
  const dir = makeRun({ task_slug: "x", started_at: "2026-07-01T00:00:00Z",
    completed_at: "2026-07-01T00:10:00Z", wall_clock_seconds: 600, phases: [] });
  const r = sealRunClock(dir, { now: (ANCHOR + 12405) * 1000 });
  assert.equal(r.anchored, false);
  assert.equal(r.degraded, "no-anchor");
  assert.equal(r.changed, false);
  assert.equal(tel(dir).started_at, "2026-07-01T00:00:00Z");
  assert.equal(tel(dir).wall_clock_seconds, 600);
});

test("no anchor and no timestamps: unknown is null, never a measured zero", () => {
  const dir = makeRun({ task_slug: "x", phases: [] });
  const r = sealRunClock(dir, { now: (ANCHOR + 12405) * 1000 });
  assert.equal(r.degraded, "no-anchor-no-values");
  assert.equal(r.started_at, null);
  assert.equal(r.wall_clock_seconds, null);
  assert.equal(r.completed_at, "2026-07-28T14:26:45Z");
  const t = tel(dir);
  assert.equal(t.started_at, null);
  assert.equal(t.wall_clock_seconds, null);
});

test("a garbage anchor is treated as no anchor at all", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, "not-a-number");
  assert.equal(sealRunClock(dir, { now: (ANCHOR + 12405) * 1000 }).degraded, "no-anchor-no-values");
});

test("an anchor with surrounding whitespace still parses", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, `  ${ANCHOR}  `);
  assert.equal(sealRunClock(dir, { now: (ANCHOR + 10) * 1000 }).wall_clock_seconds, 10);
});

test("a run directory with no telemetry throws — there is nothing to seal", () => {
  const dir = mkdtempSync(join(tmpdir(), "run-"));
  assert.throws(() => sealRunClock(dir), /no _telemetry\.json/);
});

// A run whose single phase has no resolvable transcript: enrichment finds nothing,
// which is the "leave telemetry unchanged" path, not an error.
function makeUnresolvableRun(anchorEpoch = ANCHOR) {
  const dir = mkdtempSync(join(tmpdir(), "finish-"));
  writeFileSync(join(dir, "_telemetry.json"), JSON.stringify({
    task_slug: "x", phases: [{ phase: "development", agent_id: "nosuchagent00" }],
  }, null, 2) + "\n");
  mkdirSync(join(dir, ".checkpoint"), { recursive: true });
  writeFileSync(join(dir, ".checkpoint", "_started_at"), `${anchorEpoch}\n`);
  return dir;
}

test("finishRun seals the clock even when enrichment resolves nothing", () => {
  const dir = makeUnresolvableRun();
  const r = finishRun(dir, { now: (ANCHOR + 300) * 1000, registryPath: REGISTRY,
    projectsRoot: join(dir, "no-projects") });
  assert.equal(r.clock.wall_clock_seconds, 300);
  assert.equal(r.enrich.ok, true);
  assert.equal(r.enrich.skipped_all, true);
  assert.equal(tel(dir).wall_clock_seconds, 300);
  assert.match(r.warnings.join("\n"), /cost enrichment incomplete/);
});

test("the clock is written BEFORE enrichment reads its overhead window", () => {
  // Proven by state, not by call order: enrichment's overhead window is derived from
  // the anchor plus wall_clock_seconds, so a telemetry that had no clock at entry must
  // still carry one by the time enrichment runs.
  const dir = makeUnresolvableRun();
  const r = finishRun(dir, { now: (ANCHOR + 300) * 1000, registryPath: REGISTRY,
    projectsRoot: join(dir, "no-projects") });
  assert.equal(r.clock.changed, true);
  assert.equal(typeof tel(dir).started_at, "string");
});

test("a report failure does not cost the run its enriched telemetry", () => {
  const dir = makeUnresolvableRun();
  const r = finishRun(dir, { now: (ANCHOR + 300) * 1000, registryPath: REGISTRY,
    projectsRoot: join(dir, "no-projects"), renderReport: () => { throw new Error("boom"); } });
  assert.equal(r.report.ok, false);
  assert.match(r.report.error, /boom/);
  assert.equal(tel(dir).wall_clock_seconds, 300);
  assert.match(r.warnings.join("\n"), /HTML report failed/);
});

test("an enrichment failure does not stop the report", () => {
  const dir = makeUnresolvableRun();
  let rendered = false;
  const r = finishRun(dir, { now: (ANCHOR + 300) * 1000,
    enrich: () => { throw new Error("registry gone"); },
    renderReport: () => { rendered = true; return { htmlPath: join(dir, "report.html"), cap_unverified: true }; } });
  assert.equal(r.enrich.ok, false);
  assert.equal(rendered, true);
  assert.equal(r.report.ok, true);
  assert.match(r.warnings.join("\n"), /cost enrichment failed/);
  assert.match(r.warnings.join("\n"), /unpriced/);
});

test("--no-report skips only the render", () => {
  const dir = makeUnresolvableRun();
  const r = finishRun(dir, { now: (ANCHOR + 300) * 1000, noReport: true, registryPath: REGISTRY,
    projectsRoot: join(dir, "no-projects") });
  assert.deepEqual(r.report, { skipped: "--no-report" });
  assert.equal(tel(dir).wall_clock_seconds, 300);
});

test("finishRun is idempotent — sealing twice does not double-count", () => {
  const dir = makeUnresolvableRun();
  const a = finishRun(dir, { now: (ANCHOR + 300) * 1000, registryPath: REGISTRY,
    projectsRoot: join(dir, "no-projects"), noReport: true });
  const b = finishRun(dir, { now: (ANCHOR + 400) * 1000, registryPath: REGISTRY,
    projectsRoot: join(dir, "no-projects"), noReport: true });
  assert.equal(a.enrich.total_cost_usd, b.enrich.total_cost_usd);
  assert.equal(tel(dir).started_at, a.clock.started_at);   // the anchor never moves
  assert.equal(tel(dir).wall_clock_seconds, 400);          // only the end advances
});

test("a run directory with no telemetry throws before anything is attempted", () => {
  const dir = mkdtempSync(join(tmpdir(), "finish-"));
  assert.throws(() => finishRun(dir), /no _telemetry\.json/);
});

test("cap-breach and clock-drift warnings from enrichment are surfaced verbatim", () => {
  const dir = makeUnresolvableRun();
  const r = finishRun(dir, { now: (ANCHOR + 300) * 1000, noReport: true,
    enrich: () => ({ telPath: join(dir, "_telemetry.json"), enriched: ["development"], skipped: [],
      total_cost_usd: 3.5, overhead_cost_usd: 1, overhead_window_fallback: true,
      cap_breach_usd: 1.51, cap_status: "exceeded-undetected",
      timestamps_corrected: { from: "2026-07-28T14:24:17Z", to: "2026-07-28T11:04:17Z", drift_seconds: 12000 } }) });
  const w = r.warnings.join("\n");
  assert.match(w, /exceeded the cost cap by \$1\.51/);
  assert.match(w, /exceeded-undetected/);
  assert.match(w, /overhead window fell back/);
  assert.match(w, /machine anchor says/);
});

const CLI = join(REPO, "plugins", "sdlc", "tools", "run", "cli.mjs");
// Runs the CLI with cwd = the repo, so `finish <dir>` also exercises path resolution.
// spawnSync rather than execFileSync: the latter surfaces stderr only when the process
// exits non-zero, and the whole point of this verb is that it warns loudly while
// exiting 0.
function runCli(args, cwd) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

test("the CLI prints a block shaped for the orchestrator to echo", () => {
  const dir = makeUnresolvableRun();
  const r = runCli(["finish", dir, "--no-report", "--registry", REGISTRY, "--projects-root", join(dir, "none")], REPO);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^finish: /m);
  assert.match(r.stdout, /clock:\s+\d{4}-\d{2}-\d{2}T/);
  assert.match(r.stdout, /cost:/);
});

test("WARN lines go to stderr, not into the stdout block", () => {
  const dir = makeUnresolvableRun();
  const r = runCli(["finish", dir, "--no-report", "--registry", REGISTRY, "--projects-root", join(dir, "none")], REPO);
  assert.match(r.stderr, /WARN: cost enrichment incomplete/);
  assert.doesNotMatch(r.stdout, /WARN:/);
});

test("--json emits exactly one parseable line", () => {
  const dir = makeUnresolvableRun();
  const r = runCli(["finish", dir, "--no-report", "--json", "--registry", REGISTRY, "--projects-root", join(dir, "none")], REPO);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  const j = JSON.parse(lines[0]);
  assert.equal(j.command, "finish");
  assert.equal(j.ok, true);
  assert.equal(j.clock.wall_clock_seconds >= 0, true);
  assert.equal(Array.isArray(j.warnings), true);
});

test("sealing never fails a run that already succeeded — exit stays 0 with warnings", () => {
  const dir = makeUnresolvableRun();
  const r = runCli(["finish", dir, "--registry", REGISTRY, "--projects-root", join(dir, "none")], REPO);
  assert.equal(r.status, 0);
});

test("an unreadable run is a usage error, exit 2", () => {
  const r = runCli(["finish", "no-such-slug"], REPO);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /finish/);
});

test("no verb, or an unknown one, prints usage and exits 2", () => {
  assert.equal(runCli([], REPO).status, 2);
  assert.equal(runCli(["seal", "x"], REPO).status, 2);
});

test("finishRun marks the run sealed, defaulting to the orchestrator", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = finishRun(dir, { now: (ANCHOR + 60) * 1000, noReport: true,
    enrich: () => ({ skipped_all: true }) });

  assert.equal(r.sealed.by, "orchestrator");
  assert.equal(r.sealed.at, "2026-07-28T11:01:00Z");
  assert.equal(tel(dir).sealed_by, "orchestrator");

  const marker = JSON.parse(readFileSync(join(dir, ".checkpoint", "_sealed"), "utf8"));
  assert.equal(marker.by, "orchestrator");
  assert.equal(marker.sealed_at, "2026-07-28T11:01:00Z");
  assert.equal(marker.wall_clock_seconds, 60);
});

test("finishRun attributes the seal to the hook when the hook is the caller", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = finishRun(dir, { now: (ANCHOR + 60) * 1000, noReport: true, sealedBy: "stop-hook",
    enrich: () => ({ skipped_all: true }) });

  assert.equal(r.sealed.by, "stop-hook");
  assert.equal(tel(dir).sealed_by, "stop-hook");
  assert.equal(JSON.parse(readFileSync(join(dir, ".checkpoint", "_sealed"), "utf8")).by, "stop-hook");
});

test("the seal marker is written AFTER enrich, which rewrites the whole telemetry file", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  // A realistic enricher: it re-reads and rewrites _telemetry.json wholesale. If the
  // marker were written before this, enrich would erase sealed_by and the hook would
  // re-seal a sealed run — the failure ADR-0014 priced at $12.81 -> $13.71.
  finishRun(dir, { now: (ANCHOR + 60) * 1000, noReport: true, enrich: (d) => {
    const p = join(d, "_telemetry.json");
    const t = JSON.parse(readFileSync(p, "utf8"));
    writeFileSync(p, JSON.stringify({ ...t, cost_basis: "transcript" }, null, 2) + "\n");
    return { total_cost_usd: 1.23 };
  } });

  const t = tel(dir);
  assert.equal(t.cost_basis, "transcript", "enrich's own write must survive");
  assert.equal(t.sealed_by, "orchestrator", "sealed_by must survive enrich's rewrite");
});
