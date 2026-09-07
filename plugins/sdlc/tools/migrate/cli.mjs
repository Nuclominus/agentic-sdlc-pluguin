#!/usr/bin/env node
// Dependency-free entry for migrating a project's SDLC config across an agent rename.
//
//   node ${CLAUDE_PLUGIN_ROOT}/tools/migrate/cli.mjs check [--json]
//   node ${CLAUDE_PLUGIN_ROOT}/tools/migrate/cli.mjs apply [--json]
//
// `check` is read-only and is what /sdlc:doctor runs; `apply` rewrites the project's own files and
// must only ever run after the user has approved the reported changes (ADR-0021). The rename data
// lives in config/agent-migrations.json, not in code, so a future rename is a data change.
//
// Exit codes: 0 clean or applied, 1 an internal failure, 2 stale names found by `check` (so CI can
// gate on a migrated config without parsing prose).

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRenames, scanConfigs, applyRenames, renderReport } from "./migrate.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0];
const jsonOut = argv.includes("--json");

if (cmd !== "check" && cmd !== "apply") {
  console.error("usage: cli.mjs <check|apply> [--json]");
  process.exit(2);
}

// The plugin root is this file's own grandparent — resolving it from the running install rather
// than from a home-anchored path (ADR-0009).
const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

try {
  const renames = loadRenames(pluginRoot);
  const findings = scanConfigs(projectRoot, renames);
  const applied = cmd === "apply" ? applyRenames(projectRoot, findings) : [];

  if (jsonOut) {
    console.log(JSON.stringify({ ok: true, command: cmd, findings, changed_files: applied }));
  } else {
    console.log(renderReport(findings, { applied: cmd === "apply" }));
    if (cmd === "apply" && applied.length) console.log(`   files rewritten: ${applied.join(", ")}`);
  }
  process.exit(cmd === "check" && findings.length ? 2 : 0);
} catch (e) {
  const msg = e && e.message ? e.message : String(e);
  if (jsonOut) console.log(JSON.stringify({ ok: false, command: cmd, error: msg }));
  else console.error(`❌ migrate: ${msg}`);
  process.exit(1);
}
