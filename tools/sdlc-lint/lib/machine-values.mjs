// Dev/CI lint for Track H3 (the machine-value invariant): shipped prose must never
// ask the model to compute a value a machine already writes. Checks the SOURCE TREE
// only — it never runs at pipeline runtime, so (like lib/read-discipline.mjs and
// lib/plugin-paths.mjs, unlike lib/usage.mjs) it has no mirrored copy under
// plugins/sdlc/tools/. The rule itself lives in plugins/sdlc/MACHINE-VALUES.md,
// which is also the registry this reads.

export const CONTRACT_PATH = "plugins/sdlc/MACHINE-VALUES.md";

// A fenced block whose info string is exactly `machine-values` — the same shape as the
// ```sdlc-contract blocks lib/contracts.mjs already pulls out of this same prose.
const BLOCK = /^```machine-values[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/m;

// `<key>: <owner>`. The key charset is deliberately narrow: it is interpolated straight
// into a RegExp by violationRe(), and `[A-Za-z0-9_]+` cannot carry a metacharacter.
const ENTRY = /^([A-Za-z0-9_]+)\s*:\s*(\S.*)$/;

/**
 * Parse the machine-owned key registry out of the contract document.
 * @param {string} text
 * @returns {{ keys: string[], owners: Map<string,string>, errors: string[] }}
 */
export function parseRegistry(text) {
  const m = BLOCK.exec(text);
  if (!m) {
    return { keys: [], owners: new Map(), errors: ["missing ```machine-values registry block"] };
  }
  const errors = [];
  const owners = new Map();
  const body = m[1].split("\n");
  for (let i = 0; i < body.length; i++) {
    const line = body[i].trim();
    if (!line || line.startsWith("#")) continue;
    const e = ENTRY.exec(line);
    if (!e) {
      errors.push(`registry line ${i + 1}: expected '<key>: <owner>', got ${JSON.stringify(line)}`);
      continue;
    }
    const [, key, owner] = e;
    if (owners.has(key)) {
      errors.push(`registry line ${i + 1}: duplicate key '${key}'`);
      continue;
    }
    owners.set(key, owner.trim());
  }
  if (owners.size === 0 && errors.length === 0) {
    errors.push("registry block is empty — a lint with no keys checks nothing");
  }
  // Longest-first: alternation is ordered, so this makes an error name `total_input_tokens`
  // rather than a shorter key that happens to be a suffix of it.
  const keys = [...owners.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return { keys, owners, errors };
}
