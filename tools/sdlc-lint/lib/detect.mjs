import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "tinyglobby";
import { loadManifests } from "./load.mjs";

export function evalRule(rule, root) {
  if (rule === "*") return true;
  if (rule == null || typeof rule !== "object") return false;
  if ("file_exists" in rule) return existsSync(join(root, rule.file_exists));
  if ("file_glob" in rule) return globSync(rule.file_glob, { cwd: root, dot: true }).length > 0;
  if ("file_contains" in rule) {
    const { path, pattern } = rule.file_contains;
    const re = new RegExp(pattern);
    return globSync(path, { cwd: root, absolute: true, dot: true })
      .some(f => re.test(readFileSync(f, "utf8")));
  }
  if ("any" in rule) return rule.any.some(r => evalRule(r, root));
  if ("all" in rule) return rule.all.every(r => evalRule(r, root));
  return false;
}

function dependencyPresent(root, paths, coordinate) {
  if (!coordinate) return false;
  for (const p of paths) {
    for (const f of globSync(p, { cwd: root, absolute: true, dot: true })) {
      if (readFileSync(f, "utf8").includes(coordinate)) return true;
    }
  }
  return false;
}

export function resolveStack(evalRoot, { foundations, frameworks }) {
  const winner = foundations
    .filter(f => evalRule(f.doc.detect, evalRoot))
    .sort((a, b) => (b.doc.priority ?? 0) - (a.doc.priority ?? 0))[0];
  if (!winner) return { foundation: null, priority: null, additive: [] };
  const hosts = winner.doc.hosts_aspects;
  const paths = winner.doc.framework_detection ?? [];
  const additive = [];
  for (const fw of frameworks) {
    const hosted = hosts === "all" || (Array.isArray(hosts) && hosts.includes(fw.doc.enriches_aspect));
    if (hosted && dependencyPresent(evalRoot, paths, fw.doc.dependency)) additive.push(fw.doc.stack);
  }
  return { foundation: winner.doc.stack, priority: winner.doc.priority ?? 0, additive: additive.sort() };
}

export function listFixtures(fixturesDir) {
  return readdirSync(fixturesDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(fixturesDir, e.name, "expected.json")))
    .map(e => e.name)
    .sort();
}

export function resolveFixture(fixtureDir, repoRoot) {
  const { foundations, frameworks } = loadManifests(repoRoot);
  const actual = resolveStack(fixtureDir, { foundations, frameworks });
  const expected = JSON.parse(readFileSync(join(fixtureDir, "expected.json"), "utf8"));
  const ok = actual.foundation === expected.foundation
    && actual.priority === expected.priority
    && JSON.stringify(actual.additive) === JSON.stringify(expected.additive);
  return { actual, expected, ok };
}
