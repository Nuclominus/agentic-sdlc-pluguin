import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { checkSchemas } from "../lib/schema.mjs";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function compile(path) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(resolve(REPO, path), "utf8")));
}

test("all real plugin files pass their schema", () => {
  const results = checkSchemas(REPO);
  const failed = results.filter(r => !r.ok);
  assert.equal(failed.length, 0, JSON.stringify(failed, null, 2));
  assert.ok(results.some(r => r.schema.endsWith("manifest.schema.json")));
  assert.ok(results.some(r => r.schema.endsWith("workflow.schema.json")));
});

test("checkpoint.schema accepts a valid completed unit", () => {
  const v = compile("schemas/checkpoint.schema.json");
  assert.ok(v({ phase: "security", aspect: null, status: "completed", completed_at: "2026-07-03T10:15:00Z" }));
});

test("checkpoint.schema rejects an unknown status", () => {
  const v = compile("schemas/checkpoint.schema.json");
  assert.equal(v({ phase: "security", status: "half", completed_at: "2026-07-03T10:15:00Z" }), false);
});

test("run.schema accepts a resolved phase list", () => {
  const v = compile("schemas/run.schema.json");
  assert.ok(v({ task_slug: "x", workflow: "default", resolved_phases: [{ name: "qa", kind: "plain", aspects: null }] }));
});
