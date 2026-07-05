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
