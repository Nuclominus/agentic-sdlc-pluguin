import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePr, readPr, listMergedPrNumbers } from "../lib/pr.mjs";

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

test("readPr calls exec with correct args and normalizes result", () => {
  let capturedArgs;
  const fakeExec = (args) => {
    capturedArgs = args;
    return JSON.stringify({
      number: 29,
      title: "feat(x): y",
      author: { login: "Nuclominus" },
      mergedAt: "2026-07-03T21:36:33Z",
      labels: [],
      files: [{ path: "a" }],
    });
  };

  const pr = readPr(29, fakeExec);

  assert.equal(pr.number, 29);
  assert.equal(pr.title, "feat(x): y");
  assert.equal(pr.author, "Nuclominus");
  assert.equal(pr.mergedAt, "2026-07-03T21:36:33Z");
  assert.deepEqual(pr.labels, []);
  assert.deepEqual(pr.files, ["a"]);
  assert.deepEqual(capturedArgs, [
    "pr",
    "view",
    "29",
    "--json",
    "number,title,body,author,mergedAt,labels,files",
  ]);
});

test("listMergedPrNumbers filters, sorts, and maps correctly", () => {
  let capturedArgs;
  const fakeExec = (args) => {
    capturedArgs = args;
    return JSON.stringify([
      { number: 30, mergedAt: "2026-07-03T21:51:26Z" },
      { number: 1, mergedAt: "2026-06-23T06:30:09Z" },
      { number: 99, mergedAt: null },
    ]);
  };

  const result = listMergedPrNumbers("develop", fakeExec);

  assert.deepEqual(result, [1, 30]);
  assert.deepEqual(capturedArgs, [
    "pr",
    "list",
    "--state",
    "merged",
    "--base",
    "develop",
    "--limit",
    "500",
    "--json",
    "number,mergedAt",
  ]);
});
