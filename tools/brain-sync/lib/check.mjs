import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = [
  "README.md",
  "_moc-root.md",
  "_templates/change-note.md",
  "_templates/adr.md",
  "_templates/plan.md",
  "_templates/component.md",
  "architecture/_moc-architecture.md",
  "changes/_moc-changes.md",
  "decisions/_moc-decisions.md",
  "planning/_moc-planning.md",
  "releases/_moc-releases.md",
];

function walkMd(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".obsidian" || e.name === "_templates") continue; // scaffolding, not content
    const p = join(dir, e.name);
    if (e.isDirectory()) walkMd(p, acc);
    else if (e.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

// A Map of Content, wherever it sits: `_moc-root.md` at the vault root or
// `<pillar>/_moc-<pillar>.md` inside one.
const isMoc = (rel) => /(^|\/)_moc-[^/]*\.md$/.test(rel);

// Content notes are what a reader is meant to find. Everything underscore-prefixed is
// scaffolding (MOCs themselves, templates), and README.md is the maintenance contract
// rather than knowledge.
const isContent = (rel) => rel !== "README.md" && !rel.split("/").pop().startsWith("_");

export function checkVault(vault) {
  const problems = [];
  if (!existsSync(vault)) return [`vault does not exist: ${vault}`];

  for (const r of REQUIRED) if (!existsSync(join(vault, r))) problems.push(`missing required: ${r}`);

  const notes = walkMd(vault);
  const rels = notes.map((p) => p.slice(vault.length + 1).replace(/\\/g, "/"));
  const noteSet = new Set(rels);
  // Everything any MOC points at. Deliberately not "the MOC of the note's own directory":
  // components/ is indexed from `_moc-root.md` while the other pillars each have their own
  // MOC, and both are legitimate. The property worth enforcing is that a reader walking the
  // maps can reach the note at all — an ADR nobody links from an index is invisible to the
  // vault's own navigation, which is exactly how ADR-0014 and ADR-0015 went unlisted while
  // this check still reported "clean".
  const indexed = new Set();

  for (const abs of notes) {
    const rel = abs.slice(vault.length + 1).replace(/\\/g, "/");
    const md = readFileSync(abs, "utf8");
    const base = rel.split("/").pop();

    if (rel.startsWith("changes/") && !base.startsWith("_")) {
      if (!/^---\n[\s\S]*?\bpr:\s*\d+[\s\S]*?\n---/.test(md)) {
        problems.push(`${rel}: missing/invalid frontmatter (pr)`);
      }
    }

    // Links resolve by exact vault-relative path only (`target + ".md"`). This is stricter
    // than Obsidian, which also resolves shortest-form links (`[[roadmap]]`) and links into
    // `_templates/` (excluded from the walk here) — intentional: this vault is machine-
    // generated with full-path links, and strict resolution catches an ambiguous/typo'd link
    // that Obsidian's fuzzy matching would silently paper over. Verdict is "resolves by full
    // path", not "matches what Obsidian renders".
    for (const m of md.matchAll(/\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g)) {
      const target = m[1].trim();
      if (!target) continue;
      const candidate = target.endsWith(".md") ? target : `${target}.md`;
      if (!noteSet.has(candidate)) problems.push(`${rel}: broken link [[${target}]]`);
      if (isMoc(rel)) indexed.add(candidate);
    }
  }

  // Index completeness. A note that resolves every link it makes but that no map links TO
  // is still lost: it ships, it passes every other check, and nobody browsing the vault
  // finds it.
  for (const rel of rels.filter(isContent).sort()) {
    if (!indexed.has(rel)) problems.push(`${rel}: not listed in any _moc-* index`);
  }
  return problems;
}
