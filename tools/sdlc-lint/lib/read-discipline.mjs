// Dev/CI lint for Track E2 (read discipline). Checks the SOURCE TREE only —
// it never runs at pipeline runtime, so unlike lib/usage.mjs it has no
// mirrored copy under plugins/sdlc/tools/.

import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { globSync } from "tinyglobby";

export const ANCHOR = "Read discipline:";
export const PREFIX_START = "=== STABLE PREFIX ===";
export const PREFIX_END = "=== PER-CALL CONTEXT ===";

/**
 * Check 1 — the read-discipline contract exists and sits in the cache-stable
 * prefix of the orchestrator prompt template.
 * @param {string} text contents of pipeline-orchestrator/SKILL.md
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkAnchor(text) {
  const errors = [];
  const start = text.indexOf(PREFIX_START);
  // Anchored to `start`: the real SKILL.md mentions PREFIX_END in prose (line 928)
  // three lines ABOVE the actual template delimiter, so a bare indexOf would give
  // end < start and report a malformed template forever. Search for the first
  // PREFIX_END that follows PREFIX_START.
  const end = text.indexOf(PREFIX_END, start);
  if (start === -1 || end === -1 || end < start) {
    errors.push(`missing or malformed prompt-template delimiter ('${PREFIX_START}' … '${PREFIX_END}')`);
    return { ok: false, errors };
  }
  const at = text.indexOf(ANCHOR);
  if (at === -1) {
    errors.push(`missing '${ANCHOR}' contract — the E2 read-discipline paragraph must be present`);
  } else if (at < start || at > end) {
    errors.push(`'${ANCHOR}' must sit between '${PREFIX_START}' and '${PREFIX_END}' — outside it loses prompt-cache stability`);
  }
  return { ok: errors.length === 0, errors };
}

// Narrow on purpose. Verified against the live tree: these match exactly the
// five known lines and nothing else. `\b` after `read` keeps the plural
// ("no re-reads", as the AAR analyst legitimately says) out. The second
// pattern requires file/files so "read the full stack trace" stays legal.
export const PATTERNS = [
  /\bre-?read\b/i,
  /\bread (the )?(entire|whole|full) files?\b/i,
  /\bread all\b/i,
];

export const OK_MARKER = "<!-- read-discipline: ok";

// A bare marker is not a justification: require a stated reason after `ok`.
// The lookahead keeps the closing `-->` from being mistaken for a one-character
// reason (its leading `-` would otherwise satisfy a bare `\S`).
const OK_MARKER_RE = /<!--\s*read-discipline:\s*ok\s*—\s*(?!-->)\S/;

/**
 * Check 2 — no agent contract instructs a re-read or a whole-file read,
 * unless the line (or the line above it) carries an explicit, reasoned
 * escape-hatch marker.
 * @param {string} text contents of one plugins/<p>/agents/<a>.md
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function scanAgentText(text) {
  const lines = text.split("\n");
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (OK_MARKER_RE.test(line)) continue;
    if (i > 0 && OK_MARKER_RE.test(lines[i - 1])) continue;
    for (const p of PATTERNS) {
      const m = line.match(p);
      if (m) {
        errors.push(`line ${i + 1}: "${m[0]}" — matches ${p}. Reword, or justify with ${OK_MARKER} — reason -->`);
        break; // one error per line keeps output readable
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export const SKILL_PATH = "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md";
export const AGENT_GLOB = "plugins/*/agents/**/*.md";

/**
 * Check 1 + Check 2 over a repository root.
 * @returns {Array<{file: string, ok: boolean, errors: string[], tool_error?: boolean}>}
 */
export function checkReadDiscipline(root = process.cwd()) {
  const results = [];

  const skillAbs = resolve(root, SKILL_PATH);
  try {
    results.push({ file: SKILL_PATH, ...checkAnchor(readFileSync(skillAbs, "utf8")) });
  } catch (e) {
    results.push({ file: SKILL_PATH, ok: false, tool_error: true, errors: [`read: ${e.message}`] });
  }

  for (const abs of globSync(AGENT_GLOB, { cwd: root, absolute: true }).sort()) {
    const file = relative(root, abs);
    try {
      results.push({ file, ...scanAgentText(readFileSync(abs, "utf8")) });
    } catch (e) {
      results.push({ file, ok: false, tool_error: true, errors: [`read: ${e.message}`] });
    }
  }
  return results;
}
