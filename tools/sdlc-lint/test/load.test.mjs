import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadManifests, loadWorkflows } from "../lib/load.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("loadManifests splits foundations and frameworks", () => {
  const { foundations, frameworks, errors } = loadManifests(REPO);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const fstacks = foundations.map(f => f.doc.stack).sort();
  assert.deepEqual(fstacks, ["android", "vanilla"]);
  const fwstacks = frameworks.map(f => f.doc.stack).sort();
  assert.deepEqual(fwstacks, ["dagger", "datastore-proto", "koin", "ktor", "retrofit", "room", "workmanager"]);
});

test("loadWorkflows excludes test-fixtures", () => {
  const { workflows } = loadWorkflows(REPO);
  assert.ok(workflows.length >= 5);
  assert.ok(!workflows.some(w => w.file.includes("/test-fixtures/")));
});
