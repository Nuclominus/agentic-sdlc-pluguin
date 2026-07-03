#!/usr/bin/env node
import { checkSchemas } from "./lib/schema.mjs";
import { checkAllWorkflows } from "./lib/cycles.mjs";

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

let code = 0;
switch (cmd) {
  case "schema": code = printSchema(checkSchemas(root)); break;
  case "cycles": code = printCycles(checkAllWorkflows(root)); break;
  case undefined:
  case "--help":
    console.log("Usage: sdlc-lint <schema|cycles|detect|all> [--json]");
    break;
  default:
    console.error(`unknown command: ${cmd}`);
    code = 2;
}
process.exit(code);
