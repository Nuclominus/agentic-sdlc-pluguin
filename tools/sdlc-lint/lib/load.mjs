import { readFileSync } from "node:fs";
import { globSync } from "tinyglobby";
import YAML from "yaml";

// Manifest loading now has ONE implementation, and it ships: the lint re-exports the
// plugin's tree-mode loader rather than keeping a second copy (ADR-0019). This also means
// `sdlc-lint all` exercises the shipped YAML subset parser over every manifest in the repo,
// on top of the differential gate in test/yaml-parity.test.mjs.
//
// Only TREE mode belongs here. The production path — what the consumer actually has
// installed and enabled — is loadInstalledManifests(), and pointing a dev tool at it would
// resolve against the developer's own machine instead of the fixtures.
export { loadManifestsFromTree as loadManifests } from "../../../plugins/sdlc/tools/resolve/manifests.mjs";

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
