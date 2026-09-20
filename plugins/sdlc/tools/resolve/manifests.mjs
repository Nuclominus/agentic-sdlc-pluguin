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
import { basename, join, resolve } from "node:path";
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

// ADR-0026: a foundation may embed its own frameworks via a `frameworks:` array (see
// schemas/manifest.schema.json `$defs/frameworkRow`), instead of each one shipping as a
// separate installed plugin. A row never carries `kind` — this synthesizer adds
// `kind: "framework"` and stamps `file` to the FOUNDATION's own manifest path, so every
// downstream consumer that reads `r.doc.kind` or resolves "this framework's directory" via
// `dirname(r.file)` (plan.mjs's role_expertise / rule-path resolution) keeps working
// unchanged, and lands on the foundation's own directory — where the embedded row's
// relocated skill/snippet assets actually live.
//
// Called once per foundation record, inside `classify()`, so both `loadManifestsFromTree`
// and `loadInstalledManifests` (which both call `classify`) get identical synthesis for
// free — the "one production path" the dual-mode equality test guards.
function synthesizeEmbeddedFrameworks(foundationRecord) {
  const rows = foundationRecord.doc?.frameworks ?? [];
  return rows.map((row) => ({
    file: foundationRecord.file,
    key: foundationRecord.key,
    version: foundationRecord.version,
    scope: foundationRecord.scope,
    source: foundationRecord.source,
    doc: {
      kind: "framework",
      stack: row.stack,
      enriches_aspect: row.enriches_aspect,
      dependency: row.dependency,
      ...(row.priority !== undefined ? { priority: row.priority } : {}),
      ...(row.convention_skills !== undefined ? { convention_skills: row.convention_skills } : {}),
      ...(row.phase_injections !== undefined ? { phase_injections: row.phase_injections } : {}),
      ...(row.extra_phases !== undefined ? { extra_phases: row.extra_phases } : {}),
      ...(row.pre_phase_commands !== undefined ? { pre_phase_commands: row.pre_phase_commands } : {}),
      ...(row.post_pipeline_checks !== undefined ? { post_pipeline_checks: row.post_pipeline_checks } : {}),
    },
  }));
}

function classify(records) {
  const foundations = [], frameworks = [], errors = [];
  const shadowed_frameworks = [];
  for (const r of records) {
    if (r.error) { errors.push(r); continue; }
    const kind = r.doc?.kind;
    if (kind === "foundation") {
      foundations.push(r);
      frameworks.push(...synthesizeEmbeddedFrameworks(r));
    } else if (kind === "framework") frameworks.push(r);
    else errors.push({ file: r.file, error: `unknown or missing kind: ${kind}` });
  }

  // Edge case 1 (BA): a stale standalone copy of a now-embedded framework (e.g. a cached
  // `retrofit-plugin` still installed after the merge) must not double-attach. When both an
  // embedded row and a standalone record share a `stack`, the embedded row wins — the
  // foundation is now authoritative — and the standalone copy is reported, following the
  // existing `shadows` precedent in `mergePathLoaded` above.
  const byStack = new Map();
  for (const f of frameworks) {
    const stack = f.doc?.stack;
    if (!stack) continue;
    if (!byStack.has(stack)) byStack.set(stack, []);
    byStack.get(stack).push(f);
  }
  const isEmbedded = (f) => foundations.some((fo) => fo.file === f.file);
  // Sorting by `file` before picking is what makes the choice DETERMINISTIC. Record order is
  // an artifact of enumeration — a glob in tree mode, `installed_plugins.json` order in
  // installed mode — and the two need not agree. Picking "the first one that matches" would
  // therefore let the two modes resolve different winners for the same tree, which is exactly
  // the dual-mode divergence ADR-0026 exists to make impossible. Sort is stable in V8, so two
  // rows from the SAME file (a foundation declaring one `stack` twice) keep their YAML order,
  // which is itself identical in both modes.
  const byFile = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  const deduped = [];
  for (const [stack, group] of byStack) {
    if (group.length === 1) { deduped.push(group[0]); continue; }
    // The foundation is authoritative once it embeds a row for this stack, so an embedded
    // record beats a standalone one. Among equals, lowest `file` path wins.
    const embedded = group.filter(isEmbedded);
    const winner = (embedded.length ? embedded : group).slice().sort(byFile)[0];
    deduped.push(winner);
    for (const loser of group) {
      if (loser === winner) continue;
      // Two distinct reasons, because they are two different problems with different fixes.
      // A standalone copy losing to an embedded row is the EXPECTED post-merge state — the
      // user uninstalls the stale plugin. Two embedded rows colliding is a MANIFEST BUG: the
      // `stack` id is declared twice (in one foundation or across two), which
      // `tools/sdlc-lint`'s `stack-uniqueness` verb rejects in-repo. Reporting the second as
      // `superseded-by-embedded` told the user to uninstall a plugin that was never the cause.
      shadowed_frameworks.push({
        stack,
        file: loser.file,
        reason: isEmbedded(loser) ? "duplicate-embedded-row" : "superseded-by-embedded",
      });
    }
  }

  return { foundations, frameworks: deduped, errors, shadowed_frameworks };
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

/** The plugin half of an `installed_plugins.json` key — `sdlc@agentic-sdlc` -> `sdlc`. */
export const pluginNameOf = (key) => String(key).split("@")[0];

/**
 * A path-loaded root's identity, and whether it is DECLARED or merely guessed.
 *
 * `.claude-plugin/plugin.json` is what the harness itself reads, so it is what decides whether
 * this root and a registered entry are the same plugin. A root without one still resolves — a
 * fixture or a partial checkout is not a reason to drop a manifest that is plainly there — but
 * it resolves as a plugin of its own, never as a replacement for somebody else's: `basename` is
 * a directory name, and a checkout that happens to sit in a directory called `superpowers` must
 * not be able to take over the registered `superpowers@obra`, whose `skills/` the dependency
 * preflight would then look for in the wrong tree.
 */
function identifyRoot(root) {
  const j = readJson(join(root, ".claude-plugin", "plugin.json"));
  return { name: j?.name || basename(root), version: j?.version ?? null, declared: Boolean(j?.name) };
}

/**
 * Fold path-loaded roots into an installs map, so that every consumer that iterates `installs`
 * — manifests here, `workflows/` in ./workflow.mjs, `runtime-dependencies.json` and `skills/`
 * in ./deps.mjs — sees a development checkout without being taught about one (issue #164).
 *
 * A path-loaded copy REPLACES every registered entry of the same plugin rather than joining
 * them. Two roots of one plugin would otherwise both be read, and two `vanilla` foundations of
 * equal priority make stack detection a coin toss decided by iteration order. EVERY entry, not
 * just the first: one plugin installed from two marketplaces is two keys, and replacing one
 * while leaving the other pointing at its own copy reproduces the tie this exists to prevent.
 * The survivors' paths are reported in `shadows` so the caller can say what it is not using.
 *
 * The first match keeps its registered KEY, which is what makes the replacement safe: every
 * `declared_by` and `plugin:skill` label stays the name it was, and a version the root does not
 * declare stays the version the registry knew rather than becoming `null`.
 */
export function mergePathLoaded(installs, roots = []) {
  const out = new Map(installs);
  for (const root of roots) {
    if (!existsSync(join(root, "manifest.yaml"))) continue;
    if ([...out.values()].some((info) => resolve(info.installPath) === resolve(root))) continue;
    const { name, version, declared } = identifyRoot(root);
    const matches = declared ? [...out].filter(([key]) => pluginNameOf(key) === name) : [];
    if (matches.length === 0) {
      out.set(`${name}@path`, { installPath: root, version, scope: "path" });
      continue;
    }
    const [[key, info], ...also] = matches;
    out.set(key, {
      ...info, installPath: root, version: version ?? info.version, scope: "path",
      shadows: [info.installPath, ...also.map(([, i]) => i.installPath)],
    });
    for (const [dup] of also) out.delete(dup);
  }
  return out;
}

/**
 * A path-loaded plugin is enabled by the act of being loaded.
 *
 * `enabledPlugins` governs the REGISTERED install, and the replacement above inherits the
 * registered key — so a `false` there followed the key onto the checkout and vetoed it. That is
 * not a corner case: disabling the installed copy in `settings.json` before running the checkout
 * with `--plugin-dir` is the natural thing to do, and it restored the exact #164 halt this fix
 * exists to remove. The harness was pointed at this directory explicitly; nothing in a settings
 * file outranks that.
 *
 * Stated once, here, because FOUR consumers apply the veto — manifests below, `discoverRecipes`
 * in ./workflow.mjs, `collectDependencies` and `enumerateSkills` in ./deps.mjs. Fixing only the
 * manifest layer left the other three vetoing the recipes and the dependency declaration, which
 * halts the run just as dead.
 */
export function withPathLoadedEnabled(enabled, installs) {
  const out = { ...enabled };
  for (const [key, info] of installs) if (info.scope === "path") out[key] = true;
  return out;
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
 * local path is in no cache and no installed_plugins.json, and must still work. They arrive
 * through `mergePathLoaded`, which is also what keeps a path load from doubling a plugin the
 * cache already carries.
 */
export function loadInstalledManifests({ configDir, projectRoot, extraRoots = [] } = {}) {
  const cfg = configDir ?? defaultConfigDir();
  const { installs: registered, conflicts, file: installsFile, present } = readInstalledPlugins({ configDir: cfg });
  const installs = mergePathLoaded(registered, extraRoots);
  const enabled = withPathLoadedEnabled(readEnabledPlugins({ configDir: cfg, projectRoot }), installs);

  const records = [];
  const skipped = [];

  for (const [key, info] of installs) {
    const manifest = join(info.installPath, "manifest.yaml");
    if (enabled[key] === false) {
      if (existsSync(manifest)) skipped.push({ key, reason: "disabled", file: manifest, version: info.version });
      continue;
    }
    if (!existsSync(manifest)) continue;          // not an SDLC plugin; carries no manifest
    const source = info.scope === "path" ? "path" : "installed";
    records.push({ ...readManifest(manifest), key, version: info.version, scope: info.scope, source });
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
