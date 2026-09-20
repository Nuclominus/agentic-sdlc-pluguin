// Edge case 3 (ADR-0026): a manifest.yaml below a plugin root is invisible to installed mode but
// visible to tree mode — the exact trap the embedded-frameworks merge exists to close. This test
// pins both sides: a clean tree (one manifest per plugin root) passes, and a manifest one level
// deeper fails with a message naming the mode mismatch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkNestedManifest } from "../lib/nested-manifest.mjs";

function write(file, content) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, content);
}
function scratch() { return mkdtempSync(join(tmpdir(), "sdlc-nested-manifest-")); }

test("a manifest.yaml at each plugin root, and nowhere deeper, is clean", () => {
  const root = scratch();
  try {
    write(join(root, "plugins", "android-foundation", "manifest.yaml"), "kind: foundation\n");
    write(join(root, "plugins", "sdlc", "manifest.yaml"), "kind: foundation\n");
    assert.deepEqual(checkNestedManifest(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a manifest.yaml nested below a plugin root FAILS, naming the tree-vs-installed mismatch", () => {
  const root = scratch();
  try {
    write(join(root, "plugins", "android-foundation", "manifest.yaml"), "kind: foundation\n");
    write(join(root, "plugins", "android-foundation", "frameworks", "retrofit", "manifest.yaml"), "kind: framework\n");
    const results = checkNestedManifest(root);
    assert.equal(results.length, 1);
    assert.equal(results[0].file, "plugins/android-foundation/frameworks/retrofit/manifest.yaml");
    assert.equal(results[0].ok, false);
    assert.match(results[0].errors[0], /tree mode/);
    assert.match(results[0].errors[0], /installed mode/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("multiple nested manifests are all reported, sorted", () => {
  const root = scratch();
  try {
    write(join(root, "plugins", "foo", "manifest.yaml"), "kind: foundation\n");
    write(join(root, "plugins", "foo", "b", "manifest.yaml"), "kind: framework\n");
    write(join(root, "plugins", "foo", "a", "manifest.yaml"), "kind: framework\n");
    const results = checkNestedManifest(root);
    assert.deepEqual(results.map((r) => r.file), [
      "plugins/foo/a/manifest.yaml",
      "plugins/foo/b/manifest.yaml",
    ]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
