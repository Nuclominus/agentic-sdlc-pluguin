// Dev/CI re-export shim. The canonical, dependency-free implementation is SHIPPED
// with the sdlc plugin at plugins/sdlc/tools/resolve/detect.mjs (so marketplace consumers
// resolving a run execute the same code CI tests). This file keeps the detect test-suite
// pointed at that single source of truth, so it exercises the exact code that ships —
// the same arrangement lib/resume.mjs already has over tools/run/reentry.mjs.
//
// What stays here rather than moving: the fixture helpers. They read manifests, and manifest
// PARSING is YAML, which the shipped side cannot depend on. Loading is the lint's job;
// evaluating an already-parsed manifest is the plugin's.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadManifests } from "./load.mjs";
import { resolveStack } from "../../../plugins/sdlc/tools/resolve/detect.mjs";

export { evalRule, resolveStack } from "../../../plugins/sdlc/tools/resolve/detect.mjs";

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
