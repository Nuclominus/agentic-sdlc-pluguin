// ADR-0028: a marketplace entry means "this repo redistributes this plugin". `marketplace.json`
// used to carry `superpowers` (source: url -> obra/superpowers.git) and `security-guidance`
// (source: git-subdir -> anthropics/claude-plugins-official). Claude Code takes such an entry
// literally and clones the foreign plugin into OUR namespace, registering it as
// `<name>@agentic-sdlc` — a second install of a plugin we never authored, shadowing the user's own
// copy and putting its update path in our hands. Observed live: `superpowers@agentic-sdlc` 6.4.1
// installed and enabled while `security-guidance` existed twice, once under each marketplace.
//
// An optional external dependency belongs in `runtime-dependencies.json` (name + policy +
// skills_used + install_command), where `policy: warn` can express "run anyway" — something a
// marketplace entry (or a native plugin.json dependency) cannot.
//
// So: every entry must be a LOCAL plugin, spelled `./plugins/<name>`, with a directory on disk.
// A structural check, sibling to `checkNestedManifest` in this directory — there is no schema
// question here, only "does this entry name something we own".

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FILE = ".claude-plugin/marketplace.json";

/**
 * @param {string} root repo root
 * @returns {Array<{file: string, ok: boolean, errors: string[]}>} one result per entry, plus one
 *   for the file itself when it cannot be read or parsed
 */
export function checkMarketplaceSurface(root = process.cwd()) {
  const abs = join(root, FILE);
  if (!existsSync(abs)) return [{ file: FILE, ok: false, errors: ["marketplace manifest not found"] }];

  let doc;
  try {
    doc = JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    return [{ file: FILE, ok: false, errors: [`not valid JSON: ${err.message}`] }];
  }
  if (!Array.isArray(doc.plugins)) {
    return [{ file: FILE, ok: false, errors: ["`plugins` is missing or not an array"] }];
  }

  return doc.plugins.map((entry, i) => {
    const name = entry?.name ?? `(unnamed #${i})`;
    const where = `${FILE} plugins[${i}] (${name})`;
    const errors = [];
    const source = entry?.source;

    if (typeof source !== "string") {
      const kind = source && typeof source === "object" ? (source.source ?? "object") : typeof source;
      errors.push(
        `source is ${kind}, not a local path — a marketplace entry means this repo redistributes ` +
        `the plugin. A foreign \`url\`/\`git-subdir\` source clones it into our namespace as ` +
        `${name}@agentic-sdlc and shadows the user's own install. Declare an external dependency ` +
        `in runtime-dependencies.json (policy: warn) and document it instead (ADR-0028).`,
      );
    } else if (source !== `./plugins/${name}`) {
      errors.push(`source is "${source}" — expected "./plugins/${name}" (entry name must match its directory)`);
    } else if (!existsSync(join(root, "plugins", String(name)))) {
      errors.push(`source "${source}" names no directory on disk`);
    }

    return { file: where, ok: errors.length === 0, errors };
  });
}
