import { test } from "node:test";
import assert from "node:assert/strict";
import { median, spread, runMetrics, recommendN, verdict } from "../compare.mjs";

const result = (cacheRead, peak, flags = []) => ({
  manifest: { arm: "a", run: 1 },
  flags,
  telemetry: {
    task_slug: "t", cost_basis: "transcript",
    total_input_tokens: 0, total_output_tokens: 0,
    total_cached_input_tokens: cacheRead, total_cache_creation_tokens: 0,
    total_subagent_tokens: 0, total_cost_usd: 1.0,
    phases: [
      { phase: "development", usage_source: "transcript", turns: 10, peak_prefix_tokens: peak, cached_input_tokens: cacheRead },
      { phase: "documentation", usage_source: "transcript", turns: 5, peak_prefix_tokens: Math.round(peak / 2), cached_input_tokens: 0 },
    ],
  },
});

test("median of an odd count is the middle value", () => {
  assert.equal(median([3, 1, 2]), 2);
});

test("median of an even count averages the two middle values", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("spread is the range over the minimum", () => {
  assert.equal(spread([100, 110]), 0.1);
  assert.equal(spread([100]), 0);
  assert.equal(spread([]), 0);
});

test("runMetrics takes the sum for cache-read and the max for peak", () => {
  const m = runMetrics(result(900000, 74000));
  assert.equal(m.total_cache_read, 900000);
  assert.equal(m.peak_prefix, 74000);   // max across phases, not the last one
  assert.equal(m.turns, 15);
});

test("recommendN maps spread to N at the documented boundaries", () => {
  assert.equal(recommendN(0.09).n, 3);
  assert.equal(recommendN(0.10).n, 4);
  assert.equal(recommendN(0.24).n, 4);
  assert.equal(recommendN(0.25).n, null);
  assert.match(recommendN(0.25).action, /enlarge/i);
  assert.doesNotMatch(recommendN(0.25).action, /shrink/i);
});

test("no verdict below three runs per arm", () => {
  const v = verdict([1, 2], [3, 4, 5], 0.05);
  assert.equal(v.moved, null);
  assert.match(v.reason, /at least 3/);
});

test("no verdict when the difference is inside the noise", () => {
  const v = verdict([100, 100, 100], [96, 96, 96], 0.20);
  assert.equal(v.moved, false);
  assert.match(v.reason, /no measurable effect/i);
});

test("a difference larger than the noise counts as movement", () => {
  const v = verdict([100, 100, 100], [50, 50, 50], 0.10);
  assert.equal(v.moved, true);
  assert.equal(v.delta, -0.5);
});

test("verdict language never claims statistical significance", () => {
  const all = [verdict([1,2], [3,4,5], 0.05), verdict([100,100,100],[96,96,96],0.2), verdict([100,100,100],[50,50,50],0.1)];
  for (const v of all) {
    assert.doesNotMatch(v.reason, /significant|p\s*[<=]|p-value/i);
  }
});
