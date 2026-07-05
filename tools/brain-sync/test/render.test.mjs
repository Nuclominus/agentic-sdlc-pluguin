import { test } from "node:test";
import assert from "node:assert/strict";
import { noteBasename, renderChangeNote } from "../lib/render.mjs";

const PR = {
  number: 29,
  title: "feat(workmanager): provider (Roadmap C2)",
  body: "Adds the WorkManager provider.\n\nMore detail here.",
  author: "Nuclominus",
  mergedAt: "2026-07-03T21:36:33Z",
  labels: ["feat"],
  files: ["plugins/workmanager-plugin/manifest.yaml"],
};
const CLS = { type: "feat", plugins: ["workmanager-plugin"], roadmap: "C2", slug: "provider-roadmap-c2" };

test("noteBasename is date-PR-num-slug", () => {
  assert.equal(noteBasename(PR, CLS), "2026-07-03-PR-29-provider-roadmap-c2.md");
});

test("renderChangeNote emits frontmatter + component link + roadmap link", () => {
  const md = renderChangeNote(PR, CLS);
  assert.match(md, /^---\npr: 29\n/);
  assert.match(md, /date: 2026-07-03/);
  assert.match(md, /type: feat/);
  assert.match(md, /plugins: \[workmanager-plugin\]/);
  assert.match(md, /roadmap: C2/);
  assert.match(md, /\[\[components\/workmanager-plugin\]\]/);
  assert.match(md, /\[\[planning\/roadmap\]\]/);
  assert.match(md, /Adds the WorkManager provider\./);
  // enrich hint must NOT be a wikilink
  assert.ok(!/\[\[decisions\//.test(md));
  assert.match(md, /`decisions\/ADR-XXXX`/);
});

test("renderChangeNote handles repo-level PR (no plugins, no roadmap)", () => {
  const pr = { ...PR, files: ["README.md"] };
  const cls = { type: "docs", plugins: [], roadmap: null, slug: "readme" };
  const md = renderChangeNote(pr, cls);
  assert.match(md, /plugins: \[\]/);
  assert.match(md, /roadmap: null/);
  assert.match(md, /Repo-level change/);
  assert.ok(!/\[\[components\//.test(md));
  assert.ok(!/\[\[planning\/roadmap\]\]/.test(md));
});

test("renderChangeNote skips a leading PR-body heading and surfaces real prose (blank line variant)", () => {
  const pr = { ...PR, body: "## Summary\n\nReal prose here.\n\nSecond para." };
  const md = renderChangeNote(pr, CLS);
  assert.match(md, /Real prose here\./);
  // must not echo a contentless heading as the summary body (the naive
  // implementation renders the note's own "## Summary" section header
  // immediately followed by the PR body's "## Summary" heading echo)
  assert.ok(!/## Summary\n\n## Summary\n/.test(md));
});

test("renderChangeNote skips a leading PR-body heading with no blank line", () => {
  const pr = { ...PR, body: "## Summary\nReal prose here." };
  const md = renderChangeNote(pr, CLS);
  assert.match(md, /Real prose here\./);
});

test("renderChangeNote falls back to placeholder when body is heading-only", () => {
  const pr = { ...PR, body: "## Summary" };
  const md = renderChangeNote(pr, CLS);
  assert.match(md, /_No description provided\._/);
});
