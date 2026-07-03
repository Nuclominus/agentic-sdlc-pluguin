#!/usr/bin/env node
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSchemas } from "./lib/schema.mjs";
import { checkAllWorkflows } from "./lib/cycles.mjs";
import { resolveFixture, listFixtures } from "./lib/detect.mjs";
import { resolveWorkspace } from "./lib/resume.mjs";
import { renderReportFile } from "./lib/report.mjs";
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

function runAll() {
  const codes = [
    printSchema(checkSchemas(root)),
    printCycles(checkAllWorkflows(root)),
    printDetect2(detectRows()),
    printResumeFixtures(),
  ];
  const exit = Math.max(...codes);
  if (jsonOut) console.log(JSON.stringify({ command: "all", ok: exit === 0, exit }));
  return exit;
}

let code = 0;
switch (cmd) {
  case "schema": code = printSchema(checkSchemas(root)); break;
  case "cycles": code = printCycles(checkAllWorkflows(root)); break;
  case "detect": code = printDetect(); break;
  case "resume":
    code = args[1] && !args[1].startsWith("--") ? printResumeOne(resolve(root, args[1])) : printResumeFixtures();
    break;
  case "report": {
    const target = args[1] && !args[1].startsWith("--") ? args[1] : null;
    if (!target) { console.error("usage: sdlc-lint report <slug-or-dir> [--json]"); code = 2; break; }
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
  case "all": code = runAll(); break;
  case undefined:
  case "--help":
    console.log("Usage: sdlc-lint <schema|cycles|detect|resume|report|all> [--json]");
    break;
  default:
    console.error(`unknown command: ${cmd}`);
    code = 2;
}
process.exit(code);
