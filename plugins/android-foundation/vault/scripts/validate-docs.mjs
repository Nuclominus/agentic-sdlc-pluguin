#!/usr/bin/env node
// validate-docs.mjs — lint the vault's typed edges. REPORTS ONLY — never edits a note.
//
// Checks:
//   1. Resolution     — every typed-edge wikilink is path-qualified and resolves to a note.
//   2. Drift          — `depends_on:` frontmatter vs the mirror prose section (lint, don't generate).
//   3. Layer rules     — architecture constraints encoded as data, with cross-cutting escape hatches.
//   4. Cycles          — the module `depends_on` graph must be acyclic.
//
// Exit 0 = clean, 1 = findings (use in CI / DocsWriter Definition of Done). A layer
// violation is SURFACED, not silenced — never rewrite an edge green to make this pass.
// Non-blocking, no npm deps. Run from the repo root: `node .claude/scripts/validate-docs.mjs`.

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VAULT = process.env.VAULT_DIR || '.obsidian-vault';

// Breadcrumb dropped when the gate runs with no vault present — makes the absence
// discoverable (and self-documents the usual cause + fix) instead of a silent pass.
const VAULT_PENDING_NOTE = (vault) =>
  `# Vault pending\n\n` +
  `\`${vault}\` was not found when the documentation gate ran, so vault docs were ` +
  `**not** validated for this change.\n\n` +
  `Most common cause: the vault is untracked in git, so a \`git worktree\` used for ` +
  `pipeline isolation never received it. Fix by committing/tracking \`${vault}\` (or its ` +
  `submodule) and re-running \`/manage-vault\`. Delete this file once the vault is in place.\n`;

// ─── Architecture rules as data (tip 7) ─────────────────────────────────────
// Layer rank: a module may depend DOWNWARD or SAME layer. Depending upward is an
// inversion; skipping a layer (ui → data) is a skip-layer violation.
const LAYER_RANK = { ui: 0, domain: 1, data: 2 };
const SKIP_LAYER_THRESHOLD = 2; // rank gap that counts as "skipped a layer"
// Cross-cutting modules are allowed as a dependency target from any layer.
const CROSS_CUTTING = new Set(['di', 'util']);
// Notes with `exclude_from_validation: true` (dev-only overlays) are skipped entirely.

const EDGE_KEYS = ['depends_on', 'screens', 'flows', 'adrs', 'related', 'supersedes', 'superseded_by'];
// Which prose heading mirrors `depends_on:` per note type (tip 3 — lint the mirror).
const DEPENDS_PROSE_HEADING = { module: 'Dependencies', screen: 'Dependencies', flow: 'Modules involved' };

const findings = [];
const add = (kind, note, msg) => findings.push({ kind, note, msg });

// ─── tiny frontmatter / prose readers (no YAML dep) ──────────────────────────
function split(src) {
  if (!src.startsWith('---')) return { fm: '', body: src };
  const end = src.indexOf('\n---', 3);
  if (end === -1) return { fm: '', body: src };
  return { fm: src.slice(3, end), body: src.slice(end + 4) };
}
function scalar(fm, key) {
  const m = new RegExp(`(^|\\n)${key}:\\s*(.*)`).exec(fm);
  return m ? m[2].trim().replace(/^["']|["']$/g, '') : undefined;
}
function rawList(fm, key) {
  // value spanning until the next top-level key — supports inline [a, b] and block lists
  const re = new RegExp(`(^|\\n)${key}:([\\s\\S]*?)(?=\\n[a-zA-Z_]+:|$)`);
  const m = re.exec(fm);
  return m ? m[2] : '';
}
function items(fm, key) {
  // return raw list items (strings) for a frontmatter edge field
  const raw = rawList(fm, key).replace(/^\s*\[|\]\s*$/g, '');
  return raw
    .split(/,|\n/)
    .map((s) => s.replace(/^[\s\-]+|[\s]+$/g, '').replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}
const linksIn = (text) => [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim());
function layerOf(fm) {
  const m = /tags:\s*\[([^\]]*)\]/.exec(fm);
  const l = m && /layer\/([a-z0-9-]+)/.exec(m[1]);
  return l ? l[1] : 'unknown';
}
function proseSection(body, heading) {
  const re = new RegExp(`(^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  const m = re.exec(body);
  return m ? m[2] : '';
}
const targetExists = (t) => existsSync(join(VAULT, `${t.replace(/\.md$/, '')}.md`));
const moduleId = (link) => link.replace(/^modules\//, '').replace(/\.md$/, '').trim();

// ─── collect all notes ───────────────────────────────────────────────────────
function allNotes() {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('_') || ent.name.startsWith('.')) continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.md')) out.push(p);
    }
  };
  walk(VAULT);
  return out;
}

function main() {
  if (!existsSync(VAULT)) {
    // The vault is an OPTIONAL module — but its absence is NOT a silent pass. Make
    // it loud (an untracked vault that a git worktree never inherited is the classic
    // trap that ships phases with zero docs) and leave a discoverable breadcrumb,
    // yet stay non-fatal (exit 0) so a project that deliberately runs without a
    // vault is never blocked.
    console.error(`validate-docs: ⚠ ${VAULT} not found — docs were NOT validated (vault absent).`);
    console.error(`validate-docs:   If this project uses a vault, this working tree likely did not inherit it`);
    console.error(`validate-docs:   (an untracked .obsidian-vault is not checked out into git worktrees).`);
    console.error(`validate-docs:   Run /manage-vault to (re)scaffold, and track/commit the vault so worktrees get it.`);
    try {
      writeFileSync('_vault-pending.md', VAULT_PENDING_NOTE(VAULT));
      console.error(`validate-docs:   wrote _vault-pending.md breadcrumb.`);
    } catch { /* breadcrumb is best-effort; the stderr warning is the primary signal */ }
    process.exit(0);
  }
  const moduleLayer = new Map(); // id -> layer
  const moduleEdges = new Map(); // id -> [targetId]

  for (const path of allNotes()) {
    const rel = path.slice(VAULT.length + 1).replace(/\\/g, '/');
    const src = readFileSync(path, 'utf8');
    const { fm, body } = split(src);
    if (scalar(fm, 'exclude_from_validation') === 'true') continue;
    const type = scalar(fm, 'type');

    // 1. Resolution + path-qualification
    for (const key of EDGE_KEYS) {
      for (const it of items(fm, key)) {
        const link = (linksIn(it)[0] || '').trim();
        if (!link) {
          add('bare-slug', rel, `${key}: "${it}" is not a path-qualified wikilink (use "[[folder/name]]")`);
          continue;
        }
        if (!link.includes('/')) {
          add('bare-slug', rel, `${key}: [[${link}]] is a bare slug — qualify it (e.g. [[modules/${link}]])`);
          continue;
        }
        if (!targetExists(link)) add('unresolved', rel, `${key}: [[${link}]] does not resolve to a note`);
      }
    }

    // 2. Drift — depends_on frontmatter vs mirror prose
    const heading = type && DEPENDS_PROSE_HEADING[type];
    if (heading) {
      const fmSet = new Set(items(fm, 'depends_on').flatMap(linksIn));
      const proseSet = new Set(linksIn(proseSection(body, heading)).filter((l) => l.startsWith('modules/')));
      for (const l of fmSet) if (!proseSet.has(l)) add('drift', rel, `[[${l}]] in depends_on: but missing from ## ${heading}`);
      for (const l of proseSet) if (!fmSet.has(l)) add('drift', rel, `[[${l}]] in ## ${heading} but missing from depends_on:`);
    }

    // collect module graph
    if (type === 'module') {
      const id = moduleId(rel.replace(/^modules\//, ''));
      moduleLayer.set(id, layerOf(fm));
      moduleEdges.set(
        id,
        items(fm, 'depends_on').flatMap(linksIn).filter((l) => l.startsWith('modules/')).map(moduleId),
      );
    }
  }

  // 3. Layer rules (modules only)
  for (const [from, targets] of moduleEdges) {
    const fr = LAYER_RANK[moduleLayer.get(from)];
    for (const to of targets) {
      if (CROSS_CUTTING.has(to)) continue;
      const tr = LAYER_RANK[moduleLayer.get(to)];
      if (fr === undefined || tr === undefined) continue; // unknown layer — can't classify
      if (tr < fr) add('layer', `modules/${from}.md`, `inversion: ${from} (${inv(fr)}) → ${to} (${inv(tr)}) depends upward`);
      else if (tr - fr >= SKIP_LAYER_THRESHOLD) add('layer', `modules/${from}.md`, `skip-layer: ${from} (${inv(fr)}) → ${to} (${inv(tr)})`);
    }
  }

  // 4. Cycle detection (DFS)
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...moduleEdges.keys()].map((k) => [k, WHITE]));
  const stack = [];
  const dfs = (n) => {
    color.set(n, GRAY); stack.push(n);
    for (const m of moduleEdges.get(n) || []) {
      if (!moduleEdges.has(m)) continue;
      if (color.get(m) === GRAY) add('cycle', `modules/${n}.md`, `cycle: ${[...stack.slice(stack.indexOf(m)), m].join(' → ')}`);
      else if (color.get(m) === WHITE) dfs(m);
    }
    stack.pop(); color.set(n, BLACK);
  };
  for (const n of moduleEdges.keys()) if (color.get(n) === WHITE) dfs(n);

  report();
}

const inv = (rank) => Object.keys(LAYER_RANK).find((k) => LAYER_RANK[k] === rank);

function report() {
  if (findings.length === 0) {
    console.log('validate-docs: OK — typed edges resolve, no drift, layers respected, no cycles.');
    process.exit(0);
  }
  const order = ['bare-slug', 'unresolved', 'drift', 'layer', 'cycle'];
  const label = {
    'bare-slug': 'Path-qualification', unresolved: 'Unresolved edges', drift: 'Prose ↔ frontmatter drift',
    layer: 'Layer violations (escalate — do NOT rewrite to pass)', cycle: 'Dependency cycles',
  };
  for (const kind of order) {
    const group = findings.filter((f) => f.kind === kind);
    if (!group.length) continue;
    console.error(`\n■ ${label[kind]} (${group.length})`);
    for (const f of group) console.error(`  ${f.note}: ${f.msg}`);
  }
  console.error(`\nvalidate-docs: ${findings.length} finding(s).`);
  process.exit(1);
}

main();
