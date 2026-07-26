// Dev/CI drift guard for issue #70 — shipped plugin text must never resolve a
// path against a literal home directory. `~/.claude/plugins/cache/**` reads the
// operator's real home even when CLAUDE_CONFIG_DIR points elsewhere, which lets
// a plugin from an unrelated config tree win stack detection. The contract the
// plugin text must follow instead lives in plugins/sdlc/PLUGIN-PATHS.md.
//
// Source-tree only — it never runs at pipeline runtime, so (like
// lib/read-discipline.mjs, unlike lib/usage.mjs) it has no mirrored copy under
// plugins/sdlc/tools/.

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { globSync } from "tinyglobby";

/**
 * The ONE legal way to spell a home-relative Claude path: as the default of a
 * `CLAUDE_CONFIG_DIR` expansion, so a custom config dir still wins. Stripped
 * from each line before the violation scan.
 */
export const ALLOWED_RE = /\$\{CLAUDE_CONFIG_DIR:-(?:~|\$HOME|\$\{HOME\})\/\.claude\}/g;

/** A home-anchored `.claude` path in any of its three spellings. */
export const VIOLATION_RE = /(?:~|\$HOME|\$\{HOME\})\/\.claude\b/;

export const OK_MARKER = "<!-- plugin-paths: ok";

// A bare marker is not a justification: require a stated reason after `ok`.
// The lookahead keeps the closing `-->` from passing as a one-character reason.
const OK_MARKER_RE = /<!--\s*plugin-paths:\s*ok\s*—\s*(?!-->)\S/;

/**
 * Scan one shipped plugin file for home-anchored paths.
 * @param {string} text
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function scanPluginText(text) {
  const lines = text.split("\n");
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    if (OK_MARKER_RE.test(lines[i])) continue;
    if (i > 0 && OK_MARKER_RE.test(lines[i - 1])) continue;
    const stripped = lines[i].replace(ALLOWED_RE, "");
    const m = stripped.match(VIOLATION_RE);
    if (m) {
      errors.push(
        `line ${i + 1}: "${m[0]}" — resolve from the running install instead ` +
        `({SDLC_PLUGIN_ROOT} / {PLUGIN_CACHE_ROOT} / {CONFIG_DIR}, see plugins/sdlc/PLUGIN-PATHS.md), ` +
        `write \${CLAUDE_CONFIG_DIR:-~/.claude} in prose, or justify with ${OK_MARKER} — reason -->`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

export const CONTRACT_PATH = "plugins/sdlc/PLUGIN-PATHS.md";
export const ORCHESTRATOR_PATH = "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md";
// Text that ships to consumers. Excludes tools/**/test fixtures and node_modules;
// .brain/ and docs/ are not plugin payload and keep their historical wording.
export const PLUGIN_GLOB = "plugins/**/*.{md,yaml,yml,json,mjs,js,sh}";
export const IGNORE = ["**/node_modules/**", "plugins/*/tools/*/test/**"];

/**
 * Check 1 — the contract doc exists and the orchestrator points at it, so the
 * symbols used across every command/skill have exactly one definition.
 * @param {string} text contents of pipeline-orchestrator/SKILL.md
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkContractReference(text) {
  const errors = [];
  if (!text.includes("PLUGIN-PATHS.md")) {
    errors.push(`must reference ${CONTRACT_PATH} — the plugin-root resolution contract`);
  }
  if (!/CLAUDE_PLUGIN_ROOT/.test(text)) {
    errors.push("must resolve the plugin roots from ${CLAUDE_PLUGIN_ROOT} (Step 0)");
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Check 1 + Check 2 over a repository root.
 * @returns {Array<{file: string, ok: boolean, errors: string[], tool_error?: boolean}>}
 */
export function checkPluginPaths(root = process.cwd()) {
  const results = [];

  try {
    const text = readFileSync(resolve(root, ORCHESTRATOR_PATH), "utf8");
    results.push({ file: ORCHESTRATOR_PATH, ...checkContractReference(text) });
  } catch (e) {
    results.push({ file: ORCHESTRATOR_PATH, ok: false, tool_error: true, errors: [`read: ${e.message}`] });
  }

  try {
    readFileSync(resolve(root, CONTRACT_PATH), "utf8");
  } catch (e) {
    results.push({ file: CONTRACT_PATH, ok: false, tool_error: true, errors: [`read: ${e.message}`] });
  }

  for (const abs of globSync(PLUGIN_GLOB, { cwd: root, absolute: true, ignore: IGNORE }).sort()) {
    const file = relative(root, abs);
    try {
      results.push({ file, ...scanPluginText(readFileSync(abs, "utf8")) });
    } catch (e) {
      results.push({ file, ok: false, tool_error: true, errors: [`read: ${e.message}`] });
    }
  }
  return results;
}
