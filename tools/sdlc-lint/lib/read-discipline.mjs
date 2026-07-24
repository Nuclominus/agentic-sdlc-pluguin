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
