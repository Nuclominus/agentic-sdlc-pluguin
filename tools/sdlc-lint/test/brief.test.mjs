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
  assert.equal(r.error, "--brief cannot be combined with --resume (a resumed run already has its _brief.md; use --resume=<slug>)");
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
  const cwd = project({ "a.md": "\uFEFF" + body });
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

test("a directory or the project root is not a file", () => {
  const cwd = project({ "docs/briefs/x.md": VALID });
  assert.match(readBrief({ cwd, args: "--brief=docs" }).error, /^--brief=docs: not a file: docs$/);
  assert.match(readBrief({ cwd, args: "--brief=." }).error, /not a file/);
});

test("missing slug and missing narrative_language are errors naming the key", () => {
  const cwd = project({
    "a.md": fm("title: T\nnarrative_language: en"),
    "b.md": fm("title: T\nslug: ok"),
  });
  assert.equal(readBrief({ cwd, args: "--brief=a.md" }).error, "--brief=a.md: missing slug");
  assert.equal(readBrief({ cwd, args: "--brief=b.md" }).error, "--brief=b.md: missing narrative_language");
});

test("briefArgs strips leading dashes so a title cannot act as a flag", () => {
  assert.equal(briefArgs("--brief=a.md --dry-run", "Drop --resume support"), '"Drop resume support" --dry-run');
});

test("briefArgs strips mid-word double dashes so a quoted title cannot smuggle a flag", () => {
  const out = briefArgs("--brief=a.md --dry-run", 'x"--workflow=evil a--b');
  assert.doesNotMatch(out, /--workflow/);
  assert.equal(out, '"x\\" workflow=evil a b" --dry-run');
});

test("the space form and a quoted path resolve like --brief=<path>", () => {
  const cwd = project({ "docs/briefs/x.md": VALID });
  const want = readBrief({ cwd, args: "--brief=docs/briefs/x.md" });
  for (const args of ["--brief docs/briefs/x.md --dry-run", "--brief='docs/briefs/x.md'", '--brief="docs/briefs/x.md" --dry-run',
                      "--brief 'docs/briefs/x.md'", '--dry-run --brief  "docs/briefs/x.md"']) {
    assert.deepEqual(readBrief({ cwd, args }), want, args);
  }
});

test("the space form never leaks the path into the description", () => {
  assert.equal(briefArgs("--brief docs/briefs/x.md --dry-run", "T"), '"T" --dry-run');
  assert.equal(briefArgs("--brief 'docs/briefs/x.md'", "T"), '"T"');
  assert.equal(briefArgs('"see --brief=b.md" --brief a.md', "T"), '"see --brief=b.md" "T"');
});

test("an empty value, a following flag or an unclosed quote is rejected with both forms named", () => {
  const cwd = project({ "docs/briefs/x.md": VALID });
  for (const args of ["--dry-run --brief", "--brief", "--brief --dry-run", "--brief=", "--brief= --dry-run", "--brief='docs/briefs/x.md", "--brief ''"]) {
    const r = readBrief({ cwd, args });
    assert.equal(r.requested, true, args);
    assert.equal(r.error, "--brief: give a path — --brief=<path> or --brief <path>", args);
  }
});

test("a quoted path with spaces is read whole and reported by its full name", () => {
  const r = readBrief({ cwd: project(), args: '--brief="docs/my brief.md"' });
  assert.equal(r.error, "--brief=docs/my brief.md: file not found: docs/my brief.md");
});

test("a quoted description that mentions the flag is not a --brief request", () => {
  const cwd = project({ "docs/briefs/x.md": VALID });
  for (const args of ['"Document the --brief flag in WORKFLOW.md"', '"Add a --brief=<path> option"',
                      "'Explain --brief=docs/briefs/x.md' --dry-run", 'x--brief=docs/briefs/x.md']) {
    assert.deepEqual(readBrief({ cwd, args }), { requested: false }, args);
  }
});

test("briefArgs replaces only the standalone flag, not a quoted mention", () => {
  assert.equal(briefArgs('--dry-run --brief=a.md', "T"), '--dry-run "T"');
  assert.equal(briefArgs('"see --brief=b.md" --brief=a.md', "T"), '"see --brief=b.md" "T"');
});
