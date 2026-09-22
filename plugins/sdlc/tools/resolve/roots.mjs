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
import { fileURLToPath } from "node:url";

const CACHE_MARKER = "/plugins/cache/";

/** The file that makes a directory THIS plugin's root, on every host. */
const REGISTRY_FILE = join("config", "models", "claude.yaml");

/**
 * The project-local directory the SDLC owns: `<project>/.sdlc/`.
 *
 * It used to be `<project>/.claude/`, which was never right and became visibly
 * wrong once the pipeline ran on other CLIs — the marketplace was parking its
 * own files in another tool's directory, and on a Gemini or Codex host that
 * directory may not exist or may belong to a tool the project does not use.
 *
 * One directory, not one per host: the content here is host-neutral. Extensions,
 * skill mappings, agent bindings, cost caps and tier tags mean the same thing
 * everywhere (ADR-0029 §6 keeps tier tags untranslated across hosts), so a
 * per-host copy would be the same fact in two places — the drift shape the model
 * registry split was corrected to avoid.
 *
 * There is NO fallback to the old location. An alias layer is what ADR-0021 §5
 * deleted after six defects; a project's files are migrated once, visibly, with
 * the user's approval (tools/migrate), and everything downstream reads one
 * spelling. What the resolver does instead is NOTICE the old directory and say
 * so, because silently ignoring a cost cap the user set is worse than either.
 */
export const PROJECT_DIR = ".sdlc";

/** The directory this project's SDLC config lives in. */
export const projectDir = (cwd) => join(cwd, PROJECT_DIR);

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
 * Order: a package that declares its host, then the harness's own export, then the installed
 * registry, then the tree this module runs from, then the newest cached version. Only the
 * last is a guess, and it says so.
 */
export function resolveSdlcRoot(configDir, env = process.env, self = selfPluginRoot()) {
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
      const hit = list.find((e) => existsSync(join(e.installPath, REGISTRY_FILE)));
      if (hit) return { value: hit.installPath, source: "installed_plugins.json", version: hit.version ?? null };
    }
  }

  // The tree this module is executing from, when the consumer has no copy of its own (#173).
  // It ranks BELOW the registry deliberately: `claude plugin eval` and a bare checkout have no
  // registry to consult, while a consumer that installed the plugin must keep getting what it
  // installed, whatever checkout happens to be running the code.
  if (self && existsSync(join(self, REGISTRY_FILE))) return { value: self, source: "self" };

  // Last resort: the newest cached copy that actually carries the Claude registry.
  const cacheRoot = join(configDir, "plugins", "cache");
  const candidates = [];
  for (const marketplace of safeDirs(cacheRoot)) {
    const sdlcDir = join(cacheRoot, marketplace, "sdlc");
    for (const version of safeDirs(sdlcDir)) {
      const root = join(sdlcDir, version);
      if (existsSync(join(root, REGISTRY_FILE))) candidates.push({ root, version });
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
 *
 * `self` is the caller's OFFER of the tree this module runs from (ADR-0023); a declared host
 * never needs it, because such a package is its own install by construction.
 */
export function resolveRoots(env = process.env, cwd = process.cwd(), self = selfPluginRoot()) {
  const declared = readDeclaredHost();
  if (declared) {
    // Both the env-named config dir AND the default, not one OR the other.
    // Measured on agy 1.1.28: `agy plugin install` ignores GEMINI_CONFIG_DIR
    // entirely and always installs under $HOME/.gemini, and `agy plugin list`
    // ignores it too. So a user who exports it would, under an `||`, get a
    // resolver searching an empty directory while every sibling plugin sat in
    // the default one -- android-foundation would not be found and an Android
    // project would silently fall back to the vanilla profile. A superset costs
    // one extra stat and is correct whether or not the host ever honours it.
    const envDir = declared.config_dir_env ? env[declared.config_dir_env] : null;
    const defaultDir = join(env.HOME || "", declared.config_dir_default || "");
    const configDirs = [...new Set([envDir, defaultDir].filter(Boolean))];
    const configDir = configDirs[0] ?? "";
    const searchPaths = [
      ...(declared.workspace_plugin_subdirs ?? []).map((s) => join(cwd, s)),
      ...configDirs.flatMap((d) => (declared.plugin_search_subdirs ?? []).map((s) => join(d, s))),
    ];
    return {
      config_dir: configDir,
      plugin_cache_root: searchPaths[0] ?? null,
      plugin_search_paths: searchPaths,
      sdlc_plugin_root: ownPluginRoot(),
      host: declared.host,
      // False when the model was baked into each agent file at build time, so a
      // dispatch carries no model and a per-project tier override cannot take
      // effect. Absent in older packages -> treat as capable, since that is the
      // Claude Code behaviour every such package was built for.
      model_arg: declared.model_arg !== false,
      // The HOST's project-local directories, declared rather than assumed. An
      // empty list is a real answer, so `?? []` is only for a package emitted
      // before these existed — hence the `??` on the whole key, not on a
      // per-element default.
      workspace_skill_dirs: (declared.workspace_skill_subdirs ?? []).map((s) => join(cwd, s)),
      project_settings_files: (declared.project_settings_files ?? []).map((s) => join(cwd, s)),
      // The spelling of a command on this host, for a warning that names one. A package emitted
      // before this existed keeps the Claude spelling, which is the wrong one — stated rather than
      // guessed, since the descriptor is the only place that knows.
      command_prefix: declared.command_prefix ?? "sdlc:",
      sources: {
        // Name the variable only when it actually supplied the value. Reporting
        // `GEMINI_CONFIG_DIR` for a path that came from $HOME/.gemini is a
        // provenance claim that is simply false, and provenance is the field a
        // reader trusts when a path looks wrong.
        config_dir: envDir ? declared.config_dir_env : `$HOME/${declared.config_dir_default}`,
        sdlc_plugin_root: "own-package (declared host)",
      },
      sdlc_version: null,
      sdlc_ambiguous: false,
    };
  }

  const config = resolveConfigDir(env);
  const sdlc = resolveSdlcRoot(config.value, env, self);
  const cacheRoot = join(config.value, "plugins", "cache");
  return {
    config_dir: config.value,
    plugin_cache_root: cacheRoot,
    plugin_search_paths: [cacheRoot],
    sdlc_plugin_root: sdlc.value,
    host: "claude",
    // Claude Code passes the tier at the call site and enforce-agent-model.sh
    // holds it there, so overrides are live.
    model_arg: true,
    // Claude Code's own project-local locations, unchanged. Named here rather
    // than hardcoded downstream so every host answers the same question in the
    // same place.
    workspace_skill_dirs: [join(cwd, ".claude", "skills")],
    project_settings_files: [join(cwd, ".claude", "settings.json"), join(cwd, ".claude", "settings.local.json")],
    command_prefix: "sdlc:",
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
  // fileURLToPath, not `new URL(...).pathname`: the latter hands back a percent-encoded path, so
  // a checkout under `~/My Plugins/` resolves to a directory that does not exist. Harmless while
  // this was an unused escape hatch; not harmless now that #173 made it load-bearing.
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

/**
 * Does the consumer's registry list a copy of THIS plugin — in any state?
 *
 * The question `resolveSdlcRoot` asks of the registry is stricter (it wants an installPath that
 * actually carries the registry file), and the two must not be confused: gating the self root
 * on the strict answer let a PARTIAL install keep its entry for cross-plugin discovery while
 * self-referential reads moved to whatever checkout happened to be executing. One run, two trees.
 * A registry entry that cannot be read is a broken install — `/sdlc:doctor`'s problem, not a
 * reason to substitute a directory the consumer never pointed at.
 */
export function registryListsSdlc(installs) {
  for (const key of installs.keys()) if (/^sdlc@/.test(key)) return true;
  return false;
}

/**
 * The plugin tree this module is executing from, or `null` when that tree is a cache install.
 *
 * A module running out of `<config>/plugins/cache/...` IS the installed copy: registry-keyed
 * discovery already has it with the right key, version and scope, and offering it a second time
 * as a path load is how one plugin becomes two foundations of equal priority.
 */
export function selfPluginRoot(own = ownPluginRoot()) {
  return own && !own.includes(CACHE_MARKER) ? own : null;
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
 * The first signal is `CLAUDE_PLUGIN_ROOT`. A root inside `/plugins/cache/` is dropped: that copy
 * IS registered, and ordinary installed discovery already covers it with the right key, version
 * and scope.
 *
 * `CLAUDE_PLUGIN_ROOT` is not the ONLY signal, because a host can load a plugin without exporting
 * it — `claude plugin eval` is exactly that host, and under it every should-fire case of
 * `plugins/sdlc/evals/` halted at Step 0 (issue #173). So the caller may OFFER the tree this
 * module is executing from, via `selfPluginRoot()`. The offer is the caller's to make and not a
 * default here: the module volunteering its own location unconditionally would announce a
 * checkout to any consumer that merely imported it — a test fixture, a lint pass — while having
 * a registered install of its own. `resolveProfile` therefore offers it only when Step 0 already
 * resolved this plugin's root from that same location (`sources.sdlc_plugin_root === "self"`),
 * which keeps self-referential reads and cross-plugin discovery pointed at ONE tree.
 */
export function pathLoadedRoots(env = process.env, self = null) {
  const candidate = env.CLAUDE_PLUGIN_ROOT || self;
  if (!candidate || candidate.includes(CACHE_MARKER)) return [];
  const root = resolve(candidate);
  return existsSync(join(root, "manifest.yaml")) ? [root] : [];
}
