import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseContracts } from "../lib/contracts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "compliance");
const REPO = resolve(HERE, "..", "..", "..");

test("parses every sdlc-contract block and ignores other fenced blocks", () => {
  const { contracts, errors } = parseContracts(join(FIX, "skill-contracts-ok.md"));
  assert.deepEqual(errors, []);
  assert.deepEqual(contracts.map((c) => c.id), ["5b-0-enrich", "6-journal"]);
  assert.equal(contracts[0].requires, "bash_match");
  assert.equal(contracts[0].cardinality, "once-per-run");
  assert.equal(contracts[0].since, "2026-07-07");
  assert.deepEqual(contracts[0].applies_when, []);
});

test("parses applies_when into structured conditions", () => {
  const { contracts } = parseContracts(join(FIX, "skill-contracts-ok.md"));
  assert.deepEqual(contracts[1].applies_when, [
    { field: "headless_mode", op: "==", value: false },
  ]);
});

test("every error class is reported, and none is thrown", () => {
  let res;
  assert.doesNotThrow(() => { res = parseContracts(join(FIX, "skill-contracts-bad.md")); });
  const joined = res.errors.join("\n");
  assert.match(joined, /duplicate id 'dup'/);
  assert.match(joined, /unknown requires 'telepathy'/);
  assert.match(joined, /uncompilable pattern/);
  assert.match(joined, /since must be YYYY-MM-DD/);
  assert.match(joined, /unparseable applies_when condition/);
  assert.match(joined, /not a mapping|missing required field/);
});

test("a contract with errors is excluded from the returned set", () => {
  const { contracts } = parseContracts(join(FIX, "skill-contracts-bad.md"));
  assert.equal(contracts.some((c) => c.id === "bad-regex"), false);
});

test("a missing file is an error, not a throw", () => {
  const { contracts, errors } = parseContracts(join(FIX, "no-such-file.md"));
  assert.deepEqual(contracts, []);
  assert.match(errors.join(" "), /cannot read/);
});

test("the real orchestrator SKILL.md parses with zero errors", () => {
  const { errors } = parseContracts(
    join(REPO, "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md"));
  assert.deepEqual(errors, []);
});

test("the orchestrator declares exactly the v1 contract set", () => {
  const { contracts } = parseContracts(
    join(REPO, "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md"));
  assert.deepEqual(contracts.map((c) => c.id).sort(), [
    "2-4-anchor", "3d-1b-phase-cost", "5-clock",
    "5b-0-enrich", "5b-2-report", "6-journal",
  ]);
});
