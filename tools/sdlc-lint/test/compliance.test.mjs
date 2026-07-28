import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { auditRun } from "../lib/compliance.mjs";
import { parseContracts } from "../lib/contracts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "compliance");
const REPO = resolve(HERE, "..", "..", "..");
const PROJECTS = join(FIX, "projects");
const run = (name) => join(FIX, "runs", name);

const { contracts } = parseContracts(join(REPO, "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md"));
const audit = (name) => auditRun(run(name), contracts, { projectsRoot: PROJECTS });
const verdict = (res, id) => res.verdicts.find((v) => v.id === id);

test("a fully compliant run passes every contract", () => {
  const res = audit("compliant");
  assert.equal(res.status, "auditable");
  assert.deepEqual(res.verdicts.filter((v) => v.verdict !== "pass"), []);
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

test("the run date falls back to the telemetry mtime, flagged as inferred", () => {
  const res = audit("no-date");
  assert.equal(res.date_source, "mtime");
  // Compared against the file's real mtime rather than a literal: git does not
  // preserve mtimes, so a checked-out fixture carries the checkout time.
  const mtime = statSync(join(run("no-date"), "_telemetry.json")).mtimeMs;
  assert.equal(res.date, new Date(mtime).toISOString().slice(0, 10));
});

test("plugin_version is surfaced when telemetry carries it", () => {
  assert.equal(audit("compliant").plugin_version, "1.14.1");
  assert.equal(audit("incident").plugin_version, null);
});
