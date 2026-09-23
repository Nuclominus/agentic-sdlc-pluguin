import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDocRefs } from "../lib/doc-refs.mjs";

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "doc-refs-"));
  mkdirSync(join(root, "plugins", "sdlc", "agents"), { recursive: true });
  mkdirSync(join(root, "plugins", "sdlc", "skills", "aar"), { recursive: true });
  writeFileSync(join(root, "plugins", "sdlc", "agents", "developer.md"), "---\nname: developer\n---\n");
  writeFileSync(join(root, "plugins", "sdlc", "skills", "aar", "SKILL.md"), "---\nname: aar\n---\n");
  return root;
}

test("checkDocRefs: a live agent reference passes", () => {
  const root = makeRepo();
  writeFileSync(join(root, "README.md"), "See `sdlc:developer` for details.\n");
  const r = checkDocRefs({ repoRoot: root });
  assert.equal(r.ok, true);
  assert.deepEqual(r.violations, []);
});

test("checkDocRefs: a live skill reference passes", () => {
  const root = makeRepo();
  writeFileSync(join(root, "README.md"), "Run `sdlc:aar` for a retrospective.\n");
  const r = checkDocRefs({ repoRoot: root });
  assert.equal(r.ok, true);
});

test("checkDocRefs: a dangling rename is a violation", () => {
  const root = makeRepo();
  writeFileSync(join(root, "README.md"), "Run `sdlc:old-aar-name` for a retrospective.\n");
  const r = checkDocRefs({ repoRoot: root });
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].ref, "sdlc:old-aar-name");
});

test("checkDocRefs: an unknown namespace is ignored (not every colon-pair is a plugin ref)", () => {
  const root = makeRepo();
  writeFileSync(join(root, "README.md"), "See `note:to-self` in your editor.\n");
  const r = checkDocRefs({ repoRoot: root });
  assert.equal(r.ok, true);
});

test("checkDocRefs: docs/superpowers/** is exempt (frozen planning narrative), a top-level docs/*.md sibling is not", () => {
  // Mirrors the old one-off CI grep's own exemption (`--exclude-dir=superpowers`): that directory
  // holds historical plan/spec narrative, not living documentation, so a dangling reference there
  // legitimately preserves a pre-rename name on purpose.
  const root = makeRepo();
  mkdirSync(join(root, "docs", "superpowers", "plans"), { recursive: true });
  writeFileSync(
    join(root, "docs", "superpowers", "plans", "old-plan.md"),
    "Historical note: this used to be `sdlc:old-aar-name`.\n"
  );
  writeFileSync(join(root, "docs", "guide.md"), "See `sdlc:old-aar-name` for details.\n");
  const r = checkDocRefs({ repoRoot: root });
  assert.equal(r.ok, false);
  assert.equal(r.violations.length, 1, JSON.stringify(r.violations));
  assert.equal(r.violations[0].file, "docs/guide.md");
  assert.equal(r.violations[0].ref, "sdlc:old-aar-name");
});
