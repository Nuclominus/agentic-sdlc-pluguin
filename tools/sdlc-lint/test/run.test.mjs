import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sealRunClock } from "../lib/run.mjs";

// A run directory with the given telemetry and, optionally, a machine anchor.
function makeRun(tel, anchorEpoch) {
  const dir = mkdtempSync(join(tmpdir(), "run-"));
  writeFileSync(join(dir, "_telemetry.json"), JSON.stringify(tel, null, 2) + "\n");
  if (anchorEpoch !== undefined) {
    mkdirSync(join(dir, ".checkpoint"), { recursive: true });
    writeFileSync(join(dir, ".checkpoint", "_started_at"), `${anchorEpoch}\n`);
  }
  return dir;
}
const tel = (dir) => JSON.parse(readFileSync(join(dir, "_telemetry.json"), "utf8"));

// 2026-07-28T11:00:00Z. Verified: node -e 'console.log(new Date(1785236400000).toISOString())'
const ANCHOR = 1785236400;

test("sealRunClock derives all three keys from the anchor", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = sealRunClock(dir, { now: (ANCHOR + 12405) * 1000 });
  assert.equal(r.anchored, true);
  assert.equal(r.degraded, null);
  assert.equal(r.wall_clock_seconds, 12405);
  assert.equal(r.started_at, "2026-07-28T11:00:00Z");
  assert.equal(r.completed_at, "2026-07-28T14:26:45Z");
  const t = tel(dir);
  assert.equal(t.started_at, r.started_at);
  assert.equal(t.completed_at, r.completed_at);
  assert.equal(t.wall_clock_seconds, 12405);
});

test("timestamps carry no milliseconds — the corpus shape is %FT%TZ", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = sealRunClock(dir, { now: (ANCHOR + 1) * 1000 + 500 });
  assert.match(r.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(r.completed_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("a clock that runs backwards clamps the duration to zero rather than going negative", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = sealRunClock(dir, { now: (ANCHOR - 1000) * 1000 });
  assert.equal(r.wall_clock_seconds, 0);
  assert.equal(r.started_at, r.completed_at);
});

test("no anchor, but telemetry already has timestamps: leave them alone and say so", () => {
  const dir = makeRun({ task_slug: "x", started_at: "2026-07-01T00:00:00Z",
    completed_at: "2026-07-01T00:10:00Z", wall_clock_seconds: 600, phases: [] });
  const r = sealRunClock(dir, { now: (ANCHOR + 12405) * 1000 });
  assert.equal(r.anchored, false);
  assert.equal(r.degraded, "no-anchor");
  assert.equal(r.changed, false);
  assert.equal(tel(dir).started_at, "2026-07-01T00:00:00Z");
  assert.equal(tel(dir).wall_clock_seconds, 600);
});

test("no anchor and no timestamps: unknown is null, never a measured zero", () => {
  const dir = makeRun({ task_slug: "x", phases: [] });
  const r = sealRunClock(dir, { now: (ANCHOR + 12405) * 1000 });
  assert.equal(r.degraded, "no-anchor-no-values");
  assert.equal(r.started_at, null);
  assert.equal(r.wall_clock_seconds, null);
  assert.equal(r.completed_at, "2026-07-28T14:26:45Z");
  const t = tel(dir);
  assert.equal(t.started_at, null);
  assert.equal(t.wall_clock_seconds, null);
});

test("a garbage anchor is treated as no anchor at all", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, "not-a-number");
  assert.equal(sealRunClock(dir, { now: (ANCHOR + 12405) * 1000 }).degraded, "no-anchor-no-values");
});

test("an anchor with surrounding whitespace still parses", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, `  ${ANCHOR}  `);
  assert.equal(sealRunClock(dir, { now: (ANCHOR + 10) * 1000 }).wall_clock_seconds, 10);
});

test("a run directory with no telemetry throws — there is nothing to seal", () => {
  const dir = mkdtempSync(join(tmpdir(), "run-"));
  assert.throws(() => sealRunClock(dir), /no _telemetry\.json/);
});
