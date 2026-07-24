// Dev/CI lint for Track E2 (read discipline). Checks the SOURCE TREE only —
// it never runs at pipeline runtime, so unlike lib/usage.mjs it has no
// mirrored copy under plugins/sdlc/tools/.

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
  const end = text.indexOf(PREFIX_END);
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
    if (line.includes(OK_MARKER)) continue;
    if (i > 0 && lines[i - 1].includes(OK_MARKER)) continue;
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
