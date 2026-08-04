#!/usr/bin/env node
// Dependency-free entry for resolving a run, shipped inside the sdlc plugin.
//
// One command, invoked by pipeline-orchestrator Steps 0 → 1d:
//   node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs plan [--json] [--dry-run] [--workflow=NAME] …
//
// It replaces ~926 lines of prose that the model executed as ~24 turns and 14 tool calls, for a
// measured median of $1.31 per run (ADR-0019). Paths resolve against the CONSUMER's project cwd;
// only the script itself is loaded from the plugin root.
//
// This is the ONLY unit here that prints. Everything it prints is composed upstream — the
// orchestrator echoes `prints[]` verbatim rather than filling a template, which is
// ADR-0015's machine-value invariant applied to prose instead of arithmetic.

import { resolvePlan } from "./plan.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1).join(" ");
const jsonOut = argv.includes("--json");

function usage() {
  console.error("usage: cli.mjs plan [--json] [--dry-run] [--workflow=NAME] [--no-auto-workflow]");
  console.error("                    [--force-preflight] [--skills <csv>] [--no-skip-rules] [--force-ba]");
  console.error("                    [--base-ref <ref>] [--mode tree|installed]");
  return 2;
}

if (cmd !== "plan") process.exit(usage());

const modeIdx = argv.indexOf("--mode");
const mode = modeIdx >= 0 && argv[modeIdx + 1] && !argv[modeIdx + 1].startsWith("--") ? argv[modeIdx + 1] : "installed";

let result;
try {
  result = resolvePlan({ cwd: process.cwd(), args: rest, env: process.env, mode });
} catch (e) {
  // A crash here stops the run, and the prose it replaced would have degraded instead. The
  // trade is deliberate (ADR-0019), so the message has to be actionable rather than a stack.
  if (jsonOut) console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  else console.error(`❌ resolve failed: ${e && e.message ? e.message : e}`);
  process.exit(1);
}

const { plan, prints, warnings, halt, deps_abort: depsAbort } = result;

if (jsonOut) {
  console.log(JSON.stringify({ ok: !halt, plan, prints, warnings, halt: halt ?? null }));
} else {
  // `warnings` is a subset of `prints` (see resolvePlan) — echoing it here too would print
  // every diagnostic twice. It stays in the JSON envelope for machine consumers only.
  for (const p of prints) console.log(p);
  if (halt) console.error(halt);
}

// A blocking dependency and an unresolvable workflow are both "the run cannot proceed", but
// only the first has a machine-readable stdout contract that predates this command (Step 0a-4),
// and that contract is preserved above by `prints`/`halt` rather than replaced by the exit code.
// The exit code is the addition: unlike a skill prompt, a process CAN report failure as status.
process.exit(halt || depsAbort ? 1 : 0);
