// The composition, end to end, over a synthetic consumer built on disk: a config dir with an
// installed+enabled plugin, a project with its own overrides and recipe, and a real git repo so
// the diff signals resolve. This is the test that would have caught the two `[object Object]`
// defects the unit fixtures missed, because it runs the same path a consumer does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlan, resolveExpertise } from "../../../plugins/sdlc/tools/resolve/plan.mjs";

function write(file, content) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

/** A consumer machine: config dir + one installed plugin + a git project. */
function world({ localYaml = null, modelJson = null, recipe = null, roleExpertise = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-plan-"));
  const cfg = join(dir, "cfg");
  const plug = join(dir, "cache", "demo", "1.0.0");
  const core = join(dir, "cache", "sdlc", "1.0.0");
  const proj = join(dir, "project");

  write(join(plug, "manifest.yaml"), [
    "kind: foundation",
    "stack: demo",
    "priority: 300",
    "aspects: [demo]",
    "workflow: demo-flow",
    "detect:",
    "  file_exists: marker.txt",
    "hosts_aspects: all",
    ...(roleExpertise ? [
      // ADR-0021 shape: the foundation binds NO agents; it declares expertise per core role.
      "role_expertise:",
      "  developer:",
      "    invariants: |",
      "      Demo house rule: never block main.",
      "    rules:",
      "      - { path: rules/house.md, note: \"house rules\" }",
      "    skills:",
      "      - { skill: superpowers:test-driven-development, when: \"before the first edit\" }",
      "      - { skill: demo:zed, policy: recommended }",
      "  debugger:",
      "    invariants: |",
      "      Demo debugging rule.",
    ] : [
      "agents_per_phase:",
      "  business_analysis: demo-ba",
      "  development: demo-dev",
      "  qa: demo-qa",
      "  documentation: demo-docs",
    ]),
    "post_pipeline_checks:",
    '  - "echo plugin-check"',
    "",
  ].join("\n"));
  if (roleExpertise) write(join(plug, "rules", "house.md"), "# house rules\n");
  write(join(plug, "agents", "demo-ba.md"), "---\nname: demo-ba\nmodel: opus\n---\n");
  write(join(plug, "agents", "demo-dev.md"), "---\nname: demo-dev\nmodel: sonnet\n---\n");
  write(join(plug, "workflows", "demo-flow.yaml"), recipe ?? [
    "name: demo-flow",
    "phases:",
    "  - business_analysis",
    "  - development",
    "  - parallel:",
    "      - qa",
    "      - documentation",
    "caps:",
    "  max_total_cost_usd: 20",
    "",
  ].join("\n"));
  write(join(core, "config", "models.json"), JSON.parse(JSON.stringify({
    pipeline_tiers: ["opus", "sonnet", "haiku", "fable"],
    cache_write_multipliers: { ephemeral_5m: 1.25 },
    estimation_baselines: {
      opus: { input: 30, cache_read: 670000, cache_write: 93000, output: 1125 },
      sonnet: { input: 25, cache_read: 725000, cache_write: 73000, output: 1230 },
      haiku: { input: 195, cache_read: 820000, cache_write: 51000, output: 30 },
    },
    models: [
      { tag: "opus", model_id: "m-opus", pricing: { input: 5, cached_input: 0.5, output: 25 } },
      { tag: "sonnet", model_id: "m-sonnet", pricing: { input: 3, cached_input: 0.3, output: 15 } },
      { tag: "haiku", model_id: "m-haiku", pricing: { input: 1, cached_input: 0.1, output: 5 } },
    ],
  })));
  write(join(plug, "runtime-dependencies.json"), { dependencies: [] });

  // The core plugin is a real participant, not scaffolding: it owns the model registry, and it
  // is the `vanilla` foundation every stack profile falls back to for an unclaimed phase.
  write(join(core, "manifest.yaml"), [
    "kind: foundation", "stack: vanilla", "priority: 0", "aspects: [vanilla]",
    "detect:", '  any: ["*"]', "hosts_aspects: all",
    "agents_per_phase:",
    "  documentation: core-docs",
    "  business_analysis: business-analyst",
    "  development: developer",
    "  qa: qa-engineer",
    "on_demand_agents: [debugger]",
    "",
  ].join("\n"));
  write(join(core, "agents", "developer.md"), "---\nname: developer\nmodel: sonnet\n---\n");
  write(join(core, "runtime-dependencies.json"), { dependencies: [] });

  write(join(cfg, "settings.json"), { enabledPlugins: { "demo@m": true, "sdlc@m": true } });
  write(join(cfg, "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      "demo@m": [{ scope: "user", installPath: plug, version: "1.0.0" }],
      "sdlc@m": [{ scope: "user", installPath: core, version: "1.0.0" }],
    },
  });

  write(join(proj, "marker.txt"), "detect me\n");
  if (localYaml) write(join(proj, ".claude", "sdlc.local.yaml"), localYaml);
  if (modelJson) write(join(proj, ".claude", "model.local.json"), modelJson);

  const g = (...a) => execFileSync("git", a, { cwd: proj, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  g("add", "-A"); g("commit", "-qm", "seed");
  g("update-ref", "refs/remotes/origin/main", "HEAD");

  // Two ordinary source changes, so no skip-rule fires and the plan stays full.
  write(join(proj, "src.txt"), Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n"));
  g("add", "-A"); g("commit", "-qm", "work");

  return { dir, cfg, proj, plug, core, env: { HOME: dir, CLAUDE_CONFIG_DIR: cfg } };
}

test("end to end: detection, profile, workflow and cap resolve into one plan", () => {
  const w = world();
  try {
    const { plan, halt, prints } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    assert.equal(halt, null);
    assert.equal(plan.stack.primary_profile, "demo");
    assert.equal(plan.workflow.name, "demo-flow");
    assert.equal(plan.workflow.tier, "profile_default", "the manifest's own workflow: is the fallback tier");
    assert.deepEqual(plan.workflow.resolved_phases.map((p) => p.name ?? "parallel"), ["business_analysis", "development", "parallel"]);
    assert.equal(plan.cost_cap, 20);
    assert.equal(plan.cost_cap_source, "recipe");
    assert.deepEqual(plan.profile.post_pipeline_checks, ["echo plugin-check"]);
    assert.ok(prints.some((p) => p.includes("workflow: demo-flow")));
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("project overrides reach the plan, and the cap override is announced", () => {
  const w = world({
    localYaml: [
      "post_pipeline_checks:",
      '  - "echo project-check"',
      "cost_caps:",
      "  demo-flow: 3.5",
      "extra_phase_prompts:",
      "  development: |",
      "    Project rule: use the local runner.",
      "",
    ].join("\n"),
    modelJson: { default: "haiku" },
  });
  try {
    const { plan, prints } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    assert.deepEqual(plan.profile.post_pipeline_checks, ["echo project-check"], "REPLACE, not append");
    assert.equal(plan.cost_cap, 3.5);
    assert.equal(plan.cost_cap_source, "project:demo-flow");
    assert.match(plan.profile.phase_prompts_injection.development, /Project rule: use the local runner\./);
    assert.equal(plan.models.default, "haiku");
    assert.ok(prints.some((p) => p.includes("Cost cap overridden")));
    assert.ok(prints.some((p) => p.includes("Model tier overrides")));
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("--workflow beats the profile default, and an unknown name halts with the available list", () => {
  const w = world();
  try {
    const missing = resolvePlan({ cwd: w.proj, args: "--workflow=nope", env: w.env });
    assert.equal(missing.plan, null);
    assert.match(missing.halt, /Workflow 'nope' not found/);
    assert.match(missing.halt, /demo-flow/);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a schema-invalid recipe halts with the violations, not a stack trace", () => {
  const w = world({ recipe: "name: demo-flow\nphases: []\n" });
  try {
    const { plan, halt } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    assert.equal(plan, null);
    assert.match(halt, /failed schema validation/);
    assert.match(halt, /'phases' must be a non-empty array/);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("--dry-run prices every dispatch row, including parallel members", () => {
  const w = world();
  try {
    const { plan, prints } = resolvePlan({ cwd: w.proj, args: "--dry-run", env: w.env });
    assert.equal(plan.dry_run.rows.length, 4, "3 slots, 4 dispatches — the parallel group expands");
    assert.ok(plan.dry_run.expected_total > 0);
    const block = prints.find((p) => p.startsWith("🔎 DRY RUN"));
    assert.ok(block, "the human preview is printed");
    assert.ok(!/\[object Object\]/.test(block), "an agent is never rendered as its mapping object");
    assert.match(block, /Cap: \$20\.00 {2}→ WITHIN/);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("headless --dry-run emits the machine line instead of the block", () => {
  const w = world();
  try {
    const { prints } = resolvePlan({ cwd: w.proj, args: "--dry-run", env: { ...w.env, SDLC_NONINTERACTIVE: "true" } });
    const line = prints.find((p) => p.startsWith("{"));
    assert.ok(line, "CI gets one machine-readable line");
    const parsed = JSON.parse(line);
    assert.equal(parsed.dry_run, true);
    assert.equal(parsed.cap_estimate, "within");
    assert.ok(!prints.some((p) => p.startsWith("🔎 DRY RUN")), "and not the human block as well");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a skip-rule removes a phase and says so, once", () => {
  const w = world({
    recipe: "name: demo-flow\nphases:\n  - business_analysis\n  - development\n  - security\n",
  });
  try {
    // A tiny diff with no migrations and no sensitive paths fires lightweight-no-db.
    execFileSync("git", ["rm", "-q", "src.txt"], { cwd: w.proj, stdio: "ignore" });
    execFileSync("git", ["commit", "-qm", "shrink"], { cwd: w.proj, stdio: "ignore" });
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: w.proj, stdio: "ignore" });
    writeFileSync(join(w.proj, "tiny.txt"), "one line\n");
    execFileSync("git", ["add", "-A"], { cwd: w.proj, stdio: "ignore" });
    execFileSync("git", ["commit", "-qm", "tiny"], { cwd: w.proj, stdio: "ignore" });

    const { plan, prints } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    assert.ok(plan.skip_rules.applied.some((a) => a.phase_skipped === "security"));
    assert.ok(!plan.workflow.resolved_phases.some((p) => p.name === "security"), "the skipped phase leaves the plan");
    assert.equal(prints.filter((p) => p.startsWith("✂️")).length, 1);
    assert.match(plan.profile.phase_prompts_injection.development, /SECURITY-LITE MODE/, "skipping security owes the developer a check");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a disabled plugin drops out of detection entirely", () => {
  const w = world();
  try {
    write(join(w.cfg, "settings.json"), { enabledPlugins: { "demo@m": false, "sdlc@m": true } });
    const { plan, halt } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    // vanilla still detects (its rule is `*`), but the demo recipe went with the plugin, so the
    // run cannot be planned — a disabled foundation must not quietly keep supplying its workflow.
    assert.equal(plan, null);
    assert.match(halt, /not found/);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("every warning reaches prints[], because prints[] is the orchestrator's only obligation", () => {
  // Review finding 3 on #121: `warnings[]` was a sibling channel the caller wrote to stderr in
  // non-JSON mode only — and the orchestrator always invokes with --json. A project whose
  // sdlc.local.yaml failed to parse therefore ran on plugin defaults with nothing said.
  const w = world({ localYaml: "post_pipeline_checks:\n\t- broken tab\n" });
  try {
    const { plan, prints, warnings } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    const parseWarning = warnings.find((x) => x.includes("Failed to parse .claude/sdlc.local.yaml"));
    assert.ok(parseWarning, "the unparseable override file is reported");
    assert.ok(prints.includes(parseWarning), "and it is in the channel that actually reaches the user");
    assert.deepEqual(plan.profile.post_pipeline_checks, ["echo plugin-check"], "the run continues on plugin defaults");
    for (const x of warnings) assert.ok(prints.includes(x), `warning not echoed: ${x}`);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("the stack banner is printed on an ordinary run", () => {
  const w = world();
  try {
    const { prints } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    const banner = prints.find((p) => p.startsWith("🎯 Active stack profiles:"));
    assert.ok(banner, "without it the user cannot tell a wrong detection from a right one");
    assert.match(banner, /primary: {2}demo \(priority 300, from demo\/manifest\.yaml\)/);
    assert.match(banner, /forced via --stack: no/);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("profile_source is the winning foundation's manifest, not the workflow recipe's origin", () => {
  const w = world();
  try {
    const { plan } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    assert.equal(plan.stack.profile_source, "demo/manifest.yaml");
    assert.equal(plan.stack.priority, 300, "the key map promises priority, so the plan must carry it");
    assert.equal(plan.workflow.origin, "plugin", "recipe provenance keeps its own field");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("--stack forces the profile, and an unknown one halts instead of falling back to vanilla", () => {
  const w = world();
  try {
    const forced = resolvePlan({ cwd: w.proj, args: "--stack=vanilla --workflow=demo-flow", env: w.env });
    assert.equal(forced.halt, null);
    assert.equal(forced.plan.stack.primary_profile, "vanilla", "demo detects at priority 300 and is overridden anyway");
    assert.equal(forced.plan.stack.forced, true);

    const bogus = resolvePlan({ cwd: w.proj, args: "--stack=cobol", env: w.env });
    assert.equal(bogus.plan, null);
    assert.match(bogus.halt, /--stack=cobol: no installed foundation declares that stack/);
    assert.match(bogus.halt, /demo, vanilla/);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

// ---- ADR-0021: agents live in the core; foundations carry expertise -------------------------

test("role_expertise reaches the plan as absolute rule paths and pre-rendered prompt blocks", () => {
  const w = world({ roleExpertise: true });
  try {
    const { plan, halt, warnings } = resolvePlan({ cwd: w.proj, args: "--dry-run", env: w.env });
    assert.equal(halt, null);
    assert.deepEqual(warnings.filter((x) => /agents_per_phase/.test(x)), [], "an expertise-only foundation earns no deprecation warning");
    assert.equal(plan.stack.profile_dir, w.plug, "the directory the rule paths were resolved against");
    assert.deepEqual(plan.profile.agents_per_phase.development, { demo: "developer" }, "the core agent, fanned out over the foundation's aspect");

    const rx = plan.profile.role_expertise.developer;
    assert.equal(rx.rules[0].path, join(w.plug, "rules", "house.md"), "relative in the manifest, absolute in the plan");

    const dev = plan.profile.prompt_blocks.developer;
    assert.match(dev.expertise, /^Stack expertise for developer \(demo\):\nDemo house rule: never block main\./);
    assert.ok(dev.expertise.includes(`- ${join(w.plug, "rules", "house.md")} — house rules`));
    assert.match(dev.skills, /^Skills for this role/);
    assert.match(dev.skills, /\n- MANDATORY — invoke `superpowers:test-driven-development` — before the first edit\./);
    assert.ok(dev.skills.indexOf("MANDATORY") < dev.skills.indexOf("RECOMMENDED"), "mandatory rows first");

    assert.ok("debugger" in plan.profile.prompt_blocks, "on-demand agents get a block too — the expertise command serves them");
    assert.equal(plan.profile.prompt_blocks["qa-engineer"].expertise, null, "a role the stack says nothing about gets no header");
    assert.ok(plan.dry_run.rows.every((r) => !/^demo-/.test(r.agent)), "every dispatch row names a core agent");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a foundation still binding its own roster is warned about where the user can see it", () => {
  const w = world();
  try {
    const { prints } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    assert.ok(prints.some((p) => /WARN: foundation 'demo' declares agents_per_phase — deprecated \(ADR-0021\)/.test(p)));
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a recipe phase that resolves to no agent is warned about, not crashed on", () => {
  const w = world({ recipe: "name: demo-flow\nphases:\n  - business_analysis\n  - review\n  - development\n" });
  try {
    const { plan, warnings } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    assert.ok(plan, "the run still plans — the orchestrator's 3a skips the phase");
    assert.ok(warnings.some((x) => /WARN: phase 'review' in workflow 'demo-flow' has no agent bound/.test(x)), warnings.join("\n"));
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("resolveExpertise serves an on-demand agent one block, refuses an unknown role, and is empty on vanilla", () => {
  const w = world({ roleExpertise: true });
  try {
    const dbg = resolveExpertise({ cwd: w.proj, args: "", env: w.env, role: "debugger" });
    assert.equal(dbg.ok, true);
    assert.equal(dbg.stack, "demo");
    assert.match(dbg.block, /^Stack expertise for debugger \(demo\):\nDemo debugging rule\./);
    assert.equal(dbg.skills_block, null);

    const dev = resolveExpertise({ cwd: w.proj, args: "", env: w.env, role: "developer" });
    assert.ok(dev.block.includes(join(w.plug, "rules", "house.md")));
    assert.match(dev.skills_block, /MANDATORY — invoke `superpowers:test-driven-development`/);

    const bogus = resolveExpertise({ cwd: w.proj, args: "", env: w.env, role: "bogus" });
    assert.equal(bogus.ok, false);
    assert.match(bogus.error, /unknown role 'bogus'/);
    assert.match(bogus.error, /known: .*debugger.*developer/);

    const vanilla = resolveExpertise({ cwd: w.proj, args: "--stack=vanilla", env: w.env, role: "developer" });
    assert.equal(vanilla.ok, true);
    assert.equal(vanilla.block, null, "nothing to say — the caller prints the 'no stack expertise' line");
    assert.equal(vanilla.stack, "vanilla");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a core role resolves even while a foundation still binds its own roster, and so does the bound name", () => {
  // The defect this pins: `known_agents` built from the EFFECTIVE (foundation-bound) roster made
  // every core role's on-demand bootstrap fail with 'unknown role' on any project whose foundation
  // binds agents. The valid set is exactly what carries a prompt block: dispatched ∪ core.
  const w = world();   // the demo foundation binds demo-ba / demo-dev / demo-qa / demo-docs
  try {
    const core = resolveExpertise({ cwd: w.proj, args: "", env: w.env, role: "developer" });
    assert.equal(core.ok, true, core.error);
    const bound = resolveExpertise({ cwd: w.proj, args: "", env: w.env, role: "demo-dev" });
    assert.equal(bound.ok, true, "a name this run actually dispatches is valid too");

    const { plan } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    assert.ok("demo-dev" in plan.profile.prompt_blocks, "the dispatched agent must have a block to paste");
    assert.ok("developer" in plan.profile.prompt_blocks, "and so must every core role");
    assert.equal(plan.profile.prompt_blocks["demo-dev"].expertise, null, "the foundation declares no role_expertise here");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a config naming an agent that does not exist is reported in prints, and the run continues", () => {
  const w = world({
    localYaml: [
      "extensions:", "  skills:",
      '    - skill: "acme:x"', "      agents: [android-developer]",
      '    - skill: "acme:y"', "      agents: [developer]",
      "",
    ].join("\n"),
    modelJson: { agents: { "android-ba": "opus" } },
  });
  try {
    const { plan, prints, warnings } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    assert.ok(plan, "an un-migrated config degrades, it never stops the run");
    assert.deepEqual(plan.profile.extension_skills.map((r) => r.skill), ["acme:y"]);
    assert.deepEqual(plan.models.agents, {}, "the unknown key is dropped, the rest of the file survives");
    for (const w2 of warnings) assert.ok(prints.includes(w2), `warning not echoed: ${w2}`);
    assert.ok(prints.some((p) => /extensions\.skills\[0\] targets unknown agent 'android-developer'/.test(p)), prints.join("\n"));
    assert.ok(prints.some((p) => /model\.local\.json names unknown agent 'android-ba'/.test(p)), prints.join("\n"));
    assert.ok(prints.some((p) => /run \/sdlc:doctor/.test(p)), "the report names the command that fixes it");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("cli.mjs expertise --role prints the block, exits 2 on an unknown role, and says so on vanilla", () => {
  const w = world({ roleExpertise: true });
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugins", "sdlc", "tools", "resolve", "cli.mjs");
  const run = (argv) => {
    try {
      return { code: 0, out: execFileSync("node", [cli, ...argv], { cwd: w.proj, env: { ...process.env, ...w.env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) { return { code: e.status, out: String(e.stdout ?? ""), err: String(e.stderr ?? "") }; }
  };
  try {
    const dev = run(["expertise", "--role", "developer"]);
    assert.equal(dev.code, 0);
    assert.match(dev.out, /^Stack expertise for developer \(demo\):/m);
    assert.match(dev.out, /Skills for this role/);

    const json = run(["expertise", "--role", "debugger", "--json"]);
    assert.equal(json.code, 0);
    const parsed = JSON.parse(json.out);
    assert.equal(parsed.ok, true);
    assert.match(parsed.block, /^Stack expertise for debugger/);

    const bogus = run(["expertise", "--role", "bogus"]);
    assert.equal(bogus.code, 2);
    assert.match(bogus.err, /unknown role 'bogus'/);

    const vanilla = run(["expertise", "--role", "developer", "--stack=vanilla"]);
    assert.equal(vanilla.code, 0);
    assert.match(vanilla.out, /^no stack expertise for developer \(stack: vanilla\)$/m);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});
