#!/usr/bin/env node
// Dependency-free entry for the cross-run rollup, shipped inside the sdlc plugin.
// Invoked by the /sdlc:report command as:
//   node ${CLAUDE_PLUGIN_ROOT}/tools/rollup/cli.mjs report [--json]
// Paths resolve against the CONSUMER's project cwd (where docs/plans/ lives);
// only the script itself is loaded from the plugin root. Node builtins + the
// sibling rollup module only — no node_modules on a consumer install.
import { rollupWorkspace } from "./rollup.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const jsonOut = args.includes("--json");
const root = process.cwd();

function usage() {
  console.error("usage: report [--json]");
  return 2;
}

let code = 0;
if (cmd !== "report") {
  code = usage();
} else {
  try {
    const { htmlPath, agg, text, warnings } = rollupWorkspace(root);
    for (const w of warnings) console.error(`⚠ ${w}`);
    if (jsonOut) {
      console.log(JSON.stringify({ command: "report", ok: true, html_path: htmlPath, run_count: agg.run_count, agg }));
    } else {
      console.log(text);
      console.log(`\nwrote ${htmlPath}`);
    }
  } catch (e) {
    if (jsonOut) console.log(JSON.stringify({ command: "report", ok: false, error: e.message }));
    else console.error(`✗ report: ${e.message}`);
    code = 2;
  }
}
process.exit(code);
