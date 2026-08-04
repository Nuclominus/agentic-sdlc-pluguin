// Step 1c — locate, validate and order a workflow recipe, per workflows/RESOLVER.md.
//
// Schema validation without ajv: `schemas/workflow.schema.json` is a repo artifact and the
// plugin ships no dependencies, so the structural rules are implemented directly here — which
// is what RESOLVER.md Step 2 asks for anyway ("verify required fields are present, types
// match, and no unknown properties exist"). Drift between this validator and the schema is
// caught by a differential test that runs both over every shipped recipe and a set of
// deliberately malformed ones, the same arrangement that keeps ./yaml.mjs honest.
//
// Discovery uses installed_plugins.json rather than a cache glob, for the reason spelled out
// in ./manifests.mjs: the cache holds every version ever installed, and a glob would offer
// four copies of the same recipe as four separate plugins colliding on a name.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseYaml } from "./yaml.mjs";

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const SEVERITIES = ["critical", "high", "medium", "low"];
const isPlainObject = (x) => x != null && typeof x === "object" && !Array.isArray(x);
const isInt = (x) => Number.isInteger(x);

function yamlFiles(dir) {
  try { return readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(dir, f)); }
  catch { return []; }
}
function readRecipe(file, origin, key = null) {
  try { return { file, origin, key, name: basename(file).replace(/\.ya?ml$/, ""), doc: parseYaml(readFileSync(file, "utf8")) }; }
  catch (e) { return { file, origin, key, name: basename(file).replace(/\.ya?ml$/, ""), doc: null, error: e.message }; }
}

/**
 * Every recipe this consumer can select — project-local first, then one entry per installed
 * and enabled plugin that ships a `workflows/` directory.
 */
export function discoverRecipes({ projectRoot, installs = new Map(), enabled = {} } = {}) {
  const recipes = [];
  if (projectRoot) {
    for (const f of yamlFiles(join(projectRoot, ".claude", "sdlc-workflows"))) recipes.push(readRecipe(f, "project"));
  }
  for (const [key, info] of installs) {
    if (enabled[key] === false) continue;
    for (const f of yamlFiles(join(info.installPath, "workflows"))) {
      if (f.includes("/test-fixtures/")) continue;
      recipes.push(readRecipe(f, "plugin", key));
    }
  }
  return recipes;
}

/** Structural validation mirroring schemas/workflow.schema.json. Returns a list of violations. */
export function validateWorkflow(doc) {
  const errors = [];
  const bad = (m) => errors.push(m);
  if (!isPlainObject(doc)) return ["workflow must be a mapping"];

  for (const key of Object.keys(doc)) {
    if (!["name", "description", "match", "phases", "caps"].includes(key)) bad(`unknown property '${key}'`);
  }
  if (typeof doc.name !== "string") bad("missing or non-string 'name'");
  else if (!NAME_RE.test(doc.name) || doc.name.length < 2 || doc.name.length > 40) bad(`'name' must be kebab-case, 2–40 chars (got '${doc.name}')`);
  if (doc.description !== undefined && typeof doc.description !== "string") bad("'description' must be a string");

  if (doc.match !== undefined) {
    if (!isPlainObject(doc.match)) bad("'match' must be a mapping");
    else {
      for (const [k, v] of Object.entries(doc.match)) {
        if (k === "arguments_pattern") { if (typeof v !== "string") bad("match.arguments_pattern must be a string"); }
        else if (k === "loc_touched_max" || k === "loc_touched_min") { if (!isInt(v) || v < 0) bad(`match.${k} must be a non-negative integer`); }
        else if (k === "has_migrations" || k === "config_only") { if (typeof v !== "boolean") bad(`match.${k} must be a boolean`); }
        else if (k === "priority") { if (!isInt(v)) bad("match.priority must be an integer"); }
        else bad(`unknown property 'match.${k}'`);
      }
    }
  }

  if (doc.caps !== undefined) {
    if (!isPlainObject(doc.caps)) bad("'caps' must be a mapping");
    else for (const [k, v] of Object.entries(doc.caps)) {
      if (k !== "max_total_cost_usd") bad(`unknown property 'caps.${k}'`);
      else if (typeof v !== "number" || v < 0) bad("caps.max_total_cost_usd must be a number >= 0");
    }
  }

  if (!Array.isArray(doc.phases) || doc.phases.length < 1) { bad("'phases' must be a non-empty array"); return errors; }
  doc.phases.forEach((p, i) => validatePhase(p, i, bad));
  return errors;
}

function validatePhase(p, i, bad) {
  const at = `phases[${i}]`;
  if (typeof p === "string") { if (p.length < 1) bad(`${at} must be a non-empty string`); return; }
  if (!isPlainObject(p)) { bad(`${at} must be a string or a mapping`); return; }

  if ("parallel" in p) {
    for (const k of Object.keys(p)) if (k !== "parallel") bad(`unknown property '${at}.${k}'`);
    if (!Array.isArray(p.parallel) || p.parallel.length < 2) bad(`${at}.parallel must list at least 2 phases`);
    else p.parallel.forEach((m, j) => { if (typeof m !== "string" || !m.length) bad(`${at}.parallel[${j}] must be a non-empty string`); });
    return;
  }

  for (const k of Object.keys(p)) if (!["name", "when", "gate", "loop", "heal"].includes(k)) bad(`unknown property '${at}.${k}'`);
  if (typeof p.name !== "string" || !p.name.length) bad(`${at}.name is required`);
  if (p.when !== undefined && typeof p.when !== "string") bad(`${at}.when must be a string`);

  if (p.gate !== undefined) {
    if (!isPlainObject(p.gate)) bad(`${at}.gate must be a mapping`);
    else {
      for (const k of Object.keys(p.gate)) if (!["after", "min_severity"].includes(k)) bad(`unknown property '${at}.gate.${k}'`);
      if (!Array.isArray(p.gate.after) || p.gate.after.length < 1) bad(`${at}.gate.after must list at least one phase`);
      else p.gate.after.forEach((a, j) => { if (typeof a !== "string" || !a.length) bad(`${at}.gate.after[${j}] must be a non-empty string`); });
      if (!SEVERITIES.includes(p.gate.min_severity)) bad(`${at}.gate.min_severity must be one of ${SEVERITIES.join("|")}`);
    }
  }
  if (p.loop !== undefined) {
    if (!isPlainObject(p.loop)) bad(`${at}.loop must be a mapping`);
    else {
      for (const k of Object.keys(p.loop)) if (!["return_to", "max_rounds"].includes(k)) bad(`unknown property '${at}.loop.${k}'`);
      if (typeof p.loop.return_to !== "string" || !p.loop.return_to.length) bad(`${at}.loop.return_to is required`);
      if (!isInt(p.loop.max_rounds) || p.loop.max_rounds < 1 || p.loop.max_rounds > 10) bad(`${at}.loop.max_rounds must be an integer 1–10`);
    }
  }
  if (p.heal !== undefined) {
    if (!isPlainObject(p.heal)) bad(`${at}.heal must be a mapping`);
    else {
      for (const k of Object.keys(p.heal)) if (k !== "max_attempts") bad(`unknown property '${at}.heal.${k}'`);
      if (!isInt(p.heal.max_attempts) || p.heal.max_attempts < 1 || p.heal.max_attempts > 3) bad(`${at}.heal.max_attempts must be an integer 1–3`);
    }
  }
}

/** Step 2 normalization — shapes are preserved, strings are widened to `{name}`. */
export function normalizePhases(phases) {
  return phases.map((p) => (typeof p === "string" ? { name: p } : p));
}

/** Flat list of executed phase names, expanding parallel groups to their members. */
export function phaseNames(phases) {
  return phases.flatMap((p) => (Array.isArray(p.parallel) ? p.parallel : [p.name]));
}

/**
 * Step 3 — a DAG has no repeats, and a `loop.return_to` is a back-edge rather than one.
 * The target must exist and must PRECEDE the loop phase, or the loop is not a loop.
 */
export function validateAcyclic(phases, workflowName, file) {
  const errors = [];
  const names = phaseNames(phases);
  const seen = new Set();
  for (const n of names) {
    if (seen.has(n)) errors.push(`Workflow '${workflowName}' contains duplicate phase '${n}'. File: ${file}`);
    seen.add(n);
  }
  phases.forEach((p, i) => {
    if (!p.loop?.return_to) return;
    const target = p.loop.return_to;
    const idx = names.indexOf(target);
    const selfIdx = names.indexOf(p.name);
    if (idx === -1 || idx >= selfIdx) {
      errors.push(`Loop phase '${p.name}' has return_to='${target}' which is not an earlier phase in workflow '${workflowName}'. File: ${file}`);
    }
  });
  return errors;
}

/** Which of a recipe's `match` conditions hold. Absent conditions are not constraints. */
export function evaluateMatch(match, signals, args = "") {
  if (!isPlainObject(match)) return null;
  const conditions = Object.keys(match).filter((k) => k !== "priority");
  if (conditions.length === 0) return null;                 // empty block -> never auto-selected

  const satisfied = [];
  for (const key of conditions) {
    const v = match[key];
    switch (key) {
      case "arguments_pattern": {
        let re; try { re = new RegExp(v, "i"); } catch { return { matched: false, satisfied: [] }; }
        if (!re.test(String(args))) return { matched: false, satisfied: [] };
        break;
      }
      case "loc_touched_max": if (!(signals.loc_touched <= v)) return { matched: false, satisfied: [] }; break;
      case "loc_touched_min": if (!(signals.loc_touched >= v)) return { matched: false, satisfied: [] }; break;
      // A `false` here imposes no constraint, per RESOLVER.md.
      case "has_migrations": if (v === true && signals.has_migrations !== true) return { matched: false, satisfied: [] }; break;
      case "config_only": if (v === true && signals.config_only !== true) return { matched: false, satisfied: [] }; break;
      default: return { matched: false, satisfied: [] };
    }
    satisfied.push(key);
  }
  return { matched: true, satisfied };
}

/**
 * Step 1.5 — deterministic auto-selection.
 *
 * Tie-break order is load-bearing and applied in full: explicit priority, then specificity,
 * then the most conservative cap (no cap is +∞, so a present cap always beats none), then
 * alphabetical as the final backstop. Every stage exists because the one before it can tie.
 */
export function autoSelect(recipes, signals, args = "") {
  const candidates = [];
  for (const r of recipes) {
    if (!r.doc) continue;
    const m = evaluateMatch(r.doc.match, signals, args);
    if (m?.matched) candidates.push({ recipe: r, satisfied: m.satisfied });
  }
  if (candidates.length === 0) return null;

  const capOf = (r) => (typeof r.doc?.caps?.max_total_cost_usd === "number" ? r.doc.caps.max_total_cost_usd : Infinity);
  candidates.sort((a, b) =>
    (b.recipe.doc.match.priority ?? 0) - (a.recipe.doc.match.priority ?? 0)
    || b.satisfied.length - a.satisfied.length
    || capOf(a.recipe) - capOf(b.recipe)
    || String(a.recipe.doc.name ?? a.recipe.name).localeCompare(String(b.recipe.doc.name ?? b.recipe.name)));

  const winner = candidates[0];
  const name = winner.recipe.doc.name ?? winner.recipe.name;
  return {
    name,
    satisfied: winner.satisfied,
    print: `🧭 Auto-selected workflow '${name}' — matched: ${winner.satisfied.join(",")}. Override with --workflow=NAME or --no-auto-workflow.`,
  };
}

/** Step 1 — the five-tier name precedence. */
export function resolveWorkflowName({ args = "", activeWorkflow = null, recipes = [], signals = null, profileDefault = null } = {}) {
  const explicit = /--workflow=([^\s]+)/.exec(String(args));
  if (explicit) return { name: explicit[1], tier: "--workflow", autoselected: false, print: null };
  if (activeWorkflow) return { name: activeWorkflow, tier: "active_workflow", autoselected: false, print: null };
  if (signals && !/--no-auto-workflow\b/.test(String(args))) {
    const auto = autoSelect(recipes, signals, args);
    if (auto) return { name: auto.name, tier: "auto", autoselected: true, satisfied: auto.satisfied, print: auto.print };
  }
  if (profileDefault) return { name: profileDefault, tier: "profile_default", autoselected: false, print: null };
  return { name: "default", tier: "fallback", autoselected: false, print: null };
}

/**
 * Step 1 — pick the file. A project recipe SHADOWS a plugin one deliberately; only two
 * PLUGINS colliding on a name is ambiguous, and that halts.
 */
export function locateRecipe(name, recipes) {
  const byName = recipes.filter((r) => r.name === name);
  const project = byName.find((r) => r.origin === "project");
  if (project) return { recipe: project, shadowed: byName.filter((r) => r !== project).map((r) => r.file) };

  const plugins = byName.filter((r) => r.origin === "plugin");
  if (plugins.length === 1) return { recipe: plugins[0], shadowed: [] };
  if (plugins.length > 1) {
    return {
      recipe: null,
      halt: [`❌ Workflow '${name}' is ambiguous — defined in multiple plugins:`,
        ...plugins.map((r) => `   ${r.file}`),
        "   Rename one, or pass --workflow= with a unique name.",
        `   (A project-local <project>/.claude/sdlc-workflows/${name}.yaml would override both.)`].join("\n"),
    };
  }
  const available = recipes.map((r) => `${r.name}${r.origin === "project" ? " (project)" : ""}`).sort();
  return {
    recipe: null,
    halt: [`❌ Workflow '${name}' not found.`,
      `   Available: ${available.join(", ") || "(none)"}`,
      "   Omit --workflow=NAME to use the default workflow."].join("\n"),
  };
}

/**
 * Step 4 — insert the stack profiles' extra phases, re-check for duplicates, apply skips.
 *
 * An `after:` target that is not in this workflow is a WARNING and the phase is skipped: a
 * stack profile is shared across recipes and cannot know which ones contain its anchor.
 */
export function buildResolvedPhases({ phases, extraPhases = [], skipPhases = [], workflowName, file } = {}) {
  const out = [...phases];
  const warnings = [];
  for (const extra of extraPhases) {
    if (!extra?.name) continue;
    const idx = out.findIndex((p) => p.name === extra.after);
    if (idx === -1) {
      warnings.push(`⚠️ Extra phase '${extra.name}' has after='${extra.after}' which is not present in workflow '${workflowName}' — skipping.`);
      continue;
    }
    out.splice(idx + 1, 0, { name: extra.name, ...(extra.agent ? { agent: extra.agent } : {}) });
  }

  const dupes = validateAcyclic(out, workflowName, file).filter((e) => e.includes("duplicate"));
  if (dupes.length) {
    return { phases: out, warnings, halt: `❌ Workflow '${workflowName}' after merging stack extra_phases contains duplicate phase. Check the stack profile's extra_phases declaration.` };
  }

  const skip = new Set(skipPhases);
  const kept = out
    .map((p) => (Array.isArray(p.parallel) ? { ...p, parallel: p.parallel.filter((m) => !skip.has(m)) } : p))
    .filter((p) => (Array.isArray(p.parallel) ? p.parallel.length > 0 : !skip.has(p.name)));

  return { phases: kept, warnings, halt: null };
}

/** The one line Step 1c owes the user. */
export function renderWorkflowPrint(name, phases) {
  return `   workflow: ${name}  (${phases.length} phases after skips)`;
}
