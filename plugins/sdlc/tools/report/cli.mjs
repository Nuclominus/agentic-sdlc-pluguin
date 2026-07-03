#!/usr/bin/env node
// Dependency-free entry for the HTML run-report, shipped inside the sdlc plugin.
// Invoked by pipeline-orchestrator Step 5b as:
//   node ${CLAUDE_PLUGIN_ROOT}/tools/report/cli.mjs report <slug-or-dir> [--json]
// Paths resolve against the CONSUMER's project cwd (where docs/plans/<slug>/ lives);
// only the script itself is loaded from the plugin root. Imports node builtins +
// the sibling renderer only — no ajv/yaml, so no node_modules on a consumer install.
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { renderReportFile } from "./report.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const jsonOut = args.includes("--json");
const root = process.cwd();

function usage() {
  console.error("usage: report <slug-or-dir> [--json]");
  return 2;
}

let code = 0;
if (cmd !== "report") {
  code = usage();
} else {
  const target = args[1] && !args[1].startsWith("--") ? args[1] : null;
  if (!target) {
    code = usage();
  } else {
    const direct = resolve(root, target);
    const dir = existsSync(join(direct, "_telemetry.json")) ? direct : join(root, "docs", "plans", target);
    try {
      const { htmlPath } = renderReportFile(dir);
      if (jsonOut) console.log(JSON.stringify({ command: "report", ok: true, html_path: htmlPath }));
      else console.log(`report: wrote ${htmlPath}`);
    } catch (e) {
      if (jsonOut) console.log(JSON.stringify({ command: "report", ok: false, error: e.message }));
      else console.error(`✗ report: ${e.message}`);
      code = 2;
    }
  }
}
process.exit(code);
