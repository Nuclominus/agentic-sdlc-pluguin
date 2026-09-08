#!/usr/bin/env node
// Dependency-free entry for transcript-derived cost accounting, shipped inside
// the sdlc plugin. Two commands, invoked by pipeline-orchestrator:
//   Step 3d-1b (between phases, feeds the cost-cap gate):
//     node ${CLAUDE_PLUGIN_ROOT}/tools/usage/cli.mjs phase-cost <agent-id>[,<id>...] --session <transcript.jsonl> --json
//   Step 5b (end of run, authoritative rewrite of the whole run):
//     node ${CLAUDE_PLUGIN_ROOT}/tools/usage/cli.mjs enrich <slug-or-dir> --session <transcript.jsonl> [--json]
// Paths resolve against the CONSUMER's project cwd (where docs/plans/<slug>/ lives);
// only the script itself is loaded from the plugin root. Imports node builtins +
// the sibling module only — no ajv/yaml, so no node_modules on a consumer install.
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { enrichTelemetry, phaseCost } from "./usage.mjs";

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
  console.error("       phase-cost <agent-id>[,<agent-id>...] [--exclude <id,...>] [--session <transcript.jsonl>] [--registry <models.json>] [--projects-root <dir>] [--json]");
  return 2;
}
const list = (s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

let code = 0;
if (cmd === "phase-cost") {
  // Price ONE finished phase between dispatches, so the Step 3d-cap gate spends
  // a real number instead of the aggregate envelope's unpriceable null. A miss
  // is NOT an error: exit 0 with resolved:false and let the caller fall back.
  const ids = list(args[1] && !args[1].startsWith("--") ? args[1] : null);
  if (!ids.length) {
    code = usage();
  } else {
    const session = opt("--session");
    try {
      const r = phaseCost(ids, {
        exclude: list(opt("--exclude")),
        sessionTranscript: session ? resolve(root, session) : undefined,
        registryPath: opt("--registry") || undefined,
        projectsRoot: opt("--projects-root") || undefined,
      });
      if (jsonOut) {
        console.log(JSON.stringify({ command: "phase-cost", ok: true, ...r }));
      } else if (r.resolved) {
        console.log(`phase-cost: $${r.cost_usd.toFixed(2)} (${r.model}, ${r.turns} turns, ${r.billed_tokens} billed tokens)`);
      } else {
        console.log(`phase-cost: unresolved (${r.reason}) — cost unknown, not $0`);
      }
    } catch (e) {
      // Even a registry failure must not fail the pipeline; report and let the
      // orchestrator keep the aggregate fallback.
      if (jsonOut) console.log(JSON.stringify({ command: "phase-cost", ok: false, resolved: false, reason: "error", cost_usd: null, error: e.message }));
      else console.error(`phase-cost: unresolved (error: ${e.message})`);
    }
  }
} else if (cmd !== "enrich") {
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
        if (r.timestamps_corrected) {
          const d = r.timestamps_corrected;
          console.error(`WARN: started_at was ${d.from} but the machine anchor says ${d.to}` +
            (d.drift_seconds != null ? ` (off by ${d.drift_seconds}s)` : "") +
            ` — corrected; Step 5 did not derive the ISO stamps from .checkpoint/_started_at`);
        }
        if (r.session_mismatch) {
          console.error(`WARN: --session does not belong to this run (none of its agents are in that session) — ignored it and recovered the session from the phase transcripts`);
        }
        if (r.skipped_all) {
          console.log(`  no transcripts resolved — telemetry left unchanged (cost stays aggregate/unpriced)`);
        } else {
          console.log(`  total_cost_usd: $${(r.total_cost_usd ?? 0).toFixed(2)}` +
            (r.overhead_cost_usd != null ? `  (orchestration overhead $${r.overhead_cost_usd.toFixed(2)})` : ""));
          if (r.overhead_window_fallback) {
            console.error(`WARN: overhead window fell back to the full transcript — telemetry started_at/completed_at look wrong; verify orchestration cost`);
          }
          if (r.cap_breach_usd != null) {
            console.error(`WARN: phase spend exceeded the cost cap by $${r.cap_breach_usd.toFixed(2)} (cap_status: ${r.cap_status})` +
              (r.cap_status === "exceeded-undetected" ? ` — the in-run gate did not catch this; check for cap_gate_blind phases` : ""));
          }
        }
      }
    } catch (e) {
      if (jsonOut) console.log(JSON.stringify({ command: "enrich", ok: false, error: e.message }));
      else console.error(`✗ enrich: ${e.message}`);
      code = 2;
    }
  }
}
process.exit(code);
