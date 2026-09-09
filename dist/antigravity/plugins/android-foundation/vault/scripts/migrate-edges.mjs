#!/usr/bin/env node
// migrate-edges.mjs — migrate vault notes from the legacy flat `links:` array to typed edges.
//
// Backfills `depends_on:` DETERMINISTICALLY from the most trustworthy source — the
// `## Dependencies` (module/screen) or `## Modules involved` (flow) prose wikilinks —
// NOT from the old `links:` array, which was polluted with reverse + sibling links.
// Also drops the stale `links:` field and ensures the typed edge keys exist.
//
//   node .claude/scripts/migrate-edges.mjs --dry-run   # show the diff, write nothing
//   node .claude/scripts/migrate-edges.mjs             # apply in place
//
// Idempotent: re-running on already-migrated notes is a no-op. Assumes single-line
// frontmatter arrays (`key: [ ... ]`), which the templates and `links:` legacy use.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const VAULT = process.env.VAULT_DIR || '.obsidian-vault';
const DRY = process.argv.includes('--dry-run');

const PROSE_HEADING = { module: 'Dependencies', screen: 'Modules involved', flow: 'Modules involved' };
// keep `screen` mirror as Dependencies (screens consume modules under ## Dependencies)
PROSE_HEADING.screen = 'Dependencies';
const TYPED_KEYS = {
  module: ['depends_on', 'screens', 'flows', 'adrs', 'related'],
  screen: ['depends_on', 'flows', 'adrs', 'related'],
  flow: ['depends_on', 'screens', 'adrs', 'related'],
  adr: ['supersedes', 'superseded_by', 'related'],
};

function split(src) {
  if (!src.startsWith('---')) return null;
  const end = src.indexOf('\n---', 3);
  if (end === -1) return null;
  return { fm: src.slice(3, end), body: src.slice(end + 4), endIdx: end };
}
const linksIn = (t) => [...t.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim());
function proseSection(body, heading) {
  const re = new RegExp(`(^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  const m = re.exec(body);
  return m ? m[2] : '';
}
const fmScalar = (fm, k) => {
  const m = new RegExp(`(^|\\n)${k}:\\s*(.*)`).exec(fm);
  return m ? m[2].trim() : undefined;
};
const fmLinks = (fm, k) => {
  const m = new RegExp(`(^|\\n)${k}:\\s*(.*)`).exec(fm);
  return m ? linksIn(m[2]) : [];
};
const arr = (links) => `[${links.map((l) => `"[[${l}]]"`).join(', ')}]`;

function allNotes() {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) out.push(p);
    }
  };
  walk(VAULT);
  return out;
}

let changed = 0, scanned = 0;
for (const path of allNotes()) {
  const rel = path.slice(VAULT.length + 1);
  const src = readFileSync(path, 'utf8');
  const parts = split(src);
  if (!parts) continue;
  const { fm, body } = parts;
  const type = fmScalar(fm, 'type');
  const keys = TYPED_KEYS[type];
  if (!keys) continue;
  scanned++;

  const hasLegacy = /(^|\n)links:/.test(fm);
  const desiredDepends = keys.includes('depends_on')
    ? [...new Set(linksIn(proseSection(body, PROSE_HEADING[type])).filter((l) => l.startsWith('modules/')))]
    : [];
  const currentDepends = keys.includes('depends_on') ? fmLinks(fm, 'depends_on') : [];
  const dependsChanged =
    keys.includes('depends_on') && arr([...currentDepends].sort()) !== arr([...desiredDepends].sort());
  const missingKeys = keys.filter((k) => !new RegExp(`(^|\\n)${k}:`).test(fm));

  if (!hasLegacy && !dependsChanged && missingKeys.length === 0) continue; // already migrated

  // rebuild frontmatter line-by-line
  let lines = fm.split('\n').filter((l) => !/^\s*links:/.test(l));
  // set/insert depends_on
  if (keys.includes('depends_on')) {
    const dl = `depends_on: ${arr(desiredDepends)}`;
    const idx = lines.findIndex((l) => /^depends_on:/.test(l));
    if (idx >= 0) lines[idx] = dl;
    else {
      const after = lines.findIndex((l) => /^tags:/.test(l));
      lines.splice(after >= 0 ? after + 1 : 1, 0, dl);
    }
  }
  // ensure remaining typed keys exist (empty)
  for (const k of keys) {
    if (k === 'depends_on') continue;
    if (!lines.some((l) => new RegExp(`^${k}:`).test(l))) {
      const anchor = lines.findIndex((l) => /^(depends_on|tags):/.test(l));
      lines.splice(anchor >= 0 ? anchor + 1 : 1, 0, `${k}: []`);
    }
  }
  const newFm = lines.join('\n');
  if (newFm === fm) continue;
  changed++;

  if (DRY) {
    console.log(`\n--- ${rel}`);
    if (hasLegacy) console.log('  - drop legacy links:');
    if (dependsChanged) console.log(`  ~ depends_on: ${arr(currentDepends)}  →  ${arr(desiredDepends)}`);
    if (missingKeys.length) console.log(`  + add empty: ${missingKeys.filter((k) => k !== 'depends_on').join(', ')}`);
  } else {
    writeFileSync(path, '---' + newFm + '\n---' + body);
    console.log(`migrated: ${rel}`);
  }
}

console.log(`\nmigrate-edges: ${scanned} typed note(s) scanned, ${changed} ${DRY ? 'would change' : 'changed'}.`);
if (DRY && changed) console.log('Re-run without --dry-run to apply.');
