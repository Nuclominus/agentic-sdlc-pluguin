#!/usr/bin/env node
// ADR-0036 — the maintainer's side of a skill set: keep the matrix in step with its upstream catalog.
//
// The matrix (plugins/<plugin>/skill-sets/<set>.yaml) is triaged by hand; the catalog it describes
// moves on its own. This script is the mechanical half of re-syncing the two, so a person only has
// to do the part that needs judgement — deciding which role a new skill belongs to.
//
//   diff     what moved upstream since the matrix was synced: added, removed and relocated skills,
//            skills whose `last-updated` changed, and the catalog version. Read-only.
//   refresh  write the mechanical part back IN PLACE, preserving comments and layout (yaml Document
//            API): `source.catalog_version` / `synced_at`, every `upstream_path` / `upstream_updated`.
//            A new skill is appended with `unassigned: "TRIAGE — …"`, which `sdlc-lint skill-sets`
//            rejects — so the sync cannot merge until someone has decided who gets it. A skill gone
//            upstream is reported, never deleted: removing a row changes what roles are told, and
//            that is a decision, not bookkeeping.
//   render   regenerate the generated views (the `<set>.md` table and the README block) — the same
//            as `node tools/sdlc-lint/cli.mjs skill-sets --write`.
//
// The catalog is any directory laid out like `android/skills`: `.claude-plugin/marketplace.json`
// listing skill paths (falling back to a walk for SKILL.md), each SKILL.md carrying `description`
// and `metadata.last-updated`, and optionally a `version` file (the Android CLI's clone writes one;
// a git checkout does not — pass `--version` then). Nothing here runs the `android` binary.
//
// Usage: node tools/sdlc-lint/scripts/skill-sets.mjs <diff|refresh|render>
//          [--set <file>] [--catalog <dir>] [--version <v>] [--today YYYY-MM-DD] [--json] [--exit-code]

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { checkSkillSets } from "../lib/skill-sets.mjs";

export const DEFAULT_SET = "plugins/android-foundation/skill-sets/android-skills.yaml";
const SUMMARY_MAX = 120;   // skill-set.schema.json `summary.maxLength`

/** YAML frontmatter of a SKILL.md, or {} — a catalog file we cannot read is not fatal. */
function frontmatter(file) {
  let text;
  try { text = readFileSync(file, "utf8"); } catch { return {}; }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  try { return YAML.parse(m[1]) ?? {}; } catch { return {}; }
}

function walkSkillDirs(root, rel = "", depth = 0, out = []) {
  let entries;
  try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (existsSync(join(root, r, "SKILL.md"))) out.push(r);
    else if (depth < 4) walkSkillDirs(root, r, depth + 1, out);
  }
  return out;
}

/**
 * Read a catalog directory: `{ version, skills: { id: { upstream_path, updated, description } } }`.
 * Throws only when the directory holds no skills at all — an empty catalog must never be read as
 * "every skill was removed upstream".
 */
export function readCatalog(dir, { version = null } = {}) {
  let paths = null;
  try {
    const mk = JSON.parse(readFileSync(join(dir, ".claude-plugin", "marketplace.json"), "utf8"));
    paths = (mk.plugins ?? []).flatMap((p) => Array.isArray(p.skills) ? p.skills : [])
      .filter((p) => typeof p === "string").map((p) => p.replace(/^\.\//, "").replace(/\/$/, ""));
  } catch { /* no marketplace file: walk instead */ }
  if (!paths || paths.length === 0) paths = walkSkillDirs(dir);
  const skills = {};
  // A skill installs under its directory NAME, so two paths ending in the same name are one id on
  // disk — upstream's problem, but one a keyed map would hide: the second path would silently
  // replace the first, the kept row would read as "moved", and the new skill would never be triaged.
  const seen = new Map();
  for (const p of paths.sort()) {
    const id = basename(p);
    if (seen.has(id)) { seen.get(id).push(p); continue; }
    seen.set(id, [p]);
    const fm = frontmatter(join(dir, p, "SKILL.md"));
    const updated = fm?.metadata?.["last-updated"];
    skills[id] = {
      upstream_path: p,
      updated: updated != null ? String(updated) : null,
      description: typeof fm.description === "string" ? fm.description.replace(/\s+/g, " ").trim() : "",
    };
  }
  if (Object.keys(skills).length === 0) throw new Error(`${dir} holds no skills (no marketplace.json entries, no SKILL.md)`);
  let v = version;
  if (v == null) { try { v = readFileSync(join(dir, "version"), "utf8").trim() || null; } catch { v = null; } }
  const collisions = [...seen].filter(([, ps]) => ps.length > 1).map(([id, ps]) => ({ id, paths: ps }));
  return { version: v, skills, collisions };
}

/** What differs between a parsed matrix and a catalog. Pure. */
export function diffCatalog(doc, catalog) {
  const mine = new Map((doc?.skills ?? []).filter((s) => s && typeof s.id === "string").map((s) => [s.id, s]));
  const added = [], removed = [], moved = [], updated = [];
  for (const [id, c] of Object.entries(catalog.skills)) {
    const s = mine.get(id);
    if (!s) { added.push({ id, upstream_path: c.upstream_path, updated: c.updated, description: c.description }); continue; }
    if (s.upstream_path !== c.upstream_path) moved.push({ id, from: s.upstream_path ?? null, to: c.upstream_path });
    if (c.updated && String(s.upstream_updated ?? "") !== c.updated) updated.push({ id, from: s.upstream_updated ?? null, to: c.updated });
  }
  // Gone upstream. A row that still reaches a role is drift — roles are told to use a skill that can
  // no longer be installed. A row the maintainer already kept as `unassigned` reaches nobody: it is
  // a settled decision, listed for the record and never counted against `in_sync` again.
  const retired = [];
  for (const [id, s] of mine) {
    if (id in catalog.skills) continue;
    const hasRoles = s.roles && typeof s.roles === "object" && Object.keys(s.roles).length > 0;
    (hasRoles ? removed : retired).push(id);
  }
  const collisions = catalog.collisions ?? [];
  const matrix = doc?.source?.catalog_version != null ? String(doc.source.catalog_version) : null;
  return {
    catalog_version: {
      matrix, catalog: catalog.version, changed: Boolean(catalog.version && matrix !== catalog.version),
      // A checkout carries no version file: the version cannot be compared, only content can.
      unknown: catalog.version == null,
    },
    added, removed: removed.sort(), retired: retired.sort(), moved, updated, collisions,
    in_sync: added.length + removed.length + moved.length + updated.length + collisions.length === 0
      && !(catalog.version && matrix !== catalog.version),
  };
}

/** The category whose `upstream` dirs claim a path's top directory; ambiguity is reported, not guessed away. */
export function guessCategory(categories, upstreamPath) {
  const top = String(upstreamPath).split("/")[0];
  const hits = Object.entries(categories ?? {}).filter(([, c]) => Array.isArray(c?.upstream) && c.upstream.includes(top)).map(([id]) => id);
  return { category: hits[0] ?? Object.keys(categories ?? {})[0] ?? null, candidates: hits, top };
}

/** First sentence of an upstream description, cut to the schema's summary limit. */
export function summarize(description) {
  const first = String(description ?? "").split(/(?<=\.)\s/)[0].replace(/\.$/, "").trim() || "(no upstream description)";
  return first.length <= SUMMARY_MAX ? first : `${first.slice(0, SUMMARY_MAX - 1).trimEnd()}…`;
}

const q = (v) => JSON.stringify(String(v));

/** Index range [from, to) of the lines that belong to the `- id: <id>` entry of `skills:`. */
function entryRange(lines, id) {
  const head = new RegExp(`^  - id: ${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(#.*)?$`);
  const from = lines.findIndex((l) => head.test(l));
  if (from < 0) return null;
  let to = from + 1;
  while (to < lines.length && !/^ {2}- /.test(lines[to]) && !/^ {2}#/.test(lines[to]) && !/^\S/.test(lines[to])) to += 1;
  return [from, to];
}

/**
 * Rewrite the matrix text for a catalog. Returns `{ text, diff }`.
 *
 * LINE edits, not a re-serialisation: the file is hand-formatted (flow maps with inner padding,
 * aligned comments), and every YAML emitter normalises some of that — a refresh that restyles 40
 * lines to change four would bury the four. Only the lines this script owns are touched —
 * `source.catalog_version`, `source.synced_at`, each entry's `upstream_path` / `upstream_updated`
 * — and new entries are appended at the end. A no-op refresh returns the input unchanged.
 */
export function applyRefresh(text, catalog, { today }) {
  const plain = YAML.parse(text);
  const diff = diffCatalog(plain, catalog);
  if (diff.in_sync) return { text, diff };
  // Refuse rather than write something half-true. Without a version, `synced_at` would move while
  // `catalog_version` still names the old release — a matrix claiming a sync it cannot identify.
  // With a collision, whichever path won the map would be written as the skill's home.
  if (diff.collisions.length) {
    throw new Error(`upstream ships more than one skill under the same id — ${diff.collisions.map((c) => `${c.id}: ${c.paths.join(", ")}`).join("; ")}. `
      + "They install to one directory, so resolve it upstream (or pin a catalog without the clash) before refreshing.");
  }
  if (!catalog.version) {
    throw new Error("the catalog has no version (no `version` file) — pass --version <v> so catalog_version moves with synced_at");
  }

  const lines = text.split("\n");
  const setSource = (key, value) => {
    const i = lines.findIndex((l) => new RegExp(`^  ${key}:`).test(l));
    if (i >= 0) lines[i] = `  ${key}: ${q(value)}`;
  };
  if (catalog.version) setSource("catalog_version", catalog.version);
  setSource("synced_at", today);

  for (const m of diff.moved) {
    const r = entryRange(lines, m.id);
    const i = r && lines.slice(r[0], r[1]).findIndex((l) => /^ {4}upstream_path:/.test(l));
    if (r && i >= 0) lines[r[0] + i] = `    upstream_path: ${m.to}`;
  }
  for (const u of diff.updated) {
    const r = entryRange(lines, u.id);
    if (!r) continue;
    const block = lines.slice(r[0], r[1]);
    const i = block.findIndex((l) => /^ {4}upstream_updated:/.test(l));
    if (i >= 0) { lines[r[0] + i] = `    upstream_updated: ${q(u.to)}`; continue; }
    const after = block.findIndex((l) => /^ {4}upstream_path:/.test(l));
    lines.splice(r[0] + (after >= 0 ? after + 1 : 1), 0, `    upstream_updated: ${q(u.to)}`);
  }

  if (diff.added.length) {
    const tag = catalog.version ? `new in ${catalog.version}` : `new at sync ${today}`;
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(`  # ---- TRIAGE (sync ${today}) — assign roles within the category guard, or give a real reason ----`);
    for (const a of diff.added) {
      const g = guessCategory(plain.categories, a.upstream_path);
      const note = g.candidates.length === 1 ? `category from upstream '${g.top}'`
        : g.candidates.length > 1 ? `upstream '${g.top}' fits ${g.candidates.join(" | ")} — pick one`
        : `no category claims upstream '${g.top}' — add one or extend an upstream list`;
      lines.push(`  - id: ${a.id}`, `    upstream_path: ${a.upstream_path}`);
      if (a.updated) lines.push(`    upstream_updated: ${q(a.updated)}`);
      lines.push(`    category: ${g.category}`, `    summary: ${q(summarize(a.description))}`, `    unassigned: ${q(`TRIAGE — ${tag}; ${note}`)}`);
    }
    lines.push("");
  }
  return { text: lines.join("\n"), diff };
}

function renderDiff(d, setFile) {
  const out = [`${setFile}: catalog ${d.catalog_version.catalog ?? "(unknown version)"} vs matrix ${d.catalog_version.matrix ?? "?"}`];
  if (d.catalog_version.unknown) out.push("  ⚠️ catalog version unknown (no `version` file) — pass --version; refresh refuses without one");
  for (const c of d.collisions) out.push(`  ✗ ${c.id}  shipped at ${c.paths.join(" AND ")} — one install directory; refresh refuses until upstream resolves it`);
  for (const id of d.retired ?? []) out.push(`  · ${id}  gone upstream, kept unassigned — settled, not drift`);
  if (d.in_sync) { out.push("  in sync — nothing to do"); return out.join("\n"); }
  for (const a of d.added) out.push(`  + ${a.id}  (${a.upstream_path})  ${summarize(a.description)}`);
  for (const id of d.removed) out.push(`  - ${id}  gone upstream — decide: drop the row, or keep it unassigned with a reason`);
  for (const m of d.moved) out.push(`  → ${m.id}  ${m.from} → ${m.to}`);
  for (const u of d.updated) out.push(`  ~ ${u.id}  last-updated ${u.from ?? "—"} → ${u.to}  (re-read it: has its scope changed?)`);
  return out.join("\n");
}

function main(argv) {
  const cmd = argv[0];
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null; };
  const root = process.cwd();
  if (cmd === "render") {
    const res = checkSkillSets(root, { write: true });
    for (const r of res) console.log(`${r.ok ? "✓" : "✗"} ${r.file}${r.written?.length ? ` — wrote ${r.written.join(", ")}` : ""}${r.errors.length ? `\n    ${r.errors.join("\n    ")}` : ""}`);
    return res.every((r) => r.ok) ? 0 : 1;
  }
  if (cmd !== "diff" && cmd !== "refresh") {
    console.error("usage: skill-sets.mjs <diff|refresh|render> [--set <file>] [--catalog <dir>] [--version <v>] [--today YYYY-MM-DD] [--json] [--exit-code]");
    return 2;
  }
  const setFile = opt("--set") ?? DEFAULT_SET;
  const catalogDir = resolve(opt("--catalog") ?? join(process.env.HOME ?? "", ".android", "cli", "skills"));
  let catalog;
  try { catalog = readCatalog(catalogDir, { version: opt("--version") }); }
  catch (e) { console.error(`✗ ${e.message}`); return 1; }
  const text = readFileSync(join(root, setFile), "utf8");

  if (cmd === "diff") {
    const d = diffCatalog(YAML.parse(text), catalog);
    console.log(argv.includes("--json") ? JSON.stringify({ set: setFile, catalog: catalogDir, ...d }) : renderDiff(d, setFile));
    return argv.includes("--exit-code") && !d.in_sync ? 1 : 0;
  }
  const today = opt("--today") ?? new Date().toISOString().slice(0, 10);
  let next, diff;
  try { ({ text: next, diff } = applyRefresh(text, catalog, { today })); }
  catch (e) { console.error(`✗ refresh refused: ${e.message}`); return 1; }
  if (next !== text) writeFileSync(join(root, setFile), next);
  console.log(argv.includes("--json") ? JSON.stringify({ set: setFile, written: next !== text, ...diff }) : renderDiff(diff, setFile));
  if (diff.added.length) console.log(`\n${diff.added.length} skill(s) appended as TRIAGE — \`sdlc-lint skill-sets\` fails until each is assigned or given a reason.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
