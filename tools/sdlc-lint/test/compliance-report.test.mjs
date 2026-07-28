import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, renderText } from "../lib/compliance-report.mjs";

const contracts = [
  { id: "a", requires: "bash_match", pattern: "x", cardinality: "once-per-run", since: "2026-01-01", applies_when: [] },
  { id: "b", requires: "bash_match", pattern: "y", cardinality: "once-per-phase", since: "2026-01-01", applies_when: [] },
];

const results = [
  { run: "r1", status: "auditable", date: "2026-07-01", date_source: "started_at", plugin_version: null,
    verdicts: [{ id: "a", verdict: "pass", reason: null, matched: 1, expected: 1 },
               { id: "b", verdict: "partial", reason: null, matched: 1, expected: 3 }] },
  { run: "r2", status: "auditable", date: "2026-07-02", date_source: "mtime", plugin_version: "1.14.1",
    verdicts: [{ id: "a", verdict: "fail", reason: null, matched: 0, expected: 1 },
               { id: "b", verdict: "na", reason: "predates", matched: 0, expected: 0 }] },
  { run: "r3", status: "unauditable", reason: "no-agent-ids", date: null, date_source: "none",
    plugin_version: null, verdicts: [] },
];

test("rate counts only pass over applicable runs, never partial", () => {
  const agg = aggregate(results, contracts);
  const a = agg.contracts.find((c) => c.id === "a");
  assert.deepEqual([a.pass, a.partial, a.fail, a.na], [1, 0, 1, 0]);
  assert.equal(a.denominator, 2);
  assert.equal(a.rate, 0.5);

  const b = agg.contracts.find((c) => c.id === "b");
  assert.deepEqual([b.pass, b.partial, b.fail, b.na], [0, 1, 0, 1]);
  assert.equal(b.denominator, 1);
  assert.equal(b.rate, 0);
});

test("unauditable runs are excluded, never folded into a denominator", () => {
  const agg = aggregate(results, contracts);
  assert.equal(agg.auditable, 2);
  assert.deepEqual(agg.excluded, [{ run: "r3", reason: "no-agent-ids" }]);
});

test("a denominator below 5 is annotated thin", () => {
  const agg = aggregate(results, contracts);
  assert.ok(agg.contracts.every((c) => c.annotations.includes(`thin denominator (n=${c.denominator})`)));
});

test("rates are annotated provisional while any audited run lacks plugin_version", () => {
  const agg = aggregate(results, contracts);
  assert.ok(agg.contracts.every((c) => c.annotations.includes("provisional")));
});

test("5b-2-report carries its confounder annotation", () => {
  const withReport = [{ id: "5b-2-report", requires: "bash_match", pattern: "z",
                        cardinality: "once-per-run", since: "2026-01-01", applies_when: [] }];
  const rows = aggregate([{ run: "r", status: "auditable", date: "2026-07-01", date_source: "started_at",
    plugin_version: "1.14.1",
    verdicts: [{ id: "5b-2-report", verdict: "pass", reason: null, matched: 1, expected: 1 }] }], withReport);
  assert.ok(rows.contracts[0].annotations.includes("confounded by --no-report (not recorded)"));
});

test("a zero denominator yields a null rate rather than NaN", () => {
  const agg = aggregate([{ run: "r", status: "auditable", date: "2026-07-01", date_source: "started_at",
    plugin_version: "1.14.1",
    verdicts: [{ id: "a", verdict: "na", reason: "predates", matched: 0, expected: 0 }] }], [contracts[0]]);
  assert.equal(agg.contracts[0].rate, null);
});

test("the rendered report names all three sections", () => {
  const text = renderText(aggregate(results, contracts), results);
  assert.match(text, /per-contract/i);
  assert.match(text, /per-run/i);
  assert.match(text, /excluded/i);
  assert.match(text, /no-agent-ids/);
});
