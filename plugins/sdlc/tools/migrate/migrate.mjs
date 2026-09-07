// Config migration — the replacement for a runtime alias table (ADR-0021).
//
// When the agent roster was renamed, the first design kept the old names working everywhere: the
// resolver rewrote them, the tier lookup rewrote them, the model-enforcement hook rewrote them,
// and the orchestrator was told they were equivalent. Review found six defects in that machinery,
// all of the same shape — one copy of the map disagreeing with another about WHICH name a given
// step was keyed on. None of them were possible if the name is never translated.
//
// So the name is never translated. A project's own files are migrated ONCE, visibly, with the
// user's approval, and everything downstream reads a single spelling. This module is the two
// halves of that: find the stale names, and rewrite exactly those tokens.
//
// It edits the USER's files, so precision matters more than convenience:
//   - YAML is rewritten by targeted token replacement on the lines an `agents:` key owns, never by
//     re-serializing a parsed document — that would discard comments, quoting and key order.
//   - JSON is re-serialized (it has no comments to lose), preserving 2-space indent.
//   - A name appearing in prose (a `when:` hint, a comment) is NOT a target.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MIGRATIONS_FILE = "config/agent-migrations.json";
const CONFIG_YAML = ".claude/sdlc.local.yaml";
const CONFIG_JSON = ".claude/model.local.json";

const readJson = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };

/**
 * The merged old→new map from every migration entry, later entries winning.
 * @param {string} sdlcPluginRoot the sdlc plugin's own root (where config/ lives)
 */
export function loadRenames(sdlcPluginRoot) {
  const doc = readJson(join(sdlcPluginRoot, MIGRATIONS_FILE));
  const out = {};
  for (const entry of doc?.migrations ?? []) {
    for (const [from, to] of Object.entries(entry?.renamed ?? {})) {
      if (typeof from === "string" && typeof to === "string" && from && to) out[from] = to;
    }
  }
  return out;
}

/** Is this line the start of a block-sequence `agents:` value? */
const AGENTS_BLOCK = /^(\s*)agents:\s*(#.*)?$/;
/** An inline `agents: [a, b]` value. Captures indent, the inside of the brackets, and any trailing comment. */
const AGENTS_FLOW = /^(\s*agents:\s*\[)([^\]]*)(\].*)$/;
/** A `- item` entry of a block sequence. */
const SEQ_ITEM = /^(\s*-\s*)(["']?)([^"'#\s]+)(\2\s*(?:#.*)?)$/;

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * Walk `sdlc.local.yaml` and yield every agent-name token with its line and column context.
 * The scanner is deliberately shallow: it only needs to know which lines an `agents:` key owns,
 * and it tracks the enclosing `extensions.skills[i]` index for the report.
 */
function* yamlAgentTokens(text) {
  const lines = text.split("\n");
  let inSkills = false, skillsIndent = -1, skillIndex = -1;
  let blockIndent = -1;   // indent of the `agents:` key whose block sequence we are inside, or -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const ind = indentOf(line);

    if (/^\s*skills:\s*$/.test(line)) { inSkills = true; skillsIndent = ind; skillIndex = -1; continue; }
    if (inSkills && ind <= skillsIndent && !/^\s*-/.test(line)) inSkills = false;
    // A `- skill:` item opens the next extensions.skills[i]; the index is only used for the report.
    if (inSkills && /^\s*-\s*skill:/.test(line)) skillIndex += 1;

    if (blockIndent >= 0) {
      const m = SEQ_ITEM.exec(line);
      if (m && ind > blockIndent) { yield { line: i, kind: "seq", match: m, skillIndex }; continue; }
      blockIndent = -1;   // the sequence ended
    }

    const flow = AGENTS_FLOW.exec(line);
    if (flow) { yield { line: i, kind: "flow", match: flow, skillIndex }; continue; }
    if (AGENTS_BLOCK.test(line)) { blockIndent = ind; continue; }
  }
}

const where = (skillIndex) => (skillIndex >= 0 ? `extensions.skills[${skillIndex}].agents` : "agents");

/**
 * Every stale agent name in this project's config, sorted by file then name so a report and a
 * `git diff` read the same way twice.
 * @returns {Array<{file: string, where: string, from: string, to: string, conflict?: boolean}>}
 */
export function scanConfigs(projectRoot, renames) {
  const found = [];
  if (!renames || Object.keys(renames).length === 0) return found;

  const yamlPath = join(projectRoot, CONFIG_YAML);
  if (existsSync(yamlPath)) {
    let text; try { text = readFileSync(yamlPath, "utf8"); } catch { text = null; }
    if (text != null) {
      const seen = new Set();
      for (const tok of yamlAgentTokens(text)) {
        const names = tok.kind === "flow"
          ? tok.match[2].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
          : [tok.match[3]];
        for (const name of names) {
          const to = renames[name];
          if (!to) continue;
          const key = `${where(tok.skillIndex)}::${name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          found.push({ file: CONFIG_YAML, where: where(tok.skillIndex), from: name, to });
        }
      }
    }
  }

  const jsonPath = join(projectRoot, CONFIG_JSON);
  const doc = existsSync(jsonPath) ? readJson(jsonPath) : null;
  if (doc && doc.agents && typeof doc.agents === "object") {
    for (const name of Object.keys(doc.agents)) {
      const to = renames[name];
      if (!to) continue;
      found.push({ file: CONFIG_JSON, where: "agents", from: name, to, conflict: Object.hasOwn(doc.agents, to) });
    }
  }

  return found.sort((a, b) => a.file.localeCompare(b.file) || a.from.localeCompare(b.from));
}

/** Rewrite one YAML line's agent tokens. Returns the line unchanged when nothing applies. */
function rewriteYamlLine(line, kind, match, renames) {
  if (kind === "flow") {
    const inside = match[2].split(",").map((part) => {
      const raw = part.trim();
      if (!raw) return part;
      const bare = raw.replace(/^["']|["']$/g, "");
      const to = renames[bare];
      return to ? part.replace(bare, to) : part;
    }).join(",");
    return `${match[1]}${inside}${match[3]}`;
  }
  const to = renames[match[3]];
  return to ? `${match[1]}${match[2]}${to}${match[4]}` : line;
}

/**
 * Apply the findings to disk. Returns the files actually changed.
 *
 * Idempotent by construction: it rewrites only names still present as rename SOURCES, so a second
 * run over migrated files finds nothing and writes nothing.
 */
export function applyRenames(projectRoot, findings) {
  if (!findings || findings.length === 0) return [];
  const renames = {};
  for (const f of findings) renames[f.from] = f.to;
  const changed = [];

  if (findings.some((f) => f.file === CONFIG_YAML)) {
    const path = join(projectRoot, CONFIG_YAML);
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");
    let touched = false;
    for (const tok of yamlAgentTokens(text)) {
      const next = rewriteYamlLine(lines[tok.line], tok.kind, tok.match, renames);
      if (next !== lines[tok.line]) { lines[tok.line] = next; touched = true; }
    }
    if (touched) { writeFileSync(path, lines.join("\n")); changed.push(CONFIG_YAML); }
  }

  if (findings.some((f) => f.file === CONFIG_JSON)) {
    const path = join(projectRoot, CONFIG_JSON);
    const doc = readJson(path);
    if (doc?.agents && typeof doc.agents === "object") {
      const agents = {};
      for (const [name, tier] of Object.entries(doc.agents)) {
        const to = renames[name];
        if (!to) { agents[name] = tier; continue; }
        // A file carrying BOTH spellings has already been half-migrated by hand; the explicit new
        // key is the user's stated intent, so the stale one is dropped rather than overwriting it.
        if (Object.hasOwn(doc.agents, to)) continue;
        agents[to] = tier;
      }
      doc.agents = agents;
      writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`);
      changed.push(CONFIG_JSON);
    }
  }

  return changed.sort();
}

/** The human report — one line per finding, plus what to do about it. */
export function renderReport(findings, { applied = false } = {}) {
  if (findings.length === 0) return "✅ Agent names: no stale names in this project's config.";
  const lines = [
    applied
      ? `🔧 Agent names migrated (${findings.length}):`
      : `⚠️ Agent names: ${findings.length} stale name(s) in this project's config (ADR-0021 renamed the roster; nothing translates them at runtime):`,
  ];
  for (const f of findings) {
    lines.push(`   ${f.file} ${f.where}: ${f.from} → ${f.to}${f.conflict ? "   (both spellings present — the stale one will be dropped)" : ""}`);
  }
  if (!applied) lines.push("   These entries currently target nothing. Approve the fix to rewrite them in place.");
  return lines.join("\n");
}
