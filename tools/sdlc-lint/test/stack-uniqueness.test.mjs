// ADR-0026's embedded-frameworks description claims `stack` uniqueness is "enforced by
// tools/sdlc-lint". This test pins the three collision classes the schema itself cannot express:
// (a) two embedded rows sharing a stack, (b) an embedded row colliding with a foundation's own
// stack id, (c) an embedded row colliding with a standalone framework's stack — plus a clean case.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkStackUniqueness } from "../lib/stack-uniqueness.mjs";

function write(file, content) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
}
function scratch() { return mkdtempSync(join(tmpdir(), "sdlc-stack-uniqueness-")); }

test("distinct stack ids across foundations and embedded rows are clean", () => {
  const root = scratch();
  try {
    write(join(root, "plugins", "android-foundation", "manifest.yaml"), [
      "kind: foundation",
      "stack: android",
      "frameworks:",
      "  - stack: retrofit",
      "  - stack: room",
    ].join("\n"));
    write(join(root, "plugins", "sdlc", "manifest.yaml"), "kind: foundation\nstack: vanilla\n");
    assert.deepEqual(checkStackUniqueness(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("two embedded rows sharing a stack, within one foundation, collide", () => {
  const root = scratch();
  try {
    write(join(root, "plugins", "android-foundation", "manifest.yaml"), [
      "kind: foundation",
      "stack: android",
      "frameworks:",
      "  - stack: retrofit",
      "  - stack: retrofit",
    ].join("\n"));
    const results = checkStackUniqueness(root);
    assert.equal(results.length, 2);
    for (const r of results) {
      assert.equal(r.file, "plugins/android-foundation/manifest.yaml");
      assert.equal(r.ok, false);
      assert.match(r.errors[0], /stack 'retrofit'/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("two embedded rows sharing a stack, across two different foundations, collide", () => {
  const root = scratch();
  try {
    write(join(root, "plugins", "android-foundation", "manifest.yaml"), [
      "kind: foundation",
      "stack: android",
      "frameworks:",
      "  - stack: retrofit",
    ].join("\n"));
    write(join(root, "plugins", "other-foundation", "manifest.yaml"), [
      "kind: foundation",
      "stack: other",
      "frameworks:",
      "  - stack: retrofit",
    ].join("\n"));
    const results = checkStackUniqueness(root);
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r) => r.file).sort(), [
      "plugins/android-foundation/manifest.yaml",
      "plugins/other-foundation/manifest.yaml",
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an embedded row colliding with a foundation's own stack id is flagged", () => {
  const root = scratch();
  try {
    write(join(root, "plugins", "android-foundation", "manifest.yaml"), [
      "kind: foundation",
      "stack: android",
      "frameworks:",
      "  - stack: vanilla",
    ].join("\n"));
    write(join(root, "plugins", "sdlc", "manifest.yaml"), "kind: foundation\nstack: vanilla\n");
    const results = checkStackUniqueness(root);
    assert.equal(results.length, 2);
    const androidResult = results.find((r) => r.file === "plugins/android-foundation/manifest.yaml");
    assert.match(androidResult.errors[0], /embedded framework row/);
    const sdlcResult = results.find((r) => r.file === "plugins/sdlc/manifest.yaml");
    assert.match(sdlcResult.errors[0], /foundation/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an embedded row colliding with a standalone framework's stack is flagged", () => {
  const root = scratch();
  try {
    write(join(root, "plugins", "android-foundation", "manifest.yaml"), [
      "kind: foundation",
      "stack: android",
      "frameworks:",
      "  - stack: retrofit",
    ].join("\n"));
    write(join(root, "plugins", "retrofit-plugin", "manifest.yaml"), "kind: framework\nstack: retrofit\n");
    const results = checkStackUniqueness(root);
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((r) => r.file).sort(), [
      "plugins/android-foundation/manifest.yaml",
      "plugins/retrofit-plugin/manifest.yaml",
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
