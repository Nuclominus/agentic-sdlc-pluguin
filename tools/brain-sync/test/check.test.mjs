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
