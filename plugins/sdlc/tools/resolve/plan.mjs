// The composition — Steps 0 → 1d run end to end, producing one resolved plan.
//
// The module map in the spec put "no I/O of its own" on plan.mjs and left the sequencing to
// cli.mjs. That split is wrong in one direction: the ORDER of these steps is itself logic
// (roots before manifests, manifests before deps, signals before workflow auto-selection), and
// logic in a CLI entry point is logic nobody tests. So the sequencing lives here and `cli.mjs`
// keeps the property that actually matters — it is the only unit that prints.
//
// Every step's own module does its own reading. This function owns the order and the assembly.

import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { resolveRoots, pathLoadedRoots, selfPluginRoot, registryListsSdlc, PROJECT_DIR } from "./roots.mjs";
import { readInstalledPlugins, readEnabledPlugins, loadInstalledManifests, loadManifestsFromTree, mergePathLoaded, withPathLoadedEnabled } from "./manifests.mjs";
import { resolveStack } from "./detect.mjs";
import { preflight } from "./deps.mjs";
import { computeDiffSignals, applySkipRules, renderSkipPrint } from "./skiprules.mjs";
import {
  mergeProfiles, applyLocalOverrides, parseFrameworkOverrides, parseModelOverrides, renderOverridesPrint, renderModelPrint, renderStackPrint,
  mergeRoleExpertise, renderRoleExpertiseBlock, renderSkillsBlock,
} from "./profile.mjs";
import { discoverRecipes, resolveWorkflowName, locateRecipe, validateWorkflow, normalizePhases, validateAcyclic, buildResolvedPhases, renderWorkflowPrint, availableNames } from "./workflow.mjs";
import { resolveCostCap, renderCapOverridePrint, expandRows, estimate, renderDryRun, renderHeadlessDryRun } from "./caps.mjs";
import { loadCheckpoints, doneUnitIds } from "../run/reentry.mjs";
import { parseYaml } from "./yaml.mjs";
import { scanLegacyLocation } from "../migrate/migrate.mjs";

/**
 * Immediate children of the given roots that are plugins.
 *
 * "Is a plugin" and "is an SDLC stack plugin" are different questions, and
 * collapsing them cost a real answer. `manifest.yaml` alone was the test, which
 * is the STACK test — so `superpowers`, installed at
 * `~/.gemini/config/plugins/superpowers` with twelve skills and a `plugin.json`
 * but no `manifest.yaml`, was invisible, and the preflight reported every one of
 * its mandated skills missing while they sat on disk. On Claude Code
 * `installed_plugins.json` lists every plugin regardless of kind, so a
 * synthesized registry that admits fewer is not a substitute for it.
 *
 * Downstream consumers still apply their own filter — `loadInstalledManifests`
 * skips a directory with no manifest, recipe discovery finds no `workflows/` —
 * so widening here loses nothing and restores skill enumeration.
 */
function pluginDirsUnder(searchPaths) {
  const out = [];
  for (const base of searchPaths) {
    let entries;
    try { entries = readdirSync(base, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = join(base, e.name);
      const isPlugin = existsSync(join(dir, "manifest.yaml"))
        || existsSync(join(dir, "plugin.json"))
        || existsSync(join(dir, ".claude-plugin", "plugin.json"));
      if (isPlugin) out.push(dir);
    }
  }
  return out;
}

/**
 * WHICH plugin a directory is, independent of where it sits. The emitted
 * manifest is at the plugin root; the authored one is under .claude-plugin/.
 * Directory name is the last resort — an install can be renamed, a declared
 * name cannot.
 */
function pluginIdentity(dir) {
  for (const f of [join(dir, "plugin.json"), join(dir, ".claude-plugin", "plugin.json")]) {
    const name = readJson(f)?.name;
    if (name) return name;
  }
  return basename(dir);
}

/**
 * The installed-plugin registry, synthesized, for a host that keeps none.
 *
 * `installed_plugins.json` is written only by Claude Code, and FOUR consumers read
 * plugins out of it: manifest loading, recipe discovery, the dependency preflight,
 * and agent `model:` frontmatter. The first two were given an `extraRoots` seam;
 * the other two were not, and both failed silently rather than loudly —
 * `android-foundation` declares two runtime dependencies and the preflight said
 * "no external dependencies declared", so a `policy: block` dependency would not
 * have been caught at all; and every agent fell through to the hardcoded `sonnet`
 * default, so the dry run named a tier the run would not dispatch.
 *
 * Threading a fifth `extraRoots` parameter would have kept that going. On a host
 * with no registry, the package search IS the registry, so it is built once here
 * and every consumer downstream is unchanged. Registry entries always win: this
 * only fills a gap, it never overrides an answer the host actually gave.
 */
function installsFromRoots(hostRoots) {
  const out = new Map();
  for (const dir of hostRoots) {
    const key = pluginIdentity(dir);
    if (out.has(key)) continue;
    const version = readJson(join(dir, "plugin.json"))?.version
      ?? readJson(join(dir, ".claude-plugin", "plugin.json"))?.version
      ?? null;
    out.set(key, { installPath: dir, version, scope: "host" });
  }
  return out;
}

/**
 * The plugin roots a non-Claude host should read, own package first, one entry
 * per plugin IDENTITY rather than per path.
 *
 * Both halves are load-bearing. Own-package-first: sibling scanning finds the
 * running package only when its install happens to sit under a search path,
 * which is true of `agy plugin install` and false of running straight out of a
 * checked-out dist/ tree — where the package shipped ten recipes and then
 * reported `Available: (none)`. Dedupe by identity: with the release installed
 * AND a branch checkout running, the same plugin appeared at two paths and the
 * run halted on `Workflow 'default' is ambiguous`, naming one plugin twice. That
 * is the documented way this project tests an unreleased branch against a real
 * project, so it is not an edge case. The code that is running owns the recipes
 * it ships; an installed copy of the same plugin is shadowed, never merged —
 * mixing two copies of one plugin tree is issue #70's failure, one layer out.
 */
function hostPluginRoots(roots) {
  if (roots.host === "claude") return { roots: [], conflicts: [] };
  const out = [];
  const chosen = new Map();
  const conflicts = new Map();
  // Same directory reached twice is not a conflict. The own package normally
  // ALSO sits under a search path — that is what a plain `agy plugin install`
  // produces — and reporting it as two copies of itself, naming one path twice,
  // is a false alarm in the one channel that must stay worth reading.
  const canonical = (d) => { try { return realpathSync(d); } catch { return resolve(d); } };

  const consider = (dir, source) => {
    if (!dir) return;
    const id = pluginIdentity(dir);
    const won = chosen.get(id);
    if (won) {
      if (canonical(won.dir) === canonical(dir)) return;
      // Losing a duplicate is REPORTED, never silent. `readInstalledPlugins`
      // warns on a multi-path install on Claude Code and that warning is not
      // decoration — issue #70 was one run reading two plugin trees. A
      // synthesized registry that drops the loser quietly is narrower than the
      // facility it stands in for, in exactly the way that already cost this
      // phase one defect.
      const rec = conflicts.get(id) ?? { key: id, chosen: won.dir, source: won.source, others: [] };
      rec.others.push(dir);
      conflicts.set(id, rec);
      return;
    }
    chosen.set(id, { dir, source });
    out.push(dir);
  };
  consider(roots.sdlc_plugin_root, "own package");
  for (const dir of pluginDirsUnder(roots.plugin_search_paths ?? [])) consider(dir, "search path");
  return { roots: out, conflicts: [...conflicts.values()] };
}

const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const readYaml = (f) => { try { return parseYaml(readFileSync(f, "utf8")); } catch (e) { return { __error: e.message }; } };

/** Agent `model:` frontmatter across every enabled plugin — the third tier of the precedence. */
function frontmatterTiers(installs, enabled) {
  const tiers = {};
  for (const [key, info] of installs) {
    if (enabled[key] === false) continue;
    const dir = join(info.installPath, "agents");
    let files; try { files = readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { continue; }
    for (const f of files) {
      let text; try { text = readFileSync(join(dir, f), "utf8"); } catch { continue; }
      const m = /^model:\s*(\S+)/m.exec(text);
      if (m) tiers[f.replace(/\.md$/, "")] = m[1];
    }
  }
  return tiers;
}

/** Step 2's slug rule, in code: lowercase, alphanumerics + dashes, max 40 chars. */
const slugify = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");

/**
 * Flags whose value is a SEPARATE token (`--mode tree`), as `cli.mjs`'s `tokenOpt` reads them.
 * Their value is not part of the description and must not reach the slug — `--mode tree "Add dark
 * mode"` otherwise derives `tree-add-dark-mode`, which matches no workspace.
 */
const TOKEN_VALUE_FLAGS = ["--mode", "--role", "--skills", "--base-ref", "--workflow"];

/** `$ARGUMENTS` with every flag, flag value and quote stripped — the description Step 2 slugifies. */
const briefOf = (args) => {
  let out = String(args);
  for (const f of TOKEN_VALUE_FLAGS) out = out.replace(new RegExp(`(^|\\s)${f}\\s+\\S+`, "g"), " ");
  return out.replace(/--[a-z][a-z0-9-]*(=[^\s]*)?/g, " ").replace(/["'`]/g, " ").replace(/\s+/g, " ").trim();
};

/** A slug is a directory name under docs/plans/ — never a path, never a traversal. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Which units a `--resume` would skip, so the preview can price them at $0 (issue #168).
 *
 * `commands/start.md` promises "Combine with `--dry-run` to preview what would be skipped", and
 * the rendering for it has always been there — `⏩` rows, zeroed estimates, resumed rows excluded
 * from the loop/heal/gate arithmetic. Nothing ever passed `resumedDone`, so every one of those
 * branches was unreachable and the preview priced a finished run as if it were about to start. On
 * a run resumed near the end that is not a rounding error: the verdict can read EXCEEDS against a
 * remaining cost of nearly zero.
 *
 * "Done" is NOT redefined here. `loadCheckpoints` + `doneUnitIds` come from tools/run/reentry.mjs,
 * the same module `--resume` and the H6 seal gate consult; `resolveWorkspace` is the wrong entry
 * point only because it demands the `_run.json` that a run which has not started has not written.
 *
 * The slug is the soft spot, and it is reported rather than guessed around. Step 2 generates it
 * from `$ARGUMENTS` in prose, so a model's slug and this function's can differ. `--resume=<slug>`
 * is exact; a bare `--resume` is a reconstruction, and when it finds no checkpoint directory the
 * preview says so instead of quietly showing a full run.
 */
export function resolveResume({ cwd = process.cwd(), args = "" } = {}) {
  // `(?=\s|$)` rather than a consuming `(\s|$)`: with the latter a trailing `--resume=` cannot
  // match at all, so an empty slug read as "no resume at all" — no preview, and no warning either.
  // A silent no-op is the one outcome this function exists to prevent.
  const m = /(^|\s)--resume(=(\S*))?(?=\s|$)/.exec(String(args));
  if (!m) return { requested: false, slug: null, done: new Set(), warnings: [] };
  const warnings = [];
  const explicit = m[2] !== undefined;
  const slug = explicit ? m[3] : slugify(briefOf(args));
  if (!slug) {
    warnings.push(explicit
      ? "WARN: --resume=: empty slug — previewing a full run"
      : "WARN: --resume: no slug given and none derivable from the description — previewing a full run");
    return { requested: true, slug: null, done: new Set(), warnings };
  }
  if (!SLUG_RE.test(slug)) {
    warnings.push(`WARN: --resume=${slug}: not a run slug (a directory name under docs/plans/) — previewing a full run`);
    return { requested: true, slug: null, done: new Set(), warnings };
  }
  const checkpointDir = join(cwd, "docs", "plans", slug, ".checkpoint");
  if (!existsSync(checkpointDir)) {
    warnings.push(`WARN: --resume: no checkpoints at docs/plans/${slug}/.checkpoint — previewing a full run${explicit ? "" : " (slug derived from the description; pass --resume=<slug> if it differs)"}`);
    return { requested: true, slug, done: new Set(), warnings };
  }
  const { units, warnings: cw } = loadCheckpoints(checkpointDir);
  for (const w of cw) warnings.push(`WARN: --resume: ${w}`);
  return { requested: true, slug, done: doneUnitIds(units), warnings };
}

const flag = (args, name) => new RegExp(`(^|\\s)${name}(\\s|=|$)`).test(String(args));
const opt = (args, name) => (new RegExp(`${name}=([^\\s]+)`).exec(String(args)) ?? [])[1] ?? null;

/** Every agent name an `agents_per_phase` map binds, flat or per-aspect, de-duplicated. */
function agentsBound(agentsPerPhase = {}) {
  const out = new Set();
  for (const mapping of Object.values(agentsPerPhase)) {
    if (typeof mapping === "string") out.add(mapping);
    else if (mapping && typeof mapping === "object") for (const a of Object.values(mapping)) if (typeof a === "string") out.add(a);
  }
  return out;
}

/**
 * ADR-0021 — the per-agent prompt blocks, pre-rendered.
 *
 * Keyed by name, with no translation anywhere: a `role_expertise` entry is found by the exact name
 * that will be dispatched. The key set is every agent this run can dispatch UNION the core's own
 * roster, so the orchestrator can paste `prompt_blocks[agent]` without a presence check and an
 * on-demand core role is served even when a foundation binds something else for its phases.
 * A `null` block is a real answer (this stack says nothing about this role), not a missing one.
 */
function renderPromptBlocks({ agents, roleExpertise, extensionRows, stack, unavailablePlugins, warnings = [] }) {
  const blocks = {};
  for (const agent of agents) {
    const exp = roleExpertise[agent];
    // A stack that mandates a skill from a plugin the preflight flagged unavailable gets that
    // row downgraded, not printed as a hard requirement the agent then has to disobey. Rendered
    // once and reused for both framings so the two can never disagree about which rows exist —
    // and so the downgrade WARN is emitted once, not twice.
    const skillArgs = { roleSkills: exp?.skills ?? [], extensionRows, unavailablePlugins, warnings };
    blocks[agent] = {
      expertise: renderRoleExpertiseBlock(agent, exp, { stack }),
      skills: renderSkillsBlock(agent, skillArgs),
      // 3b-special Pass 1 (`development_plan`) writes a plan, not code: every mandate's trigger is
      // false there by construction. It gets the same rows to plan around, stated as the NEXT
      // pass's obligations — see renderSkillsBlock's `variant`.
      skills_planning: renderSkillsBlock(agent, { ...skillArgs, warnings: [], variant: "planning" }),
    };
  }
  return blocks;
}

/**
 * Steps 0 → 1b-models: everything up to and including the effective profile. Shared by
 * `resolvePlan` (which continues into the workflow) and `resolveExpertise` (which stops here —
 * an on-demand agent has no recipe to resolve).
 *
 * Returns `halt` when detection cannot proceed; otherwise every intermediate the caller needs.
 */
export function resolveProfile({ cwd = process.cwd(), args = "", env = process.env, mode = "installed" } = {}) {
  const prints = [];
  const warnings = [];
  /** Record a diagnostic in both channels — see the note on resolvePlan. */
  const warn = (msg) => { warnings.push(msg); prints.push(msg); };
  const warnAll = (msgs) => { for (const m of msgs) warn(m); };
  const headless = env.SDLC_NONINTERACTIVE === "true" || env.SDLC_NONINTERACTIVE === "1";

  // ---- Step 0: roots
  //
  // The registry is read BEFORE the self root is offered, because one question governs both
  // halves of Step 0: does this consumer list a copy of this plugin at all? If it does, the
  // module's own location is never consulted — not for `config/**` and `tools/**`, and not for
  // discovery. If it does not, the same self root answers for both, so a run can never price
  // itself from one tree while executing another's recipe (issue #173, ADR-0023).
  //
  // The registry lives in the HOST's config dir, which a declared package names itself, so the
  // roots are resolved first without the offer and again with it only where the registry is
  // silent. A declared host never takes the offer: such a package is its own install.
  let roots = resolveRoots(env, cwd, null);
  const configDir = roots.config_dir;
  const { installs: registered, conflicts } = readInstalledPlugins({ configDir });
  if (roots.host === "claude" && !registryListsSdlc(registered)) roots = resolveRoots(env, cwd, selfPluginRoot());
  if (roots.host_error) {
    return {
      prints, warnings, headless, roots, deps: null,
      halt: `❌ This package declares a host that cannot be read: ${roots.host_error}\n   Regenerate the package: node tools/sdlc-lint/cli.mjs emit`,
    };
  }

  // On a host with no installed_plugins.json registry, discovery is the search
  // paths the running package declares: every immediate child of them that
  // carries a manifest.yaml. Empty on Claude Code, where the registry answers.
  const { roots: hostRoots, conflicts: hostConflicts } = hostPluginRoots(roots);

  // ---- Step 0b inputs: what is installed and enabled
  //
  // `extraRoots` is the path-load case (issue #164): under `--plugin-dir`, `plugin eval` or any
  // development checkout this plugin is in no registry, and every discovery below keys off the
  // registry. Merging the root INTO `installs` is what fixes manifests, recipes, dependencies and
  // the skill enumeration at once, rather than four times over — see ./manifests.mjs.
  //
  // The host does not always export `CLAUDE_PLUGIN_ROOT` — `claude plugin eval` does not (issue
  // #173) — so the tree this module is executing from is offered as the fallback, and offered
  // only when Step 0 above actually resolved this plugin's root from that same location.
  //
  // A declared host takes no path load at all. Such a package is its own install — it is the
  // first host root below, and an installed copy of it is shadowed by identity — so a tree named
  // by `CLAUDE_PLUGIN_ROOT` there is a FOREIGN one: the authored checkout beside a dist/ package,
  // which is how this repo tests an emitted package. Reading both is the two-copies halt
  // ADR-0029 records ("Workflow 'default' is ambiguous").
  const declaredHost = roots.sources.sdlc_plugin_root === "own-package (declared host)";
  const extraRoots = declaredHost ? [] : pathLoadedRoots(env, roots.sources.sdlc_plugin_root === "self" ? roots.sdlc_plugin_root : null);
  const installs = mergePathLoaded(registered, extraRoots);
  // Fill the registry a non-Claude host never wrote. Never overwrite: a real
  // entry is the host's own answer and outranks anything inferred from a scan.
  for (const [key, info] of installsFromRoots(hostRoots)) if (!installs.has(key)) installs.set(key, info);
  const enabled = withPathLoadedEnabled(readEnabledPlugins({ configDir, projectRoot: cwd, projectSettingsFiles: roots.project_settings_files ?? null }), installs);
  for (const c of conflicts) warn(`WARN: ${c.key} is installed at several paths; using the ${c.scope} copy (${c.chosen})`);
  for (const [key, info] of installs) {
    for (const p of info.shadows ?? []) warn(`WARN: ${key} is loaded from a path (${info.installPath}); the installed copy at ${p} is not used`);
  }
  // Same warning for the synthesized registry. The `own package` source is the
  // documented dev-checkout flow rather than a misconfiguration, so it says which
  // it is — a developer running an unreleased branch beside an install should
  // read one sentence, not go looking for a problem.
  for (const c of hostConflicts) {
    warn(`WARN: ${c.key} is present at ${c.others.length + 1} paths; using the ${c.source} copy (${c.chosen}).`
      + ` Ignored: ${c.others.join(", ")}`);
  }

  // One view for every consumer: the map built above (registry, path loads, host roots) and
  // its enablement go in as-is, so detection cannot disagree with recipes, skills or deps.
  const manifests = mode === "tree"
    ? loadManifestsFromTree(cwd)
    : loadInstalledManifests({ configDir, projectRoot: cwd, installs, enabled });
  for (const s of manifests.skipped ?? []) warn(`WARN: ${s.key} ships a manifest but is disabled — not considered for detection`);
  for (const e of manifests.errors ?? []) warn(`WARN: unreadable manifest ${e.file}: ${e.error}`);
  for (const sf of manifests.shadowed_frameworks ?? []) {
    // The two reasons need different advice: one is a stale install the user should remove,
    // the other is a manifest declaring the same `stack` twice. Telling someone to uninstall
    // a plugin when the real fault is a duplicated row sends them after the wrong file.
    warn(sf.reason === "duplicate-embedded-row"
      ? `WARN: ${sf.stack} is declared by more than one embedded framework row; the row in ${sf.file} is not used (${sf.reason}) — a \`stack\` id must be unique across every foundation's \`frameworks:\` array`
      : `WARN: ${sf.stack} is now embedded in a foundation; the standalone copy at ${sf.file} is not used (${sf.reason})`);
  }

  // ---- Step 0a: dependency preflight
  const deps = preflight({
    configDir, projectRoot: cwd, installs, enabled, headless,
    force: flag(args, "--force-preflight"), skills: opt(args, "--skills"),
    workspaceSkillDirs: roots.workspace_skill_dirs ?? null,
  });
  prints.push(...deps.prints);

  // ---- Step 1b's file, read EARLY
  //
  // It is parsed here rather than beside `applyLocalOverrides` below because one of its keys —
  // `frameworks.disable` — is an input to detection, not to the profile merge. Suppressing a
  // framework has to prevent attachment (issue #197); a post-hoc filter over `additive` would
  // leave its `role_expertise` path, its `convention_skills` and its phase injection already
  // merged. One read, two consumers.
  // The rename to `<project>/.sdlc/` ships with NO fallback read, on purpose — an alias layer is
  // the shape ADR-0021 §5 deleted. But a silent rename is its own defect: the cost cap, the skill
  // mappings and the agent bindings would simply stop applying, and the run would look normal.
  // So the old location is not read, it is NOTICED, and the run says so. Detection only, by the
  // same scanner the doctor command moves with; the move itself asks first.
  const stale = scanLegacyLocation(cwd).map((f) => f.from);
  if (stale.length) {
    warn(`WARN: ${stale.length} SDLC config file(s) still in the old location and NOT read: ${stale.join(", ")}.`
      + ` They moved to ${PROJECT_DIR}/ — the marketplace no longer keeps its files in another tool's directory.`
      + ` Run /${roots.command_prefix}doctor to move them (it asks first). Until then this run uses plugin defaults for anything they set.`);
  }

  const localPath = join(cwd, PROJECT_DIR, "sdlc.local.yaml");
  let local = null;
  if (existsSync(localPath)) {
    local = readYaml(localPath);
    if (local?.__error) {
      warn(`⚠️ Failed to parse ${PROJECT_DIR}/sdlc.local.yaml: ${local.__error}. Continuing with plugin defaults.`);
      local = null;
    }
  }
  const frameworkOverrides = parseFrameworkOverrides(local);
  warnAll(frameworkOverrides.warnings);

  // ---- Step 0b: detection (`--stack=NAME` skips it, per 0b-2)
  const forcedStack = opt(args, "--stack");
  const stack = resolveStack(cwd, manifests, { forceStack: forcedStack, disableFrameworks: frameworkOverrides.disable });
  // A name that matches no installed framework suppressed nothing and would otherwise be the
  // same silence #197 was about — the config looks honoured while doing nothing at all.
  for (const name of stack.disable_unknown ?? []) {
    warn(`WARN: frameworks.disable '${name}' — no installed framework declares that stack id — ignored`);
  }
  if (stack.forced_unresolved) {
    const known = stack.known_stacks.length ? stack.known_stacks.join(", ") : "none installed";
    return {
      prints, warnings, headless, roots, deps,
      halt: `❌ --stack=${stack.forced_unresolved}: no installed foundation declares that stack.\n   Installed foundations: ${known}`,
    };
  }
  const primaryRecord = manifests.foundations.find((f) => f.doc?.stack === stack.foundation) ?? null;
  const primary = primaryRecord?.doc ?? null;
  const vanilla = manifests.foundations.find((f) => f.doc?.stack === "vanilla")?.doc ?? null;
  const additiveRecords = manifests.frameworks.filter((f) => stack.additive.includes(f.doc?.stack));
  const additive = additiveRecords.map((f) => f.doc);
  const stackPrint = renderStackPrint(stack);
  if (stackPrint) prints.push(stackPrint);

  // ---- Step 1: profile merge + project overrides
  const activeByAspect = primary ? { [primary.aspects?.[0] ?? stack.foundation]: primary } : {};
  const { profile: base, errors: mergeErrors, warnings: mergeWarnings } = mergeProfiles({ primary, active: activeByAspect, additive, vanilla });
  for (const e of mergeErrors) warn(`WARN: ${e.message}`);
  warnAll(mergeWarnings);

  // The roster a project's config may legitimately name: what this run dispatches, plus the core's
  // own roles (an on-demand agent is never bound to a phase). A name in neither matches nothing —
  // reported by the parsers below, never translated (ADR-0021 ships no aliases; /sdlc:doctor migrates).
  const knownAgents = new Set([
    ...agentsBound(base.agents_per_phase),
    ...agentsBound(vanilla?.agents_per_phase),
    ...(Array.isArray(vanilla?.on_demand_agents) ? vanilla.on_demand_agents : []),
  ]);

  const overridden = applyLocalOverrides(base, local, {
    availableSkills: deps.available_skills,
    unavailablePlugins: deps.flags,
    knownAgents,
  });
  warnAll(overridden.warnings);
  const effective = overridden.profile;
  const overridesPrint = renderOverridesPrint(overridden.applied);
  if (overridesPrint) prints.push(overridesPrint);

  const modelJson = readJson(join(cwd, PROJECT_DIR, "model.local.json"));
  const parsedModels = parseModelOverrides(modelJson, { knownAgents });
  warnAll(parsedModels.warnings);

  // A host that carries no model on the dispatch call cannot honour these. Each
  // agent file holds the model baked in at build time, and there is no hook to
  // rewrite the call either — enforce-agent-model.sh does not port. So the
  // override is INERT, and the honest thing is to say so rather than to preview
  // a tier the run will not dispatch: this file said `business-analyst: opus`
  // while the agent file said `gemini-3.1-pro-high`, which is the same class of
  // lie as pricing an unpriced run at $0.00. ADR-0029 §4 chose "declare the
  // gap" over "build a substitute mechanism" precisely here — dropping the
  // overrides silently would be the other half of the same mistake.
  const overridesInert = roots.model_arg === false
    && (parsedModels.overrides?.default !== undefined || Object.keys(parsedModels.overrides?.agents ?? {}).length > 0);
  const models = overridesInert ? { ...parsedModels, overrides: {} } : parsedModels;

  if (overridesInert) {
    const n = Object.keys(parsedModels.overrides.agents ?? {}).length;
    warn(`WARN: .sdlc/model.local.json is INERT on host ${roots.host}`
      + ` — ${n} agent override(s)${parsedModels.overrides.default !== undefined ? " plus a default" : ""} ignored.`
      + " Each agent's model is baked into its file at package build time and the dispatch passes none,"
      + " so a per-project tier cannot take effect. Change the tier in the agent's frontmatter and re-emit.");
  }
  const modelPrint = renderModelPrint(models.overrides);
  if (modelPrint) prints.push(modelPrint);

  // ---- Step 1a-expertise (ADR-0021): per-role expertise, merged in injection order, paths absolute
  const expertiseSources = [primaryRecord, ...additiveRecords]
    .filter((r) => r?.doc)
    .map((r) => ({ stack: r.doc.stack, dir: r.file ? dirname(r.file) : "", role_expertise: r.doc.role_expertise }));
  const expertise = mergeRoleExpertise(expertiseSources);
  warnAll(expertise.warnings);
  // Late-bound phases (an `extra_phases[].agent`, a project's skip injections) can add a name after
  // `knownAgents` was built for config validation; the block map must cover everything dispatched.
  const blockAgents = new Set([...knownAgents, ...agentsBound(effective.agents_per_phase)]);
  // One WARN per downgraded row, not one per role that mandates it — the block is rendered per
  // agent, so the same missing skill would otherwise be reported once for every role naming it.
  const blockWarnings = [];
  const promptBlocks = renderPromptBlocks({
    agents: blockAgents, roleExpertise: expertise.role_expertise, extensionRows: effective.extension_skills ?? [], stack: stack.foundation,
    unavailablePlugins: deps.flags, warnings: blockWarnings,
  });
  warnAll([...new Set(blockWarnings)]);

  return {
    prints, warnings, halt: null, headless, roots, installs, enabled, manifests, deps, stack, local,
    primary, vanilla, additive, effective, models,
    role_expertise: expertise.role_expertise, prompt_blocks: promptBlocks, known_agents: blockAgents,
    profile_dir: primaryRecord?.file ? dirname(primaryRecord.file) : null,
  };
}

/**
 * ADR-0021 — the one command an ON-DEMAND agent runs to receive its stack expertise.
 *
 * `node …/resolve/cli.mjs expertise --role <name>` prints exactly the blocks the orchestrator
 * would have pasted into a pipeline prompt for that role. One command, once per invocation: the
 * shape H1 measured at ~100% compliance, replacing the "self-read rules/skills.md and
 * sdlc.local.yaml" prose that on-demand agents were asked to follow.
 */
export function resolveExpertise({ cwd = process.cwd(), args = "", env = process.env, mode = "installed", role } = {}) {
  const r = resolveProfile({ cwd, args, env, mode });
  if (r.halt) return { ok: false, role, error: r.halt, prints: r.prints, warnings: r.warnings };
  // A blocking dependency stops `plan`; it must stop this too, or an on-demand agent would run
  // against a project the pipeline itself refuses. The preflight's own stdout IS the contract.
  if (r.deps?.abort) return { ok: false, role, error: r.deps.stdout.join("\n"), prints: r.prints, warnings: r.warnings };
  const known = [...r.known_agents].sort();
  if (!known.includes(role)) {
    return { ok: false, role, prints: r.prints, warnings: r.warnings, error: `unknown role '${role}' — known: ${known.join(", ")}` };
  }
  const blocks = r.prompt_blocks[role] ?? { expertise: null, skills: null };
  return {
    ok: true, role, stack: r.stack.foundation, profile_dir: r.profile_dir,
    expertise: r.role_expertise[role] ?? null,
    block: blocks.expertise, skills_block: blocks.skills,
    prints: r.prints, warnings: r.warnings,
  };
}

/**
 * Resolve everything Steps 0 → 1d resolve, in one pass.
 *
 * Returns `{ plan, prints, halt, warnings }`. `halt` is a string when the run cannot proceed —
 * an ambiguous or missing recipe, a schema failure, a blocking dependency. The caller decides
 * what to do with it; this function never exits and never prints.
 *
 * **`warnings[]` is a subset of `prints[]`, not a sibling channel.** Every warning is pushed
 * into both, in generation order. The orchestrator has exactly one obligation — echo `prints[]`
 * — so a warning that lived only in `warnings[]` would reach nobody: the caller sends that
 * array to stderr only in non-JSON mode, and the orchestrator always invokes with `--json`.
 * That is how "⚠️ Failed to parse .sdlc/sdlc.local.yaml" became silent. The duplicate key
 * survives for machine consumers that want the diagnostics without pattern-matching prose.
 */
export function resolvePlan({ cwd = process.cwd(), args = "", env = process.env, mode = "installed" } = {}) {
  const resolved = resolveProfile({ cwd, args, env, mode });
  const { prints, warnings, headless, roots, installs, enabled, deps, stack, local, effective, models } = resolved;
  if (resolved.halt) return { plan: null, prints, warnings, halt: resolved.halt };
  /** Record a diagnostic in both channels — see the note above. */
  const warn = (msg) => { warnings.push(msg); prints.push(msg); };
  const warnAll = (msgs) => { for (const m of msgs) warn(m); };

  // ---- Step 0c: diff signals
  const signals = computeDiffSignals(cwd, { baseRef: opt(args, "--base-ref") });
  if (signals.degraded) warn(`WARN: skip-rule signals unavailable (${signals.reason ?? "git"}) — no rule will fire`);

  // ---- Step 1c: workflow
  const recipes = discoverRecipes({ projectRoot: cwd, installs, enabled });
  const resolvedName = resolveWorkflowName({
    args,
    activeWorkflow: local?.active_workflow ?? null,
    recipes,
    signals: signals.degraded ? null : signals,
    profileDefault: effective.profile_default_workflow,
  });
  warnAll(resolvedName.warnings ?? []);
  if (resolvedName.print) prints.push(resolvedName.print);

  const located = locateRecipe(resolvedName.name, recipes);
  if (!located.recipe) return { plan: null, prints, warnings, halt: located.halt };
  if (located.recipe.error) {
    return { plan: null, prints, warnings, halt: `❌ Workflow '${resolvedName.name}' could not be parsed.\n   ${located.recipe.error}\n   File: ${located.recipe.file}` };
  }

  const schemaErrors = validateWorkflow(located.recipe.doc);
  if (schemaErrors.length) {
    return { plan: null, prints, warnings, halt: `❌ Workflow '${resolvedName.name}' failed schema validation.\n   Errors: ${schemaErrors.join("; ")}\n   File: ${located.recipe.file}` };
  }

  const normalized = normalizePhases(located.recipe.doc.phases);
  const cycleErrors = validateAcyclic(normalized, resolvedName.name, located.recipe.file);
  if (cycleErrors.length) return { plan: null, prints, warnings, halt: `❌ ${cycleErrors.join("\n❌ ")}` };

  // ---- Step 0c applied + Step 1b skip_phases
  const skip = applySkipRules(signals, {
    args,
    phases: normalized.flatMap((p) => (Array.isArray(p.parallel) ? p.parallel : [p.name])),
    forceBa: flag(args, "--force-ba"),
    disabled: flag(args, "--no-skip-rules"),
  });
  const skipPrint = renderSkipPrint(skip.applied);
  if (skipPrint) prints.push(skipPrint);

  const skipNames = [...skip.applied.map((a) => a.phase_skipped), ...(effective.skip_phases ?? [])];
  const built = buildResolvedPhases({ phases: normalized, extraPhases: effective.extra_phases, skipPhases: skipNames, workflowName: resolvedName.name, file: located.recipe.file });
  warnAll(built.warnings);
  if (built.halt) return { plan: null, prints, warnings, halt: built.halt };
  prints.push(renderWorkflowPrint(resolvedName.name, built.phases));

  // A recipe names PHASES; the core manifest binds the agent. A phase nothing binds is not a
  // crash — the orchestrator's 3a skips it — but it must be said before the run, not discovered
  // as a silent gap in telemetry.
  const bound = (name) => {
    const m = effective.agents_per_phase?.[name];
    return typeof m === "string" ? Boolean(m) : Boolean(m && typeof m === "object" && Object.values(m).some(Boolean));
  };
  for (const name of built.phases.flatMap((p) => (Array.isArray(p.parallel) ? p.parallel : [p.name]))) {
    if (!bound(name)) warn(`WARN: phase '${name}' in workflow '${resolvedName.name}' has no agent bound in the core manifest — it will be skipped`);
  }

  // The agents THIS run dispatches: the resolved workflow's phases (after skips, parallel groups
  // flattened) mapped through the core roster. Narrower than `agentsBound(agents_per_phase)`,
  // which also names agents for phases this recipe never runs.
  const dispatchedAgents = new Set();
  for (const name of built.phases.flatMap((p) => (Array.isArray(p.parallel) ? p.parallel : [p.name]))) {
    const mapping = effective.agents_per_phase?.[name];
    if (typeof mapping === "string") dispatchedAgents.add(mapping);
    else if (mapping && typeof mapping === "object") {
      for (const a of Object.values(mapping)) if (typeof a === "string") dispatchedAgents.add(a);
    }
  }

  // ---- Step 1d: cap
  const cap = resolveCostCap({ recipe: located.recipe.doc, workflowName: resolvedName.name, costCaps: effective.cost_caps });
  const capPrint = renderCapOverridePrint(cap, located.recipe.doc);
  if (capPrint) prints.push(capPrint);

  const plan = {
    roots,
    deps_preflight: deps.deps_preflight,
    skills_source: deps.skills_source,
    fs_blind_to: deps.fs_blind_to,
    availability_flags: deps.flags,
    stack: {
      primary_profile: stack.foundation,
      priority: stack.priority,
      additive_profiles: stack.additive,
      // Detected, then held back by `frameworks.disable`. Distinct from simply absent from
      // `additive_profiles`: a run that suppressed a framework and one whose dependency was
      // never there resolve to the same additive list, and telemetry has to tell them apart.
      suppressed_profiles: stack.suppressed ?? [],
      aspects: stack.aspects ?? [],
      // The manifest that decided this run's agents. It was previously derived from
      // `located.recipe.origin` — the WORKFLOW recipe's provenance, a different thing
      // entirely — while telemetry has always documented this field as a manifest path
      // ("android-foundation/manifest.yaml"). Read from the winning foundation now.
      profile_source: stack.source ?? null,
      // The directory `role_expertise` rule paths were resolved against (ADR-0021).
      profile_dir: resolved.profile_dir,
      forced: Boolean(stack.forced),
    },
    skip_rules: { applied: skip.applied, suppressed: skip.suppressed, signals },
    workflow: {
      name: resolvedName.name,
      tier: resolvedName.tier,
      autoselected: resolvedName.autoselected,
      file: located.recipe.file,
      origin: located.recipe.origin ?? null,
      // The names a consumer could have asked for. It is what the not-found halt lists, what
      // tier 1b matches a prose mention against, and the only place the plan says out loud
      // which recipes this machine actually has.
      available: availableNames(recipes),
      shadowed: located.shadowed,
      resolved_phases: built.phases,
    },
    profile: {
      agents_per_phase: effective.agents_per_phase,
      convention_skills: effective.convention_skills,
      phase_prompts_injection: { ...effective.phase_prompts_injection, ...skip.injections },
      post_pipeline_checks: effective.post_pipeline_checks,
      heal_checks: effective.heal_checks,
      phase_command_overrides: effective.phase_command_overrides,
      extension_skills: effective.extension_skills,
      // ADR-0021: the pre-rendered blocks the orchestrator pastes verbatim into each agent's
      // stable prefix (3b-1). The merged `role_expertise` map they are rendered FROM is
      // deliberately not emitted: it was 17,910 of one real plan's 54,746 characters — a third of
      // everything the orchestrator carries before it dispatches anything — and nothing read it.
      // Its one documented consumer was a Step 5 telemetry field that was never written, and what
      // expertise was in force is already recorded by `primary_profile` + `additive_profiles` +
      // `plugin_version`. `resolveExpertise` reads the in-process value, not this output.
      prompt_blocks: resolved.prompt_blocks,
      // The compliance denominator (PR-4). Stated here rather than counted by the orchestrator
      // (ADR-0015), and carried into telemetry so `sdlc-lint compliance` can check that every
      // dispatch in scope received its block. A phase count cannot serve: a review loop
      // dispatches one phase repeatedly.
      //
      // Scope is the agents THIS RUN WILL DISPATCH that have a block — not every agent holding
      // one. `prompt_blocks` deliberately covers the on-demand roster (debugger, devops, cicd,
      // aar-analyst) so `expertise --role` can serve them, but 3b-1a pastes nothing for those:
      // they fetch their own. Counting them would make a `/sdlc:aar` in the same session an
      // expected dispatch that can never match, and report a compliant run as short.
      expertise_block_agents: [...dispatchedAgents]
        .filter((a) => resolved.prompt_blocks[a]?.expertise)
        .sort(),
    },
    models: models.overrides,
    cost_cap: cap.cost_cap,
    cost_cap_source: cap.cost_cap_source,
    headless,
    plugin_version: null,
  };

  // ---- Step 1d-1: the dry-run preview is a rendering of the plan, not a second resolution.
  if (flag(args, "--dry-run")) {
    const tiers = frontmatterTiers(installs, enabled);
    const resume = resolveResume({ cwd, args });
    warnAll(resume.warnings);
    const rows = expandRows(built.phases, { agentsPerPhase: effective.agents_per_phase, modelOverrides: models.overrides, frontmatterTiers: tiers, resumedDone: resume.done });
    // One registry per dispatcher (ADR-0029 decision 7). A host whose file carries no
    // `estimation_baselines` — because none were ever measured there — yields no preview
    // rather than a fabricated one.
    const registryPath = join(roots.sdlc_plugin_root ?? "", "config", "models", `${roots.host ?? "claude"}.yaml`);
    const registry = existsSync(registryPath) ? parseYaml(readFileSync(registryPath, "utf8")) : null;
    if (!registry) {
      warn(`WARN: model registry not found (${registryPath}) — dry-run cost preview unavailable`);
    } else {
      const healEnabled = (effective.heal_checks ?? []).length > 0;
      const est = estimate(rows, registry, { healEnabled });
      // `resumed` reports what the estimate ACTUALLY accounts for, not that the flag was typed. A
      // --resume whose slug found nothing prices a full run; emitting `resumed: true` beside a
      // full-run figure would have a CI consumer read one as the other.
      const anyResumed = est.rows.some((r) => r.resumed);
      const reenterAt = anyResumed ? (est.rows.find((r) => !r.resumed)?.phase ?? null) : null;
      plan.dry_run = {
        rows: est.rows.map((r) => ({ phase: r.phase, aspect: r.aspect ?? null, agent: r.agent, tier: r.tier, est: r.est, resumed: r.resumed === true })),
        expected_total: est.expected_total,
        worst_total: est.worst_total,
        ...(anyResumed ? { resumed: true, resume_slug: resume.slug, reenter_at: reenterAt } : {}),
      };
      prints.push(headless
        ? renderHeadlessDryRun({ estimate: est, slots: built.phases.length, workflow: resolvedName.name, cap: cap.cost_cap, resumed: anyResumed, reenterAt })
        : renderDryRun({
          estimate: est, slots: built.phases.length, stack: stack.foundation, workflow: resolvedName.name,
          autoselected: resolvedName.autoselected, skipRules: skip.applied, cap: cap.cost_cap,
          healEnabled, healBlocks: rows.filter((r) => r.heal).length, resume,
        }));
    }
  }

  return { plan, prints, warnings, halt: deps.abort ? deps.stdout.join("\n") : null, deps_abort: deps.abort };
}
