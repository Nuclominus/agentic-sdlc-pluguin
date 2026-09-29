// ADR-0036 — the doctor's view of a `kind: skill-catalog` dependency.
//
// The preflight answers one question per run, cheaply: which assigned skills can a role not use
// right now? That is enough to downgrade a row. It is not enough to FIX anything, and the doctor
// is where a person asks "why, and what do I run?". This module answers that from the same inputs,
// read-only, and adds what only a diagnosis needs:
//
//   - the catalog version installed vs. the version the matrix was triaged against (drift);
//   - which ROLES lose what when a skill is missing (a missing mandatory row is the one to fix);
//   - skills the catalog ships that the matrix has never triaged (`unknown_to_matrix`) and ids
//     the matrix still names that the catalog no longer ships (`removed_upstream`);
//   - installed copies that differ from the catalog copy (`stale`) — `android skills add` copies,
//     so an installed skill does not follow a catalog update until `android skills update` runs;
//   - the same bare id installed in more than one root (`duplicate_roots`) — bare generic names
//     (`styles`, `adaptive`) are exactly the ones another plugin may also ship;
//   - the host tools each skill needs, with versions when the caller asks for a probe.
//
// Generic on purpose: nothing here knows the word `android`. Everything catalog-specific arrives
// from the declaring plugin's runtime-dependencies.json entry and its skill-set file.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readSkillSet, assignedSkills } from "./skillsets.mjs";
import { expandHome, whichTool } from "./deps.mjs";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Every directory holding a SKILL.md under `root`, as `{ id: relPath }`. Dot dirs are metadata. */
export function catalogSkills(root, maxDepth = 4) {
  const out = {};
  const walk = (dir, rel, depth) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (existsSync(join(dir, e.name, "SKILL.md"))) out[e.name] ??= r;
      else if (depth < maxDepth) walk(join(dir, e.name), r, depth + 1);
    }
  };
  if (root) walk(root, "", 1);
  return out;
}

/**
 * A content hash of one skill directory: every file, by relative path, sorted. SKILL.md alone would
 * miss the `references/` a skill loads on demand — the part most likely to change upstream.
 */
export function skillDirHash(dir) {
  const files = [];
  const walk = (d, rel) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), r);
      else if (e.isFile()) files.push(r);
    }
  };
  walk(dir, "");
  if (files.length === 0) return null;
  const h = createHash("sha256");
  for (const f of files.sort()) {
    h.update(f).update("\0");
    try { h.update(readFileSync(join(dir, f))); } catch { h.update("<unreadable>"); }
    h.update("\0");
  }
  return h.digest("hex");
}

function readVersionFile(file, env) {
  if (typeof file !== "string") return null;
  try { return readFileSync(expandHome(file, env), "utf8").trim() || null; } catch { return null; }
}

/** `<tool> --version`, first non-empty line; null when it cannot be run. Only with `--probe`. */
export function probeVersion(path) {
  try {
    const r = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 15000 });
    if (r.error || r.status !== 0) return null;
    return `${r.stdout ?? ""}\n${r.stderr ?? ""}`.split("\n").map((l) => l.trim()).find(Boolean) ?? null;
  } catch { return null; }
}

/**
 * The per-catalog report.
 *
 * `dependencies` / `status` / `installedVersions` / `skillRoots` are the preflight's own output
 * (the doctor reuses the pipeline's code path, never a parallel one); `roleExpertise` is the
 * merged profile, whose set-owned rows carry `requires: <dependency>`.
 */
export function catalogReport({
  dependencies = [], status = {}, installedVersions = {}, skillRoots = [], roleExpertise = {},
  env = process.env, which = (t) => whichTool(t, env), probe = false, version = probeVersion,
} = {}) {
  const out = [];
  for (const dep of dependencies) {
    if (dep?.kind !== "skill-catalog") continue;
    const doc = dep.skill_set_file ? readSkillSet(dep.skill_set_file) : null;
    const skills = (doc?.skills ?? []).filter((s) => isObj(s) && typeof s.id === "string");
    const assigned = doc ? assignedSkills(doc) : [];
    const used = dep.skills_used ?? [];
    const s = status[dep.name] ?? { status: "available", missing_skills: [] };

    // Which roles lose what. Only set-owned rows count: a hand-written row naming the same id
    // belongs to its plugin, and lint rejects that duplicate anyway.
    const rolesFor = (id) => Object.entries(roleExpertise ?? {})
      .flatMap(([role, exp]) => (exp?.skills ?? [])
        .filter((r) => r.requires === dep.name && r.skill === id)
        .map((r) => ({ role, policy: r.policy ?? "recommended" })))
      .sort((a, b) => a.role.localeCompare(b.role));

    const catalogDir = expandHome(dep.catalog_dir ?? null, env);
    const upstream = catalogDir && existsSync(catalogDir) ? catalogSkills(catalogDir) : null;
    const known = new Set(skills.map((x) => x.id));

    // Every root that holds a copy of each set skill — the input to both `stale` and duplicates.
    const copies = {};
    for (const x of skills) {
      for (const root of skillRoots) {
        const dir = join(root.root, x.id);
        if (existsSync(join(dir, "SKILL.md"))) (copies[x.id] ??= []).push({ dir, kind: root.kind, key: root.key ?? null });
      }
    }
    const stale = [];
    if (upstream) {
      for (const x of skills) {
        const src = upstream[x.id] ? join(catalogDir, upstream[x.id]) : null;
        if (!src || !copies[x.id]) continue;
        const want = skillDirHash(src);
        for (const c of copies[x.id]) {
          if (want && skillDirHash(c.dir) !== want) stale.push({ skill: x.id, installed_at: c.dir, catalog_at: src });
        }
      }
    }

    const toolUsers = {};
    for (const [skill, tools] of Object.entries(dep.skill_tools ?? {})) {
      for (const t of tools) (toolUsers[t] ??= []).push(skill);
    }
    const tools = Object.entries(toolUsers).sort(([a], [b]) => a.localeCompare(b)).map(([name, requiredBy]) => {
      const path = which(name) || null;
      return { name, path, ...(probe ? { version: path ? version(path) : null } : {}), required_by: requiredBy.sort() };
    });

    // The catalog's OWN version file when it declares one: a plugin-route install reports the
    // plugin's version, which is not the number the matrix was triaged against.
    const installed = readVersionFile(dep.version_file, env) ?? installedVersions[dep.name] ?? null;
    const matrix = doc?.source?.catalog_version != null ? String(doc.source.catalog_version) : null;
    const missing = s.missing_skills ?? [];
    const unavailable = s.unavailable_skills ?? missing;
    const drift = Boolean(installed && matrix && installed !== matrix);

    out.push({
      name: dep.name,
      policy: dep.policy ?? "warn",
      status: s.status === "available" ? "available" : "degraded",
      skill_set: doc?.set ?? null,
      version: { installed, matrix, drift },
      catalog_dir: catalogDir,
      catalog_present: upstream !== null,
      tools,
      assigned: assigned.length,
      applicable: used.length,
      gated_off: assigned.filter((id) => !used.includes(id)),
      assigned_missing: missing.map((skill) => ({ skill, roles: rolesFor(skill) })),
      tool_blocked: unavailable.filter((id) => !missing.includes(id))
        .map((skill) => ({ skill, tools: (dep.skill_tools?.[skill] ?? []).filter((t) => !which(t)), roles: rolesFor(skill) })),
      unknown_to_matrix: upstream ? Object.keys(upstream).filter((id) => !known.has(id)).sort() : [],
      removed_upstream: upstream ? [...known].filter((id) => !(id in upstream)).sort() : [],
      stale,
      duplicate_roots: Object.entries(copies).filter(([, c]) => c.length > 1)
        .map(([skill, c]) => ({ skill, roots: c.map((x) => x.dir) })),
      remediation: {
        install: missing.length ? (dep.install_command ?? []) : [],
        update: drift || stale.length ? (dep.update_command ?? []) : [],
        alt_install: missing.length ? (dep.alt_install_command ?? []) : [],
        rematrix: upstream && (Object.keys(upstream).some((id) => !known.has(id)) || [...known].some((id) => !(id in upstream)))
          ? "The catalog and the matrix disagree on which skills exist — the plugin's maintainers re-triage the skill set; nothing to run locally."
          : null,
      },
    });
  }
  return out;
}

/** Human rendering for `cli.mjs deps` without `--json` — the doctor's "Skill catalogs" section. */
export function renderCatalogReport(reports) {
  if (reports.length === 0) return "Skill catalogs: none declared by the installed plugins.";
  const lines = ["Skill catalogs:"];
  for (const r of reports) {
    const mark = r.status === "available" ? "✅ available" : "⚠️ degraded";
    lines.push(`  ${r.name} ${r.version.installed ?? "not installed"} [policy=${r.policy}] — ${mark}`);
    lines.push(`    matrix: ${r.skill_set ?? "?"} triaged against ${r.version.matrix ?? "?"}${r.version.drift ? " (⚠️ catalog has moved — re-triage owed)" : ""}`);
    lines.push(`    skills: ${r.applicable} needed in this project of ${r.assigned} assigned${r.gated_off.length ? ` (gated off here: ${r.gated_off.join(", ")})` : ""}`);
    for (const t of r.tools) {
      lines.push(`    tool ${t.name}: ${t.path ? `${t.version ?? t.path}` : "❌ not on PATH"} — needed by ${t.required_by.join(", ")}`);
    }
    for (const m of r.assigned_missing) {
      const roles = m.roles.map((x) => `${x.role}${x.policy === "mandatory" ? " (MANDATORY)" : ""}`).join(", ");
      lines.push(`    ❌ missing ${m.skill}${roles ? ` — ${roles}` : ""}`);
    }
    for (const b of r.tool_blocked) lines.push(`    ⚠️ ${b.skill} installed, but needs ${b.tools.join(", ")}`);
    for (const x of r.stale) lines.push(`    ⚠️ stale: ${x.skill} at ${x.installed_at} differs from the catalog copy`);
    for (const d of r.duplicate_roots) lines.push(`    ⚠️ ${d.skill} installed in ${d.roots.length} places: ${d.roots.join(", ")}`);
    if (r.unknown_to_matrix.length) lines.push(`    ℹ️ not yet triaged (no role receives them): ${r.unknown_to_matrix.join(", ")}`);
    if (r.removed_upstream.length) lines.push(`    ℹ️ in the matrix but no longer in the catalog: ${r.removed_upstream.join(", ")}`);
    const cmds = [...r.remediation.install, ...r.remediation.update.filter((c) => !r.remediation.install.includes(c))];
    if (cmds.length) {
      lines.push("    fix:");
      for (const c of cmds) lines.push(`      ${c}`);
      if (r.remediation.alt_install.length) lines.push(`      (or: ${r.remediation.alt_install.join(" && ")})`);
    }
  }
  return lines.join("\n");
}
