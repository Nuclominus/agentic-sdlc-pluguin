// Sealing a finished run: one call that does what Step 5's clock arithmetic and all of
// Step 5b used to ask the orchestrator to do in six prose sub-steps. Shipped inside the
// sdlc plugin; node builtins plus the two sibling tools it composes.
//
// Fail-open everywhere. The run has already succeeded by the time this executes — a
// failure to price it, or to render its report, must never turn a successful run into a
// failed one. Each stage records what happened and the next stage still runs.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sealRunClock } from "./clock.mjs";
import { enrichTelemetry } from "../usage/usage.mjs";
import { renderReportFile } from "../report/report.mjs";

/**
 * Seal a run: machine clock, transcript-derived cost, HTML report.
 *
 * @param {string} runDir  docs/plans/<slug>/
 * @param {object} [opts]
 * @param {number} [opts.now]           epoch ms; injected by tests
 * @param {boolean} [opts.noReport]     skip the HTML render only
 * @param {string} [opts.registryPath]  models.json override
 * @param {string} [opts.projectsRoot]  transcript root override
 * @param {Function} [opts.enrich]        TEST SEAM — replaces enrichTelemetry
 * @param {Function} [opts.renderReport]  TEST SEAM — replaces renderReportFile
 *
 * There is deliberately no `session` option. The enricher recovers the orchestrator
 * session from a resolved phase transcript by itself, which is why the model no longer
 * globs for one — and why it can no longer supply the wrong one (the worktree trap).
 */
export function finishRun(runDir, opts = {}) {
  const telPath = join(runDir, "_telemetry.json");
  if (!existsSync(telPath)) throw new Error(`no _telemetry.json in ${runDir}`);

  const warnings = [];
  const enrichFn = opts.enrich || ((dir) => enrichTelemetry(dir, {
    registryPath: opts.registryPath, projectsRoot: opts.projectsRoot }));
  const renderFn = opts.renderReport || ((dir) => renderReportFile(dir));

  // 1. Clock — first, so enrichment's overhead window is right on the first pass
  //    rather than repaired afterwards by reconcileRunWindow.
  const clock = sealRunClock(runDir, { now: opts.now });
  if (clock.degraded === "no-anchor") {
    warnings.push("WARN: no .checkpoint/_started_at — kept the timestamps already in telemetry; " +
      "this run's clock is not machine-anchored");
  } else if (clock.degraded === "no-anchor-no-values") {
    warnings.push("WARN: no .checkpoint/_started_at and no timestamps in telemetry — started_at " +
      "and wall_clock_seconds recorded as null (unknown, not zero)");
  }

  // 2. Cost.
  let enrich;
  try {
    const r = enrichFn(runDir);
    enrich = { ok: true, ...r };
    if (r.timestamps_corrected) {
      const d = r.timestamps_corrected;
      warnings.push(`WARN: started_at was ${d.from} but the machine anchor says ${d.to}` +
        (d.drift_seconds != null ? ` (off by ${d.drift_seconds}s)` : "") + " — corrected");
    }
    if (r.overhead_window_fallback) {
      warnings.push("WARN: overhead window fell back to the full transcript — the run window looks " +
        "wrong; verify the orchestration cost");
    }
    if (r.cap_breach_usd != null) {
      warnings.push(`WARN: phase spend exceeded the cost cap by $${r.cap_breach_usd.toFixed(2)} ` +
        `(cap_status: ${r.cap_status})` + (r.cap_status === "exceeded-undetected"
          ? " — the in-run gate did not catch this; check for cap_gate_blind phases" : ""));
    }
    // enrichTelemetry sets cost_basis:"transcript" on its success path only, so these
    // two fields are exactly the "not fully priced" condition — no re-read needed.
    if (r.skipped_all || (r.skipped && r.skipped.length)) {
      warnings.push("WARN: cost enrichment incomplete — cost may read as aggregate/$—" +
        (r.skipped && r.skipped.length ? ` (unresolved: ${r.skipped.join(", ")})` : ""));
    }
  } catch (e) {
    enrich = { ok: false, error: e.message };
    warnings.push(`WARN: cost enrichment failed — ${e.message}; the run stays unpriced`);
  }

  // 3. Report.
  let report;
  if (opts.noReport) {
    report = { skipped: "--no-report" };
  } else {
    try {
      const { htmlPath, cap_unverified } = renderFn(runDir);
      report = { ok: true, html_path: htmlPath, cap_unverified: !!cap_unverified };
      if (cap_unverified) {
        warnings.push("WARN: run is unpriced (cost_basis is not \"transcript\") — the cost cap " +
          "gated nothing and the report says \"unverified\"");
      }
    } catch (e) {
      report = { ok: false, error: e.message };
      warnings.push(`WARN: HTML report failed — ${e.message}`);
    }
  }

  return { runDir, telPath, clock, enrich, report, warnings };
}
