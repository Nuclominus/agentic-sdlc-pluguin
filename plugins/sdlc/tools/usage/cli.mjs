#!/usr/bin/env node
// Dependency-free entry for transcript-derived cost enrichment, shipped inside
// the sdlc plugin. Invoked by pipeline-orchestrator Step 5b as:
//   node ${CLAUDE_PLUGIN_ROOT}/tools/usage/cli.mjs enrich <slug-or-dir> --session <transcript.jsonl> [--json]
// Paths resolve against the CONSUMER's project cwd (where docs/plans/<slug>/ lives);
// only the script itself is loaded from the plugin root. Imports node builtins +
// the sibling module only — no ajv/yaml, so no node_modules on a consumer install.
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { enrichTelemetry } from "./usage.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const jsonOut = args.includes("--json");
const root = process.cwd();

function opt(name) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}
function usage() {
  console.error("usage: enrich <slug-or-dir> [--session <transcript.jsonl>] [--registry <models.json>] [--projects-root <dir>] [--json]");
  return 2;
}

let code = 0;
if (cmd !== "enrich") {
  code = usage();
} else {
  const target = args[1] && !args[1].startsWith("--") ? args[1] : null;
  if (!target) {
    code = usage();
  } else {
    const direct = resolve(root, target);
    const dir = existsSync(join(direct, "_telemetry.json")) ? direct : join(root, "docs", "plans", target);
    const session = opt("--session");
    try {
      const r = enrichTelemetry(dir, {
        sessionTranscript: session ? resolve(root, session) : undefined,
        registryPath: opt("--registry") || undefined,
        projectsRoot: opt("--projects-root") || undefined,
      });
      if (jsonOut) {
        console.log(JSON.stringify({ command: "enrich", ok: true, ...r }));
      } else {
        console.log(`enrich: ${r.telPath}`);
        console.log(`  enriched: ${r.enriched.join(", ") || "(none)"}`);
        if (r.skipped.length) console.log(`  skipped (no transcript): ${r.skipped.join(", ")}`);
        console.log(`  total_cost_usd: $${(r.total_cost_usd ?? 0).toFixed(2)}` +
          (r.overhead_cost_usd != null ? `  (orchestration overhead $${r.overhead_cost_usd.toFixed(2)})` : ""));
      }
    } catch (e) {
      if (jsonOut) console.log(JSON.stringify({ command: "enrich", ok: false, error: e.message }));
      else console.error(`✗ enrich: ${e.message}`);
      code = 2;
    }
  }
}
process.exit(code);
