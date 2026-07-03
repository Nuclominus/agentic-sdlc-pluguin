import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderReport } from "../lib/report.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "report-basic");
const tel = JSON.parse(readFileSync(join(FIX, "_telemetry.json"), "utf8"));

test("renders a complete, self-contained HTML document", () => {
  const html = renderReport(tel);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<\/html>\s*$/i);
  // self-contained: no external references of any kind
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /src=/);
  assert.doesNotMatch(html, /<link/i);
  assert.doesNotMatch(html, /@import url\(/i);
});

test("header + KPI content is present", () => {
  const html = renderReport(tel);
  assert.match(html, /add-subscription-billing/);
  assert.match(html, /RESUMED/);            // resumed badge
  assert.match(html, /\$0\.20/);            // total cost
  assert.match(html, /60%/);                // cache hit
});

test("escapes injected markup from untrusted fields", () => {
  const html = renderReport(tel);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/); // raw form absent
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); // escaped form present
});

test("output is deterministic (byte-identical across calls)", () => {
  assert.equal(renderReport(tel), renderReport(tel));
});

test("phase timeline lists every phase with agent and model", () => {
  const html = renderReport(tel);
  assert.match(html, /business_analysis/);
  assert.match(html, /qa-engineer/);
  assert.match(html, /claude-sonnet-5/);
  assert.match(html, /resumed<\/span>/); // origin badge on the resumed phase
});

test("cost-by-model note flags unpriced phases", () => {
  const html = renderReport(tel);
  // security phase has cost_usd:null → partial note with count 1
  assert.match(html, /1 phase\(s\) unpriced/);
});
