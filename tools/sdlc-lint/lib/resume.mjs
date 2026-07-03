import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Unit id for a (phase, aspect): aspect-agnostic → phase; aspect-aware → `${phase}-${aspect}`.
const unitId = (phase, aspect) => (aspect == null ? phase : `${phase}-${aspect}`);

export function loadCheckpoints(checkpointDir) {
  const units = new Map();
  const warnings = [];
  if (!existsSync(checkpointDir)) return { units, warnings };
  for (const f of readdirSync(checkpointDir)) {
    if (!f.endsWith(".json") || f === "_run.json") continue; // .tmp and _run.json ignored
    let data;
    try {
      data = JSON.parse(readFileSync(join(checkpointDir, f), "utf8"));
    } catch {
      warnings.push(`unparseable checkpoint ignored (treated as incomplete): ${f}`);
      continue;
    }
    if (!data || typeof data.status !== "string") {
      warnings.push(`checkpoint missing status ignored (treated as incomplete): ${f}`);
      continue;
    }
    units.set(f.slice(0, -".json".length), data); // key = filename sans .json
  }
  return { units, warnings };
}

const DONE = new Set(["completed", "skipped"]);
const isDone = (u) => u != null && DONE.has(u.status);

// Is one resolved (plain) phase fully done? aspect-aware → every aspect done.
// An empty aspect list resolves to NOT done (a phase with no dispatched aspects
// hasn't run) — never treat a vacuous `[].every()` as complete.
function plainDone(phase, units) {
  if (phase.aspects == null) return isDone(units.get(phase.name));
  return phase.aspects.length > 0 && phase.aspects.every(a => isDone(units.get(unitId(phase.name, a))));
}

function phaseDone(phase, units) {
  if (phase.kind === "loop") {
    // A loop is done only when its own checkpoint says completed (verdict approved).
    return isDone(units.get(phase.name));
  }
  if (phase.kind === "parallel") {
    // A members-less parallel entry is NOT done — never vacuously complete.
    const members = phase.members ?? [];
    return members.length > 0 && members.every(m => plainDone(m, units));
  }
  return plainDone(phase, units);
}

// Collect the unit ids that are done, for the human/print "completed" list.
function completedUnits(resolvedPhases, units) {
  const out = [];
  const pushPlain = (p) => {
    if (p.aspects == null) { if (isDone(units.get(p.name))) out.push(p.name); }
    else for (const a of p.aspects) { const id = unitId(p.name, a); if (isDone(units.get(id))) out.push(id); }
  };
  for (const p of resolvedPhases) {
    if (p.kind === "parallel") (p.members ?? []).forEach(pushPlain);
    else if (p.kind === "loop") { if (isDone(units.get(p.name))) out.push(p.name); }
    else pushPlain(p);
  }
  return out;
}

export function computeReentry(resolvedPhases, units) {
  const completed = completedUnits(resolvedPhases, units);
  const idx = resolvedPhases.findIndex(p => !phaseDone(p, units));
  if (idx === -1) return { completed, reenter_at: null, remaining: [] };
  return {
    completed,
    reenter_at: resolvedPhases[idx].name,
    remaining: resolvedPhases.slice(idx).map(p => p.name),
  };
}

export function resolveWorkspace(workspaceDir) {
  const checkpointDir = join(workspaceDir, ".checkpoint");
  const runPath = join(checkpointDir, "_run.json");
  if (!existsSync(runPath)) {
    throw new Error(`cannot resume ${workspaceDir}: .checkpoint/_run.json not found`);
  }
  const run = JSON.parse(readFileSync(runPath, "utf8"));
  if (!run || !Array.isArray(run.resolved_phases)) {
    throw new Error(`cannot resume ${workspaceDir}: .checkpoint/_run.json has no resolved_phases array`);
  }
  const { units, warnings } = loadCheckpoints(checkpointDir);
  return { ...computeReentry(run.resolved_phases, units), warnings };
}
