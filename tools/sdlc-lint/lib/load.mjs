import { readFileSync } from "node:fs";
import { globSync } from "tinyglobby";
import YAML from "yaml";

export function loadManifests(root = process.cwd()) {
  const files = globSync("plugins/**/manifest.yaml", { cwd: root, absolute: true });
  const foundations = [], frameworks = [], errors = [];
  for (const file of files) {
    let raw;
    try { raw = readFileSync(file, "utf8"); }
    catch (e) { errors.push({ file, error: `read: ${e.message}` }); continue; }
    let doc;
    try { doc = YAML.parse(raw); }
    catch (e) { errors.push({ file, error: `parse: ${e.message}` }); continue; }
    if (doc?.kind === "foundation") foundations.push({ file, doc });
    else if (doc?.kind === "framework") frameworks.push({ file, doc });
    else errors.push({ file, error: `unknown or missing kind: ${doc?.kind}` });
  }
  return { foundations, frameworks, errors };
}

export function loadWorkflows(root = process.cwd()) {
  const files = globSync("plugins/**/workflows/*.yaml", { cwd: root, absolute: true })
    .filter(f => !f.includes("/test-fixtures/"));
  const workflows = [], errors = [];
  for (const file of files) {
    let raw;
    try { raw = readFileSync(file, "utf8"); }
    catch (e) { errors.push({ file, error: `read: ${e.message}` }); continue; }
    try { workflows.push({ file, doc: YAML.parse(raw) }); }
    catch (e) { errors.push({ file, error: `parse: ${e.message}` }); }
  }
  return { workflows, errors };
}
