#!/usr/bin/env node
// ADR-0021 PR-2/PR-3 gate — proves the Android expertise survived the move out of the agent bodies.
//
// The extraction deletes eleven agent files. Everything they said that is NOT process — the MASVS
// audit sections, the Turbine patterns, the Maestro flows, the vault Definition of Done — has to
// land somewhere a core agent can still reach: a foundation skill, a rules file, or the manifest's
// `role_expertise`. Nothing checks that automatically, because a deleted paragraph raises no error.
//
// So the track note (.brain/planning/i1-agents-in-core.md) carries one row per `##` section of each
// agent, naming a destination and an anchor phrase, and this script asserts three things:
//
//   table     the table parses and holds no unfilled placeholder;
//   anchors   every row's destination file exists and literally contains the row's anchor;
//   sections  the rows and the agents' `##` headings are in bijection — no section without a row
//             (expertise that would vanish), no row without a section (a claim about nothing).
//
// `sections` runs only while the agent files are still on disk. PR-3 deletes them; from then on
// `table` + `anchors` keep guarding the destinations, which is all that remains to guard.
//
// Usage: node tools/sdlc-lint/scripts/expertise-coverage.mjs [--json] [root]

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export const TRACK_NOTE = ".brain/planning/i1-agents-in-core.md";
export const AGENTS_DIR = "plugins/android-foundation/agents";

/** A destination cell meaning "deliberately not carried over"; its anchor cell holds the reason. */
const DROPPED = new Set(["—", "-", "(dropped)", "dropped"]);

const cell = (s) => s.trim();
/** Anchors are written as `` `phrase` `` so the table stays readable; the backticks are not matched. */
const anchorText = (s) => cell(s).replace(/^`|`$/g, "");

/**
 * Parse the coverage table out of the track note.
 * The table is the first markdown table under a heading containing "Expertise-coverage table".
 * @returns {{rows: Array<{agent,section,destination,anchor,line}>, errors: string[]}}
 */
function parseTable(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^#{2,}\s.*Expertise-coverage table/i.test(l));
  if (start < 0) return { rows: [], errors: ["no '## Expertise-coverage table' heading — nothing to check against"] };

  const rows = [];
  const errors = [];
  let seenTable = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^#{2,}\s/.test(line)) break;                       // next section ends the table
    if (!line.trim().startsWith("|")) { if (seenTable) break; continue; }
    seenTable = true;
    const cells = line.split("|").slice(1, -1);
    if (cells.length !== 4) { errors.push(`${TRACK_NOTE}:${i + 1} has ${cells.length} columns, expected 4 (Agent | Section | Destination | Anchor)`); continue; }
    const [agent, section, destination, anchor] = cells.map(cell);
    if (/^:?-+:?$/.test(agent.replace(/\s/g, "")) || /^Agent$/i.test(agent)) continue;   // header / separator
    if (/^_?\(PR-\d\)_?$/.test(agent) || (agent && !section && !destination)) {
      errors.push(`${TRACK_NOTE}:${i + 1} is still a placeholder row (${agent || "empty"}) — the coverage table was never filled in`);
      continue;
    }
    rows.push({ agent, section, destination, anchor, line: i + 1 });
  }
  if (!seenTable) errors.push(`${TRACK_NOTE} has the heading but no table under it`);
  else if (rows.length === 0 && errors.length === 0) errors.push(`${TRACK_NOTE} coverage table has no data rows`);
  return { rows, errors };
}

/**
 * `##`-level section titles of a markdown file, in order.
 * Fenced blocks are skipped: several agents document a *report template* whose body is itself
 * made of `##` headings (android-ba § "6. Deliverable Format"), and those are sample text, not
 * sections of the agent.
 */
function sectionsOf(text) {
  const out = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (!fenced && /^##\s+\S/.test(line)) out.push(line.replace(/^##\s+/, "").trim());
  }
  return out;
}

/**
 * @param {string} root repo root
 * @returns {Array<{check: string, file: string, ok: boolean, errors: string[]}>}
 */
export function checkCoverage(root = process.cwd()) {
  const results = [];
  const push = (check, file, errors) => results.push({ check, file, ok: errors.length === 0, errors });

  const noteFile = join(root, TRACK_NOTE);
  if (!existsSync(noteFile)) {
    push("table", TRACK_NOTE, [`${TRACK_NOTE} does not exist — the coverage table is the only record of where each agent section went`]);
    return results;
  }
  const { rows, errors: tableErrors } = parseTable(readFileSync(noteFile, "utf8"));
  push("table", TRACK_NOTE, tableErrors);

  // ---- anchors: the destination exists and literally carries the phrase
  const anchorErrors = [];
  const cache = new Map();
  for (const row of rows) {
    if (DROPPED.has(row.destination)) {
      if (!row.anchor) anchorErrors.push(`${TRACK_NOTE}:${row.line} drops '${row.agent} § ${row.section}' but gives no reason — a drop is a decision, write it down`);
      continue;
    }
    const dest = join(root, row.destination);
    if (!cache.has(row.destination)) cache.set(row.destination, existsSync(dest) ? readFileSync(dest, "utf8") : null);
    const text = cache.get(row.destination);
    if (text === null) { anchorErrors.push(`${TRACK_NOTE}:${row.line} (${row.agent} § ${row.section}) points at ${row.destination}, which does not exist`); continue; }
    const anchor = anchorText(row.anchor);
    if (!anchor) { anchorErrors.push(`${TRACK_NOTE}:${row.line} (${row.agent} § ${row.section}) has no anchor phrase — nothing to verify`); continue; }
    if (!text.includes(anchor)) anchorErrors.push(`${TRACK_NOTE}:${row.line} (${row.agent} § ${row.section}) anchor "${anchor}" not found in ${row.destination}`);
  }
  push("anchors", TRACK_NOTE, anchorErrors);

  // ---- sections: rows and agent `##` headings are in bijection (while the agents are on disk)
  const agentsDir = join(root, AGENTS_DIR);
  if (!existsSync(agentsDir)) {
    push("sections", AGENTS_DIR, []);   // PR-3 deleted them; anchors alone guard the destinations now
    return results;
  }
  const agents = new Map();
  for (const f of readdirSync(agentsDir).filter((f) => f.endsWith(".md")).sort()) {
    agents.set(basename(f, ".md"), sectionsOf(readFileSync(join(agentsDir, f), "utf8")));
  }
  const sectionErrors = [];
  const covered = new Map([...agents.keys()].map((a) => [a, new Set()]));
  for (const row of rows) {
    const sections = agents.get(row.agent);
    if (!sections) { sectionErrors.push(`${TRACK_NOTE}:${row.line} names '${row.agent}', but ${AGENTS_DIR}/ has no such agent`); continue; }
    if (!sections.includes(row.section)) { sectionErrors.push(`${TRACK_NOTE}:${row.line} claims section '${row.section}', but ${AGENTS_DIR}/${row.agent}.md has no such section`); continue; }
    covered.get(row.agent).add(row.section);
  }
  for (const [agent, sections] of agents) {
    for (const section of sections) {
      if (!covered.get(agent).has(section)) {
        sectionErrors.push(`${AGENTS_DIR}/${agent}.md § '${section}' has no row in the coverage table — deleting the agent would delete this expertise unrecorded`);
      }
    }
  }
  push("sections", AGENTS_DIR, sectionErrors);
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const root = args.find((a) => !a.startsWith("--")) ?? process.cwd();
  const results = checkCoverage(root);
  const ok = results.every((r) => r.ok);
  if (json) {
    console.log(JSON.stringify({ command: "expertise-coverage", ok, results }, null, 2));
  } else {
    for (const r of results) for (const e of r.errors) console.error(`✗ ${r.check}: ${e}`);
    console.log(ok ? "expertise-coverage: ok" : `expertise-coverage: ${results.reduce((n, r) => n + r.errors.length, 0)} problem(s)`);
  }
  process.exit(ok ? 0 : 1);
}
