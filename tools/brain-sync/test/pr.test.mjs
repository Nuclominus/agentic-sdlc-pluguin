import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePr } from "../lib/pr.mjs";

test("normalizePr flattens gh json", () => {
  const raw = {
    number: 29,
    title: "feat(workmanager): provider (Roadmap C2)",
    body: "First para.\n\nSecond para.",
    author: { login: "Nuclominus" },
    mergedAt: "2026-07-03T21:36:33Z",
    labels: [{ name: "feat" }, { name: "enhancement" }],
    files: [{ path: "plugins/workmanager-plugin/manifest.yaml" }, { path: "README.md" }],
  };
  const pr = normalizePr(raw);
  assert.equal(pr.number, 29);
  assert.equal(pr.author, "Nuclominus");
  assert.equal(pr.mergedAt, "2026-07-03T21:36:33Z");
  assert.deepEqual(pr.labels, ["feat", "enhancement"]);
  assert.deepEqual(pr.files, ["plugins/workmanager-plugin/manifest.yaml", "README.md"]);
});

test("normalizePr tolerates missing fields", () => {
  const pr = normalizePr({ number: 1 });
  assert.equal(pr.title, "");
  assert.equal(pr.author, "unknown");
  assert.equal(pr.mergedAt, null);
  assert.deepEqual(pr.labels, []);
  assert.deepEqual(pr.files, []);
});
