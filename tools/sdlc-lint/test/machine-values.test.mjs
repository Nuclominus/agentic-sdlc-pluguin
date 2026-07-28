import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  parseRegistry, scanText, violationRe, OK_MARKER, CONTRACT_PATH,
  checkContractReference, checkMachineValues, ORCHESTRATOR_PATH,
} from "../lib/machine-values.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "machine-values");
const REPO = resolve(HERE, "..", "..", "..");
const fixture = (name) => readFileSync(join(FIX, name), "utf8");
const contract = () => readFileSync(resolve(REPO, CONTRACT_PATH), "utf8");
const CLI = resolve(REPO, "tools/sdlc-lint/cli.mjs");

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

const KEYS = ["total_input_tokens", "total_cost_usd", "cache_hit_ratio", "cost_usd", "input_tokens"]
  .sort((a, b) => b.length - a.length || a.localeCompare(b));

test("each of the six real formula shapes is flagged exactly once", () => {
  const { ok, errors } = scanText(fixture("violations.md"), KEYS);
  assert.equal(ok, false);
  assert.equal(errors.length, 6);
  assert.match(errors[0], /^line 3: "cost_usd" is computed here/);
  assert.match(errors[1], /^line 4: "total_input_tokens" is computed here/);
  assert.match(errors[2], /^line 5: "total_cost_usd" is computed here/);
  assert.match(errors[3], /^line 6: "cache_hit_ratio" is computed here/);
  assert.match(errors[4], /^line 7: "total_cost_usd" is computed here/);
  assert.match(errors[5], /^line 8: "cost_usd" is computed here/);
});

test("a violation names the contract so the fix is discoverable", () => {
  assert.match(scanText(fixture("violations.md"), KEYS).errors[0], /MACHINE-VALUES\.md/);
});

test("the three near-misses that would make the check noise are NOT flagged", () => {
  // 1. `max_total_cost_usd=0.60` — a config example, rejected by the leading \b.
  // 2. `CONTEXT.running_cost_usd = 0` — the cap gate's own state, same \b rejection.
  // 3. descriptive prose about the same keys, of which SKILL.md has dozens.
  assert.deepEqual(scanText(fixture("clean.md"), KEYS), { ok: true, errors: [] });
});

test("a model-owned key is invisible to the check even when it IS a sum", () => {
  // total_subagent_tokens is absent from the registry, so its legitimate Step 5 sum passes.
  const line = "- `total_subagent_tokens` = sum of phase `subagent_tokens`.";
  assert.deepEqual(scanText(line, KEYS), { ok: true, errors: [] });
});

test("comparisons are not assignments", () => {
  for (const line of ["when `total_cost_usd` == 0", "if `cost_usd` != null", "`cost_usd` >= 1"]) {
    assert.deepEqual(scanText(line, KEYS), { ok: true, errors: [] }, line);
  }
});

test("marker on the matching line suppresses it", () => {
  assert.equal(scanText(fixture("suppressed-same-line.md"), KEYS).ok, true);
});

test("marker on the preceding line suppresses it", () => {
  assert.equal(scanText(fixture("suppressed-prev-line.md"), KEYS).ok, true);
});

test("a marker with no stated reason does not suppress", () => {
  const { ok, errors } = scanText(fixture("marker-no-reason.md"), KEYS);
  assert.equal(ok, false);
  assert.equal(errors.length, 2, "both the bare marker and the `-->`-only marker must still fail");
});

test("an empty key list scans nothing rather than building an empty alternation", () => {
  // new RegExp("\\b()\\b…") matches at every position — a registry failure must not
  // become a firehose of violations on every file in the tree.
  assert.deepEqual(scanText("cost_usd = 1", []), { ok: true, errors: [] });
});

test("violationRe captures the key it matched", () => {
  assert.equal(violationRe(KEYS).exec("- `total_cost_usd` = sum of")[1], "total_cost_usd");
});

test("OK_MARKER is the string the error message tells authors to write", () => {
  assert.ok(scanText(fixture("violations.md"), KEYS).errors[0].includes(OK_MARKER));
});

test("SKILL.md must point at the contract, so the rule has one definition", () => {
  assert.deepEqual(checkContractReference("… see MACHINE-VALUES.md for the rule …"), { ok: true, errors: [] });
  const { ok, errors } = checkContractReference("no reference at all");
  assert.equal(ok, false);
  assert.match(errors[0], /MACHINE-VALUES\.md/);
});

test("the live tree is clean, with zero escape-hatch markers", () => {
  const failed = checkMachineValues(REPO).filter(r => !r.ok);
  assert.deepEqual(failed, [], "every machine value must come from a path, not a formula");
});

test("the invariant holds without exemptions — no ok-marker anywhere in shipped prose", () => {
  // A check whose green run depends on suppressions is measuring the suppressions.
  let out = "";
  try {
    // The contract itself necessarily spells the marker out — that is where authors read
    // its syntax. Every OTHER occurrence in shipped prose is a real exemption.
    out = execFileSync("git", ["grep", "-l", OK_MARKER, "--", "plugins/", `:!${CONTRACT_PATH}`],
      { cwd: REPO, encoding: "utf8" }).trim();
  } catch (e) {
    if (e.status !== 1) throw e;   // status 1 == no matches, which is the pass
  }
  assert.equal(out, "", `unexpected machine-values exemptions in: ${out}`);
});

test("no file OTHER than SKILL.md violates the invariant", () => {
  const others = checkMachineValues(REPO).filter(r => !r.ok && r.file !== ORCHESTRATOR_PATH);
  assert.deepEqual(others, [], "the check must be silent everywhere it has nothing to say");
});

test("the contract document itself is exempt — it quotes the formulas as evidence", () => {
  const contractRow = checkMachineValues(REPO).find(r => r.file === CONTRACT_PATH);
  assert.ok(contractRow, "the contract must still be checked for a well-formed registry");
  assert.deepEqual(contractRow.errors, [],
    "its audit table quotes removed formulas; scanning it would be circular");
});

test("a missing contract is a tool error (exit 2), not a silent all-clear", () => {
  const results = checkMachineValues(join(FIX, "..", "vanilla-node"));
  assert.equal(results.length, 1);
  assert.equal(results[0].tool_error, true);
  assert.match(results[0].errors[0], /^read:/);
});

test("the CLI verb exits 0 on the clean tree", () => {
  const out = execFileSync("node", [CLI, "machine-values", "--json"], { cwd: REPO, encoding: "utf8" });
  const report = JSON.parse(out.trim().split("\n").pop());
  assert.equal(report.failed, 0);
});
