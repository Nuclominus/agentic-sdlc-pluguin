#!/usr/bin/env node
// gen-mermaid.mjs — regenerate the module dependency diagram from typed edges.
//
// Reads `depends_on:` wikilinks from every .obsidian-vault/modules/*.md note and
// rewrites a layer-colored `graph LR` between the markers in
// .obsidian-vault/architecture/dependency-graph.md:
//
//   <!-- BEGIN GENERATED MERMAID -->
//   <!-- END GENERATED MERMAID -->
//
// Hand-maintained diagrams drift from the data they claim to depict — this is the
// only writer of that block. Idempotent: re-running with no edge changes is a no-op.
// Non-blocking, no npm deps. Run from the repo root: `node .claude/scripts/gen-mermaid.mjs`.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const VAULT = process.env.VAULT_DIR || '.obsidian-vault';
const MODULES_DIR = join(VAULT, 'modules');
const GRAPH_NOTE = join(VAULT, 'architecture', 'dependency-graph.md');
const BEGIN = '<!-- BEGIN GENERATED MERMAID -->';
const END = '<!-- END GENERATED MERMAID -->';

// Layer → node fill color. Keep in sync with .obsidian/graph.json colorGroups.
const LAYER_COLOR = {
  ui: '#e3f2fd',
  domain: '#e8f5e9',
  data: '#fff3e0',
  unknown: '#eeeeee',
};

// --- tiny frontmatter reader (no YAML dep; tolerant of our authored subset) ---
function frontmatter(src) {
  if (!src.startsWith('---')) return {};
  const end = src.indexOf('\n---', 3);
  if (end === -1) return {};
  return src.slice(3, end);
}
function wikilinks(block, key) {
  // capture the value after `key:` up to the next top-level key or block end
  const re = new RegExp(`(^|\\n)${key}:([\\s\\S]*?)(?=\\n[a-zA-Z_]+:|$)`);
  const m = re.exec(block);
  if (!m) return [];
  return [...m[2].matchAll(/\[\[([^\]]+)\]\]/g)].map((x) => x[1].trim());
}
function layerOf(block) {
  const m = /tags:\s*\[([^\]]*)\]/.exec(block);
  if (m) {
    const l = /layer\/([a-z0-9-]+)/.exec(m[1]);
    if (l) return l[1];
  }
  return 'unknown';
}
// `modules/auth` | `modules/auth.md` | `auth` → `auth`
const nodeId = (link) => link.replace(/^modules\//, '').replace(/\.md$/, '').trim();
const safe = (id) => id.replace(/[^A-Za-z0-9_]/g, '_');

function build() {
  if (!existsSync(MODULES_DIR)) return 'graph LR\n  empty["no modules yet"]';
  const files = readdirSync(MODULES_DIR).filter((f) => f.endsWith('.md'));
  const nodes = new Map(); // id -> layer
  const edges = []; // [fromId, toId]
  for (const f of files) {
    const id = nodeId(f);
    const block = frontmatter(readFileSync(join(MODULES_DIR, f), 'utf8'));
    nodes.set(id, layerOf(block));
    for (const link of wikilinks(block, 'depends_on')) {
      if (!link.startsWith('modules/')) continue; // only module→module edges
      edges.push([id, nodeId(link)]);
    }
  }
  // ensure edge targets exist as nodes even if their note is missing
  for (const [, to] of edges) if (!nodes.has(to)) nodes.set(to, 'unknown');

  const lines = ['graph LR'];
  for (const [id, layer] of [...nodes].sort()) {
    lines.push(`  ${safe(id)}["${id}"]:::${layer}`);
  }
  for (const [from, to] of edges.sort()) {
    lines.push(`  ${safe(from)} --> ${safe(to)}`);
  }
  for (const [layer, color] of Object.entries(LAYER_COLOR)) {
    lines.push(`  classDef ${layer} fill:${color},stroke:#90a4ae,color:#263238;`);
  }
  return lines.join('\n');
}

function main() {
  if (!existsSync(GRAPH_NOTE)) {
    console.error(`gen-mermaid: ${GRAPH_NOTE} not found — nothing to do.`);
    process.exit(0);
  }
  const src = readFileSync(GRAPH_NOTE, 'utf8');
  const b = src.indexOf(BEGIN);
  const e = src.indexOf(END);
  if (b === -1 || e === -1 || e < b) {
    console.error(`gen-mermaid: BEGIN/END markers missing in ${GRAPH_NOTE}.`);
    process.exit(1);
  }
  const block = '```mermaid\n' + build() + '\n```';
  const next = src.slice(0, b + BEGIN.length) + '\n' + block + '\n' + src.slice(e);
  if (next === src) {
    console.log('gen-mermaid: diagram already up to date.');
    return;
  }
  writeFileSync(GRAPH_NOTE, next);
  console.log(`gen-mermaid: regenerated diagram in ${GRAPH_NOTE}.`);
}

main();
