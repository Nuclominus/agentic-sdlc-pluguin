import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

test("cli sync --from-json writes a note and rebuilds the index", () => {
  const v = mkdtempSync(join(tmpdir(), "brain-cli-"));
  mkdirSync(join(v, "changes"), { recursive: true });
  const prFile = join(v, "pr.json");
  writeFileSync(prFile, JSON.stringify({
    number: 29, title: "feat(workmanager): provider (Roadmap C2)",
    body: "Body.", author: { login: "Nuclominus" }, mergedAt: "2026-07-03T21:36:33Z",
    labels: [], files: [{ path: "plugins/workmanager-plugin/manifest.yaml" }],
  }));
  execFileSync("node", [CLI, "sync", "--pr", "29", "--from-json", prFile, "--vault", v], { encoding: "utf8" });
  const notes = readdirSync(join(v, "changes")).filter((f) => f.startsWith("2026"));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /2026-07-03-PR-29-.*\.md/);
  const idx = readFileSync(join(v, "changes", "_moc-changes.md"), "utf8");
  assert.match(idx, /#29/);
});

test("cli sync is idempotent", () => {
  const v = mkdtempSync(join(tmpdir(), "brain-cli2-"));
  mkdirSync(join(v, "changes"), { recursive: true });
  const prFile = join(v, "pr.json");
  writeFileSync(prFile, JSON.stringify({
    number: 5, title: "feat(x): y", body: "b", author: { login: "a" },
    mergedAt: "2026-06-23T07:59:06Z", labels: [], files: [],
  }));
  const run = () => execFileSync("node", [CLI, "sync", "--pr", "5", "--from-json", prFile, "--vault", v], { encoding: "utf8" });
  run();
  const first = readdirSync(join(v, "changes")).sort();
  run();
  const second = readdirSync(join(v, "changes")).sort();
  assert.deepEqual(first, second);
});

// `reindex` exists for one job: resolve a `_moc-changes.md` merge conflict without paying for it
// with the vault's hand-written prose. `sync --backfill`, the only other regenerating verb, would
// rewrite every note from its PR and wipe exactly that.
test("cli reindex rebuilds the index from the notes on disk", () => {
  const v = mkdtempSync(join(tmpdir(), "brain-reindex-"));
  mkdirSync(join(v, "changes"), { recursive: true });
  const note = (pr, date) =>
    writeFileSync(join(v, "changes", `${date}-PR-${pr}-x.md`),
      `---\npr: ${pr}\ndate: ${date}\ntype: fix\nroadmap: null\n---\n\n# PR #${pr}\n`);
  note(11, "2026-07-01");
  note(12, "2026-07-02");
  // A stale index: missing #12 entirely, exactly what a bad conflict resolution leaves behind.
  writeFileSync(join(v, "changes", "_moc-changes.md"), "# Changes — Index\n\n| #11 |\n");

  const out = execFileSync("node", [CLI, "reindex", "--vault", v], { encoding: "utf8" });
  assert.match(out, /2 note\(s\)/);
  const idx = readFileSync(join(v, "changes", "_moc-changes.md"), "utf8");
  assert.match(idx, /#11/);
  assert.match(idx, /#12/);
  // Reverse-chronological, same ordering contract as sync.
  assert.ok(idx.indexOf("#12") < idx.indexOf("#11"), "newest PR first");
});

test("cli reindex leaves enriched note prose untouched", () => {
  const v = mkdtempSync(join(tmpdir(), "brain-reindex2-"));
  mkdirSync(join(v, "changes"), { recursive: true });
  const path = join(v, "changes", "2026-07-05-PR-42-y.md");
  const enriched = `---\npr: 42\ndate: 2026-07-05\ntype: feat\nroadmap: null\n---\n\n` +
    `# PR #42\n\n## Decisions & rationale\n\nHand-written reasoning that must survive.\n`;
  writeFileSync(path, enriched);

  execFileSync("node", [CLI, "reindex", "--vault", v], { encoding: "utf8" });
  assert.equal(readFileSync(path, "utf8"), enriched, "reindex must not touch note bodies");
});

test("cli reindex is idempotent", () => {
  const v = mkdtempSync(join(tmpdir(), "brain-reindex3-"));
  mkdirSync(join(v, "changes"), { recursive: true });
  writeFileSync(join(v, "changes", "2026-07-06-PR-43-z.md"),
    "---\npr: 43\ndate: 2026-07-06\ntype: docs\nroadmap: null\n---\n\n# PR #43\n");
  const run = () => {
    execFileSync("node", [CLI, "reindex", "--vault", v], { encoding: "utf8" });
    return readFileSync(join(v, "changes", "_moc-changes.md"), "utf8");
  };
  assert.equal(run(), run());
});

test("cli sync keeps exactly one note per PR when the title (slug) changes", () => {
  const v = mkdtempSync(join(tmpdir(), "brain-cli3-"));
  mkdirSync(join(v, "changes"), { recursive: true });
  const prFile = join(v, "pr.json");
  const write = (title) => writeFileSync(prFile, JSON.stringify({
    number: 7, title, body: "b", author: { login: "a" },
    mergedAt: "2026-06-23T08:16:44Z", labels: [], files: [],
  }));
  const run = () => execFileSync("node", [CLI, "sync", "--pr", "7", "--from-json", prFile, "--vault", v], { encoding: "utf8" });

  write("chore(changelog): open unreleased section");
  run();
  write("chore(changelog): renamed after merge to something else");
  run();

  const notes = readdirSync(join(v, "changes")).filter((f) => f.includes("-PR-7-"));
  assert.equal(notes.length, 1, `expected 1 note for PR-7, got ${notes.join(", ")}`);
  assert.match(notes[0], /renamed-after-merge/);
  const idx = readFileSync(join(v, "changes", "_moc-changes.md"), "utf8");
  assert.equal((idx.match(/#7\b/g) || []).length, 1, "index must list PR #7 exactly once");
});
