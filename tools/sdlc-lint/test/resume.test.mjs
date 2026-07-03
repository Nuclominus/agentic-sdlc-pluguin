import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkspace } from "../lib/resume.mjs";

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
