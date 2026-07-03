import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { resolveFixture } from "../lib/detect.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const FIX = resolve(HERE, "..", "fixtures");

for (const name of readdirSync(FIX)) {
  test(`fixture ${name} resolves to expected stack`, () => {
    const { actual, expected, ok } = resolveFixture(join(FIX, name), REPO);
    assert.equal(ok, true, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  });
}
