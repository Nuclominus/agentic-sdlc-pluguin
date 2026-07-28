import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, utimesSync, existsSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { resolveWorkspace } from "../../../plugins/sdlc/tools/run/reentry.mjs";
import { findSealable, sealStale } from "../../../plugins/sdlc/tools/run/seal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");

test("the completeness rule ships inside the plugin, where the Stop hook can reach it", () => {
  const dir = mkdtempSync(join(tmpdir(), "reentry-"));
  const cp = join(dir, ".checkpoint");
  mkdirSync(cp, { recursive: true });
  writeFileSync(join(cp, "_run.json"),
    JSON.stringify({ resolved_phases: [{ name: "development" }, { name: "qa" }] }));
  writeFileSync(join(cp, "development.json"), JSON.stringify({ status: "completed" }));

  assert.equal(resolveWorkspace(dir).reenter_at, "qa");

  writeFileSync(join(cp, "qa.json"), JSON.stringify({ status: "completed" }));
  assert.equal(resolveWorkspace(dir).reenter_at, null,
    "a run whose every resolved phase is terminal is what the seal gate calls complete");
});

// 2026-07-28T11:00:00Z. Verified: node -e 'console.log(new Date(1785236400000).toISOString())'
const ANCHOR = 1785236400;

// A docs/plans-shaped root holding one run. `phases` is the resolved DAG, `done` the
// unit ids with a terminal checkpoint, `activityMs` the mtime stamped on every file.
function makePlans({ slug = "r", phases = ["development", "qa"], done = ["development", "qa"],
                     runJson = true, sealed = false, activityMs = (ANCHOR + 600) * 1000 } = {}) {
  const plansRoot = mkdtempSync(join(tmpdir(), "plans-"));
  const runDir = join(plansRoot, slug);
  const cp = join(runDir, ".checkpoint");
  mkdirSync(cp, { recursive: true });
  writeFileSync(join(runDir, "_telemetry.json"),
    JSON.stringify({ task_slug: slug, phases: [] }, null, 2) + "\n");
  writeFileSync(join(cp, "_started_at"), `${ANCHOR}\n`);
  if (runJson) {
    // A phase may be given as a bare name or as a full resolved entry (aspects, parallel
    // members) — the realistic-shape test below needs the latter.
    writeFileSync(join(cp, "_run.json"), JSON.stringify({
      resolved_phases: phases.map(p => (typeof p === "string" ? { name: p } : p)),
    }, null, 2) + "\n");
  }
  for (const u of done) writeFileSync(join(cp, `${u}.json`), JSON.stringify({ status: "completed" }));
  if (sealed) writeFileSync(join(cp, "_sealed"), JSON.stringify({ by: "orchestrator" }));

  const secs = activityMs / 1000;
  utimesSync(join(runDir, "_telemetry.json"), secs, secs);
  for (const f of readdirSync(cp)) utimesSync(join(cp, f), secs, secs);
  return { plansRoot, runDir, slug };
}

const NOW = (ANCHOR + 900) * 1000;   // 5 min after the fixture's last activity

test("a complete, unsealed, recent run is sealable", () => {
  const { plansRoot } = makePlans();
  const { sealable, skipped } = findSealable(plansRoot, { now: NOW });
  assert.equal(sealable.length, 1);
  assert.equal(sealable[0].run, "r");
  assert.equal(sealable[0].lastActivityMs, (ANCHOR + 600) * 1000);
  assert.deepEqual(skipped, []);
});

test("the marker gates a second seal", () => {
  const { plansRoot } = makePlans({ sealed: true });
  const { sealable, skipped } = findSealable(plansRoot, { now: NOW });
  assert.deepEqual(sealable, []);
  assert.equal(skipped[0].reason, "sealed");
});

test("an incomplete run is left alone, and says which phase it would re-enter at", () => {
  const { plansRoot } = makePlans({ done: ["development"] });
  const { sealable, skipped } = findSealable(plansRoot, { now: NOW });
  assert.deepEqual(sealable, []);
  assert.equal(skipped[0].reason, "incomplete");
  assert.equal(skipped[0].reenter_at, "qa");
});

test("a run with no _run.json is unprovable, not sealable, and does not throw", () => {
  const { plansRoot } = makePlans({ runJson: false });
  const { sealable, skipped } = findSealable(plansRoot, { now: NOW });
  assert.deepEqual(sealable, []);
  assert.equal(skipped[0].reason, "unprovable",
    "completeness that cannot be proven is not assumed — the gate fails closed");
});

test("a complete but long-abandoned run falls outside the age window", () => {
  const { plansRoot } = makePlans();
  const { sealable, skipped } = findSealable(plansRoot, { now: NOW + 48 * 3600 * 1000 });
  assert.deepEqual(sealable, []);
  assert.equal(skipped[0].reason, "stale");
});

test("a missing plans root is a silent no-op, not a throw", () => {
  const { sealable, skipped } = findSealable(join(tmpdir(), "does-not-exist-h6"), { now: NOW });
  assert.deepEqual(sealable, []);
  assert.deepEqual(skipped, []);
});

test("the clock comes from the run's last activity, never from the wall clock", () => {
  const { plansRoot } = makePlans();
  let seen = null;
  sealStale(plansRoot, { now: NOW, finish: (dir, o) => { seen = o; return { warnings: [] }; } });
  assert.equal(seen.now, (ANCHOR + 600) * 1000,
    "passing the real now would charge the run for every minute the user spent chatting " +
    "afterwards — ADR-0014 priced that at 3522s -> 11144s, $12.81 -> $13.71");
  assert.equal(seen.sealedBy, "stop-hook");
});

test("end to end: the run is sealed, and its duration is anchor-to-last-activity", () => {
  const { plansRoot, runDir } = makePlans();
  const r = sealStale(plansRoot, { now: NOW, noReport: true });
  assert.equal(r.sealed.length, 1);
  const t = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  assert.equal(t.wall_clock_seconds, 600);
  assert.equal(t.started_at, "2026-07-28T11:00:00Z");
  assert.equal(t.completed_at, "2026-07-28T11:10:00Z");
  assert.equal(t.sealed_by, "stop-hook");
  assert.ok(existsSync(join(runDir, ".checkpoint", "_sealed")));

  // Idempotent from here on: the marker it just wrote closes the gate.
  assert.deepEqual(findSealable(plansRoot, { now: NOW }).sealable, []);
});

// The known-positive. H1's plan made this a hard stop, and it caught two instrument
// defects before they were published as findings. The shape below is a real pipeline —
// an aspect-aware development phase and a parallel group — which is where a gate that
// only understood flat phases would wrongly report complete.
const PIPELINE = [
  { name: "business-analysis" },
  { name: "development", aspects: ["ui", "data"] },
  { name: "review" },
  { name: "parallel:security+test", kind: "parallel", members: [{ name: "security" }, { name: "test" }] },
  { name: "qa" },
  { name: "documentation" },
];
const PIPELINE_UNITS = ["business-analysis", "development-ui", "development-data",
  "review", "security", "test", "qa", "documentation"];

test("the gate opens for a full real pipeline shape — aspects and a parallel group", () => {
  const { plansRoot } = makePlans({ phases: PIPELINE, done: PIPELINE_UNITS });
  const { sealable } = findSealable(plansRoot, { now: NOW });
  assert.equal(sealable.length, 1,
    "this is the ADR-0012 incident run's shape: eight terminal units across an " +
    "aspect-aware phase and a parallel group. A hook that does not seal this has " +
    "failed at the only case it was built for");
});

test("the gate shuts when one aspect of an aspect-aware phase is missing", () => {
  const { plansRoot } = makePlans({
    phases: PIPELINE,
    done: PIPELINE_UNITS.filter(u => u !== "development-data"),
  });
  const { sealable, skipped } = findSealable(plansRoot, { now: NOW });
  assert.deepEqual(sealable, [],
    "one unfinished aspect means the phase is unfinished — a gate that counted phases " +
    "rather than units would seal a run mid-development");
  assert.equal(skipped[0].reenter_at, "development");
});

test("one failing run does not abort the others", () => {
  const { plansRoot } = makePlans({ slug: "a" });
  // A second run in the same plans root — /sdlc:batch can leave more than one unsealed.
  const b = join(plansRoot, "b");
  mkdirSync(join(b, ".checkpoint"), { recursive: true });
  writeFileSync(join(b, "_telemetry.json"), JSON.stringify({ task_slug: "b", phases: [] }));
  writeFileSync(join(b, ".checkpoint", "_started_at"), `${ANCHOR}\n`);
  writeFileSync(join(b, ".checkpoint", "_run.json"),
    JSON.stringify({ resolved_phases: [{ name: "development" }] }));
  writeFileSync(join(b, ".checkpoint", "development.json"), JSON.stringify({ status: "completed" }));
  const secs = ((ANCHOR + 600) * 1000) / 1000;
  for (const f of readdirSync(join(b, ".checkpoint"))) utimesSync(join(b, ".checkpoint", f), secs, secs);
  utimesSync(join(b, "_telemetry.json"), secs, secs);

  const r = sealStale(plansRoot, { now: NOW, finish: (dir) => {
    if (dir.endsWith("a")) throw new Error("boom");
    return { warnings: [] };
  } });
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].run, "a");
  assert.equal(r.sealed.length, 1);
  assert.equal(r.sealed[0].run, "b");
});

const RUN_CLI = resolve(REPO, "plugins/sdlc/tools/run/cli.mjs");

test("`seal-stale --json` seals from the CLI and reports what it did", () => {
  const { plansRoot, runDir } = makePlans();
  const r = spawnSync("node", [RUN_CLI, "seal-stale", "--plans-root", plansRoot,
    "--no-report", "--json"], { encoding: "utf8" });

  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(out.command, "seal-stale");
  assert.equal(out.ok, true);
  assert.equal(out.sealed.length, 1);
  assert.equal(out.sealed[0].run, "r");
  assert.equal(JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8")).sealed_by, "stop-hook");
});

test("`seal-stale --json` on a plans root with nothing to do exits 0 and seals nothing", () => {
  const { plansRoot } = makePlans({ sealed: true });
  const r = spawnSync("node", [RUN_CLI, "seal-stale", "--plans-root", plansRoot, "--json"],
    { encoding: "utf8" });

  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.deepEqual(out.sealed, []);
  assert.equal(out.skipped[0].reason, "sealed");
});

const HOOK = resolve(REPO, "plugins/sdlc/hooks/seal-run.sh");
const PLUGIN_ROOT = resolve(REPO, "plugins/sdlc");

// Run the hook as Claude Code would: payload on stdin, CLAUDE_PROJECT_DIR in the env.
function runHook(projectDir) {
  return spawnSync("bash", [HOOK], {
    input: JSON.stringify({ session_id: "s1", hook_event_name: "Stop", cwd: projectDir }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    encoding: "utf8",
  });
}

// A project directory whose docs/plans is the given plans root.
function makeProject(opts) {
  const projectDir = mkdtempSync(join(tmpdir(), "proj-"));
  mkdirSync(join(projectDir, "docs"), { recursive: true });
  const { plansRoot, slug } = makePlans(opts);
  renameSync(plansRoot, join(projectDir, "docs", "plans"));
  return { projectDir, runDir: join(projectDir, "docs", "plans", slug), slug };
}

test("the hook is a silent no-op in a project with no docs/plans", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "proj-"));
  const r = runHook(projectDir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "", "a project that never ran a pipeline must see nothing");
});

test("the hook is a silent no-op when every run is already sealed", () => {
  const { projectDir } = makeProject({ sealed: true });
  const r = runHook(projectDir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("the hook seals a finished run the orchestrator forgot, and says so", () => {
  const { projectDir, runDir } = makeProject({ slug: "forgotten-run" });
  const r = runHook(projectDir);

  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.match(out.systemMessage, /sealed by Stop hook/);
  assert.match(out.systemMessage, /forgotten-run/, "the message must name the run it sealed");

  const t = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  assert.equal(t.sealed_by, "stop-hook");
});

test("the hook never exits 2 — for Stop that would block the agent from stopping", () => {
  const { projectDir } = makeProject({ runJson: false });   // gate shut: unprovable
  const r = runHook(projectDir);
  assert.notEqual(r.status, 2,
    "exit 2 on Stop means 'do not stop' and feeds stderr back as an instruction — a " +
    "sealing net that can trap the user in a loop is worse than no net");
  assert.equal(r.status, 0);
});
