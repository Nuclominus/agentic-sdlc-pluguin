import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { resolveFixture, listFixtures } from "../lib/detect.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const FIX = resolve(HERE, "..", "fixtures");

for (const name of listFixtures(FIX)) {
  test(`fixture ${name} resolves to expected stack`, () => {
    const { actual, expected, ok } = resolveFixture(join(FIX, name), REPO);
    assert.equal(ok, true, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  });
}

test("listFixtures ignores stray files and dirs without expected.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-fix-"));
  try {
    mkdirSync(join(dir, "real"));
    writeFileSync(join(dir, "real", "expected.json"), "{}");
    writeFileSync(join(dir, ".DS_Store"), "junk");         // stray file
    mkdirSync(join(dir, "no-expected"));                    // dir without expected.json
    assert.deepEqual(listFixtures(dir), ["real"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
