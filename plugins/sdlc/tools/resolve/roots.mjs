// Step 0 — resolve the three plugin roots, once, before anything reads a plugin file.
//
// Replaces the shell block in SKILL.md Step 0. Same precedence, three differences that are
// improvements rather than reinterpretations:
//
//   1. The `find … | sort -V | tail -1` fallback for SDLC_PLUGIN_ROOT is a heuristic over a
//      cache that holds every version ever installed. installed_plugins.json records the
//      exact installPath, so the registry is consulted FIRST and the version sort is only
//      the last resort (see ./manifests.mjs for the same argument at length).
//   2. No `$HOME` interpolation into a glob, and no shell at all — issue #70's failure mode
//      cannot recur through this path.
//   3. Every value carries how it was obtained, so the plan can report a guess as a guess.
//
// Which root serves which read is specified once in plugins/sdlc/PLUGIN-PATHS.md:
//   self-referential (config/**, tools/**)      -> SDLC_PLUGIN_ROOT
//   cross-plugin discovery (manifests, workflows) -> PLUGIN_CACHE_ROOT
//   session/user state (stamps, transcripts)    -> CONFIG_DIR

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const CACHE_MARKER = "/plugins/cache/";

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

/** Compare dotted versions numerically, newest last — `sort -V` without a shell. */
function compareVersions(a, b) {
  const pa = String(a).split(/[.\-+]/), pb = String(b).split(/[.\-+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i]), nb = Number(pb[i]);
    const bothNumeric = Number.isFinite(na) && Number.isFinite(nb);
    if (bothNumeric && na !== nb) return na - nb;
    if (!bothNumeric && (pa[i] ?? "") !== (pb[i] ?? "")) return (pa[i] ?? "") < (pb[i] ?? "") ? -1 : 1;
  }
  return 0;
}

/**
 * CONFIG_DIR.
 *
 * A CLAUDE_PLUGIN_ROOT inside a plugin cache WINS over CLAUDE_CONFIG_DIR, matching the shell
 * block it replaces: if this module is executing from a cache, that cache's config dir is
 * where the plugin actually lives, whatever an environment variable claims.
 */
export function resolveConfigDir(env = process.env) {
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT || "";
  const at = pluginRoot.indexOf(CACHE_MARKER);
  if (at !== -1) return { value: pluginRoot.slice(0, at), source: "CLAUDE_PLUGIN_ROOT" };
  if (env.CLAUDE_CONFIG_DIR) return { value: env.CLAUDE_CONFIG_DIR, source: "CLAUDE_CONFIG_DIR" };
  return { value: join(env.HOME || "", ".claude"), source: "default" };
}

/**
 * SDLC_PLUGIN_ROOT — where THIS plugin's own `config/` and `tools/` live.
 *
 * Order: the harness's own export, then the installed registry, then the newest cached
 * version. Only the last is a guess, and it says so.
 */
export function resolveSdlcRoot(configDir, env = process.env) {
  // A package built for another host is SELF-LOCATING and answers before anything
  // else is consulted. Without this, running `cli.mjs` out of an Antigravity
  // install still resolved sdlc_plugin_root to a Claude Code cache copy — the
  // package delegated its own identity to a different install, which would read
  // that install's config/host.json (absent), conclude "claude", and try to price
  // the run from transcripts that do not exist. That is issue #70's failure mode
  // (one run silently mixing two plugin trees) reappearing across hosts, so it
  // gets ADR-0009's answer: resolve from the install that is actually running.
  //
  // Gated on the declaration file, which the authored tree does not carry, so
  // Claude Code resolution is byte-for-byte unchanged.
  const own = ownPluginRoot();
  if (own && existsSync(join(own, "config", "host.json"))) {
    return { value: own, source: "own-package (declared host)" };
  }

  if (env.CLAUDE_PLUGIN_ROOT) return { value: env.CLAUDE_PLUGIN_ROOT, source: "CLAUDE_PLUGIN_ROOT" };

  const registry = readJson(join(configDir, "plugins", "installed_plugins.json"));
  if (registry?.plugins) {
    for (const [key, entries] of Object.entries(registry.plugins)) {
      if (!/^sdlc@/.test(key)) continue;
      const list = (Array.isArray(entries) ? entries : [entries]).filter((e) => e?.installPath);
      const hit = list.find((e) => existsSync(join(e.installPath, "config", "models", "claude.yaml")));
      if (hit) return { value: hit.installPath, source: "installed_plugins.json", version: hit.version ?? null };
    }
  }

  // Last resort: the newest cached copy that actually carries the Claude registry.
  const cacheRoot = join(configDir, "plugins", "cache");
  const candidates = [];
  for (const marketplace of safeDirs(cacheRoot)) {
    const sdlcDir = join(cacheRoot, marketplace, "sdlc");
    for (const version of safeDirs(sdlcDir)) {
      const root = join(sdlcDir, version);
      if (existsSync(join(root, "config", "models", "claude.yaml"))) candidates.push({ root, version });
    }
  }
  if (candidates.length === 0) return { value: null, source: "unresolved" };
  candidates.sort((a, b) => compareVersions(a.version, b.version));
  const newest = candidates[candidates.length - 1];
  return { value: newest.root, source: "cache-newest", version: newest.version, ambiguous: candidates.length > 1 };
}

function safeDirs(dir) {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
}

/**
 * All three roots plus the provenance of each.
 *
 * `plugin_search_paths` generalizes `plugin_cache_root` to hosts that lay their
 * plugins out differently. On Claude Code it is the one cache root, unchanged.
 * On a declared host it comes from that package's own `config/host.json` — the
 * package states where its siblings live rather than any code guessing.
 */
export function resolveRoots(env = process.env, cwd = process.cwd()) {
  const declared = readDeclaredHost();
  if (declared) {
    const configDir = (declared.config_dir_env && env[declared.config_dir_env])
      || join(env.HOME || "", declared.config_dir_default || "");
    const searchPaths = [
      ...(declared.workspace_plugin_subdirs ?? []).map((s) => join(cwd, s)),
      ...(declared.plugin_search_subdirs ?? []).map((s) => join(configDir, s)),
    ];
    return {
      config_dir: configDir,
      plugin_cache_root: searchPaths[0] ?? null,
      plugin_search_paths: searchPaths,
      sdlc_plugin_root: ownPluginRoot(),
      host: declared.host,
      sources: { config_dir: declared.config_dir_env ?? "host declaration", sdlc_plugin_root: "own-package (declared host)" },
      sdlc_version: null,
      sdlc_ambiguous: false,
    };
  }

  const config = resolveConfigDir(env);
  const sdlc = resolveSdlcRoot(config.value, env);
  const cacheRoot = join(config.value, "plugins", "cache");
  return {
    config_dir: config.value,
    plugin_cache_root: cacheRoot,
    plugin_search_paths: [cacheRoot],
    sdlc_plugin_root: sdlc.value,
    host: "claude",
    sources: { config_dir: config.source, sdlc_plugin_root: sdlc.source },
    sdlc_version: sdlc.version ?? null,
    sdlc_ambiguous: sdlc.ambiguous === true,
  };
}

/** The running package's host declaration, or null on the authored tree. */
function readDeclaredHost() {
  const own = ownPluginRoot();
  if (!own) return null;
  return readJson(join(own, "config", "host.json"));
}

/** Where the module itself lives — the development-checkout escape hatch. */
export function ownPluginRoot() {
  return dirname(dirname(dirname(new URL(import.meta.url).pathname)));
}
