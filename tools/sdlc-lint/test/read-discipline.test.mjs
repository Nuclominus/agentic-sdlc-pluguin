import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { checkAnchor } from "../lib/read-discipline.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "read-discipline");
const fixture = (name) => readFileSync(join(FIX, name), "utf8");

test("anchor inside the stable prefix passes", () => {
  assert.deepEqual(checkAnchor(fixture("skill-ok.md")), { ok: true, errors: [] });
});

test("missing anchor is flagged", () => {
  const { ok, errors } = checkAnchor(fixture("skill-missing.md"));
  assert.equal(ok, false);
  assert.match(errors.join(" "), /missing 'Read discipline:'/);
});

test("anchor in the per-call trailer is flagged as displaced", () => {
  const { ok, errors } = checkAnchor(fixture("skill-displaced.md"));
  assert.equal(ok, false);
  assert.match(errors.join(" "), /must sit between/);
});

test("a file with no stable-prefix delimiters is a structural failure", () => {
  const { ok, errors } = checkAnchor("# nothing here\n");
  assert.equal(ok, false);
  assert.match(errors.join(" "), /delimiter/);
});
