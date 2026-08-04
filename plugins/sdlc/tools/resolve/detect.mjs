// Stack detection and framework attachment — the CANONICAL implementation, SHIPPED
// inside the sdlc plugin so the consumer resolving a run gets the same code CI tests.
//
// Ported verbatim in semantics from tools/sdlc-lint/lib/detect.mjs, which now re-exports
// this module (the template is lib/resume.mjs -> tools/run/reentry.mjs). Two things
// changed and nothing else:
//
//   1. `tinyglobby` is gone — see ./fsglob.mjs for why the plugin cannot have dependencies.
//   2. An unreadable file is skipped rather than thrown on. Detection runs against whatever
//      the consumer's checkout contains; one EACCES must not abort a pipeline. The lint
//      never hit this because it only ever ran over fixtures.
//
// This module holds NO YAML knowledge and reads no manifests. It consumes already-parsed
// `{ file, doc }` records, which is what keeps it dependency-free — parsing is the caller's
// problem, and a deliberately separate one.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { anyFile, iterFiles } from "./fsglob.mjs";

function readOrNull(file) {
  try { return readFileSync(file, "utf8"); } catch { return null; }
}

/**
 * Evaluate one `detect:` rule against a project root.
 *
 * Grammar (closed, and deliberately not an expression language):
 *   "*"                             always true
 *   { file_exists: <path> }
 *   { file_glob: <glob> }
 *   { file_contains: { path, pattern } }
 *   { any: [ …rules ] }             OR
 *   { all: [ …rules ] }             AND
 * Anything else is false, never an error — a manifest with a typo must fail to detect
 * rather than abort every run in the marketplace.
 */
export function evalRule(rule, root) {
  if (rule === "*") return true;
  if (rule == null || typeof rule !== "object") return false;
  if ("file_exists" in rule) return existsSync(join(root, rule.file_exists));
  if ("file_glob" in rule) return anyFile(root, rule.file_glob);
  if ("file_contains" in rule) {
    const { path, pattern } = rule.file_contains;
    let re;
    try { re = new RegExp(pattern); } catch { return false; }
    for (const f of iterFiles(root, path)) {
      const text = readOrNull(f);
      if (text !== null && re.test(text)) return true;
    }
    return false;
  }
  if ("any" in rule) return Array.isArray(rule.any) && rule.any.some((r) => evalRule(r, root));
  if ("all" in rule) return Array.isArray(rule.all) && rule.all.every((r) => evalRule(r, root));
  return false;
}

/**
 * Is `coordinate` present anywhere the foundation says to look?
 *
 * The foundation owns the WHERE (`framework_detection`), the framework owns the WHAT
 * (`dependency`). Order matters and is the manifest's: the version catalog is authoritative,
 * module build files are the fallback. Substring, not parse — a coordinate is a coordinate
 * whether it appears in a catalog alias or an inline dependency line.
 */
function dependencyPresent(root, paths, coordinate) {
  if (!coordinate) return false;
  for (const p of paths) {
    for (const f of iterFiles(root, p)) {
      const text = readOrNull(f);
      if (text !== null && text.includes(coordinate)) return true;
    }
  }
  return false;
}

/**
 * The winning foundation for a project, plus the frameworks that attach to it.
 *
 * Highest `priority` among foundations whose `detect` matches. A framework attaches when
 * the winner hosts its `enriches_aspect` AND its coordinate is found. `additive` is sorted
 * so the result is stable across filesystem ordering — telemetry compares against it.
 */
export function resolveStack(evalRoot, { foundations, frameworks }) {
  const winner = (foundations || [])
    .filter((f) => evalRule(f.doc.detect, evalRoot))
    .sort((a, b) => (b.doc.priority ?? 0) - (a.doc.priority ?? 0))[0];
  if (!winner) return { foundation: null, priority: null, additive: [] };

  const hosts = winner.doc.hosts_aspects;
  const paths = winner.doc.framework_detection ?? [];
  const additive = [];
  for (const fw of frameworks || []) {
    const hosted = hosts === "all" || (Array.isArray(hosts) && hosts.includes(fw.doc.enriches_aspect));
    if (hosted && dependencyPresent(evalRoot, paths, fw.doc.dependency)) additive.push(fw.doc.stack);
  }
  return { foundation: winner.doc.stack, priority: winner.doc.priority ?? 0, additive: additive.sort() };
}
