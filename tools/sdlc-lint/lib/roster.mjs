// Dev/CI drift guards for ADR-0021 — agents live in the core; foundations carry expertise.
//
// The roster split has four seams, and each one fails SILENTLY at runtime without a check:
//
//   agents     a phase the core manifest binds to an agent that ships no .md is a dispatch of
//              "Agent from sdlc" with the full toolset (ADR-0018's original bug, by a new door);
//   phases     a recipe naming a phase nothing binds is skipped with one line in telemetry;
//   expertise  a `role_expertise` rule path that does not exist becomes a dead `Read` in every
//              dispatch; a mandated superpowers skill nobody declares is exactly the inversion
//              h5-d2 found and fixed by hand ("each plugin declares what its own runtime invokes");
//   slot       a core agent without the bootstrap line never receives its expertise when invoked
//              on demand; an orchestrator without the block never pastes it when orchestrated.
//
// Source-tree only — it never runs at pipeline runtime, so (like lib/agent-tools.mjs) it has
// no mirrored copy under plugins/sdlc/tools/.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { globSync } from "tinyglobby";
import YAML from "yaml";
import { frontmatter } from "./agent-tools.mjs";

export const CORE_MANIFEST = "plugins/sdlc/manifest.yaml";
export const CORE_AGENTS_DIR = "plugins/sdlc/agents";
export const ORCHESTRATOR = "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md";
/** The header `renderRoleExpertiseBlock` emits — the orchestrator must paste a block that carries it. */
export const EXPERTISE_HEADER = "Stack expertise for";

const readYaml = (file) => YAML.parse(readFileSync(file, "utf8"));
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Every agent name an `agents_per_phase` map binds, flat or per-aspect. */
function boundAgents(agentsPerPhase = {}) {
  const out = new Set();
  for (const m of Object.values(agentsPerPhase ?? {})) {
    if (typeof m === "string") out.add(m);
    else if (m && typeof m === "object") for (const a of Object.values(m)) if (typeof a === "string") out.add(a);
  }
  return out;
}

/** Recipe phase names, flat and parallel members alike. */
function recipePhases(doc) {
  return (doc?.phases ?? []).flatMap((p) => {
    if (typeof p === "string") return [p];
    if (Array.isArray(p?.parallel)) return p.parallel.map((m) => (typeof m === "string" ? m : m?.name)).filter(Boolean);
    return p?.name ? [p.name] : [];
  });
}

/**
 * Run every roster invariant over a marketplace checkout.
 * @param {string} root repo root
 * @returns {Array<{check: string, file: string, ok: boolean, errors: string[]}>}
 */
export function checkRoster(root = process.cwd()) {
  const results = [];
  const push = (check, file, errors) => results.push({ check, file, ok: errors.length === 0, errors });

  let core;
  try { core = readYaml(join(root, CORE_MANIFEST)); }
  catch (e) { push("agents", CORE_MANIFEST, [`unreadable core manifest: ${e.message}`]); return results; }

  const manifests = globSync("plugins/*/manifest.yaml", { cwd: root, absolute: true }).sort()
    .map((file) => { try { return { file, doc: readYaml(file) }; } catch (e) { return { file, error: e.message }; } });

  const coreRoles = new Set([
    ...boundAgents(core.agents_per_phase),
    ...(Array.isArray(core.on_demand_agents) ? core.on_demand_agents : []),
  ]);
  const extraPhaseNames = new Set();
  for (const m of manifests) {
    for (const ph of m.doc?.extra_phases ?? []) {
      if (ph?.name) extraPhaseNames.add(ph.name);
      if (typeof ph?.agent === "string") coreRoles.add(ph.agent);
    }
  }

  // ---- agents: every bound role ships plugins/sdlc/agents/<name>.md with a matching name:
  for (const name of [...coreRoles].sort()) {
    const rel = `${CORE_AGENTS_DIR}/${name}.md`;
    const abs = join(root, rel);
    if (!existsSync(abs)) { push("agents", rel, [`the core manifest binds '${name}' but ${rel} does not exist`]); continue; }
    const fm = frontmatter(readFileSync(abs, "utf8"));
    const declared = fm ? (fm.match(/^name:\s*(\S+)\s*$/m) || [])[1] ?? null : null;
    push("agents", rel, declared === name ? [] : [`${rel} declares \`name: ${declared ?? "(none)"}\` — must match its file name '${name}'`]);
  }

  // ---- phases: every recipe phase is a core-bound phase or an extra_phases name
  const phasePalette = new Set([...Object.keys(core.agents_per_phase ?? {}), ...extraPhaseNames]);
  for (const file of globSync("plugins/*/workflows/*.yaml", { cwd: root, absolute: true }).filter((f) => !f.includes("/test-fixtures/")).sort()) {
    const rel = relative(root, file);
    let doc;
    try { doc = readYaml(file); } catch (e) { push("phases", rel, [`unreadable: ${e.message}`]); continue; }
    const errors = [];
    for (const name of recipePhases(doc)) {
      if (!phasePalette.has(name)) errors.push(`${rel} names phase '${name}', which the core manifest does not bind and no extra_phases adds — it would be skipped at runtime`);
    }
    push("phases", rel, errors);
  }

  // ---- expertise: keys are core roles; rule files exist; own skills exist; superpowers skills are declared
  for (const m of manifests) {
    const rel = relative(root, m.file);
    if (m.error) { push("expertise", rel, [`unreadable: ${m.error}`]); continue; }
    const rx = m.doc?.role_expertise;
    if (!rx || typeof rx !== "object") continue;
    const pluginDir = dirname(m.file);
    const plugin = basename(pluginDir);
    let declaredSkills = null;
    const depsFile = join(pluginDir, "runtime-dependencies.json");
    if (existsSync(depsFile)) {
      try {
        declaredSkills = new Set((readJson(depsFile).dependencies ?? [])
          .flatMap((d) => (d.skills_used ?? []).map((s) => `${d.name}:${s}`)));
      } catch { declaredSkills = new Set(); }
    }
    const errors = [];
    for (const [role, decl] of Object.entries(rx)) {
      if (!coreRoles.has(role)) errors.push(`role_expertise key '${role}' is not a core role (${[...coreRoles].sort().join(", ")})`);
      for (const r of decl?.rules ?? []) {
        const path = typeof r === "string" ? r : r?.path;
        if (typeof path !== "string") continue;
        if (!existsSync(join(pluginDir, path))) errors.push(`role_expertise.${role}.rules: ${path} not found under plugins/${plugin}/ — a dead Read in every dispatch`);
      }
      for (const row of decl?.skills ?? []) {
        const id = typeof row === "string" ? row : row?.skill;
        if (typeof id !== "string" || !id.includes(":")) continue;
        const [owner, skill] = id.split(":");
        if (owner === plugin) {
          const skillFile = `plugins/${plugin}/skills/${skill}/SKILL.md`;
          if (!existsSync(join(root, skillFile))) errors.push(`role_expertise.${role}.skills: ${id} — ${skillFile} does not exist`);
        } else if (owner === "superpowers") {
          if (!declaredSkills || !declaredSkills.has(id)) {
            errors.push(`role_expertise.${role}.skills: ${id} is mandated here but not declared in plugins/${plugin}/runtime-dependencies.json skills_used — each plugin declares what its own runtime invokes`);
          }
        }
      }
    }
    push("expertise", rel, errors);
  }

  // ---- slot: every core role agent carries its own bootstrap line; the orchestrator pastes the block
  for (const name of [...coreRoles].sort()) {
    const rel = `${CORE_AGENTS_DIR}/${name}.md`;
    const abs = join(root, rel);
    if (!existsSync(abs)) continue; // reported under `agents`
    const text = readFileSync(abs, "utf8");
    push("slot", rel, text.includes(`expertise --role ${name}`) ? [] : [
      `${rel} has no \`expertise --role ${name}\` bootstrap line — invoked on demand it would never receive its stack expertise (ADR-0021)`,
    ]);
  }
  const orch = join(root, ORCHESTRATOR);
  if (existsSync(orch)) {
    const text = readFileSync(orch, "utf8");
    // The 3b-1 layout block runs from a `=== STABLE PREFIX ===` delimiter to the
    // `=== PER-CALL CONTEXT ===` that follows it. The prose mentions both delimiters elsewhere,
    // so every such span is examined: the header must sit inside at least one of them.
    const OPEN = "=== STABLE PREFIX ===", CLOSE = "=== PER-CALL CONTEXT ===";
    let inPrefix = false;
    for (let at = text.indexOf(OPEN); at >= 0; at = text.indexOf(OPEN, at + OPEN.length)) {
      const end = text.indexOf(CLOSE, at);
      if (end >= 0 && text.slice(at, end).includes(EXPERTISE_HEADER)) { inPrefix = true; break; }
    }
    push("slot", ORCHESTRATOR, inPrefix ? [] : [
      `${ORCHESTRATOR} does not paste the '${EXPERTISE_HEADER} <role>' block inside the stable prefix — orchestrated agents would never receive their expertise (ADR-0021)`,
    ]);
  } else {
    push("slot", ORCHESTRATOR, ["orchestrator skill not found"]);
  }

  return results;
}
