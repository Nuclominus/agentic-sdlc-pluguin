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
  // fileURLToPath, not `new URL(...).pathname`: the latter hands back a percent-encoded path, so
  // a checkout under `~/My Plugins/` resolves to a directory that does not exist (#173).
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));   // tools/resolve/host.mjs -> plugin root
}

/**
 * The declaration file, read one way.
 *
 * Three readers used to look at it: one gated on its existence, one parsed it and swallowed
 * the error, one parsed it and reported the error. A malformed file was therefore a declared
 * host to the first, a Claude Code tree to the second and host "unknown" to the third — in the
 * same run. Every consumer now goes through here, and a file that exists but cannot be read is
 * one answer: declared, with an error, and no host.
 *
 * @param {string} [sdlcRoot]  plugin root; defaults to the running install
 * @returns {{ declared: boolean, file: string, doc: object|null, error: string|null }}
 */
export function readHostDeclaration(sdlcRoot = ownPluginRoot()) {
  const file = join(sdlcRoot, "config", "host.json");
  if (!existsSync(file)) return { declared: false, file, doc: null, error: null };
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return { declared: true, file, doc: null, error: "not a JSON object" };
    return { declared: true, file, doc, error: null };
  } catch (e) {
    return { declared: true, file, doc: null, error: e.message };
  }
}

/**
 * Read the host declaration for an install.
 *
 * @param {string} [sdlcRoot]  plugin root; defaults to the running install
 * @returns {{ host: string, telemetry_mode: string, declared: boolean, source: string }}
 */
export function resolveHost(sdlcRoot = ownPluginRoot()) {
  const d = readHostDeclaration(sdlcRoot);
  if (!d.declared) {
    return { host: DEFAULT_HOST, telemetry_mode: "transcript", declared: false, source: "default (no config/host.json)" };
  }
  if (d.error) {
    // A malformed declaration is reported, not guessed around: pricing a run
    // against the wrong host is worse than pricing nothing.
    return { host: "unknown", telemetry_mode: "none", declared: true, source: `${d.file} (unreadable: ${d.error})` };
  }
  return {
    host: d.doc.host ?? DEFAULT_HOST,
    telemetry_mode: d.doc.telemetry_mode ?? "none",
    declared: true,
    source: d.file,
  };
}

/**
 * Can this install derive real per-phase cost from transcripts?
 * Everything else must report `resolved: false` rather than estimate.
 */
export function hasTranscriptCost(sdlcRoot) {
  return resolveHost(sdlcRoot).telemetry_mode === "transcript";
}
