import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkspace, computeReentry } from "../lib/resume.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const resumeFixtures = readdirSync(FIX, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name.startsWith("resume-"))
  .map(e => e.name)
  .sort();

for (const name of resumeFixtures) {
  test(`re-entry: ${name}`, () => {
    const expected = JSON.parse(readFileSync(join(FIX, name, "expected-reentry.json"), "utf8"));
    const got = resolveWorkspace(join(FIX, name));
    assert.deepEqual(got.completed.sort(), [...expected.completed].sort(), "completed set");
    assert.equal(got.reenter_at, expected.reenter_at, "reenter_at");
    assert.deepEqual(got.remaining, expected.remaining, "remaining");
  });
}

test("corrupt/.tmp checkpoint is treated as incomplete and warns", () => {
  const got = resolveWorkspace(join(FIX, "resume-corrupt-tmp"));
  assert.equal(got.reenter_at, "security");
  assert.ok(got.warnings.length >= 1, "expected a warning for the corrupt checkpoint");
});

test("missing _run.json throws a clear error", () => {
  assert.throws(() => resolveWorkspace(join(FIX, "does-not-exist")), /_run\.json/);
});

// PR #25 review — an empty members/aspects collection must NOT resolve to "done"
// (vacuous Array.every → true would silently skip a phase that never ran).
test("parallel group with no members is NOT done (not vacuously complete)", () => {
  const r = computeReentry(
    [{ name: "parallel:a+b", kind: "parallel" }, { name: "qa", kind: "plain", aspects: null }],
    new Map(),
  );
  assert.equal(r.reenter_at, "parallel:a+b");
  assert.deepEqual(r.remaining, ["parallel:a+b", "qa"]);
});

test("aspect-aware phase with empty aspects is NOT done (not vacuously complete)", () => {
  const r = computeReentry(
    [{ name: "development", kind: "plain", aspects: [] }, { name: "qa", kind: "plain", aspects: null }],
    new Map(),
  );
  assert.equal(r.reenter_at, "development");
  assert.deepEqual(r.remaining, ["development", "qa"]);
});

test("resolveWorkspace throws a clear error when resolved_phases is not an array", () => {
  // Named without the `resume-` prefix so the fixture auto-loop / `sdlc-lint resume`
  // runner don't try to resolve this deliberately-malformed workspace.
  const dir = join(FIX, "_malformed-run");
  assert.throws(() => resolveWorkspace(dir), /resolved_phases/);
});
