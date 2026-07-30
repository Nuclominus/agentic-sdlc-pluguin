import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import { checkWorkflow, checkAllWorkflows } from "../lib/cycles.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("duplicate phase name is flagged", () => {
  const doc = YAML.parse(readFileSync(
    resolve(REPO, "plugins/sdlc/workflows/test-fixtures/cyclic.yaml"), "utf8"));
  const { ok, errors } = checkWorkflow(doc);
  assert.equal(ok, false);
  assert.match(errors.join(" "), /duplicate phase 'business_analysis'/);
});

test("android-feature loop back-edge is valid", () => {
  const doc = YAML.parse(readFileSync(
    resolve(REPO, "plugins/android-foundation/workflows/android-feature.yaml"), "utf8"));
  assert.equal(checkWorkflow(doc).ok, true);
});

test("loop return_to to a later phase is flagged", () => {
  const doc = { name: "bad", phases: [
    { name: "review", loop: { return_to: "development", max_rounds: 2 } },
    "development",
  ]};
  const { ok, errors } = checkWorkflow(doc);
  assert.equal(ok, false);
  assert.match(errors.join(" "), /must be an EARLIER phase/);
});

test("all real workflows are clean", () => {
  const failed = checkAllWorkflows(REPO).filter(r => !r.ok);
  assert.equal(failed.length, 0, JSON.stringify(failed, null, 2));
});

test("a gate pointing at a LATER phase is rejected", () => {
  // Step 3-gate fails OPEN on an unparsable source, so a backwards gate does not error at
  // runtime — it dispatches the gated phase on every single run instead of never. Silent.
  const r = checkWorkflow({
    name: "x",
    phases: [
      { name: "remediation", gate: { after: ["security"], min_severity: "high" } },
      "security",
    ],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /gate\.after='security' must be an EARLIER phase/);
});

test("a gate pointing at an undeclared phase is rejected", () => {
  const r = checkWorkflow({
    name: "x",
    phases: ["development", { name: "remediation", gate: { after: ["audit"], min_severity: "high" } }],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /gate\.after='audit' is not a declared phase/);
});

test("a gate may read a member of an earlier parallel group", () => {
  // The shipped android shape: security runs inside parallel:[security, test], and the gate
  // sits in a phase after the group — the only place it can, since parallel members are
  // bare strings that cannot carry control flow.
  const r = checkWorkflow({
    name: "x",
    phases: [
      "development",
      { parallel: ["security", "test"] },
      { name: "remediation", gate: { after: ["security"], min_severity: "high" } },
    ],
  });
  assert.deepEqual(r.errors, []);
});

test("every shipped recipe that gates does so on an earlier phase", () => {
  const bad = checkAllWorkflows(REPO).filter(r => !r.ok);
  assert.deepEqual(bad, []);
});
