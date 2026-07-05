import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, buildChangesIndex } from "../lib/index.mjs";

test("parseFrontmatter reads simple key: value", () => {
  const fm = parseFrontmatter("---\npr: 29\ndate: 2026-07-03\ntype: feat\n---\n# body");
  assert.equal(fm.pr, "29");
  assert.equal(fm.date, "2026-07-03");
  assert.equal(fm.type, "feat");
});

test("buildChangesIndex sorts desc and links each note", () => {
  const dir = mkdtempSync(join(tmpdir(), "brain-idx-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "2026-07-01-PR-16-a.md"), "---\npr: 16\ndate: 2026-07-01\ntype: feat\nroadmap: null\n---\n");
  writeFileSync(join(dir, "2026-07-03-PR-29-b.md"), "---\npr: 29\ndate: 2026-07-03\ntype: feat\nroadmap: C2\n---\n");
  writeFileSync(join(dir, "_moc-changes.md"), "ignored");
  const md = buildChangesIndex(dir);
  const i29 = md.indexOf("#29");
  const i16 = md.indexOf("#16");
  assert.ok(i29 !== -1 && i16 !== -1 && i29 < i16, "PR 29 (newer) listed before 16");
  assert.match(md, /\[\[changes\/2026-07-03-PR-29-b\]\]/);
  assert.ok(!md.includes("_moc-changes"), "index does not list itself");
});
