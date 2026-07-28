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

test("hero shows total heal attempts when any phase healed", () => {
  const html = renderReport({
    task_slug: "t", started_at: "2026-07-27T10:00:00Z",
    phases: [
      { phase: "development", usage_source: "reported", heal_attempts_used: 1, heal_status: "healed" },
      { phase: "qa", usage_source: "reported", heal_attempts_used: 2, heal_status: "exhausted" },
    ],
  });
  assert.match(html, /3 heal attempt\(s\)/);
});

test("hero omits the heal meta entirely when nothing healed", () => {
  const html = renderReport({
    task_slug: "t", started_at: "2026-07-27T10:00:00Z",
    phases: [{ phase: "qa", usage_source: "reported" }],
  });
  assert.doesNotMatch(html, /heal attempt/);
});

test("a healed phase carries a per-phase heal badge", () => {
  const html = renderReport({
    task_slug: "t", started_at: "2026-07-27T10:00:00Z",
    phases: [
      { phase: "development", usage_source: "reported",
        input_tokens: 100, output_tokens: 50, cached_input_tokens: 10, cache_creation_tokens: 5,
        heal_attempts_used: 1, heal_status: "healed" },
      { phase: "security", usage_source: "reported",
        input_tokens: 100, output_tokens: 50, cached_input_tokens: 10, cache_creation_tokens: 5,
        heal_attempts_used: 1, heal_status: "healed" },
    ],
  });
  // Hero sums to 2; only a per-phase badge can produce the string "1 heal attempt(s)".
  assert.match(html, /2 heal attempt\(s\)/);   // hero
  assert.match(html, /1 heal attempt\(s\)/);   // per-phase badge — impossible without it
});

test("an undetected cap breach names the overage and the phases the gate could not price", () => {
  const t = JSON.parse(JSON.stringify(tel));
  t.cost_cap_usd = 0.75;
  t.cap_status = "exceeded-undetected";
  t.cap_breach_usd = 2.62;
  t.phases[0].cap_gate_blind = true;
  const html = renderReport(t);
  assert.match(html, /exceeded-undetected/);
  assert.match(html, /over by \$2\.62/);
  assert.match(html, /not caught in-run/);
  assert.match(html, new RegExp(`unpriced at gate time: ${t.phases[0].phase}`));
});

test("a cap breach the gate DID catch is not labelled undetected", () => {
  const t = JSON.parse(JSON.stringify(tel));
  t.cost_cap_usd = 0.10;
  t.cap_status = "exceeded-continued";
  t.cap_breach_usd = 0.10;
  const html = renderReport(t);
  assert.match(html, /exceeded-continued/);
  assert.match(html, /over by \$0\.10/);
  assert.doesNotMatch(html, /not caught in-run/);
});

test("a project-overridden cap is labelled as such", () => {
  const t = JSON.parse(JSON.stringify(tel));
  t.cost_cap_usd = 8.00;
  t.cost_cap_source = "project:android-feature";
  t.cap_status = "within";
  const html = renderReport(t);
  assert.match(html, /\$8\.00 cap \(project override\)/);
});

test("a cap the project switched off reads as uncapped, not as 'no cap set'", () => {
  // `cost_caps: {hotfix: null}` is a deliberate opt-out and must not render identically to a
  // recipe that never declared a cap — those are different facts about the run.
  const t = JSON.parse(JSON.stringify(tel));
  t.cost_cap_usd = null;
  t.cost_cap_source = "project:hotfix";
  const html = renderReport(t);
  assert.match(html, /uncapped \(project override\)/);
});

test("an ordinary recipe cap carries no override label", () => {
  const t = JSON.parse(JSON.stringify(tel));
  t.cost_cap_usd = 4.25;
  t.cost_cap_source = "recipe";
  const html = renderReport(t);
  assert.match(html, /\$4\.25 cap/);
  assert.doesNotMatch(html, /project override/);
});

// The QA loop belongs to whichever phase the recipe put it in — `android-feature` runs it as
// `test`, not `qa`. Keying the KPI on the name reported 0 iterations for a run that spent 2.
test("QA iterations are summed across phases, not read off a phase named 'qa'", () => {
  const t = JSON.parse(JSON.stringify(tel));
  const qa = t.phases.find((p) => p.phase === "qa");
  qa.phase = "test";                    // same loop, recipe-specific phase name
  const html = renderReport(t);
  assert.match(html, /2 QA iteration\(s\)/);
  assert.doesNotMatch(html, /0 QA iteration\(s\)/);
  assert.match(html, /QA:\s*completed \(2 iteration\(s\)\)/);
});

test("two phases running QA loops are listed separately and summed in the hero", () => {
  const t = JSON.parse(JSON.stringify(tel));
  const qa = t.phases.find((p) => p.phase === "qa");
  qa.qa_iterations_used = 2;
  t.phases.push({ phase: "qa", agent: "x-qa", status: "completed", qa_status: "completed", qa_iterations_used: 1 });
  qa.phase = "test";
  const html = renderReport(t);
  assert.match(html, /3 QA iteration\(s\)/);          // hero: summed
  assert.match(html, /QA · test:\s*completed \(2 iteration\(s\)\)/);
  assert.match(html, /QA · qa:\s*completed \(1 iteration\(s\)\)/);
});

// A run whose Step 5b enrichment never fired keeps the in-run gate's provisional
// `cap_status: "within"` beside a null cost. Rendering that as a verdict is how a
// $16.50 cap "held" on a run nothing ever priced — the report must refuse to.
test("an unpriced run reports the cap as unverified, never as within", () => {
  const t = JSON.parse(JSON.stringify(tel));
  t.total_cost_usd = null;
  delete t.cost_basis;
  t.cost_cap_usd = 16.50;
  t.cap_status = "within";
  t.phases[0].cap_gate_blind = true;
  t.phases[1].cap_gate_blind = true;
  const html = renderReport(t);
  assert.match(html, /\$16\.50 cap · unverified — run unpriced/);
  assert.doesNotMatch(html, /\$16\.50 cap · within/);
  // and the reason is named, with the phases the gate could not price
  assert.match(html, /Cost: <b>unpriced<\/b>/);
  assert.match(html, /cap verdict is unverified/);
  assert.match(html, new RegExp(`cap gate was blind on: ${t.phases[0].phase}, ${t.phases[1].phase}`));
});

test("an aggregate-only cost_basis is not treated as a priced run", () => {
  // total_cost_usd alone is not enough: `subagent_aggregate` / `estimated` bases carry a
  // number that never went through transcript pricing, so the cap never really gated.
  const t = JSON.parse(JSON.stringify(tel));
  t.cost_basis = "subagent_aggregate";
  const html = renderReport(t);
  assert.match(html, /unverified — run unpriced/);
  assert.match(html, /cost_basis: subagent_aggregate/);
});

test("a transcript-priced run keeps its cap verdict and raises no cost signal", () => {
  const html = renderReport(tel);   // fixture is cost_basis: "transcript"
  assert.match(html, /\$0\.60 cap · within/);
  assert.doesNotMatch(html, /unverified/);
  assert.doesNotMatch(html, /Cost: <b>unpriced<\/b>/);
});

test("renderReportFile flags an unpriced run so the CLI can warn on stderr", () => {
  const dir = mkdtempSync(join(tmpdir(), "report-unpriced-"));
  const t = JSON.parse(JSON.stringify(tel));
  t.total_cost_usd = null;
  writeFileSync(join(dir, "_telemetry.json"), JSON.stringify(t));
  assert.equal(renderReportFile(dir).cap_unverified, true);

  const priced = mkdtempSync(join(tmpdir(), "report-priced-"));
  writeFileSync(join(priced, "_telemetry.json"), JSON.stringify(tel));
  assert.equal(renderReportFile(priced).cap_unverified, false);
  rmSync(dir, { recursive: true, force: true });
  rmSync(priced, { recursive: true, force: true });
});
