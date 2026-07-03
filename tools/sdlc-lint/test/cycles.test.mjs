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
