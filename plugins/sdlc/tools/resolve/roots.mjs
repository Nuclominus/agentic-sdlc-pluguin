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
import { dirname, join, resolve } from "node:path";

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
  if (env.CLAUDE_PLUGIN_ROOT) return { value: env.CLAUDE_PLUGIN_ROOT, source: "CLAUDE_PLUGIN_ROOT" };

  const registry = readJson(join(configDir, "plugins", "installed_plugins.json"));
  if (registry?.plugins) {
    for (const [key, entries] of Object.entries(registry.plugins)) {
      if (!/^sdlc@/.test(key)) continue;
      const list = (Array.isArray(entries) ? entries : [entries]).filter((e) => e?.installPath);
      const hit = list.find((e) => existsSync(join(e.installPath, "config", "models.json")));
      if (hit) return { value: hit.installPath, source: "installed_plugins.json", version: hit.version ?? null };
    }
  }

  // Last resort: the newest cached copy that actually carries config/models.json.
  const cacheRoot = join(configDir, "plugins", "cache");
  const candidates = [];
  for (const marketplace of safeDirs(cacheRoot)) {
    const sdlcDir = join(cacheRoot, marketplace, "sdlc");
    for (const version of safeDirs(sdlcDir)) {
      const root = join(sdlcDir, version);
      if (existsSync(join(root, "config", "models.json"))) candidates.push({ root, version });
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

/** All three roots plus the provenance of each. */
export function resolveRoots(env = process.env) {
  const config = resolveConfigDir(env);
  const sdlc = resolveSdlcRoot(config.value, env);
  return {
    config_dir: config.value,
    plugin_cache_root: join(config.value, "plugins", "cache"),
    sdlc_plugin_root: sdlc.value,
    sources: { config_dir: config.source, sdlc_plugin_root: sdlc.source },
    sdlc_version: sdlc.version ?? null,
    sdlc_ambiguous: sdlc.ambiguous === true,
  };
}

/** Where the module itself lives — the development-checkout escape hatch. */
export function ownPluginRoot() {
  return dirname(dirname(dirname(new URL(import.meta.url).pathname)));
}

/**
 * The roots of plugins loaded from a PATH rather than from the cache — normally just this one.
 *
 * `claude --plugin-dir plugins/sdlc`, `claude plugin eval plugins/sdlc` and every development
 * checkout load the plugin from a directory that is in no cache and in no
 * `installed_plugins.json`. Cross-plugin discovery keys off that registry, so under a path load
 * the plugin cannot find its OWN manifest, `workflows/` or `runtime-dependencies.json` — the run
 * halts at Step 0 with "Workflow 'default' not found. Available: (none)" while the recipe sits
 * next to the code printing the halt (issue #164).
 *
 * The signal is `CLAUDE_PLUGIN_ROOT` and nothing else. A root inside `/plugins/cache/` is
 * dropped: that copy IS registered, and ordinary installed discovery already covers it with the
 * right key, version and scope.
 *
 * `ownPluginRoot()` is deliberately NOT a fallback here, although it names the same directory
 * under a real path load. It names it under every OTHER caller too — a test fixture, a lint
 * pass, any tool that imports this module out of the checkout — and the module would then
 * announce the checkout as an installed plugin to a consumer that never loaded it. A harness
 * that runs this code at all exports `CLAUDE_PLUGIN_ROOT`, because the skill's own Bash calls
 * interpolate it into the path they execute; absent it, no plugin was loaded to speak for.
 */
export function pathLoadedRoots(env = process.env) {
  const candidate = env.CLAUDE_PLUGIN_ROOT;
  if (!candidate || candidate.includes(CACHE_MARKER)) return [];
  const root = resolve(candidate);
  return existsSync(join(root, "manifest.yaml")) ? [root] : [];
}
