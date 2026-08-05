#!/usr/bin/env node
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSchemas } from "./lib/schema.mjs";
import { checkAllWorkflows } from "./lib/cycles.mjs";
import { resolveFixture, listFixtures } from "./lib/detect.mjs";
import { resolveWorkspace } from "./lib/resume.mjs";
import { renderReportFile } from "./lib/report.mjs";
import { rollupWorkspace } from "./lib/rollup.mjs";
import { checkReadDiscipline } from "./lib/read-discipline.mjs";
import { checkPluginPaths } from "./lib/plugin-paths.mjs";
import { checkMachineValues } from "./lib/machine-values.mjs";
import { checkAgentTools } from "./lib/agent-tools.mjs";
import { parseContracts } from "./lib/contracts.mjs";
import { auditRun } from "./lib/compliance.mjs";
import { aggregate, renderText } from "./lib/compliance-report.mjs";
import { measureRun, aggregate as aggregateWindows, renderText as renderWindows } from "./lib/start-window.mjs";
import { loadRegistry } from "../../plugins/sdlc/tools/usage/usage.mjs";
import { globSync } from "tinyglobby";
import { readdirSync, readFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const cmd = args[0];
const jsonOut = args.includes("--json");
const root = process.cwd();

function printSchema(results) {
  const failed = results.filter(r => !r.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ command: "schema", checked: results.length, failed: failed.length, failures: failed }));
  } else {
    for (const r of failed) console.error(`✗ ${r.file}\n    ${r.errors.join("\n    ")}`);
    console.log(`schema: ${results.length - failed.length}/${results.length} passed`);
  }
  return failed.some(r => r.tool_error) ? 2 : failed.length ? 1 : 0;
}

function printCycles(results) {
  const failed = results.filter(r => !r.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ command: "cycles", checked: results.length, failed: failed.length, failures: failed }));
  } else {
    for (const r of failed) console.error(`✗ ${r.file}\n    ${r.errors.join("\n    ")}`);
    console.log(`cycles: ${results.length - failed.length}/${results.length} clean`);
  }
  return failed.length ? 1 : 0;
}

function printReadDiscipline(results) {
  const failed = results.filter(r => !r.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ command: "read-discipline", checked: results.length, failed: failed.length, failures: failed }));
  } else {
    for (const r of failed) console.error(`✗ ${r.file}\n    ${r.errors.join("\n    ")}`);
    console.log(`read-discipline: ${results.length - failed.length}/${results.length} clean`);
  }
  return failed.some(r => r.tool_error) ? 2 : failed.length ? 1 : 0;
}

function printPluginPaths(results) {
  const failed = results.filter(r => !r.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ command: "plugin-paths", checked: results.length, failed: failed.length, failures: failed }));
  } else {
    for (const r of failed) console.error(`✗ ${r.file}\n    ${r.errors.join("\n    ")}`);
    console.log(`plugin-paths: ${results.length - failed.length}/${results.length} clean`);
  }
  return failed.some(r => r.tool_error) ? 2 : failed.length ? 1 : 0;
}

function printAgentTools(results) {
  const failed = results.filter(r => !r.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ command: "agent-tools", checked: results.length, failed: failed.length, failures: failed }));
  } else {
    for (const r of failed) console.error(`✗ ${r.file}\n    ${r.errors.join("\n    ")}`);
    console.log(`agent-tools: ${results.length - failed.length}/${results.length} clean`);
  }
  return failed.some(r => r.tool_error) ? 2 : failed.length ? 1 : 0;
}

function printMachineValues(results) {
  const failed = results.filter(r => !r.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ command: "machine-values", checked: results.length, failed: failed.length, failures: failed }));
  } else {
    for (const r of failed) console.error(`✗ ${r.file}\n    ${r.errors.join("\n    ")}`);
    console.log(`machine-values: ${results.length - failed.length}/${results.length} clean`);
  }
  return failed.some(r => r.tool_error) ? 2 : failed.length ? 1 : 0;
}

const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const detectRows = () => listFixtures(FIX).map(name => ({ name, ...resolveFixture(join(FIX, name), root) }));

function printDetect2(rows) {
  const failed = rows.filter(r => !r.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ command: "detect", checked: rows.length, failed: failed.length, failures: failed }));
  } else {
    for (const r of failed) console.error(`✗ ${r.name}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`);
    console.log(`detect: ${rows.length - failed.length}/${rows.length} fixtures matched`);
  }
  return failed.length ? 1 : 0;
}
function printDetect() {
  return printDetect2(detectRows());
}

function printResumeOne(dir) {
  let res, err;
  try { res = resolveWorkspace(dir); } catch (e) { err = e; }
  if (jsonOut) {
    console.log(JSON.stringify(err
      ? { command: "resume", dir, ok: false, error: err.message }
      : { command: "resume", dir, ok: true, reenter_at: res.reenter_at, completed: res.completed, warnings: res.warnings }));
  } else if (err) {
    console.error(`✗ ${dir}: ${err.message}`);
  } else {
    console.log(`resume ${dir}: reenter_at=${res.reenter_at ?? "(none — all done)"} completed=${res.completed.length}${res.warnings.length ? ` warnings=${res.warnings.length}` : ""}`);
  }
  return err ? 2 : 0;
}

function resumeFixtureDirs() {
  return readdirSync(FIX, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith("resume-"))
    .map(e => e.name).sort();
}

function printResumeFixtures() {
  const failed = [];
  for (const name of resumeFixtureDirs()) {
    const dir = join(FIX, name);
    let expected, actual;
    try {
      expected = JSON.parse(readFileSync(join(dir, "expected-reentry.json"), "utf8"));
      actual = resolveWorkspace(dir);
    } catch (e) {
      failed.push({ name, error: e.message, tool_error: true }); // misconfigured fixture / unreadable workspace
      continue;
    }
    const ok = actual.reenter_at === expected.reenter_at
      && JSON.stringify(actual.remaining) === JSON.stringify(expected.remaining)
      && JSON.stringify([...actual.completed].sort()) === JSON.stringify([...expected.completed].sort());
    if (!ok) failed.push({ name, expected, actual: { reenter_at: actual.reenter_at, remaining: actual.remaining, completed: actual.completed } });
  }
  if (jsonOut) {
    console.log(JSON.stringify({ command: "resume", checked: resumeFixtureDirs().length, failed: failed.length, failures: failed }));
  } else {
    for (const f of failed) console.error(`✗ ${f.name}: ${f.error ?? JSON.stringify(f.actual)}`);
    console.log(`resume: ${resumeFixtureDirs().length - failed.length}/${resumeFixtureDirs().length} fixtures matched`);
  }
  return failed.some(r => r.tool_error) ? 2 : failed.length ? 1 : 0;
}

/**
 * The ONE error shape (#126). Under `--json` a caller parses stdout; a verb that wrote its
 * diagnosis to stderr and nothing to stdout handed that caller an empty parse, so it could not
 * tell "the tool failed" from "the tool had nothing to say". `report`/`rollup`/`resume` already
 * emitted this envelope, `compliance`/`start-window`/the usage paths did not — an inconsistency
 * across five paths, not a convention. Same shape as #121's halt on a channel nobody read.
 */
function fail(command, message, exit = 2) {
  if (jsonOut) console.log(JSON.stringify({ command, ok: false, error: message }));
  else console.error(`✗ ${command}: ${message}`);
  return exit;
}

function opt(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
}

/**
 * EVERY occurrence of a repeatable option, in order.
 *
 * Issue #116's compounding half: `--runs` took only the first glob and silently dropped the
 * rest, so auditing two corpora as one population REQUIRED copying trees into one directory —
 * the very `cp -R` that restamped mtimes and moved three published rates. Making the option
 * repeatable removes the reason to copy.
 */
function opts(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== name) continue;
    const v = args[i + 1];
    if (v && !v.startsWith("--")) out.push(v);
  }
  return out;
}

/** Run directories matching any of `patterns`, de-duplicated, sorted. */
function runDirs(patterns) {
  const seen = new Set();
  for (const p of patterns) {
    for (const d of globSync(p, { cwd: root, absolute: true, onlyDirectories: true })) {
      if (existsSync(join(d, "_telemetry.json"))) seen.add(d);
    }
  }
  return [...seen].sort();
}

function printStartWindow() {
  // ADR-0019's Definition of Done is a BEFORE/AFTER on this number, so it has to come out of one
  // committed implementation. The `before` half (median 24 turns / 14 calls / $1.31 / 11.8%) was
  // produced by a script nobody kept — see lib/start-window.mjs for why that is a defect and not
  // just an inconvenience.
  const patterns = opts("--runs");
  if (!patterns.length) patterns.push("docs/plans/*");
  const dirs = runDirs(patterns);
  if (!dirs.length) {
    return fail("start-window", `no run directories with _telemetry.json matched ${patterns.map((p) => `'${p}'`).join(" or ")}`);
  }
  const configDir = opt("--config-dir");
  const projectsRoot = configDir ? resolve(root, configDir, "projects") : undefined;

  // One registry load for the whole corpus — measureRun would otherwise re-read and re-normalise
  // models.json per run directory.
  let registry;
  try { registry = loadRegistry(); } catch (e) { return fail("start-window", e.message); }
  const rows = dirs.map((d) => measureRun(d, { projectsRoot, registry }));
  const agg = aggregateWindows(rows);
  if (jsonOut) console.log(JSON.stringify({ command: "start-window", ...agg, runs: rows }));
  else console.log(renderWindows(agg, rows));

  // An instrument, not a gate — same rule as compliance. It reports; it never fails a build.
  return 0;
}

function printCompliance() {
  // Live contracts sit next to the prose they describe; retired ones sit in the
  // archive, so a run from before a step was replaced is still audited against the
  // procedure that was actually in force.
  const skillDir = resolve(root, "plugins/sdlc/skills/pipeline-orchestrator");
  const { contracts, errors } = parseContracts([
    join(skillDir, "SKILL.md"),
    join(skillDir, "contracts-retired.md"),
  ]);
  for (const e of errors) console.error(`✗ contract: ${e}`);
  if (!contracts.length) {
    return fail("compliance", "no sdlc-contract blocks found — nothing to audit");
  }

  const patterns = opts("--runs");
  if (!patterns.length) patterns.push("docs/plans/*");
  const dirs = runDirs(patterns);
  if (!dirs.length) {
    return fail("compliance", `no run directories with _telemetry.json matched ${patterns.map((p) => `'${p}'`).join(" or ")}`);
  }

  // Defaults to the resolved Claude config dir inside auditRun; overridable so the
  // fixtures — and any archived transcript tree — can be audited without touching it.
  const configDir = opt("--config-dir");
  const projectsRoot = configDir ? resolve(root, configDir, "projects") : undefined;

  const results = dirs.map((d) => auditRun(d, contracts, { projectsRoot }));
  const agg = aggregate(results, contracts);
  if (jsonOut) {
    console.log(JSON.stringify({
      command: "compliance", contracts: agg.contracts,
      auditable: agg.auditable, seal: agg.seal, excluded: agg.excluded, runs: results,
    }));
  } else {
    console.log(renderText(agg, results));
  }

  // An instrument, not a gate: findings must not fail a build until the rate is known.
  return errors.length ? 2 : 0;
}

function runAll() {
  const codes = [
    printSchema(checkSchemas(root)),
    printCycles(checkAllWorkflows(root)),
    printReadDiscipline(checkReadDiscipline(root)),
    printPluginPaths(checkPluginPaths(root)),
    printMachineValues(checkMachineValues(root)),
    printAgentTools(checkAgentTools(root)),
    printDetect2(detectRows()),
    printResumeFixtures(),
  ];
  const exit = Math.max(...codes);
  if (jsonOut) console.log(JSON.stringify({ command: "all", ok: exit === 0, exit }));
  return exit;
}

const VERBS = ["schema", "cycles", "detect", "resume", "report", "rollup", "read-discipline",
  "plugin-paths", "machine-values", "agent-tools", "compliance", "start-window", "all"];

let code = 0;
switch (cmd) {
  case "schema": code = printSchema(checkSchemas(root)); break;
  case "cycles": code = printCycles(checkAllWorkflows(root)); break;
  case "read-discipline": code = printReadDiscipline(checkReadDiscipline(root)); break;
  case "plugin-paths": code = printPluginPaths(checkPluginPaths(root)); break;
  case "machine-values": code = printMachineValues(checkMachineValues(root)); break;
  case "agent-tools": code = printAgentTools(checkAgentTools(root)); break;
  case "detect": code = printDetect(); break;
  case "resume":
    code = args[1] && !args[1].startsWith("--") ? printResumeOne(resolve(root, args[1])) : printResumeFixtures();
    break;
  case "report": {
    const target = args[1] && !args[1].startsWith("--") ? args[1] : null;
    if (!target) { code = fail("report", "usage: sdlc-lint report <slug-or-dir> [--json]"); break; }
    const direct = resolve(root, target);
    const dir = existsSync(join(direct, "_telemetry.json")) ? direct : join(root, "docs", "plans", target);
    try {
      const { htmlPath } = renderReportFile(dir);
      if (jsonOut) console.log(JSON.stringify({ command: "report", ok: true, html_path: htmlPath }));
      else console.log(`report: wrote ${htmlPath}`);
      code = 0;
    } catch (e) {
      if (jsonOut) console.log(JSON.stringify({ command: "report", ok: false, error: e.message }));
      else console.error(`✗ report: ${e.message}`);
      code = 2;
    }
    break;
  }
  case "rollup": {
    const target = args[1] && !args[1].startsWith("--") ? resolve(root, args[1]) : root;
    try {
      const { htmlPath, agg, text, warnings } = rollupWorkspace(target);
      for (const w of warnings) console.error(`⚠ ${w}`);
      if (jsonOut) console.log(JSON.stringify({ command: "rollup", ok: true, html_path: htmlPath, run_count: agg.run_count }));
      else { console.log(text); console.log(`\nwrote ${htmlPath}`); }
      code = 0;
    } catch (e) {
      if (jsonOut) console.log(JSON.stringify({ command: "rollup", ok: false, error: e.message }));
      else console.error(`✗ rollup: ${e.message}`);
      code = 2;
    }
    break;
  }
  case "compliance": code = printCompliance(); break;
  case "start-window": code = printStartWindow(); break;
  case "all": code = runAll(); break;
  case undefined:
  case "--help":
    // Even the help path owes a JSON consumer an envelope — `--json` must never leave stdout
    // unparseable, whatever the exit code (#126).
    if (jsonOut) { console.log(JSON.stringify({ command: "help", ok: true, verbs: VERBS })); break; }
    console.log("Usage: sdlc-lint <schema|cycles|detect|resume|report|rollup|read-discipline|plugin-paths|machine-values|agent-tools|compliance|start-window|all> [--json]");
    console.log("  read-discipline   E2: contract present in the stable prefix; no re-read phrasing in agents");
    console.log("  plugin-paths      #70: no home-anchored ~/.claude paths in shipped plugin text");
    console.log("  machine-values    H3: no prose computing a value a machine already writes");
    console.log("  agent-tools       ADR-0018: every agent declares tools; none may dispatch agents; reviewers hold no Edit");
    console.log("  compliance        H1: did the orchestrator run its own mandated steps? [--runs <glob>]... [--config-dir <path>]");
    console.log("  start-window      ADR-0019 DoD: turns/cost between loading the orchestrator and its first dispatch [--runs <glob>]... [--config-dir <path>]");
    break;
  default:
    code = fail("sdlc-lint", `unknown command: ${cmd}`);
}
process.exit(code);
