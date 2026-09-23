import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkspace, computeReentry, resumePreflight } from "../lib/resume.mjs";
import { loadCheckpoints, doneUnitIds } from "../../../plugins/sdlc/tools/run/reentry.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const resumeFixtures = readdirSync(FIX, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name.startsWith("resume-"))
  .map(e => e.name)
  .sort();

for (const name of resumeFixtures) {
  test(`re-entry: ${name}`, () => {
    const expected = JSON.parse(readFileSync(join(FIX, name, "expected-reentry.json"), "utf8"));
    const got = resolveWorkspace(join(FIX, name));
    assert.deepEqual(got.completed.sort(), [...expected.completed].sort(), "completed set");
    assert.equal(got.reenter_at, expected.reenter_at, "reenter_at");
    assert.deepEqual(got.remaining, expected.remaining, "remaining");
  });
}

test("corrupt/.tmp checkpoint is treated as incomplete and warns", () => {
  const got = resolveWorkspace(join(FIX, "resume-corrupt-tmp"));
  assert.equal(got.reenter_at, "security");
  assert.ok(got.warnings.length >= 1, "expected a warning for the corrupt checkpoint");
});

test("missing _run.json throws a clear error", () => {
  assert.throws(() => resolveWorkspace(join(FIX, "does-not-exist")), /_run\.json/);
});

// PR #25 review — an empty members/aspects collection must NOT resolve to "done"
// (vacuous Array.every → true would silently skip a phase that never ran).
test("parallel group with no members is NOT done (not vacuously complete)", () => {
  const r = computeReentry(
    [{ name: "parallel:a+b", kind: "parallel" }, { name: "qa", kind: "plain", aspects: null }],
    new Map(),
  );
  assert.equal(r.reenter_at, "parallel:a+b");
  assert.deepEqual(r.remaining, ["parallel:a+b", "qa"]);
});

test("aspect-aware phase with empty aspects is NOT done (not vacuously complete)", () => {
  const r = computeReentry(
    [{ name: "development", kind: "plain", aspects: [] }, { name: "qa", kind: "plain", aspects: null }],
    new Map(),
  );
  assert.equal(r.reenter_at, "development");
  assert.deepEqual(r.remaining, ["development", "qa"]);
});

test("resolveWorkspace throws a clear error when resolved_phases is not an array", () => {
  // Named without the `resume-` prefix so the fixture auto-loop / `sdlc-lint resume`
  // runner don't try to resolve this deliberately-malformed workspace.
  const dir = join(FIX, "_malformed-run");
  assert.throws(() => resolveWorkspace(dir), /resolved_phases/);
});

// Issue #168 — the dry-run preview needs the done set WITHOUT the resolved DAG that
// resolveWorkspace demands, because at preview time the DAG is the plan being previewed and no
// _run.json has been written. doneUnitIds keeps "done" a single definition across both callers.
test("doneUnitIds returns exactly the terminal units", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-done-"));
  try {
    const cp = join(dir, ".checkpoint");
    mkdirSync(cp, { recursive: true });
    writeFileSync(join(cp, "business_analysis.json"), JSON.stringify({ status: "completed" }));
    writeFileSync(join(cp, "security.json"), JSON.stringify({ status: "skipped" }));
    writeFileSync(join(cp, "development-android.json"), JSON.stringify({ status: "completed" }));
    writeFileSync(join(cp, "qa.json"), JSON.stringify({ status: "in_progress" }));
    writeFileSync(join(cp, "development-plan.json"), JSON.stringify({ status: "approved" }));
    writeFileSync(join(cp, "_run.json"), JSON.stringify({ resolved_phases: [] }));
    writeFileSync(join(cp, "half.json.tmp"), "{");
    writeFileSync(join(cp, "broken.json"), "not json");
    writeFileSync(join(cp, "nostatus.json"), JSON.stringify({ cost_usd: 1 }));

    const { units, warnings } = loadCheckpoints(cp);
    assert.deepEqual([...doneUnitIds(units)].sort(),
      ["business_analysis", "development-android", "security"],
      "completed and skipped only — approved plan passes are NOT done, and _run.json is not a unit");
    assert.equal(warnings.length, 2, "the unparseable one and the status-less one are each reported");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ADR-0031 — resumePreflight(): the two safety gates claude-sdlc has and this codebase's
// --resume documented as a non-goal (commands/start.md).
function makeRun({ branchName, ageHoursOfNewestCheckpoint } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "resume-preflight-"));
  const checkpointDir = join(dir, ".checkpoint");
  mkdirSync(checkpointDir, { recursive: true });
  const run = { task_slug: "t", workflow: "default", resolved_phases: [{ name: "development", kind: "plain" }] };
  if (branchName !== undefined) run.branch_name = branchName;
  writeFileSync(join(checkpointDir, "_run.json"), JSON.stringify(run));
  const cpPath = join(checkpointDir, "development.json");
  writeFileSync(cpPath, JSON.stringify({ phase: "development", status: "completed", completed_at: new Date().toISOString() }));
  if (ageHoursOfNewestCheckpoint != null) {
    const past = new Date(Date.now() - ageHoursOfNewestCheckpoint * 3600 * 1000);
    utimesSync(cpPath, past, past);
  }
  return { runPath: join(checkpointDir, "_run.json"), checkpointDir };
}

test("resumePreflight: branch mismatch when branch_name recorded and differs", () => {
  const { runPath, checkpointDir } = makeRun({ branchName: "feature/x" });
  const r = resumePreflight({ runPath, checkpointDir, currentBranch: "develop" });
  assert.equal(r.branchOk, false);
  assert.equal(r.runBranch, "feature/x");
});

test("resumePreflight: no branch_name recorded → branchOk true (old run, fail-open)", () => {
  const { runPath, checkpointDir } = makeRun({});
  const r = resumePreflight({ runPath, checkpointDir, currentBranch: "develop" });
  assert.equal(r.branchOk, true);
  assert.equal(r.runBranch, null);
});

test("resumePreflight: fresh checkpoint → not stale", () => {
  const { runPath, checkpointDir } = makeRun({ branchName: "develop", ageHoursOfNewestCheckpoint: 0.1 });
  const r = resumePreflight({ runPath, checkpointDir, currentBranch: "develop", maxAgeMs: 6 * 3600 * 1000 });
  assert.equal(r.stale, false);
});

test("resumePreflight: 7h-old newest checkpoint → stale under 6h threshold", () => {
  const { runPath, checkpointDir } = makeRun({ branchName: "develop", ageHoursOfNewestCheckpoint: 7 });
  const r = resumePreflight({ runPath, checkpointDir, currentBranch: "develop", maxAgeMs: 6 * 3600 * 1000 });
  assert.equal(r.stale, true);
  assert.ok(r.ageMs >= 7 * 3600 * 1000 * 0.99);
});

// H3 "machine values" convention: SKILL.md prints {ageHours} verbatim from this tool's own
// output rather than computing hours-from-ageMs itself — so ageHours must be present and correct.
test("resumePreflight: ageHours is the rounded-hours form of ageMs, not left for the caller to compute", () => {
  const { runPath, checkpointDir } = makeRun({ branchName: "develop", ageHoursOfNewestCheckpoint: 7 });
  const r = resumePreflight({ runPath, checkpointDir, currentBranch: "develop", maxAgeMs: 6 * 3600 * 1000 });
  assert.equal(r.ageHours, Math.round(r.ageMs / 3600000));
  assert.equal(r.ageHours, 7);
});

test("resumePreflight: no checkpoints yet → ageHours is null, same as ageMs", () => {
  const dir = mkdtempSync(join(tmpdir(), "resume-preflight-"));
  const checkpointDir = join(dir, ".checkpoint");
  mkdirSync(checkpointDir, { recursive: true });
  const r = resumePreflight({ runPath: join(checkpointDir, "_run.json"), checkpointDir, currentBranch: "develop" });
  assert.equal(r.ageHours, null);
  rmSync(dir, { recursive: true, force: true });
});

test("resumePreflight: missing _run.json → branchOk true (fail-open, nothing recorded yet)", () => {
  const dir = mkdtempSync(join(tmpdir(), "resume-preflight-"));
  const checkpointDir = join(dir, ".checkpoint");
  mkdirSync(checkpointDir, { recursive: true });
  const r = resumePreflight({ runPath: join(checkpointDir, "_run.json"), checkpointDir, currentBranch: "develop" });
  assert.equal(r.branchOk, true);
  assert.equal(r.runBranch, null);
  rmSync(dir, { recursive: true, force: true });
});

test("resumePreflight: empty checkpoint dir → not stale, no newest path", () => {
  const dir = mkdtempSync(join(tmpdir(), "resume-preflight-"));
  const checkpointDir = join(dir, ".checkpoint");
  mkdirSync(checkpointDir, { recursive: true });
  const r = resumePreflight({ runPath: join(checkpointDir, "_run.json"), checkpointDir, currentBranch: "develop" });
  assert.equal(r.stale, false);
  assert.equal(r.ageMs, null);
  assert.equal(r.newestCheckpointPath, null);
  rmSync(dir, { recursive: true, force: true });
});

// Fixture-backed cases (Step 11) — the same gates exercised against on-disk fixtures rather
// than mkdtemp scratch dirs, matching how resolveWorkspace is exercised both ways in this file.
test("resumePreflight against fixture resume-branch-mismatch: flags the recorded branch", () => {
  const checkpointDir = join(FIX, "resume-branch-mismatch", ".checkpoint");
  const r = resumePreflight({ runPath: join(checkpointDir, "_run.json"), checkpointDir, currentBranch: "develop" });
  assert.equal(r.branchOk, false);
  assert.equal(r.runBranch, "feature/other-branch");
});

test("resumePreflight against fixture resume-stale: flags a checkpoint backdated past the threshold", () => {
  // Backdating mtimes must never touch the committed fixture itself — utimesSync mutates the
  // file it targets, and that mutation would otherwise persist on disk as a side effect of
  // running the test suite. Copy the fixture into a scratch dir first (same mkdtempSync pattern
  // used elsewhere in this file) and backdate the copy only.
  const dir = mkdtempSync(join(tmpdir(), "resume-stale-"));
  cpSync(join(FIX, "resume-stale"), dir, { recursive: true });
  const checkpointDir = join(dir, ".checkpoint");
  try {
    // Git does not preserve mtimes across checkout, so the fixture's staleness is set here at
    // test time rather than relied on from the committed file's mtime. Every phase checkpoint
    // (not _run.json, which resumePreflight already excludes) must be backdated — otherwise a
    // freshly-checked-out sibling file newer than the one we backdate would still read as "newest".
    const past = new Date(Date.now() - 7 * 3600 * 1000);
    for (const f of ["business_analysis.json", "development-database.json", "development-backend.json"]) {
      utimesSync(join(checkpointDir, f), past, past);
    }
    const r = resumePreflight({ runPath: join(checkpointDir, "_run.json"), checkpointDir, currentBranch: "develop", maxAgeMs: 6 * 3600 * 1000 });
    assert.equal(r.stale, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
