import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { renderReport, renderReportFile } from "../lib/report.mjs";

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

test("signals panel surfaces QA and skip-rules", () => {
  const html = renderReport(tel);
  assert.match(html, /QA:\s*completed/);
  assert.match(html, /Skipped/);
  assert.match(html, /config-only/);
});

test("touched-files section lists files, and is omitted when absent", () => {
  const withFiles = renderReport(tel);
  assert.match(withFiles, /Touched files \(2\)/);
  assert.match(withFiles, /SubscriptionRepository\.kt/);

  const { touched_files, ...noFiles } = tel; // omit the key
  const html = renderReport(noFiles);
  assert.doesNotMatch(html, /Touched files/);
});

test("post-checks render commands and pass/fail", () => {
  const html = renderReport(tel);
  assert.match(html, /gradlew detekt/);
});

test("deps preflight and artifact links render", () => {
  const html = renderReport(tel, { artifactFiles: ["01-business-analysis.md"] });
  assert.match(html, /superpowers/);
  assert.match(html, /href="01-business-analysis\.md"/);
  assert.match(html, /href="_telemetry\.json"/);
});

test("renderReportFile writes report.html next to telemetry", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-report-"));
  writeFileSync(join(dir, "_telemetry.json"), JSON.stringify(tel));
  writeFileSync(join(dir, "01-business-analysis.md"), "# BA\n...");
  const { htmlPath, ok } = renderReportFile(dir);
  assert.equal(ok, true);
  assert.ok(existsSync(htmlPath));
  const html = readFileSync(htmlPath, "utf8");
  assert.match(html, /add-subscription-billing/);
  assert.match(html, /href="01-business-analysis\.md"/); // picked up the NN-*.md sibling
});

test("renderReportFile throws a clear error when telemetry is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-report-empty-"));
  assert.throws(() => renderReportFile(dir), /_telemetry\.json/);
});
