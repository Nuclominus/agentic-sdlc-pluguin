import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
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
  assert.match(withFiles, /Touched files/);
  assert.match(withFiles, /· 2/);                 // count in the heading
  assert.match(withFiles, /SubscriptionRepository\.kt/);
  assert.match(withFiles, /1 added/);            // status pill
  assert.match(withFiles, /1 modified/);

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
  try {
    writeFileSync(join(dir, "_telemetry.json"), JSON.stringify(tel));
    writeFileSync(join(dir, "01-business-analysis.md"), "# BA\n...");
    const { htmlPath, ok } = renderReportFile(dir);
    assert.equal(ok, true);
    assert.ok(existsSync(htmlPath));
    const html = readFileSync(htmlPath, "utf8");
    assert.match(html, /add-subscription-billing/);
    assert.match(html, /href="01-business-analysis\.md"/); // picked up the NN-*.md sibling
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renderReportFile throws a clear error when telemetry is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-report-empty-"));
  try {
    assert.throws(() => renderReportFile(dir), /_telemetry\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("post-checks excerpt renders when markdown tail provided", () => {
  const html = renderReport(tel, { postChecksMarkdown: "BUILD SUCCESSFUL in 3s" });
  assert.match(html, /Output tail/);
  assert.match(html, /BUILD SUCCESSFUL in 3s/);
});

test("cache-pressure signal: timeline subline + Signals flag for a flagged phase", () => {
  const t = {
    task_slug: "cache-demo", stack: "android", started_at: "2026-07-08T10:00:00Z",
    completed_at: "2026-07-08T10:30:00Z", wall_clock_seconds: 1800,
    phases: [{
      phase: "development", agent: "android-developer", model: "claude-sonnet-5", status: "completed",
      usage_source: "transcript", input_tokens: 186, output_tokens: 27124,
      cached_input_tokens: 2780000, cache_creation_tokens: 494153, billed_tokens: 3301463,
      turns: 39, peak_prefix_tokens: 101000, cache_pressure: true, cost_usd: 0.98,
    }],
  };
  const html = renderReport(t);
  assert.match(html, /high cache pressure/);                  // warn badge on the timeline row
  assert.match(html, /71k\/turn/);                            // per-turn cache read in the detail line (2.78M/39 ≈ 71k)
  assert.match(html, /peak ctx/);                             // peak-context bar rendered
  assert.match(html, /101k/);                                 // peak value
  assert.match(html, /High cache-pressure:.*development.*peak 101k/); // Signals flag
});

test("cache-pressure signal absent when a phase is under threshold", () => {
  const t = {
    task_slug: "calm", stack: "android", phases: [{
      phase: "qa", agent: "android-qa", model: "claude-sonnet-5", status: "completed",
      usage_source: "transcript", input_tokens: 40, output_tokens: 3361,
      cached_input_tokens: 490000, cache_creation_tokens: 143805, billed_tokens: 637206,
      turns: 10, peak_prefix_tokens: 59000, cache_pressure: false, cost_usd: 0.24,
    }],
  };
  const html = renderReport(t);
  assert.match(html, /49k\/turn/);                     // per-turn cache read in the detail line (490k/10 = 49k)
  assert.match(html, /59k/);                           // peak value present
  assert.doesNotMatch(html, /high cache pressure/);    // no warn badge
  assert.doesNotMatch(html, /High cache-pressure/);    // no Signals flag
});
