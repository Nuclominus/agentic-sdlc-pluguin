import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkVault } from "../lib/check.mjs";

function scaffold() {
  const v = mkdtempSync(join(tmpdir(), "brain-vault-"));
  for (const d of ["_templates", "architecture", "components", "changes", "decisions", "planning", "releases"]) {
    mkdirSync(join(v, d), { recursive: true });
  }
  const required = [
    "README.md", "_moc-root.md",
    "_templates/change-note.md", "_templates/adr.md", "_templates/plan.md", "_templates/component.md",
    "architecture/_moc-architecture.md", "changes/_moc-changes.md",
    "decisions/_moc-decisions.md", "planning/_moc-planning.md", "releases/_moc-releases.md",
  ];
  for (const f of required) writeFileSync(join(v, f), "# stub\n");
  return v;
}

test("checkVault is clean on a complete skeleton", () => {
  assert.deepEqual(checkVault(scaffold()), []);
});

test("checkVault reports a broken wikilink", () => {
  const v = scaffold();
  writeFileSync(join(v, "changes", "2026-01-01-PR-1-x.md"),
    "---\npr: 1\ndate: 2026-01-01\n---\n# x\n[[components/does-not-exist]]\n");
  const problems = checkVault(v);
  assert.ok(problems.some((p) => p.includes("broken link") && p.includes("does-not-exist")), problems.join("; "));
});

test("checkVault reports a change note missing frontmatter", () => {
  const v = scaffold();
  writeFileSync(join(v, "changes", "2026-01-01-PR-2-y.md"), "# no frontmatter\n");
  assert.ok(checkVault(v).some((p) => p.includes("frontmatter")));
});

// --- index completeness ---
// A note that resolves every link it makes but that no map links TO is still lost.
// ADR-0014 and ADR-0015 both shipped unlisted while `check` reported "clean".

test("checkVault reports a note no MOC links to", () => {
  const v = scaffold();
  writeFileSync(join(v, "decisions", "ADR-0001-orphan.md"), "---\nadr: 1\n---\n# orphan\n");
  const problems = checkVault(v);
  assert.deepEqual(problems, ["decisions/ADR-0001-orphan.md: not listed in any _moc-* index"]);
});

test("a note listed in its own pillar's MOC is indexed", () => {
  const v = scaffold();
  writeFileSync(join(v, "decisions", "ADR-0001-listed.md"), "---\nadr: 1\n---\n# listed\n");
  writeFileSync(join(v, "decisions", "_moc-decisions.md"),
    "# Decisions\n- [[decisions/ADR-0001-listed]]\n");
  assert.deepEqual(checkVault(v), []);
});

test("the root MOC indexes too — components/ is listed there, not in a pillar MOC", () => {
  const v = scaffold();
  writeFileSync(join(v, "components", "sdlc.md"), "# sdlc\n");
  writeFileSync(join(v, "_moc-root.md"), "# Home\n## Components\n- [[components/sdlc]]\n");
  assert.deepEqual(checkVault(v), []);
});

test("a link from an ordinary note does NOT count as indexing", () => {
  // Otherwise any two notes citing each other would vouch for one another and the
  // check would pass on a vault whose maps list nothing at all.
  const v = scaffold();
  writeFileSync(join(v, "decisions", "ADR-0001-a.md"), "---\nadr: 1\n---\n[[decisions/ADR-0002-b]]\n");
  writeFileSync(join(v, "decisions", "ADR-0002-b.md"), "---\nadr: 2\n---\n[[decisions/ADR-0001-a]]\n");
  const problems = checkVault(v);
  assert.equal(problems.length, 2);
  assert.ok(problems.every((p) => p.endsWith("not listed in any _moc-* index")), problems.join("; "));
});

test("MOCs, templates and README are scaffolding, never flagged as unindexed", () => {
  // scaffold() writes every required file and nothing links to most of them.
  assert.deepEqual(checkVault(scaffold()), []);
});

test("a MOC link that resolves is reported once as broken, not also as unindexed", () => {
  const v = scaffold();
  writeFileSync(join(v, "decisions", "_moc-decisions.md"), "# Decisions\n- [[decisions/ADR-0001-ghost]]\n");
  const problems = checkVault(v);
  assert.deepEqual(problems, ["decisions/_moc-decisions.md: broken link [[decisions/ADR-0001-ghost]]"]);
});
