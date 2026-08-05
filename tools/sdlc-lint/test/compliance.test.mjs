import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { auditRun } from "../lib/compliance.mjs";
import { parseContracts } from "../lib/contracts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "compliance");
const REPO = resolve(HERE, "..", "..", "..");
const PROJECTS = join(FIX, "projects");
const run = (name) => join(FIX, "runs", name);

const SKILLDIR = join(REPO, "plugins/sdlc/skills/pipeline-orchestrator");
const { contracts } = parseContracts([join(SKILLDIR, "SKILL.md"), join(SKILLDIR, "contracts-retired.md")]);
const audit = (name) => auditRun(run(name), contracts, { projectsRoot: PROJECTS });
const verdict = (res, id) => res.verdicts.find((v) => v.id === id);

test("a fully compliant run of the old era passes every contract that applied to it", () => {
  const res = audit("compliant");                       // dated 2026-07-28
  assert.equal(res.status, "auditable");
  assert.deepEqual(res.verdicts.filter((v) => v.verdict !== "pass" && v.verdict !== "na"), []);
  // The tail was three calls back then, and the collapsed contract did not exist yet.
  assert.equal(verdict(res, "5b-finish").reason, "predates");
});

test("a run of the new era passes the collapsed contract and retires the old three", () => {
  const res = audit("sealed");                          // dated 2026-07-30
  assert.equal(verdict(res, "5b-finish").verdict, "pass");
  for (const id of ["5-clock", "5b-0-enrich", "5b-2-report"]) {
    assert.equal(verdict(res, id).reason, "retired", id);
  }
  assert.deepEqual(res.verdicts.filter((v) => v.verdict === "fail"), []);
});

test("the incident shape fails 5b-0-enrich", () => {
  const res = audit("incident");
  assert.equal(verdict(res, "5b-0-enrich").verdict, "fail");
  assert.equal(verdict(res, "5b-2-report").verdict, "pass");
});

test("a resumed run unions its sessions rather than picking one", () => {
  const res = audit("resumed");
  assert.equal(res.sessions.length, 2);
  // The second session spells the call unquoted (`.../cli.mjs enrich`) while the
  // first uses SKILL.md's quoted form. A pattern pinned to one of them scored a real
  // enrichment as a miss on the first audit — the contract must match the command,
  // not the shell quoting around its path.
  assert.equal(verdict(res, "5b-0-enrich").verdict, "pass");
});

test("agent_dispatch matches the plugin-namespaced form of the agent name", () => {
  // The fixture's second session dispatches `sdlc:session-recorder`; the contract
  // names the bare agent. Strict equality here reported a flat 0% on the first real
  // audit — the contract was measuring the install namespace, not the step.
  assert.equal(verdict(audit("resumed"), "6-journal").verdict, "pass");
});

test("a run with no resolvable agent id is unauditable and yields no verdicts", () => {
  const res = audit("no-anchor");
  assert.equal(res.status, "unauditable");
  assert.equal(res.reason, "no-agent-ids");
  assert.deepEqual(res.verdicts, []);
});

test("a contract newer than the run is na: predates", () => {
  const v = verdict(audit("old"), "3d-1b-phase-cost");
  assert.equal(v.verdict, "na");
  assert.equal(v.reason, "predates");
});

test("once-per-phase short of its denominator is partial, with the fraction", () => {
  const v = verdict(audit("partial"), "3d-1b-phase-cost");
  assert.equal(v.verdict, "partial");
  assert.equal(v.matched, 2);
  assert.equal(v.expected, 3);
});

test("the run date comes from started_at when telemetry carries one", () => {
  const res = audit("compliant");
  assert.equal(res.date_source, "started_at");
  assert.equal(res.date, "2026-07-28");
});

test("a run that cannot be dated from its own content is scored against nothing", () => {
  // RETIRED in place (issue #116): this asserted the mtime fallback. mtime is not a property of
  // a run — a `cp -R` without `-p` restamps it — and the run date decides every `predates`
  // verdict and therefore every denominator. The full date chain is tested in the block below;
  // what this pins now is the end of it, which is silence rather than a guess.
  const res = audit("no-date");
  assert.equal(res.date, null);
  assert.equal(res.date_source, "unresolved");
  assert.equal(res.status, "auditable", "the run is still readable — it just cannot be placed in time");
  assert.ok(res.verdicts.length > 0);
  assert.ok(res.verdicts.every((v) => v.verdict === "na" && v.reason === "undated"),
    "an undated run must contribute to no rate at all; a misdated one contributes to all of them");
});

test("plugin_version is surfaced when telemetry carries it", () => {
  assert.equal(audit("compliant").plugin_version, "1.14.1");
  assert.equal(audit("incident").plugin_version, null);
});

test("sealed_by is surfaced, and absent on runs that predate the seal marker", () => {
  // Orthogonal to every verdict: it says which path sealed the run, not whether the
  // orchestrator followed a step. The auditor reads it so the two can be read together.
  assert.equal(audit("incident").sealed_by, null);
});

test("a contract retired before the run is na: retired", () => {
  const retired = [{ id: "gone", requires: "bash_match", pattern: "date -u",
    cardinality: "once-per-run", since: "2026-07-06", until: "2026-07-10", applies_when: [] }];
  const res = auditRun(run("compliant"), retired, { projectsRoot: PROJECTS });   // run dated 2026-07-28
  assert.equal(res.verdicts[0].verdict, "na");
  assert.equal(res.verdicts[0].reason, "retired");
});

test("a run inside the retirement window is still judged", () => {
  const retired = [{ id: "still-live", requires: "bash_match", pattern: "date -u",
    cardinality: "once-per-run", since: "2026-07-06", until: "2026-07-31", applies_when: [] }];
  const res = auditRun(run("compliant"), retired, { projectsRoot: PROJECTS });
  assert.equal(res.verdicts[0].verdict, "pass");
});

// ---- issue #116: the run date comes from the run, never from the filesystem -------------
//
// mtime is not a property of a run. Copying, restoring, archiving or syncing a directory
// rewrites it, and the date decides every `predates` verdict and so every denominator. A
// `cp -R` without `-p` while merging two corpora moved three published rates by up to 37
// points — `5b-finish` from 100% to 63% — and both outputs looked equally healthy.

/** A run directory plus a projects root, built on disk so the whole chain is exercised. */
function dated({ startedAt = null, anchor = null, checkpointAt = null, transcriptAt = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-date-"));
  const runDir = join(dir, "run");
  const projects = join(dir, "projects", "proj");
  const subagents = join(projects, "sess", "subagents");
  mkdirSync(join(runDir, ".checkpoint"), { recursive: true });
  mkdirSync(subagents, { recursive: true });

  const tel = { task_slug: "r", phases: [{ phase: "development", agent_id: "abc123abc123" }] };
  if (startedAt) tel.started_at = startedAt;
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify(tel));
  if (anchor != null) writeFileSync(join(runDir, ".checkpoint", "_started_at"), String(anchor));
  if (checkpointAt) {
    writeFileSync(join(runDir, ".checkpoint", "development.json"),
      JSON.stringify({ phase: "development", agent_id: "abc123abc123", completed_at: checkpointAt }));
  }
  writeFileSync(join(subagents, "agent-abc123abc123.jsonl"), "");
  writeFileSync(join(projects, "sess.jsonl"),
    transcriptAt ? JSON.stringify({ timestamp: transcriptAt, message: { role: "assistant", content: [] } }) : "");
  return { dir, runDir, projects };
}
const dateOf = (w) => auditRun(w.runDir, contracts, { projectsRoot: w.projects });

test("#116 chain 1: telemetry's own started_at wins", () => {
  const w = dated({ startedAt: "2026-07-28T10:00:00Z", anchor: 1700000000, checkpointAt: "2020-01-01T00:00:00Z" });
  try {
    const r = dateOf(w);
    assert.equal(r.date_source, "started_at");
    assert.equal(r.date, "2026-07-28");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("#116 chain 2: the .checkpoint/_started_at anchor, in epoch SECONDS", () => {
  // ADR-0014's machine anchor: `date -u +%s`. Read as seconds, or the run lands in 1970 and
  // predates every contract there is.
  const w = dated({ anchor: 1785304015, checkpointAt: "2020-01-01T00:00:00Z" });
  try {
    const r = dateOf(w);
    assert.equal(r.date_source, "checkpoint_anchor");
    assert.equal(r.date, "2026-07-29");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("#116 chain 2b: a millisecond anchor is not read as 1970", () => {
  const w = dated({ anchor: 1785304015000 });
  try { assert.equal(dateOf(w).date, "2026-07-29"); } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("#116 chain 3: the oldest checkpoint's completed_at, model-typed but run-specific", () => {
  const w = dated({ checkpointAt: "2026-07-29T09:00:00Z", transcriptAt: "2020-01-01T00:00:00Z" });
  try {
    const r = dateOf(w);
    assert.equal(r.date_source, "checkpoint_completed_at");
    assert.equal(r.date, "2026-07-29");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("#116 chain 4: the owning session transcript, last because it dates the SESSION", () => {
  // Harness-written and reliable, but a resumed session can start days before the run it later
  // performs — which would wrongly age the run and turn live contracts into `predates`.
  const w = dated({ transcriptAt: "2026-07-30T08:00:00Z" });
  try {
    const r = dateOf(w);
    assert.equal(r.date_source, "session_transcript");
    assert.equal(r.date, "2026-07-30");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("#116 acceptance: a copy WITHOUT -p produces the same verdicts as the original", () => {
  // The literal reproduction. `cpSync` does not preserve mtimes, which is what `cp -R` did.
  const w = dated({ anchor: 1785304015 });
  const copyRoot = mkdtempSync(join(tmpdir(), "sdlc-datecopy-"));
  try {
    const copied = join(copyRoot, "run");
    cpSync(w.runDir, copied, { recursive: true });
    const before = dateOf(w);
    const after = auditRun(copied, contracts, { projectsRoot: w.projects });
    assert.notEqual(statSync(join(copied, "_telemetry.json")).mtimeMs,
      statSync(join(w.runDir, "_telemetry.json")).mtimeMs, "the copy really did restamp mtime");
    assert.equal(after.date, before.date, "…and the audited date did not move with it");
    assert.deepEqual(after.verdicts.map((v) => `${v.id}:${v.verdict}:${v.reason}`),
      before.verdicts.map((v) => `${v.id}:${v.verdict}:${v.reason}`));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
    rmSync(copyRoot, { recursive: true, force: true });
  }
});
