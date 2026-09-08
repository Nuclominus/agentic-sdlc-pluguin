// Which host is this install built for?
//
// The answer is not probed from the environment. A package DECLARES it: the
// emitter writes `config/host.json` into every non-Claude package, and its
// absence means Claude Code, which is the tree authors work in. Env sniffing
// would be a guess that is wrong in exactly the cases that matter — a Codex
// package installed under a config dir that also holds a Claude one, or a
// dev checkout run by hand — and a wrong answer here silently changes how cost
// is accounted. Same reasoning as ADR-0009: resolve from the install that is
// actually running, never from ambient state.
//
// Shipped inside the plugin (node builtins only, no node_modules).

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** The host the authored tree targets. A package with no declaration is this. */
export const DEFAULT_HOST = "claude";

/** This plugin's own root, from the running file — never from $HOME (ADR-0009). */
export function ownPluginRoot() {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));   // tools/resolve/host.mjs -> plugin root
}

/**
 * Read the host declaration for an install.
 *
 * @param {string} [sdlcRoot]  plugin root; defaults to the running install
 * @returns {{ host: string, telemetry_mode: string, declared: boolean, source: string }}
 */
export function resolveHost(sdlcRoot = ownPluginRoot()) {
  const p = join(sdlcRoot, "config", "host.json");
  if (!existsSync(p)) {
    return { host: DEFAULT_HOST, telemetry_mode: "transcript", declared: false, source: "default (no config/host.json)" };
  }
  try {
    const d = JSON.parse(readFileSync(p, "utf8"));
    return {
      host: d.host ?? DEFAULT_HOST,
      telemetry_mode: d.telemetry_mode ?? "none",
      declared: true,
      source: p,
    };
  } catch (e) {
    // A malformed declaration is reported, not guessed around: pricing a run
    // against the wrong host is worse than pricing nothing.
    return { host: "unknown", telemetry_mode: "none", declared: true, source: `${p} (unreadable: ${e.message})` };
  }
}

/**
 * Can this install derive real per-phase cost from transcripts?
 * Everything else must report `resolved: false` rather than estimate.
 */
export function hasTranscriptCost(sdlcRoot) {
  return resolveHost(sdlcRoot).telemetry_mode === "transcript";
}
