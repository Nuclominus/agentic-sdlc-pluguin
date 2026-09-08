// Which finished runs still need sealing. The only unit that knows what makes a run
// sealable; it decides WHICH and WHEN and delegates HOW to finishRun, which is already
// fail-open per stage. Shipped inside the sdlc plugin; node builtins plus two siblings.
//
// The gate is completeness, not recency: recency cannot tell a paused run from a
// finished one. Measured over the 19-run downstream corpus, this gate opens for 10
// runs — including the ADR-0012 incident run, the case the hook exists for — and stays
// shut for the three H1 named as carrying most of the compliance damage.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspace } from "./reentry.mjs";
import { finishRun } from "./finish.mjs";

export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Newest mtime across the telemetry and every checkpoint: when the run last did anything. */
function lastActivity(runDir) {
  let newest = 0;
  const bump = (p) => { try { newest = Math.max(newest, statSync(p).mtimeMs); } catch { /* gone */ } };
  bump(join(runDir, "_telemetry.json"));
  const cp = join(runDir, ".checkpoint");
  try { for (const f of readdirSync(cp)) bump(join(cp, f)); } catch { /* no checkpoints */ }
  return newest;
}

/**
 * Partition a docs/plans root into runs the hook may seal and runs it must not.
 *
 * @param {string} plansRoot  a docs/plans directory (NOT finishRun's transcripts root)
 * @param {object} [opts]
 * @param {number} [opts.now]        epoch ms; injected by tests
 * @param {number} [opts.maxAgeMs]   age window, measured from the run's last activity
 *
 * Every rejection is recorded with a reason rather than dropped, so `seal-stale --json`
 * can say why it did nothing — a net that is silent about not firing is indistinguishable
 * from a net that is broken.
 */
export function findSealable(plansRoot, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const sealable = [];
  const skipped = [];

  let entries;
  try { entries = readdirSync(plansRoot, { withFileTypes: true }); }
  catch { return { sealable, skipped }; }   // no docs/plans here: not this project's concern

  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith("_")) continue;
    const runDir = join(plansRoot, e.name);

    // 1. Something to seal at all.
    if (!existsSync(join(runDir, "_telemetry.json"))) continue;

    // 2. Idempotency gate.
    if (existsSync(join(runDir, ".checkpoint", "_sealed"))) {
      skipped.push({ run: e.name, reason: "sealed" });
      continue;
    }

    // 3. Completeness gate. A throw means the run cannot prove it finished (no
    //    _run.json, or an unreadable one) — fail closed, and never propagate.
    let reenterAt;
    try { reenterAt = resolveWorkspace(runDir).reenter_at; }
    catch { skipped.push({ run: e.name, reason: "unprovable" }); continue; }
    if (reenterAt !== null) {
      skipped.push({ run: e.name, reason: "incomplete", reenter_at: reenterAt });
      continue;
    }

    // 4. Blast radius, not correctness — the gate and the mtime clock already hold
    //    correctness. A run this old has usually lost the transcripts enrich needs.
    const lastActivityMs = lastActivity(runDir);
    if (now - lastActivityMs > maxAgeMs) {
      skipped.push({ run: e.name, reason: "stale" });
      continue;
    }

    sealable.push({ run: e.name, runDir, lastActivityMs });
  }
  return { sealable, skipped };
}

/**
 * Seal every run the gate admits.
 *
 * All of them, not just the newest: /sdlc:batch can leave more than one run unsealed in
 * a project, each is independently gated, and a failure on one must not skip the rest.
 *
 * @param {string} plansRoot
 * @param {object} [opts]
 * @param {number}  [opts.now]
 * @param {number}  [opts.maxAgeMs]
 * @param {boolean} [opts.noReport]
 * @param {string}  [opts.registryPath]     models.json override
 * @param {string}  [opts.transcriptsRoot]  forwarded as finishRun's `projectsRoot`
 * @param {Function}[opts.finish]           TEST SEAM — replaces finishRun
 */
export function sealStale(plansRoot, opts = {}) {
  const { sealable, skipped } = findSealable(plansRoot, opts);
  const finish = opts.finish || finishRun;
  const sealed = [];
  const failed = [];

  for (const c of sealable) {
    try {
      // `now` is the run's last activity, never the wall clock: sealRunClock computes
      // wall_clock_seconds as now - anchor, so a late hook using the real clock would
      // charge the run for the time that passed after it finished.
      const r = finish(c.runDir, {
        now: c.lastActivityMs,
        sealedBy: "stop-hook",
        noReport: opts.noReport,
        registryPath: opts.registryPath,
        projectsRoot: opts.transcriptsRoot,
      });
      sealed.push({
        run: c.run,
        runDir: c.runDir,
        warnings: r?.warnings ?? [],
        wall_clock_seconds: r?.clock?.wall_clock_seconds ?? null,
        total_cost_usd: r?.enrich?.total_cost_usd ?? null,
      });
    } catch (e) {
      failed.push({ run: c.run, error: e.message });
    }
  }
  return { sealed, skipped, failed };
}
