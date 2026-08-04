// The composition — Steps 0 → 1d run end to end, producing one resolved plan.
//
// The module map in the spec put "no I/O of its own" on plan.mjs and left the sequencing to
// cli.mjs. That split is wrong in one direction: the ORDER of these steps is itself logic
// (roots before manifests, manifests before deps, signals before workflow auto-selection), and
// logic in a CLI entry point is logic nobody tests. So the sequencing lives here and `cli.mjs`
// keeps the property that actually matters — it is the only unit that prints.
//
// Every step's own module does its own reading. This function owns the order and the assembly.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveRoots } from "./roots.mjs";
import { readInstalledPlugins, readEnabledPlugins, loadInstalledManifests, loadManifestsFromTree } from "./manifests.mjs";
import { resolveStack } from "./detect.mjs";
import { preflight } from "./deps.mjs";
import { computeDiffSignals, applySkipRules, renderSkipPrint } from "./skiprules.mjs";
import { mergeProfiles, applyLocalOverrides, parseModelOverrides, renderOverridesPrint, renderModelPrint, renderStackPrint } from "./profile.mjs";
import { discoverRecipes, resolveWorkflowName, locateRecipe, validateWorkflow, normalizePhases, validateAcyclic, buildResolvedPhases, renderWorkflowPrint } from "./workflow.mjs";
import { resolveCostCap, renderCapOverridePrint, expandRows, estimate, renderDryRun, renderHeadlessDryRun } from "./caps.mjs";
import { parseYaml } from "./yaml.mjs";

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

const flag = (args, name) => new RegExp(`(^|\\s)${name}(\\s|=|$)`).test(String(args));
const opt = (args, name) => (new RegExp(`${name}=([^\\s]+)`).exec(String(args)) ?? [])[1] ?? null;

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
 * That is how "⚠️ Failed to parse .claude/sdlc.local.yaml" became silent. The duplicate key
 * survives for machine consumers that want the diagnostics without pattern-matching prose.
 */
export function resolvePlan({ cwd = process.cwd(), args = "", env = process.env, mode = "installed" } = {}) {
  const prints = [];
  const warnings = [];
  /** Record a diagnostic in both channels — see the note above. */
  const warn = (msg) => { warnings.push(msg); prints.push(msg); };
  const warnAll = (msgs) => { for (const m of msgs) warn(m); };
  const headless = env.SDLC_NONINTERACTIVE === "true" || env.SDLC_NONINTERACTIVE === "1";

  // ---- Step 0: roots
  const roots = resolveRoots(env);
  const configDir = roots.config_dir;

  // ---- Step 0b inputs: what is installed and enabled
  const { installs, conflicts } = readInstalledPlugins({ configDir });
  const enabled = readEnabledPlugins({ configDir, projectRoot: cwd });
  for (const c of conflicts) warn(`WARN: ${c.key} is installed at several paths; using the ${c.scope} copy (${c.chosen})`);

  const manifests = mode === "tree" ? loadManifestsFromTree(cwd) : loadInstalledManifests({ configDir, projectRoot: cwd });
  for (const s of manifests.skipped ?? []) warn(`WARN: ${s.key} ships a manifest but is disabled — not considered for detection`);
  for (const e of manifests.errors ?? []) warn(`WARN: unreadable manifest ${e.file}: ${e.error}`);

  // ---- Step 0a: dependency preflight
  const deps = preflight({ configDir, projectRoot: cwd, installs, enabled, headless, force: flag(args, "--force-preflight"), skills: opt(args, "--skills") });
  prints.push(...deps.prints);

  // ---- Step 0b: detection (`--stack=NAME` skips it, per 0b-2)
  const forcedStack = opt(args, "--stack");
  const stack = resolveStack(cwd, manifests, { forceStack: forcedStack });
  if (stack.forced_unresolved) {
    const known = stack.known_stacks.length ? stack.known_stacks.join(", ") : "none installed";
    return {
      plan: null, prints, warnings,
      halt: `❌ --stack=${stack.forced_unresolved}: no installed foundation declares that stack.\n   Installed foundations: ${known}`,
    };
  }
  const primary = manifests.foundations.find((f) => f.doc?.stack === stack.foundation)?.doc ?? null;
  const vanilla = manifests.foundations.find((f) => f.doc?.stack === "vanilla")?.doc ?? null;
  const additive = manifests.frameworks.filter((f) => stack.additive.includes(f.doc?.stack)).map((f) => f.doc);
  const stackPrint = renderStackPrint(stack);
  if (stackPrint) prints.push(stackPrint);

  // ---- Step 0c: diff signals
  const signals = computeDiffSignals(cwd, { baseRef: opt(args, "--base-ref") });
  if (signals.degraded) warn(`WARN: skip-rule signals unavailable (${signals.reason ?? "git"}) — no rule will fire`);

  // ---- Step 1: profile merge + project overrides
  const activeByAspect = primary ? { [primary.aspects?.[0] ?? stack.foundation]: primary } : {};
  const { profile: base, errors: mergeErrors } = mergeProfiles({ primary, active: activeByAspect, additive, vanilla });
  for (const e of mergeErrors) warn(`WARN: ${e.message}`);

  const localPath = join(cwd, ".claude", "sdlc.local.yaml");
  let local = null;
  if (existsSync(localPath)) {
    local = readYaml(localPath);
    if (local?.__error) {
      warn(`⚠️ Failed to parse .claude/sdlc.local.yaml: ${local.__error}. Continuing with plugin defaults.`);
      local = null;
    }
  }
  const overridden = applyLocalOverrides(base, local, {
    availableSkills: deps.available_skills,
    unavailablePlugins: deps.flags,
  });
  warnAll(overridden.warnings);
  const effective = overridden.profile;
  const overridesPrint = renderOverridesPrint(overridden.applied);
  if (overridesPrint) prints.push(overridesPrint);

  const modelJson = readJson(join(cwd, ".claude", "model.local.json"));
  const models = parseModelOverrides(modelJson);
  warnAll(models.warnings);
  const modelPrint = renderModelPrint(models.overrides);
  if (modelPrint) prints.push(modelPrint);

  // ---- Step 1c: workflow
  const recipes = discoverRecipes({ projectRoot: cwd, installs, enabled });
  const resolvedName = resolveWorkflowName({
    args,
    activeWorkflow: local?.active_workflow ?? null,
    recipes,
    signals: signals.degraded ? null : signals,
    profileDefault: effective.profile_default_workflow,
  });
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
      aspects: stack.aspects ?? [],
      // The manifest that decided this run's agents. It was previously derived from
      // `located.recipe.origin` — the WORKFLOW recipe's provenance, a different thing
      // entirely — while telemetry has always documented this field as a manifest path
      // ("android-foundation/manifest.yaml"). Read from the winning foundation now.
      profile_source: stack.source ?? null,
      forced: Boolean(stack.forced),
    },
    skip_rules: { applied: skip.applied, suppressed: skip.suppressed, signals },
    workflow: {
      name: resolvedName.name,
      tier: resolvedName.tier,
      autoselected: resolvedName.autoselected,
      file: located.recipe.file,
      origin: located.recipe.origin ?? null,
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
    const rows = expandRows(built.phases, { agentsPerPhase: effective.agents_per_phase, modelOverrides: models.overrides, frontmatterTiers: tiers });
    const registry = readJson(join(roots.sdlc_plugin_root ?? "", "config", "models.json"));
    if (!registry) {
      warn("WARN: model registry not found — dry-run cost preview unavailable");
    } else {
      const healEnabled = (effective.heal_checks ?? []).length > 0;
      const est = estimate(rows, registry, { healEnabled });
      plan.dry_run = {
        rows: est.rows.map((r) => ({ phase: r.phase, aspect: r.aspect ?? null, agent: r.agent, tier: r.tier, est: r.est })),
        expected_total: est.expected_total,
        worst_total: est.worst_total,
      };
      prints.push(headless
        ? renderHeadlessDryRun({ estimate: est, slots: built.phases.length, workflow: resolvedName.name, cap: cap.cost_cap })
        : renderDryRun({
          estimate: est, slots: built.phases.length, stack: stack.foundation, workflow: resolvedName.name,
          autoselected: resolvedName.autoselected, skipRules: skip.applied, cap: cap.cost_cap,
          healEnabled, healBlocks: rows.filter((r) => r.heal).length,
        }));
    }
  }

  return { plan, prints, warnings, halt: deps.abort ? deps.stdout.join("\n") : null, deps_abort: deps.abort };
}
