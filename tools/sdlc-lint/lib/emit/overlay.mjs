// Anchored section replacement for Track J.
//
// The orchestrator is ~1900 lines, of which only the dispatch and telemetry steps
// differ per host. Rather than fork the file three ways — three things to keep in
// step, and >90% of edits touching all three — a host replaces named SECTIONS of
// the one SSOT and inherits the rest.
//
// Why replace rather than substitute names: step 3c is not the same call spelled
// differently on each host. Claude Code returns the subagent's result inline;
// Antigravity has no retrieval call at all (a finished subagent pushes its message
// into the parent's context — measured, conversation 9a5ccef4); Codex needs
// spawn_agent followed by an explicit wait_agent, and a mandatory
// `fork_turns: "none"` without which per-agent model overrides are rejected.
// Those are three different protocols. A rename table would produce text that
// looks right and does not work.
//
// The failure this module refuses to have: an overlay that silently stops
// applying because someone renamed a heading. That is the
// scripts/expertise-coverage.mjs failure — a paragraph that fails to land raises
// no error, it just stops existing. A missing anchor is therefore an emit error,
// never a passthrough.
//
// Source-tree only — never runs at pipeline runtime (like lib/plugin-paths.mjs).

import { readFileSync, existsSync } from "node:fs";
import { join, posix } from "node:path";
import { globSync } from "tinyglobby";

/**
 * A step heading in the orchestrator: `**3c. Spawn the agent** …` at the start of
 * a line. Every step id begins with a digit, which is what bounds a section.
 */
const nextStepRe = /^\*\*\d/;

/**
 * Locate one anchored section: from its own heading line up to the next step
 * heading (exclusive), or end of file.
 *
 * @param {string} text    the document
 * @param {string} anchor  step id, e.g. "3c" or "3c-crash"
 * @returns {{ start: number, end: number }|null}  line indices, end exclusive
 */
export function sectionRange(text, anchor) {
  const lines = text.split("\n");
  const headRe = new RegExp(`^\\*\\*${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`);

  const start = lines.findIndex((l) => headRe.test(l));
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (nextStepRe.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

/** Overlay files a host declares for one skill, as anchor -> absolute path. */
export function overlaysFor(root, pluginName, hostId, skillName) {
  const dir = join(root, "plugins", pluginName, "hosts", hostId, "overlays", skillName);
  if (!existsSync(dir)) return new Map();
  return new Map(
    globSync("*.md", { cwd: dir })
      .sort()
      .map((f) => [posix.basename(f, ".md"), join(dir, f)]),
  );
}

/**
 * Replace every declared section. Applied back-to-front so earlier ranges stay
 * valid while later ones are spliced.
 *
 * @param {string} text
 * @param {Map<string, string>} overlays  anchor -> file path
 * @returns {{ ok: boolean, text: string|null, applied: string[], errors: string[] }}
 */
export function applyOverlays(text, overlays) {
  const errors = [];
  const ranges = [];

  for (const [anchor, file] of overlays) {
    const range = sectionRange(text, anchor);
    if (!range) {
      errors.push(
        `overlay anchor \`${anchor}\` matches nothing in the SSOT — the section was renamed or removed. ` +
        `Fix the overlay or delete it; emitting without it would ship the Claude Code text on another host.`,
      );
      continue;
    }
    ranges.push({ anchor, file, ...range });
  }
  if (errors.length) return { ok: false, text: null, applied: [], errors };

  ranges.sort((a, b) => b.start - a.start);
  const lines = text.split("\n");
  for (const r of ranges) {
    const body = readFileSync(r.file, "utf8").replace(/\n+$/, "").split("\n");
    lines.splice(r.start, r.end - r.start, ...body, "");
  }
  return { ok: true, text: lines.join("\n"), applied: ranges.map((r) => r.anchor).sort(), errors: [] };
}
