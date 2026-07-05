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

export function checkVault(vault) {
  const problems = [];
  if (!existsSync(vault)) return [`vault does not exist: ${vault}`];

  for (const r of REQUIRED) if (!existsSync(join(vault, r))) problems.push(`missing required: ${r}`);

  const notes = walkMd(vault);
  const rels = notes.map((p) => p.slice(vault.length + 1).replace(/\\/g, "/"));
  const noteSet = new Set(rels);

  for (const abs of notes) {
    const rel = abs.slice(vault.length + 1).replace(/\\/g, "/");
    const md = readFileSync(abs, "utf8");
    const base = rel.split("/").pop();

    if (rel.startsWith("changes/") && !base.startsWith("_")) {
      if (!/^---\n[\s\S]*?\bpr:\s*\d+[\s\S]*?\n---/.test(md)) {
        problems.push(`${rel}: missing/invalid frontmatter (pr)`);
      }
    }

    for (const m of md.matchAll(/\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g)) {
      const target = m[1].trim();
      if (!target) continue;
      const candidate = target.endsWith(".md") ? target : `${target}.md`;
      if (!noteSet.has(candidate)) problems.push(`${rel}: broken link [[${target}]]`);
    }
  }
  return problems;
}
