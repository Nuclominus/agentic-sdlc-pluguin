// Edge case 3 (ADR-0026): after a foundation embeds its frameworks, `plugins/<name>/**` must
// contain NO `manifest.yaml` below its own root. Tree mode (`plugins/**/manifest.yaml`) would
// find a nested one; installed mode (`join(info.installPath, "manifest.yaml")`, root only) never
// would — reproducing the exact tree-vs-installed trap this whole change exists to close
// (`plugins/sdlc/tools/resolve/manifests.mjs:10-13`). A structural check, sibling to
// `checkRoster`/`checkMachineValues` in this directory, not an extension of `schema.mjs`'s AJV
// pass — there is no schema question here, only "does this path exist".

import { globSync } from "tinyglobby";

/**
 * @param {string} root repo root
 * @returns {Array<{file: string, ok: boolean, errors: string[]}>} one result per offending manifest
 */
export function checkNestedManifest(root = process.cwd()) {
  const nested = globSync("plugins/*/**/manifest.yaml", { cwd: root, ignore: ["plugins/*/manifest.yaml"] }).sort();
  return nested.map((file) => ({
    file,
    ok: false,
    errors: [
      `manifest.yaml below a plugin root — tree mode (plugins/**/manifest.yaml) would find it, ` +
      `installed mode (installPath root only) never would. Fold it into the plugin's own root ` +
      `manifest.yaml (ADR-0026 frameworks: array) or move it to the plugin root itself.`,
    ],
  }));
}
