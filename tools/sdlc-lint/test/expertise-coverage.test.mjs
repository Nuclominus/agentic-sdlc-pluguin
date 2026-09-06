// ADR-0021 PR-2 gate — the extraction is only "done" when every section of every Android agent
// body has a destination that provably carries it.
//
// The failure this guards is silent by construction: an agent file is deleted in PR-3, and the
// paragraph that said "purchase tokens are verified server-side before unlocking entitlements"
// simply stops existing. Nothing errors; the pipeline runs; the audit is quietly weaker. So the
// track note carries one row per `##` of each agent, and this check asserts the row's anchor
// phrase is actually present in the file the row points at.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCoverage, TRACK_NOTE, AGENTS_DIR } from "../scripts/expertise-coverage.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function write(root, rel, content) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** The track note with a coverage table built from `rows` (each an array of 4 cells). */
const note = (rows) => [
  "# I1", "", "## Expertise-coverage table (filled in PR-2)", "",
  "| Agent | Section | Destination | Anchor |",
  "|---|---|---|---|",
  ...rows.map((r) => `| ${r.join(" | ")} |`),
  "", "## Measurements owed", "",
].join("\n");

/** A tree whose coverage table is complete and whose anchors all resolve. */
function goodTree() {
  const root = mkdtempSync(join(tmpdir(), "sdlc-coverage-"));
  write(root, `${AGENTS_DIR}/android-tester.md`, "---\nname: android-tester\n---\n\n## Testing Stack\n\nMockK.\n\n## Commands\n\n`./gradlew`\n");
  write(root, "plugins/android-foundation/skills/android-testing/SKILL.md", "---\nname: android-testing\n---\n\nTurbine asserts Flow emissions.\n\n`./gradlew koverHtmlReport`\n");
  write(root, TRACK_NOTE, note([
    ["android-tester", "Testing Stack", "plugins/android-foundation/skills/android-testing/SKILL.md", "`Turbine asserts Flow emissions`"],
    ["android-tester", "Commands", "plugins/android-foundation/skills/android-testing/SKILL.md", "`koverHtmlReport`"],
  ]));
  return root;
}

const failures = (results) => results.filter((r) => !r.ok).flatMap((r) => r.errors.map((e) => `${r.check}: ${e}`));

test("a complete table whose anchors all resolve is clean, and every check reports it ran", () => {
  const root = goodTree();
  try {
    const results = checkCoverage(root);
    assert.deepEqual(failures(results), []);
    for (const check of ["table", "anchors", "sections"]) {
      assert.ok(results.some((r) => r.check === check), `check '${check}' did not run`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("anchors: a row pointing at a missing file, or a phrase that is not there, is a violation", () => {
  const root = goodTree();
  try {
    write(root, TRACK_NOTE, note([
      ["android-tester", "Testing Stack", "plugins/android-foundation/skills/android-testing/SKILL.md", "`Robolectric for Android runtime`"],
      ["android-tester", "Commands", "plugins/android-foundation/skills/gone/SKILL.md", "`./gradlew`"],
    ]));
    const errs = failures(checkCoverage(root));
    assert.ok(errs.some((e) => /anchors: .*Testing Stack.*Robolectric for Android runtime.*not found/.test(e)), errs.join("\n"));
    assert.ok(errs.some((e) => /anchors: .*skills\/gone\/SKILL\.md.*does not exist/.test(e)), errs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sections: an agent `##` section with no row is a violation — that is the expertise that vanishes", () => {
  const root = goodTree();
  try {
    write(root, TRACK_NOTE, note([
      ["android-tester", "Testing Stack", "plugins/android-foundation/skills/android-testing/SKILL.md", "`Turbine asserts Flow emissions`"],
    ]));
    const errs = failures(checkCoverage(root));
    assert.ok(errs.some((e) => /sections: .*android-tester\.md.*'Commands'.*no row/.test(e)), errs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sections: a row naming an agent or section that does not exist is a violation too", () => {
  const root = goodTree();
  try {
    write(root, TRACK_NOTE, note([
      ["android-tester", "Testing Stack", "plugins/android-foundation/skills/android-testing/SKILL.md", "`Turbine asserts Flow emissions`"],
      ["android-tester", "Commands", "plugins/android-foundation/skills/android-testing/SKILL.md", "`koverHtmlReport`"],
      ["android-tester", "Ghost Section", "plugins/android-foundation/skills/android-testing/SKILL.md", "`Turbine`"],
      ["android-ghost", "Anything", "plugins/android-foundation/skills/android-testing/SKILL.md", "`Turbine`"],
    ]));
    const errs = failures(checkCoverage(root));
    assert.ok(errs.some((e) => /sections: .*'Ghost Section'.*android-tester\.md has no such section/.test(e)), errs.join("\n"));
    assert.ok(errs.some((e) => /sections: .*android-ghost.*no such agent/.test(e)), errs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a section deliberately dropped is declared as such, and then carries no anchor to resolve", () => {
  // Not every section moves. The core agents carry the process text verbatim, so `## Scope
  // boundaries` and the copied deliverable templates are dropped rather than extracted — but
  // "dropped" has to be a decision written down, not a row nobody wrote.
  const root = goodTree();
  try {
    write(root, TRACK_NOTE, note([
      ["android-tester", "Testing Stack", "plugins/android-foundation/skills/android-testing/SKILL.md", "`Turbine asserts Flow emissions`"],
      ["android-tester", "Commands", "—", "core `tester` carries the process text"],
    ]));
    assert.deepEqual(failures(checkCoverage(root)), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sections: a `##` inside a fenced block is template text, not a section of the agent", () => {
  // android-ba.md § "6. Deliverable Format" is a fenced report template whose body is itself
  // made of `## Executive Summary`, `## User Stories`, … Counting those as agent sections would
  // demand a coverage row for each line of a code sample.
  const root = goodTree();
  try {
    write(root, `${AGENTS_DIR}/android-tester.md`, [
      "---", "name: android-tester", "---", "",
      "## Testing Stack", "", "MockK.", "",
      "## Commands", "", "```", "## Not A Section", "```", "",
    ].join("\n"));
    assert.deepEqual(failures(checkCoverage(root)), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("table: an unfilled placeholder row fails — the gate must not pass on an empty table", () => {
  const root = goodTree();
  try {
    write(root, TRACK_NOTE, note([["_(PR-2)_", "", "", ""]]));
    const errs = failures(checkCoverage(root));
    assert.ok(errs.some((e) => /table: .*placeholder/.test(e)), errs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the shipped marketplace has full expertise coverage", () => {
  assert.deepEqual(failures(checkCoverage(REPO)), []);
});
