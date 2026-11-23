import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readBrief, briefArgs } from "../../../plugins/sdlc/tools/resolve/brief.mjs";

function project(files = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "brief-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, rel)), { recursive: true });
    writeFileSync(join(cwd, rel), content);
  }
  return cwd;
}

const fm = (body) => `---\n${body}\n---\n\n# Brief\nBody.\n`;
const VALID = fm("title: Hotfix crash on empty list\nslug: empty-list-crash\nnarrative_language: uk");

test("no --brief is not requested", () => {
  assert.deepEqual(readBrief({ cwd: project(), args: "add dark mode" }), { requested: false });
});

test("a valid brief yields title, slug, language and a project-relative path", () => {
  const cwd = project({ "docs/briefs/x.md": VALID });
  assert.deepEqual(readBrief({ cwd, args: "--brief=docs/briefs/x.md" }), {
    requested: true, path: "docs/briefs/x.md", title: "Hotfix crash on empty list", slug: "empty-list-crash", narrative_language: "uk",
  });
});

test("brief plus a description is rejected", () => {
  const cwd = project({ "docs/briefs/x.md": VALID });
  const r = readBrief({ cwd, args: '--brief=docs/briefs/x.md "extra words"' });
  assert.match(r.error, /either --brief=<path> or a description/);
  assert.equal(r.error, "--brief: use either --brief=<path> or a description, not both");
});

test("brief plus --resume is rejected", () => {
  const cwd = project({ "docs/briefs/x.md": VALID });
  const r = readBrief({ cwd, args: "--brief=docs/briefs/x.md --resume" });
  assert.match(r.error, /cannot be combined with --resume/);
  assert.equal(r.error, "--brief cannot be combined with --resume (a resumed run already has its _brief.md)");
});

test("a missing file is reported by path", () => {
  const r = readBrief({ cwd: project(), args: "--brief=docs/briefs/missing.md" });
  assert.match(r.error, /not found: docs\/briefs\/missing\.md/);
  assert.match(r.error, /^--brief=docs\/briefs\/missing\.md: /);
});

test("a path with spaces reports not found, not a stray description", () => {
  const r = readBrief({ cwd: project(), args: "--brief=docs/my brief.md" });
  assert.match(r.error, /not found: docs\/my/);
});

test("no frontmatter and an empty title are rejected", () => {
  const cwd = project({ "a.md": "# Just a heading\n", "b.md": fm("title: \nslug: ok") });
  assert.match(readBrief({ cwd, args: "--brief=a.md" }).error, /no frontmatter/);
  assert.match(readBrief({ cwd, args: "--brief=b.md" }).error, /title/);
});

test("a bad or over-long slug is rejected", () => {
  const cwd = project({
    "a.md": fm("title: T\nslug: Bad Slug"),
    "b.md": fm(`title: T\nslug: ${"a".repeat(41)}`),
  });
  assert.match(readBrief({ cwd, args: "--brief=a.md" }).error, /slug/);
  assert.match(readBrief({ cwd, args: "--brief=b.md" }).error, /slug/);
});

test("an unsupported narrative_language is rejected", () => {
  const cwd = project({ "a.md": fm("title: T\nslug: ok\nnarrative_language: de") });
  assert.match(readBrief({ cwd, args: "--brief=a.md" }).error, /narrative_language/);
});

test("CRLF line endings and a leading BOM parse like LF", () => {
  const body = "---\r\ntitle: T\r\nslug: ok\r\nnarrative_language: en\r\n---\r\n\r\nBody\r\n";
  const cwd = project({ "a.md": "﻿" + body });
  const r = readBrief({ cwd, args: "--brief=a.md" });
  assert.equal(r.error, undefined);
  assert.equal(r.title, "T");
  assert.equal(r.narrative_language, "en");
});

test("a path escaping the project is rejected", () => {
  const r = readBrief({ cwd: project(), args: "--brief=../../etc/hosts" });
  assert.match(r.error, /outside the project/);
});

test("briefArgs replaces the token with a JSON-quoted title", () => {
  assert.equal(briefArgs("--brief=a.md --dry-run", 'Fix "x" (urgent)'), '"Fix \\"x\\" (urgent)" --dry-run');
});
