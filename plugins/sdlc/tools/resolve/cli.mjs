#!/usr/bin/env node
// Dependency-free entry for resolving a run, shipped inside the sdlc plugin.
//
// Two commands:
//   node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs plan [--json] [--dry-run] [--workflow=NAME] …
//     invoked by pipeline-orchestrator Steps 0 → 1d. It replaces ~926 lines of prose that the
//     model executed as ~24 turns and 14 tool calls, for a measured median of $1.31 per run
//     (ADR-0019).
//   node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs expertise --role <name> [--json] [--stack=NAME]
//     invoked by an ON-DEMAND agent (debugger, devops, cicd, aar-analyst) that runs outside the
//     orchestrator. It prints the same `Stack expertise for <role>` and `Skills for this role`
//     blocks a pipeline dispatch would have carried in its stable prefix (ADR-0021) — one
//     command, once per invocation, in place of "self-read rules/skills.md and sdlc.local.yaml".
//
// Paths resolve against the CONSUMER's project cwd; only the script itself is loaded from the
// plugin root.
//
// This is the ONLY unit here that prints. Everything it prints is composed upstream — the
// orchestrator echoes `prints[]` verbatim rather than filling a template, which is
// ADR-0015's machine-value invariant applied to prose instead of arithmetic.

import { resolvePlan, resolveExpertise } from "./plan.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1).join(" ");
const jsonOut = argv.includes("--json");

function usage() {
  console.error("usage: cli.mjs plan [--json] [--dry-run] [--workflow=NAME] [--no-auto-workflow]");
  console.error("                    [--force-preflight] [--skills <csv>] [--no-skip-rules] [--force-ba]");
  console.error("                    [--base-ref <ref>] [--mode tree|installed]");
  console.error("       cli.mjs expertise --role <name> [--json] [--stack=NAME] [--mode tree|installed]");
  return 2;
}

/** `--name value` (a separate token), or null. */
function tokenOpt(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}

if (cmd !== "plan" && cmd !== "expertise") process.exit(usage());

const mode = tokenOpt("--mode") ?? "installed";

/** A crash stops the run, and the prose it replaced would have degraded instead. The trade is
 *  deliberate (ADR-0019), so the message has to be actionable rather than a stack. */
function crash(e) {
  if (jsonOut) console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  else console.error(`❌ resolve failed: ${e && e.message ? e.message : e}`);
  process.exit(1);
}

if (cmd === "expertise") {
  const role = tokenOpt("--role");
  if (!role) process.exit(usage());
  let r;
  try { r = resolveExpertise({ cwd: process.cwd(), args: rest, env: process.env, mode, role }); } catch (e) { crash(e); }

  if (jsonOut) {
    console.log(JSON.stringify(r));
  } else if (!r.ok) {
    for (const p of r.prints) console.log(p);
    console.error(`❌ expertise: ${r.error}`);
  } else if (r.block == null && r.skills_block == null) {
    console.log(`no stack expertise for ${r.role} (stack: ${r.stack})`);
  } else {
    if (r.block) console.log(r.block);
    if (r.block && r.skills_block) console.log("");
    if (r.skills_block) console.log(r.skills_block);
  }
  // Unknown role is a caller error (2); a halt in resolution is the same "cannot proceed" as plan (1).
  process.exit(r.ok ? 0 : /^unknown role/.test(String(r.error)) ? 2 : 1);
}

let result;
try {
  result = resolvePlan({ cwd: process.cwd(), args: rest, env: process.env, mode });
} catch (e) {
  crash(e);
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
