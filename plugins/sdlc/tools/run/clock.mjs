// The run clock, derived from the machine anchor and nothing else. Shipped inside
// the sdlc plugin; node builtins only.
//
// This module exists because the orchestrator used to do this arithmetic in prose:
// read `.checkpoint/_started_at`, take `date -u +%s`, subtract, then render both
// epochs with a BSD-vs-GNU `date` flag fallback. H1 measured that step at 67% — the
// worst rate in the audited set, and the only genuinely multi-step one. Rendering
// through `Date` removes the portability hazard along with the step.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// `%FT%TZ`, the shape the rest of the corpus carries. toISOString() alone would add
// milliseconds and make new runs inconsistent with every older one.
function isoSeconds(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** The write-once epoch from Step 2, or null when it is missing or unusable. */
function readAnchor(runDir) {
  try {
    const n = Number(readFileSync(join(runDir, ".checkpoint", "_started_at"), "utf8").trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

/**
 * Write `started_at`, `completed_at` and `wall_clock_seconds` into the run's
 * telemetry, derived from the machine anchor. The ONLY writer of these three keys:
 * the orchestrator must not author them (see ADR-0014).
 *
 * Degrades honestly. With no anchor it never invents a clock — it keeps whatever the
 * telemetry already had, and when there is nothing to keep it records `null`, because
 * an unknown duration and a zero-second run are different facts.
 *
 * SEALS A LIVE RUN, NOT AN OLD ONE. `wall_clock_seconds` is `now - anchor`, so calling
 * this on a run that finished hours ago inflates its duration (and, through the overhead
 * window, its cost). That is the same arithmetic Step 5 always did — correct at the end
 * of the run it belongs to, wrong long after. To re-price a historical run, use
 * `usage/cli.mjs enrich`, which deliberately leaves the clock alone.
 */
export function sealRunClock(runDir, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const telPath = join(runDir, "_telemetry.json");
  if (!existsSync(telPath)) throw new Error(`no _telemetry.json in ${runDir}`);
  const tel = JSON.parse(readFileSync(telPath, "utf8"));
  const write = () => writeFileSync(telPath, JSON.stringify(tel, null, 2) + "\n");

  const start = readAnchor(runDir);
  if (start == null) {
    const hasValues = tel.started_at != null || tel.wall_clock_seconds != null;
    if (hasValues) {
      return { anchored: false, started_at: tel.started_at ?? null,
        completed_at: tel.completed_at ?? null, wall_clock_seconds: tel.wall_clock_seconds ?? null,
        changed: false, degraded: "no-anchor" };
    }
    tel.started_at = null;
    tel.wall_clock_seconds = null;
    tel.completed_at = isoSeconds(now);
    write();
    return { anchored: false, started_at: null, completed_at: tel.completed_at,
      wall_clock_seconds: null, changed: true, degraded: "no-anchor-no-values" };
  }

  // Clamp: a machine whose clock moved backwards must not produce a negative duration.
  const wall = Math.max(0, Math.floor(now / 1000) - start);
  tel.started_at = isoSeconds(start * 1000);
  tel.completed_at = isoSeconds((start + wall) * 1000);
  tel.wall_clock_seconds = wall;
  write();
  return { anchored: true, started_at: tel.started_at, completed_at: tel.completed_at,
    wall_clock_seconds: wall, changed: true, degraded: null };
}
