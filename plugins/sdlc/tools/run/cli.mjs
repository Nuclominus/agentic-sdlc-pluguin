#!/usr/bin/env node
// Dependency-free entry for sealing a finished run, shipped inside the sdlc plugin.
// One command, invoked by pipeline-orchestrator Step 5b:
//   node ${CLAUDE_PLUGIN_ROOT}/tools/run/cli.mjs finish <slug-or-dir> [--no-report] [--json]
// It replaces three separate invocations (the Step 5 `date` arithmetic, `usage/cli.mjs
// enrich`, `report/cli.mjs report`) with one, because H1 measured that compliance tracks
// the number of things an instruction asks for. Paths resolve against the CONSUMER's
// project cwd; only the script itself is loaded from the plugin root.
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { finishRun } from "./finish.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const jsonOut = args.includes("--json");
const root = process.cwd();

function opt(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}
function usage() {
  console.error("usage: finish <slug-or-dir> [--no-report] [--registry <models.json>] [--projects-root <dir>] [--json]");
  return 2;
}
function round2(n) { return Math.round(n * 100) / 100; }
const money = (n) => (n == null ? "$—" : `$${n.toFixed(2)}`);

let code = 0;
if (cmd !== "finish") {
  code = usage();
} else {
  const target = args[1] && !args[1].startsWith("--") ? args[1] : null;
  if (!target) {
    code = usage();
  } else {
    const direct = resolve(root, target);
    const dir = existsSync(join(direct, "_telemetry.json")) ? direct : join(root, "docs", "plans", target);
    try {
      const r = finishRun(dir, {
        noReport: args.includes("--no-report"),
        registryPath: opt("--registry") || undefined,
        projectsRoot: opt("--projects-root") || undefined,
      });
      if (jsonOut) {
        console.log(JSON.stringify({ command: "finish", ok: true, run_dir: r.runDir,
          clock: r.clock, enrich: r.enrich, report: r.report, warnings: r.warnings }));
      } else {
        console.log(`finish: ${r.runDir}`);
        const c = r.clock;
        console.log(`  clock:   ${c.started_at ?? "—"} → ${c.completed_at ?? "—"}` +
          `  (${c.wall_clock_seconds == null ? "—" : `${c.wall_clock_seconds}s`}, ` +
          `${c.anchored ? "anchored" : "no anchor"})`);
        if (r.enrich.ok && !r.enrich.skipped_all) {
          const phases = (r.enrich.total_cost_usd ?? 0) - (r.enrich.overhead_cost_usd ?? 0);
          console.log(`  cost:    ${money(r.enrich.total_cost_usd)}  (phases ${money(round2(phases))}` +
            ` + overhead ${money(r.enrich.overhead_cost_usd)})   basis: transcript`);
          if (r.enrich.cap_status) {
            console.log(`  cap:     ${r.enrich.cap_status}` +
              (r.enrich.cap_breach_usd != null ? ` (breach ${money(r.enrich.cap_breach_usd)})` : ""));
          }
        } else {
          console.log(`  cost:    $— (unpriced — no phase transcript resolved)`);
        }
        if (r.report.ok) console.log(`  report:  ${r.report.html_path}`);
        else if (r.report.skipped) console.log(`  report:  skipped (${r.report.skipped})`);
        else console.log(`  report:  failed`);
      }
      // Warnings always go to stderr, including under --json where they also ride
      // inside the JSON: a headless consumer parses stdout, a human reads the log.
      for (const w of r.warnings) console.error(w);
    } catch (e) {
      if (jsonOut) console.log(JSON.stringify({ command: "finish", ok: false, error: e.message }));
      else console.error(`✗ finish: ${e.message}`);
      code = 2;
    }
  }
}
process.exit(code);
