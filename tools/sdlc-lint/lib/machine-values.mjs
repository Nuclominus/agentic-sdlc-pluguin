// Dev/CI lint for Track H3 (the machine-value invariant): shipped prose must never
// ask the model to compute a value a machine already writes. Checks the SOURCE TREE
// only — it never runs at pipeline runtime, so (like lib/read-discipline.mjs and
// lib/plugin-paths.mjs, unlike lib/usage.mjs) it has no mirrored copy under
// plugins/sdlc/tools/. The rule itself lives in plugins/sdlc/MACHINE-VALUES.md,
// which is also the registry this reads.

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { globSync } from "tinyglobby";

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

export const OK_MARKER = "<!-- machine-values: ok";

// A bare marker is not a justification: require a stated reason after `ok`. The lookahead
// keeps the closing `-->` from passing as a one-character reason (its leading `-` would
// otherwise satisfy a bare `\S`). Same guard as lib/plugin-paths.mjs.
const OK_MARKER_RE = /<!--\s*machine-values:\s*ok\s*—\s*(?!-->)\S/;

/**
 * A registry key as the SUBJECT of a computation. Anchoring on the left-hand side is what
 * keeps the check silent on the dozens of lines that merely discuss these keys — and what
 * makes `max_total_cost_usd=0.60` and `CONTEXT.running_cost_usd = 0` pass, since neither
 * has a word boundary before the key. `=(?!=)` excludes `==`; `!=`, `>=` and `<=` never
 * reach it, because the character after `\s*` is not `=`.
 * @param {string[]} keys
 * @returns {RegExp} capture group 1 is the matched key
 */
export function violationRe(keys) {
  return new RegExp(
    "\\b(" + keys.join("|") + ")\\b`?\\s*(?:=(?!=)|(?:is )?(?:the )?sum of|computed from|derived from)",
  );
}

/**
 * Scan one shipped-prose file for arithmetic over a machine-owned key.
 * @param {string} text
 * @param {string[]} keys registry keys, longest-first
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function scanText(text, keys) {
  // An empty alternation matches everywhere. A broken registry must fail loudly at its own
  // entry (parseRegistry), never flood every file in the tree with phantom violations.
  if (!keys.length) return { ok: true, errors: [] };
  const re = violationRe(keys);
  const lines = text.split("\n");
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    if (OK_MARKER_RE.test(lines[i])) continue;
    if (i > 0 && OK_MARKER_RE.test(lines[i - 1])) continue;
    const m = lines[i].match(re);
    if (m) {
      errors.push(
        `line ${i + 1}: "${m[1]}" is computed here — a machine already writes it ` +
        `(see ${CONTRACT_PATH}). Pass the path, not the number, or justify with ` +
        `${OK_MARKER} — reason -->`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

export const ORCHESTRATOR_PATH = "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md";
// Text that ships to consumers and is read by an LLM as instruction: skills, agents, rules,
// commands. Excludes node_modules and per-tool test fixtures, matching lib/plugin-paths.mjs.
export const PLUGIN_GLOB = "plugins/**/*.md";
export const IGNORE = ["**/node_modules/**", "plugins/*/tools/*/test/**"];

/**
 * Check 1 — the orchestrator points at the contract, so the invariant has exactly one
 * definition and the file it governs says where to find it.
 * @param {string} text contents of pipeline-orchestrator/SKILL.md
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkContractReference(text) {
  return text.includes("MACHINE-VALUES.md")
    ? { ok: true, errors: [] }
    : { ok: false, errors: [`must reference ${CONTRACT_PATH} — the machine-value invariant`] };
}

/**
 * Checks 1–3 over a repository root.
 * @returns {Array<{file: string, ok: boolean, errors: string[], tool_error?: boolean}>}
 */
export function checkMachineValues(root = process.cwd()) {
  const results = [];

  let keys = [];
  try {
    const { keys: parsed, errors } = parseRegistry(readFileSync(resolve(root, CONTRACT_PATH), "utf8"));
    keys = parsed;
    results.push({ file: CONTRACT_PATH, ok: errors.length === 0, errors });
  } catch (e) {
    // No registry means no key list. Returning here rather than scanning with `keys = []`
    // keeps a missing contract from reading as a clean tree.
    return [{ file: CONTRACT_PATH, ok: false, tool_error: true, errors: [`read: ${e.message}`] }];
  }

  try {
    results.push({
      file: ORCHESTRATOR_PATH,
      ...checkContractReference(readFileSync(resolve(root, ORCHESTRATOR_PATH), "utf8")),
    });
  } catch (e) {
    results.push({ file: ORCHESTRATOR_PATH, ok: false, tool_error: true, errors: [`read: ${e.message}`] });
  }

  for (const abs of globSync(PLUGIN_GLOB, { cwd: root, absolute: true, ignore: IGNORE }).sort()) {
    const file = relative(root, abs).split("\\").join("/");
    // The contract quotes the very formulas it retires, as the audit's evidence. Scanning it
    // would make the document that defines the rule its own first violation.
    if (file === CONTRACT_PATH) continue;
    try {
      results.push({ file, ...scanText(readFileSync(abs, "utf8"), keys) });
    } catch (e) {
      results.push({ file, ok: false, tool_error: true, errors: [`read: ${e.message}`] });
    }
  }
  return results;
}
