// Where a run has got to: which units are terminal, and which phase it would re-enter at.
// Shipped inside the sdlc plugin; node builtins only.
//
// This module ships (rather than living in the repo-root dev tool, where it started)
// because the H6 `Stop` hook evaluates the same rule on a consumer's machine through
// ${CLAUDE_PLUGIN_ROOT} to decide whether a run is finished enough to seal. Re-deriving
// a simplified copy there would put the procedure in two places — the drift H1's spec
// was written to avoid. `--resume` and the seal gate now share one definition of "done".
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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

/**
 * The ids whose checkpoint is terminal — "done" as one definition, in one place.
 *
 * `--resume` skipping a unit and the dry-run preview pricing it at $0.00 are the same question,
 * and answering it twice is how the two drift. Exported for `tools/resolve/plan.mjs`, which needs
 * the set without the resolved DAG that `resolveWorkspace` requires: at preview time the DAG is
 * the plan being previewed, not a `_run.json` written by a run that has not started.
 */
export function doneUnitIds(units) {
  const out = new Set();
  for (const [id, u] of units) if (isDone(u)) out.add(id);
  return out;
}

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

/**
 * Two --resume safety gates claude-sdlc has and this codebase's `--resume`
 * documents as a non-goal (commands/start.md): resuming on the wrong branch,
 * and resuming a run whose checkpoints have gone stale. Advisory only — this
 * function reports, the SKILL.md prose decides whether to HALT or ask.
 */
export function resumePreflight({ runPath, checkpointDir, currentBranch, nowMs = Date.now(), maxAgeMs = 6 * 3600 * 1000 }) {
  let runBranch = null;
  if (existsSync(runPath)) {
    try {
      const run = JSON.parse(readFileSync(runPath, "utf8"));
      if (typeof run?.branch_name === "string" && run.branch_name.length > 0) runBranch = run.branch_name;
    } catch { /* unparseable _run.json: treat as no recorded branch, fail open */ }
  }
  const branchOk = runBranch == null || runBranch === currentBranch;

  let newestCheckpointPath = null;
  let newestMtimeMs = -Infinity;
  if (existsSync(checkpointDir)) {
    for (const f of readdirSync(checkpointDir)) {
      // Same exclusion as loadCheckpoints(): _run.json is written once at run start (its mtime
      // reflects when the DAG was resolved, not phase progress) and would otherwise mask a
      // genuinely stale phase checkpoint whenever it happens to be newer than the last completed
      // unit — which is every run that hasn't finished a phase yet.
      if (!f.endsWith(".json") || f === "_run.json") continue;
      const p = join(checkpointDir, f);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.mtimeMs > newestMtimeMs) { newestMtimeMs = st.mtimeMs; newestCheckpointPath = p; }
    }
  }
  const ageMs = newestCheckpointPath == null ? null : nowMs - newestMtimeMs;
  const stale = ageMs != null && ageMs > maxAgeMs;
  // Machine value, not LLM arithmetic (H3 convention): the orchestrator prints this verbatim
  // in SKILL.md's stale-run message, so the hour conversion happens here, not in the prompt.
  const ageHours = ageMs == null ? null : Math.round(ageMs / 3600000);

  return { branchOk, runBranch, currentBranch, stale, ageMs, ageHours, newestCheckpointPath };
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
