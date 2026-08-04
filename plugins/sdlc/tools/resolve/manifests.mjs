// Manifest loading — the source-of-truth question ADR-0019 left as an open constraint,
// and the `enabledPlugins` gap that has been open in planning/backlog since ADR-0009.
//
// TWO MODES, because there are genuinely two sources and conflating them is the defect:
//
//   tree      plugins/**\/manifest.yaml under a marketplace checkout. What CI and the
//             fixtures use, and what the dev lint means by "the manifests".
//   installed What the CONSUMER actually has. This is the production path.
//
// Pointing the tree loader at production is not a theoretical mistake — it produced a
// wrong answer during ADR-0019's pre-implementation checks (a framework attached that no
// real run ever resolved, because the marketplace tree carries plugins the consumer never
// installed). That is why the root is a parameter and never a constant.
//
// WHY NOT GLOB THE CACHE: the cache keeps every version ever installed. On the machine this
// was written, `plugins/cache/agentic-sdlc/android-foundation/` holds 1.4.0, 1.5.0, 1.6.0
// and 1.7.0, and `sdlc/` holds four more. A glob returns all of them, they all match
// `detect`, they all carry the same `priority`, and which one wins is filesystem order.
// `installed_plugins.json` records the exact `installPath` per plugin, so the ambiguity does
// not have to be resolved by heuristic — it never has to arise.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { iterFiles } from "./fsglob.mjs";
import { resolveConfigDir } from "./roots.mjs";
import { parseYaml } from "./yaml.mjs";

/** Scope precedence: the most specific install wins. */
const SCOPE_RANK = { local: 3, project: 2, user: 1 };

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

/**
 * The config dir, resolved by Step 0's rules — one implementation, in ./roots.mjs.
 *
 * An earlier draft of this module inverted the precedence, preferring CLAUDE_CONFIG_DIR over
 * a CLAUDE_PLUGIN_ROOT sitting inside a cache. The shell block it replaces does the opposite,
 * and the shell block is right: if this code is executing from a cache, that cache's config
 * dir is where the plugin actually lives, whatever an environment variable claims.
 */
export function defaultConfigDir(env = process.env) {
  return resolveConfigDir(env).value;
}

function classify(records) {
  const foundations = [], frameworks = [], errors = [];
  for (const r of records) {
    if (r.error) { errors.push(r); continue; }
    const kind = r.doc?.kind;
    if (kind === "foundation") foundations.push(r);
    else if (kind === "framework") frameworks.push(r);
    else errors.push({ file: r.file, error: `unknown or missing kind: ${kind}` });
  }
  return { foundations, frameworks, errors };
}

function readManifest(file) {
  let raw;
  try { raw = readFileSync(file, "utf8"); }
  catch (e) { return { file, error: `read: ${e.message}` }; }
  try { return { file, doc: parseYaml(raw) }; }
  catch (e) { return { file, error: `parse: ${e.message}` }; }
}

/**
 * Mode `tree` — every manifest in a marketplace checkout.
 * Dev, CI and fixtures only. Never the production answer.
 */
export function loadManifestsFromTree(root = process.cwd()) {
  const records = [...iterFiles(root, "plugins/**/manifest.yaml")].sort().map(readManifest);
  return classify(records);
}

/**
 * The merged `enabledPlugins` map, in Claude Code's own precedence order.
 *
 * ABSENT IS NOT DISABLED, and this is measured rather than assumed: on the machine this was
 * written, both consumer projects list only `frontend-design`, `atlassian` and `github` in
 * their project settings, while `sdlc@agentic-sdlc` and `android-foundation@agentic-sdlc` —
 * plainly active in every run — appear only in the user settings. Project settings ADD to
 * the map; they do not replace it. Only an explicit `false` disables.
 */
export function readEnabledPlugins({ configDir, projectRoot } = {}) {
  const merged = {};
  const sources = [
    join(configDir ?? defaultConfigDir(), "settings.json"),
    projectRoot ? join(projectRoot, ".claude", "settings.json") : null,
    projectRoot ? join(projectRoot, ".claude", "settings.local.json") : null,
  ].filter(Boolean);
  for (const file of sources) {
    const j = readJson(file);
    if (j && j.enabledPlugins && typeof j.enabledPlugins === "object") Object.assign(merged, j.enabledPlugins);
  }
  return merged;
}

/**
 * `key -> { installPath, version, scope }` from installed_plugins.json, one entry per plugin.
 *
 * A plugin can be installed at several scopes at once; the most specific wins. When two
 * scopes disagree on the path, the loser is reported rather than dropped silently — a run
 * resolving against a different copy than the user expects is exactly the class of surprise
 * this module exists to remove.
 */
export function readInstalledPlugins({ configDir } = {}) {
  const file = join(configDir ?? defaultConfigDir(), "plugins", "installed_plugins.json");
  const j = readJson(file);
  const out = new Map();
  const conflicts = [];
  if (!j || !j.plugins || typeof j.plugins !== "object") return { installs: out, conflicts, file, present: false };

  for (const [key, entries] of Object.entries(j.plugins)) {
    const list = (Array.isArray(entries) ? entries : [entries]).filter((e) => e && e.installPath);
    if (list.length === 0) continue;
    const ranked = [...list].sort((a, b) => (SCOPE_RANK[b.scope] ?? 0) - (SCOPE_RANK[a.scope] ?? 0));
    const winner = ranked[0];
    const distinct = new Set(list.map((e) => e.installPath));
    if (distinct.size > 1) {
      conflicts.push({ key, chosen: winner.installPath, scope: winner.scope, others: [...distinct].filter((p) => p !== winner.installPath) });
    }
    out.set(key, { installPath: winner.installPath, version: winner.version ?? null, scope: winner.scope ?? null });
  }
  return { installs: out, conflicts, file, present: true };
}

/**
 * Mode `installed` — the manifests of the plugins this consumer has enabled.
 *
 * Returns the same `{foundations, frameworks, errors}` shape the tree loader does, plus
 * `skipped`, so the caller can REPORT a manifest that was deliberately left out instead of
 * pretending it never existed. That reporting requirement is the open half of the backlog's
 * *Track H — plugin discovery correctness*: a detected but disabled foundation must be
 * visible, not silently used and not silently dropped.
 *
 * `extraRoots` covers the development case the backlog also names: a plugin loaded from a
 * local path is in no cache and no installed_plugins.json, and must still work.
 */
export function loadInstalledManifests({ configDir, projectRoot, extraRoots = [] } = {}) {
  const cfg = configDir ?? defaultConfigDir();
  const enabled = readEnabledPlugins({ configDir: cfg, projectRoot });
  const { installs, conflicts, file: installsFile, present } = readInstalledPlugins({ configDir: cfg });

  const records = [];
  const skipped = [];
  const seen = new Set();

  for (const [key, info] of installs) {
    const manifest = join(info.installPath, "manifest.yaml");
    if (enabled[key] === false) {
      if (existsSync(manifest)) skipped.push({ key, reason: "disabled", file: manifest, version: info.version });
      continue;
    }
    if (!existsSync(manifest)) continue;          // not an SDLC plugin; carries no manifest
    seen.add(resolve(manifest));
    records.push({ ...readManifest(manifest), key, version: info.version, scope: info.scope, source: "installed" });
  }

  // Development checkouts: a plugin loaded from a path is in no registry. Included last so an
  // installed copy of the same plugin never shadows the tree the developer is editing.
  for (const root of extraRoots) {
    const manifest = join(root, "manifest.yaml");
    if (!existsSync(manifest) || seen.has(resolve(manifest))) continue;
    seen.add(resolve(manifest));
    records.push({ ...readManifest(manifest), key: null, version: null, scope: "path", source: "path" });
  }

  const classified = classify(records);
  return { ...classified, skipped, conflicts, installs_file: installsFile, installs_present: present, enabled };
}

/** Convenience: pick the mode from an explicit option rather than from a guess. */
export function loadManifests({ mode = "installed", root, configDir, projectRoot, extraRoots } = {}) {
  return mode === "tree"
    ? { ...loadManifestsFromTree(root), skipped: [], conflicts: [], enabled: {} }
    : loadInstalledManifests({ configDir, projectRoot, extraRoots });
}
