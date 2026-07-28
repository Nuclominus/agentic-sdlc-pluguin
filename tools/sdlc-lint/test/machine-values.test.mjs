import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseRegistry, CONTRACT_PATH } from "../lib/machine-values.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "machine-values");
const REPO = resolve(HERE, "..", "..", "..");
const fixture = (name) => readFileSync(join(FIX, name), "utf8");
const contract = () => readFileSync(resolve(REPO, CONTRACT_PATH), "utf8");

test("the shipped contract's registry parses cleanly and is non-empty", () => {
  const { keys, owners, errors } = parseRegistry(contract());
  assert.deepEqual(errors, []);
  assert.ok(keys.length >= 15, `expected the full machine-owned set, got ${keys.length}`);
  for (const k of keys) assert.ok(owners.get(k), `key '${k}' names no owner`);
});

test("the registry holds the keys finish actually writes", () => {
  const { owners } = parseRegistry(contract());
  for (const k of ["cost_usd", "input_tokens", "total_cost_usd", "cache_hit_ratio",
                   "started_at", "wall_clock_seconds", "orchestration_overhead"]) {
    assert.ok(owners.has(k), `machine-owned key '${k}' missing from the registry`);
  }
});

test("model-owned values stay OUT of the registry", () => {
  const { owners } = parseRegistry(contract());
  // total_subagent_tokens is the one sum finish never recomputes (usage.mjs sums only
  // usage_source: "transcript" phases), so the model remains its only writer. agent_id and
  // qa_iterations_used exist solely in the model's context. Registering any of these would
  // make the lint demand their removal and delete the value outright.
  for (const k of ["agent_id", "subagent_tokens", "total_subagent_tokens",
                   "qa_iterations_used", "compact_summary_chars"]) {
    assert.equal(owners.has(k), false, `model-owned key '${k}' must not be in the registry`);
  }
});

test("keys sort longest-first so an error names the most specific match", () => {
  const { keys } = parseRegistry(contract());
  const i = keys.indexOf("total_input_tokens");
  const j = keys.indexOf("input_tokens");
  assert.ok(i > -1 && j > -1);
  assert.ok(i < j, "total_input_tokens must precede input_tokens");
});

test("a document with no registry block is an error, not an empty pass", () => {
  const { keys, errors } = parseRegistry(fixture("registry-no-block.md"));
  assert.deepEqual(keys, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing ```machine-values registry block/);
});

test("an empty registry block is an error — a lint with no keys checks nothing", () => {
  const { errors } = parseRegistry(fixture("registry-empty.md"));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /empty/);
});

test("a malformed entry is reported by line, and good entries around it still parse", () => {
  const { keys, errors } = parseRegistry(fixture("registry-malformed.md"));
  assert.equal(errors.length, 3);
  assert.match(errors[0], /^registry line 2: expected '<key>: <owner>'/);
  assert.match(errors[1], /^registry line 3: expected '<key>: <owner>'/);   // owner missing
  assert.match(errors[2], /^registry line 5: duplicate key 'cost_usd'/);
  assert.deepEqual(keys, ["total_cost_usd", "cost_usd"]);
});
