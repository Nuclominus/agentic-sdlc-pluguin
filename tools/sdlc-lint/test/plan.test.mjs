// The composition, end to end, over a synthetic consumer built on disk: a config dir with an
// installed+enabled plugin, a project with its own overrides and recipe, and a real git repo so
// the diff signals resolve. This is the test that would have caught the two `[object Object]`
// defects the unit fixtures missed, because it runs the same path a consumer does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlan, resolveExpertise, resolveResume } from "../../../plugins/sdlc/tools/resolve/plan.mjs";

function write(file, content) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

/** A consumer machine: config dir + one installed plugin + a git project. */
function world({ localYaml = null, modelJson = null, recipe = null, roleExpertise = false, frameworks = false } = {}) {
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
    // ADR-0026: two providers contesting one aspect, both coordinates present — the mid-migration
    // shape `frameworks.disable` exists for (issue #197).
    ...(frameworks ? [
      "framework_detection: [\"deps.txt\"]",
      "frameworks:",
      "  - stack: alpha",
      "    enriches_aspect: network",
      "    dependency: com.example:alpha",
      "    phase_injections: { development: \"ALPHA RULES\" }",
      "  - stack: beta",
      "    enriches_aspect: network",
      "    dependency: com.example:beta",
      "    phase_injections: { development: \"BETA RULES\" }",
    ] : []),
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
  write(join(core, "config", "models", "claude.yaml"), [
    "provider: anthropic",
    "pipeline_tiers: [opus, sonnet, haiku, fable]",
    "cache_write_multipliers:",
    "  ephemeral_5m: 1.25",
    "estimation_baselines:",
    "  opus:   { input: 30,  cache_read: 670000, cache_write: 93000, output: 1125 }",
    "  sonnet: { input: 25,  cache_read: 725000, cache_write: 73000, output: 1230 }",
    "  haiku:  { input: 195, cache_read: 820000, cache_write: 51000, output: 30 }",
    "models:",
    "  - tag: opus",
    "    model_id: m-opus",
    "    pricing: { input: 5, cached_input: 0.5, output: 25 }",
    "  - tag: sonnet",
    "    model_id: m-sonnet",
    "    pricing: { input: 3, cached_input: 0.3, output: 15 }",
    "  - tag: haiku",
    "    model_id: m-haiku",
    "    pricing: { input: 1, cached_input: 0.1, output: 5 }",
    "",
  ].join("\n"));
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
  if (frameworks) write(join(proj, "deps.txt"), "com.example:alpha:1.0\ncom.example:beta:1.0\n");
  if (localYaml) write(join(proj, ".sdlc", "sdlc.local.yaml"), localYaml);
  if (modelJson) write(join(proj, ".sdlc", "model.local.json"), modelJson);

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

/**
 * A consumer that has installed NOTHING: a fresh config dir, no registry, no cache — and a host
 * that loaded this plugin without exporting `CLAUDE_PLUGIN_ROOT`. That is `claude plugin eval`
 * (issue #173), and it is also a bare `node tools/resolve/cli.mjs` against a checkout.
 */
function bareWorld() {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-bare-"));
  const proj = join(dir, "project");
  write(join(proj, "README.md"), "# demo\n");

  const g = (...a) => execFileSync("git", a, { cwd: proj, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  g("add", "-A"); g("commit", "-qm", "seed");
  g("update-ref", "refs/remotes/origin/main", "HEAD");

  // A diff big enough that no skip-rule trims the recipe — the preview must be the full six.
  write(join(proj, "src.txt"), Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n"));
  g("add", "-A"); g("commit", "-qm", "work");

  return { dir, proj, env: { HOME: dir, CLAUDE_CONFIG_DIR: join(dir, "cfg") } };
}

test("a registered install is never displaced by the checkout, however partial it is", () => {
  // Two definitions of "the consumer has an install" must not disagree. `resolveSdlcRoot`'s
  // registry branch additionally requires config/models.json; gating the self root on that alone
  // let a PARTIAL sdlc entry keep its place in discovery while self-referential reads moved to
  // whatever checkout was executing — two trees, one run, and a checkout announced to a consumer
  // that never loaded it. The registry either lists this plugin or it does not.
  const w = bareWorld();
  try {
    const partial = join(w.dir, "partial-install");
    write(join(partial, "README.md"), "an install that lost its config/\n");
    write(join(w.dir, "cfg", "plugins", "installed_plugins.json"), {
      version: 2,
      plugins: { "sdlc@m": [{ scope: "user", installPath: partial, version: "2.4.1" }] },
    });
    const { warnings } = resolvePlan({ cwd: w.proj, args: "--dry-run", env: w.env });
    assert.deepEqual(
      warnings.filter((x) => /loaded from a path/.test(x)), [],
      "the consumer's own entry stands; repairing it is /sdlc:doctor's job, not a silent swap",
    );
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("issue #173: with nothing installed and nothing exported, the checkout resolves its own plan", () => {
  // The regression this guards: every registry-keyed discovery was blind to the tree the code
  // was running from, so the run halted with "Workflow 'default' not found. Available: (none)"
  // while default.yaml sat next to the code printing it. Under `claude plugin eval` that halt
  // hit every should-fire case of plugins/sdlc/evals/.
  const w = bareWorld();
  try {
    const { plan, halt } = resolvePlan({ cwd: w.proj, args: "--dry-run", env: w.env });
    assert.equal(halt, null, "the recipe is found in the tree the code is executing from");
    assert.equal(plan.stack.primary_profile, "vanilla");
    assert.equal(plan.workflow.name, "default");
    assert.equal(plan.workflow.resolved_phases.length, 6);
    assert.ok(plan.dry_run.expected_total > 0, "config/models.json resolves from that same tree");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("issue #176: the recipe the request names is the recipe the plan prices", () => {
  // The defect: "would the docs-only workflow fit under its cost cap?" resolved `default` — six
  // phases and a $16.00 cap — and answered the cap question for a pipeline nobody asked about.
  // `docs-only` carries `match.config_only`, a condition on the DIFF, so auto-selection can never
  // reach it from prose; naming it is the explicit request, and tier 1b is where that lands.
  const w = bareWorld();
  try {
    const { plan, halt, prints } = resolvePlan({
      cwd: w.proj,
      args: "Would the docs-only SDLC workflow for 'Document the growth log screen' fit under its cost cap? --dry-run",
      env: w.env,
    });
    assert.equal(halt, null);
    assert.equal(plan.workflow.name, "docs-only");
    assert.equal(plan.workflow.tier, "named_in_prose");
    assert.deepEqual(plan.workflow.resolved_phases.map((p) => p.name), ["documentation"]);
    assert.ok(
      prints.some((p) => p.includes("🧭 Recipe 'docs-only' named in the request")),
      "the substitution the old behaviour made silently is now announced",
    );
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("the plan carries the recipe names a consumer could name", () => {
  const w = bareWorld();
  try {
    const { plan } = resolvePlan({ cwd: w.proj, args: "--dry-run", env: w.env });
    for (const name of ["default", "docs-only", "hotfix", "bugfix", "refactor", "analysis", "testing", "debug"]) {
      assert.ok(plan.workflow.available.includes(name), `'${name}' is discoverable and must be listed`);
    }
    assert.deepEqual(plan.workflow.available, [...plan.workflow.available].sort(), "sorted, so it is stable to diff");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

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
    const parseWarning = warnings.find((x) => x.includes("Failed to parse .sdlc/sdlc.local.yaml"));
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

    // The merged `role_expertise` map is NOT emitted. It is the unrendered input to the blocks
    // below, and measuring one real run showed nothing reads it: 17,910 of the plan JSON's 54,746
    // characters — a third of everything the orchestrator carries at start — for a key whose only
    // documented consumer was a telemetry field Step 5 never wrote. What was in force is already
    // recorded by `primary_profile`, `additive_profiles` and `plugin_version`.
    assert.ok(!("role_expertise" in plan.profile),
      "the rendered blocks are the contract; the map they were rendered from is not carried");

    const dev = plan.profile.prompt_blocks.developer;
    assert.match(dev.expertise, /^Stack expertise for developer \(demo\):\nDemo house rule: never block main\./);
    assert.ok(dev.expertise.includes(`- ${join(w.plug, "rules", "house.md")} — house rules`));
    assert.match(dev.skills, /^Skills for this role/);
    assert.match(dev.skills, /\n- MANDATORY — invoke `superpowers:test-driven-development` — before the first edit\./);
    assert.ok(dev.skills.indexOf("MANDATORY") < dev.skills.indexOf("RECOMMENDED"), "mandatory rows first");

    // The development phase runs two passes (3b-special) and only the second one implements, so
    // the resolver renders both framings and the orchestrator picks per pass. Same rows, same
    // order; the planning text carries no live mandate for a pass that cannot meet one.
    assert.match(dev.skills_planning, /^Skills mandated for the implementation pass/);
    assert.match(dev.skills_planning, /\n- `superpowers:test-driven-development` \(mandatory\) — before the first edit$/m);
    assert.ok(!/MANDATORY — invoke `/.test(dev.skills_planning),
      "3b-1a-mandatory-skill counts this token; the planning pass must owe nothing by it");

    assert.ok("debugger" in plan.profile.prompt_blocks, "on-demand agents get a block too — the expertise command serves them");
    assert.equal(plan.profile.prompt_blocks["qa-engineer"].skills_planning,
      plan.profile.prompt_blocks["qa-engineer"].skills,
      "a role with nothing to mandate has nothing to plan for either — both null");
    assert.equal(plan.profile.prompt_blocks["qa-engineer"].expertise, null, "a role the stack says nothing about gets no header");
    assert.ok(plan.dry_run.rows.every((r) => !/^demo-/.test(r.agent)), "every dispatch row names a core agent");

    // PR-4: the compliance denominator. The orchestrator must not re-derive which agents got a
    // block (ADR-0015) — the resolver states it, and only for roles that actually got one.
    const scoped = plan.profile.expertise_block_agents;
    assert.ok(Array.isArray(scoped), "the plan states the scope rather than leaving it to be counted");
    assert.ok(scoped.includes("developer"), "developer has an expertise block");
    assert.ok(!scoped.includes("qa-engineer"), "a role with a null block is out of scope, not a silent failure");
    assert.deepEqual(scoped, [...scoped].sort(), "stable order — it lands in telemetry and in diffs");
    // Review finding 1 on #146. On-demand agents get a block in `prompt_blocks` so the
    // `expertise --role` command can serve them, but the orchestrator pastes nothing for them —
    // they fetch it themselves. Counting them would make `/sdlc:aar` in the same session an
    // expected dispatch that can never match, failing a fully compliant run.
    for (const onDemand of ["debugger", "devops", "cicd", "aar-analyst"]) {
      assert.ok(!scoped.includes(onDemand),
        `${onDemand} runs on demand and is never handed a pasted block — it cannot be in the denominator`);
    }
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a foundation still binding its own roster is ignored, and said so where the user can see it", () => {
  const w = world();
  try {
    const { prints, plan } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    assert.ok(prints.some((p) => /WARN: foundation 'demo' declares agents_per_phase — ignored \(ADR-0021\)/.test(p)),
      prints.join("\n"));
    assert.equal(plan.profile.agents_per_phase.business_analysis, "business-analyst",
      "the core roster wins; the foundation's binding contributes nothing");
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

test("every core role resolves, and a name only the ignored foundation roster mentioned does not", () => {
  // The valid set is exactly what carries a prompt block: dispatched ∪ core. Now that a
  // foundation's roster is ignored (ADR-0021 PR-3), nothing it names is dispatched, so
  // `demo-dev` is not a role — and saying so is the point: the project has to be migrated, and a
  // silent success here would hide that from the person running the command.
  const w = world();   // the demo foundation still binds demo-ba / demo-dev / demo-qa / demo-docs
  try {
    const core = resolveExpertise({ cwd: w.proj, args: "", env: w.env, role: "developer" });
    assert.equal(core.ok, true, core.error);
    const stale = resolveExpertise({ cwd: w.proj, args: "", env: w.env, role: "demo-dev" });
    assert.equal(stale.ok, false, "a name no longer dispatched is not a role");
    assert.match(stale.error, /unknown role 'demo-dev'/);

    const { plan } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    assert.ok("developer" in plan.profile.prompt_blocks, "every core role carries a block");
    assert.ok(!("demo-dev" in plan.profile.prompt_blocks), "and nothing else does");
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

// ---- 0-large: the prescribed digest must keep naming keys the plan actually has ---------------

test("the orchestrator's 0-large jq projection names only real plan keys", () => {
  // Run 4 spent five of its nine start-window tool calls probing the plan file for its shape
  // (`keys[]`, then `.prints[]`, then two subset projections) before it could read it. Step 0-large
  // now states the projection once so no run has to rediscover it — which makes that literal a
  // contract with `resolvePlan`'s output. A renamed plan key would otherwise drop a CONTEXT value
  // silently, with every test still green. This is the guard for that.
  const skillPath = resolve(dirname(fileURLToPath(import.meta.url)),
    "..", "..", "..", "plugins", "sdlc", "skills", "pipeline-orchestrator", "SKILL.md");
  const skill = readFileSync(skillPath, "utf8");
  const m = skill.match(/=== CONTEXT ===", \(\.plan \| \{([^}]*?), profile: \(\.profile \| del\(\.prompt_blocks\)\)\}/);
  assert.ok(m, "Step 0-large must carry the `.plan | {…}` digest projection verbatim");

  // `a, b, skip_rules: .skip_rules.applied` -> the names on the LEFT of any colon.
  const projected = m[1].split(",").map((s) => s.trim().split(":")[0].trim()).filter(Boolean);

  const w = world({ roleExpertise: true });
  try {
    const { plan, halt } = resolvePlan({ cwd: w.proj, args: "--dry-run", env: w.env });
    assert.equal(halt, null);
    for (const key of projected) {
      assert.ok(key in plan, `0-large projects '${key}', which resolvePlan does not emit`);
    }
    // The one nested path in the projection, checked as a path rather than as a name.
    assert.ok(plan.skip_rules && "applied" in plan.skip_rules, "0-large reads .skip_rules.applied");

    // Every CONTEXT key the map owes must survive the projection. `profile` is carried whole
    // (minus the blocks), so its rows are covered by the parent name.
    for (const owed of ["roots", "deps_preflight", "availability_flags", "stack", "workflow",
                        "models", "cost_cap", "cost_cap_source", "headless", "plugin_version"]) {
      assert.ok(projected.includes(owed), `the key map owes CONTEXT.${owed}; 0-large does not project it`);
    }
    // The exclusion is the point of the projection: the blocks are read one agent at a time.
    assert.ok(!projected.includes("prompt_blocks"));
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});


test("config left in the pre-rename location is reported, not read", () => {
  // The rename to <project>/.sdlc/ ships with no fallback read, on purpose —
  // an alias layer is the shape ADR-0021 §5 deleted after six defects. But a
  // silent rename is its own defect: this cap would simply stop applying and
  // the run would look normal. So the old location is NOTICED and named, and
  // the value is still not read from it.
  const w = world();
  try {
    write(join(w.proj, ".claude", "sdlc.local.yaml"), "cost_caps:\n  '*': 0.5\n");
    const { plan, warnings, prints } = resolvePlan({ cwd: w.proj, args: "", env: w.env });

    const hit = warnings.filter((x) => /still in the old location/.test(x));
    assert.equal(hit.length, 1, `the stale file was not reported: ${JSON.stringify(warnings)}`);
    assert.match(hit[0], /\.claude\/sdlc\.local\.yaml/);
    assert.match(hit[0], /sdlc:doctor/);
    assert.ok(prints.some((x) => /still in the old location/.test(x)), "prints[] is the orchestrator's only obligation");

    assert.equal(plan.cost_cap, 20, "the override was read from a location nothing reads any more");
    assert.equal(plan.cost_cap_source, "recipe");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a project with no legacy files says nothing about them", () => {
  const w = world({ localYaml: "cost_caps:\n  '*': 2\n" });
  try {
    const { plan, warnings } = resolvePlan({ cwd: w.proj, args: "", env: w.env });
    assert.equal(warnings.filter((x) => /old location/.test(x)).length, 0);
    assert.equal(plan.cost_cap, 2, "the new location IS read");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

// Issue #164, end to end and against the REAL plugin — the repro from the report, reduced to a
// test. An empty config dir plus `CLAUDE_PLUGIN_ROOT=<checkout>/plugins/sdlc` is what
// `--plugin-dir`, `claude plugin eval` and every development checkout look like from in here.
// Before the fix this halted at "Workflow 'default' not found. Available: (none)" while
// default.yaml sat next to the code printing the halt.
test("a path-loaded plugin resolves its own manifest, recipes and dependencies", () => {
  const SDLC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugins", "sdlc");
  const dir = mkdtempSync(join(tmpdir(), "sdlc-pathload-"));
  try {
    const proj = join(dir, "project");
    write(join(proj, "src.txt"), "seed\n");
    const g = (...a) => execFileSync("git", a, { cwd: proj, stdio: "ignore" });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@example.com");
    g("config", "user.name", "t");
    g("add", "-A"); g("commit", "-qm", "seed");
    g("update-ref", "refs/remotes/origin/main", "HEAD");

    // No installed_plugins.json, no cache: the registry every discovery keys off is empty.
    const env = { HOME: dir, CLAUDE_CONFIG_DIR: join(dir, "cfg"), CLAUDE_PLUGIN_ROOT: SDLC };
    const { plan, halt } = resolvePlan({ cwd: proj, args: '"Add dark mode" --dry-run', env });

    assert.equal(halt, null, "the plugin that ships `vanilla` and default.yaml must not report neither");
    assert.equal(plan.stack.primary_profile, "vanilla");
    assert.equal(plan.workflow.name, "default");
    assert.ok(plan.workflow.resolved_phases.length > 0);
    assert.deepEqual(Object.keys(plan.deps_preflight), ["superpowers"],
      "runtime-dependencies.json is read through the same registry, so it went missing with the rest");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an explicit --stack=vanilla resolves under a path load", () => {
  // The other face of the same defect: "no installed foundation declares that stack" for a stack
  // that ships in the plugin doing the reporting.
  const SDLC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugins", "sdlc");
  const dir = mkdtempSync(join(tmpdir(), "sdlc-pathload-"));
  try {
    const proj = join(dir, "project");
    mkdirSync(proj, { recursive: true });
    const env = { HOME: dir, CLAUDE_CONFIG_DIR: join(dir, "cfg"), CLAUDE_PLUGIN_ROOT: SDLC };
    const { plan, halt } = resolvePlan({ cwd: proj, args: '"Add dark mode" --stack=vanilla --dry-run', env });
    assert.equal(halt, null);
    assert.equal(plan.stack.primary_profile, "vanilla");
    assert.equal(plan.stack.forced, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Review of #166, finding 1 — and the half of it that the manifest layer alone does not cover.
//
// Disabling the installed copy in settings.json before running the checkout is the natural setup,
// and the replacement inherits the registered key, so the `false` followed it. Fixing only
// loadInstalledManifests still left discoverRecipes and the dependency preflight vetoing, which
// halts the run just as dead: "Workflow 'default' not found. Available: (none)", the original bug.
test("an enabledPlugins veto does not disable a path load — recipes and deps included", () => {
  const SDLC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugins", "sdlc");
  const dir = mkdtempSync(join(tmpdir(), "sdlc-pathload-"));
  try {
    const cfg = join(dir, "cfg");
    const cached = join(cfg, "plugins", "cache", "agentic-sdlc", "sdlc", "2.4.0");
    write(join(cached, "manifest.yaml"), "kind: foundation\nstack: vanilla\npriority: 0\ndetect:\n  any: [\"*\"]\n");
    write(join(cfg, "settings.json"), { enabledPlugins: { "sdlc@agentic-sdlc": false } });
    write(join(cfg, "plugins", "installed_plugins.json"), {
      version: 2,
      plugins: { "sdlc@agentic-sdlc": [{ scope: "user", installPath: cached, version: "2.4.0" }] },
    });

    const proj = join(dir, "project");
    mkdirSync(proj, { recursive: true });
    const env = { HOME: dir, CLAUDE_CONFIG_DIR: cfg, CLAUDE_PLUGIN_ROOT: SDLC };
    const { plan, halt, warnings } = resolvePlan({ cwd: proj, args: '"Add dark mode" --dry-run', env });

    assert.equal(halt, null);
    assert.equal(plan.workflow.name, "default", "the recipe lives in the path-loaded tree, past the veto");
    assert.deepEqual(Object.keys(plan.deps_preflight), ["superpowers"]);
    assert.ok(warnings.some((w) => w.includes("is loaded from a path")), "and the displaced copy is named");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Issue #168 — `commands/start.md` promises "Combine with --dry-run to preview what would be
// skipped without dispatching anything". It previewed a full run instead: caps.mjs had every
// resumed branch (⏩ rows, $0 pricing, exclusion from the loop/heal/gate arithmetic) and plan.mjs
// never passed `resumedDone`, so none of it was reachable from the CLI.

/** A resumable run: a real workspace under docs/plans/<slug>/.checkpoint with the given statuses. */
function withCheckpoints(slug, statuses) {
  const SDLC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugins", "sdlc");
  const dir = mkdtempSync(join(tmpdir(), "sdlc-resume-"));
  const proj = join(dir, "project");
  const cp = join(proj, "docs", "plans", slug, ".checkpoint");
  mkdirSync(cp, { recursive: true });
  for (const [unit, status] of Object.entries(statuses)) write(join(cp, `${unit}.json`), { status });
  const g = (...a) => execFileSync("git", a, { cwd: proj, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  write(join(proj, "f.txt"), "seed\n");
  g("add", "-A"); g("commit", "-qm", "seed");
  g("update-ref", "refs/remotes/origin/main", "HEAD");
  return { dir, proj, cp, env: { HOME: dir, CLAUDE_CONFIG_DIR: join(dir, "cfg"), CLAUDE_PLUGIN_ROOT: SDLC } };
}

test("--resume --dry-run prices only the phases that would actually be dispatched", () => {
  const w = withCheckpoints("add-dark-mode", {
    business_analysis: "completed", "development-vanilla": "completed", qa: "completed", security: "skipped",
  });
  try {
    const args = '"Add dark mode" --resume --dry-run --no-skip-rules';
    const { plan, halt } = resolvePlan({ cwd: w.proj, args, env: w.env });
    assert.equal(halt, null);

    const resumed = plan.dry_run.rows.filter((r) => r.resumed);
    assert.deepEqual(resumed.map((r) => r.phase), ["business_analysis", "development", "qa", "security"],
      "a `skipped` checkpoint is as terminal as a `completed` one");
    assert.equal(resumed[1].aspect, "vanilla", "the aspect row matched its on-disk `development-vanilla` id");
    assert.ok(resumed.every((r) => r.est === 0), "a resumed row costs nothing to redo");
    assert.equal(plan.dry_run.reenter_at, "remediation");
    assert.equal(plan.dry_run.resume_slug, "add-dark-mode");

    // The number that matters: the estimate is the cost to FINISH.
    const full = resolvePlan({ cwd: w.proj, args: '"Add dark mode" --dry-run --no-skip-rules', env: w.env });
    assert.ok(plan.dry_run.expected_total < full.plan.dry_run.expected_total / 4,
      `resumed ${plan.dry_run.expected_total} must be far below the full ${full.plan.dry_run.expected_total}`);
    assert.equal(full.plan.dry_run.resumed, undefined, "a run that is not resuming grows no resume keys");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("the human preview marks resumed phases and names the re-entry point", () => {
  const w = withCheckpoints("add-dark-mode", { business_analysis: "completed" });
  try {
    const { prints } = resolvePlan({ cwd: w.proj, args: '"Add dark mode" --resume --dry-run --no-skip-rules', env: w.env });
    const preview = prints.join("\n");
    assert.match(preview, /⏭ Resume: add-dark-mode/);
    assert.match(preview, /Re-entering at: development/);
    assert.match(preview, /⏩ business_analysis {3}→ skipped \(resumed from checkpoint\) {3}\$0\.00/);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("the headless dry-run line carries resumed and reenter_at", () => {
  const w = withCheckpoints("add-dark-mode", { business_analysis: "completed", "development-vanilla": "completed" });
  try {
    const env = { ...w.env, SDLC_NONINTERACTIVE: "true" };
    const { prints } = resolvePlan({ cwd: w.proj, args: '"Add dark mode" --resume --dry-run --no-skip-rules', env });
    const line = JSON.parse(prints[prints.length - 1]);
    assert.equal(line.resumed, true);
    assert.equal(line.reenter_at, "qa");
    assert.equal(line.dry_run, true);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a --resume whose workspace does not exist says so instead of showing a full run as a resume", () => {
  // Step 2 generates the slug from $ARGUMENTS in prose, so a model's slug and this function's can
  // differ. Silently previewing a full run is the failure this issue is about; a WARN is not.
  const w = withCheckpoints("add-dark-mode", { business_analysis: "completed" });
  try {
    const { plan, warnings } = resolvePlan({ cwd: w.proj, args: '"Something else entirely" --resume --dry-run --no-skip-rules', env: w.env });
    assert.ok(warnings.some((x) => /--resume: no checkpoints at docs\/plans\/something-else-entirely/.test(x)));
    assert.ok(plan.dry_run.rows.every((r) => !r.resumed));
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("--resume=<slug> is exact and beats the derived slug", () => {
  const w = withCheckpoints("explicit-slug", { business_analysis: "completed" });
  try {
    const { plan } = resolvePlan({ cwd: w.proj, args: '"Totally different words" --resume=explicit-slug --dry-run --no-skip-rules', env: w.env });
    assert.equal(plan.dry_run.resume_slug, "explicit-slug");
    assert.equal(plan.dry_run.rows[0].resumed, true);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("resolveResume is inert without --resume, and slugifies by Step 2's rule", () => {
  assert.equal(resolveResume({ args: '"Add dark mode" --dry-run' }).requested, false);
  const r = resolveResume({ cwd: "/nonexistent", args: '"Add Dark Mode, now!" --resume --dry-run' });
  assert.equal(r.slug, "add-dark-mode-now");
  assert.equal(r.done.size, 0);
});

// Findings from the review of #171.

test("a --resume that resumed nothing is not reported as a resume", () => {
  // Gating the output on the FLAG rather than on what was resumed dressed an unchanged full-run
  // preview up as a resumed one: `⏭ Resume: … 0 of 6 complete` beside the full estimate, and
  // `{"resumed":true}` in the headless line for a CI consumer to misread.
  const w = withCheckpoints("add-dark-mode", { business_analysis: "completed" });
  try {
    const args = '"Something else entirely" --resume --dry-run --no-skip-rules';
    const { plan, prints, warnings } = resolvePlan({ cwd: w.proj, args, env: w.env });
    assert.ok(warnings.some((x) => /no checkpoints at/.test(x)), "the warning is still owed");
    assert.equal(plan.dry_run.resumed, undefined);
    assert.equal(plan.dry_run.reenter_at, undefined);
    assert.ok(!prints.join("\n").includes("⏭ Resume:"));
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a space-separated flag value stays out of the derived slug", () => {
  // `cli.mjs` reads `--mode tree` as two tokens, so a value-stripping rule keyed only on
  // `--flag=value` left "tree" in the description: `--mode tree "Add dark mode"` derived
  // `tree-add-dark-mode` and matched no workspace.
  assert.equal(resolveResume({ cwd: "/nonexistent", args: "--mode tree Add dark mode --resume" }).slug, "add-dark-mode");
  assert.equal(resolveResume({ cwd: "/nonexistent", args: "Add dark mode --skills a,b --resume" }).slug, "add-dark-mode");
});

test("--resume= with an empty slug warns instead of silently doing nothing", () => {
  const r = resolveResume({ cwd: "/nonexistent", args: "Add dark mode --resume= --dry-run" });
  assert.equal(r.requested, true, "a consuming (\\s|$) could not match the trailing '=' and read this as no resume at all");
  assert.equal(r.slug, null);
  assert.ok(r.warnings.some((w) => /empty slug/.test(w)));
});

test("a slug that is a path, not a run name, is refused", () => {
  const r = resolveResume({ cwd: "/nonexistent", args: "--resume=../../elsewhere --dry-run" });
  assert.equal(r.slug, null);
  assert.equal(r.done.size, 0);
  assert.ok(r.warnings.some((w) => /not a run slug/.test(w)));
});

// ---- issue #197: `frameworks.disable` reaches detection, and an unknown key is not silent ----

test("frameworks.disable suppresses a detected framework end to end, injection and all", () => {
  const w = world({ frameworks: true, localYaml: "frameworks:\n  disable: [beta]\n" });
  try {
    const r = resolvePlan({ cwd: w.proj, args: "--dry-run", env: w.env });
    assert.equal(r.halt, null, r.halt ?? "");
    assert.deepEqual(r.plan.stack.additive_profiles, ["alpha"]);
    assert.deepEqual(r.plan.stack.suppressed_profiles, ["beta"], "telemetry must be able to tell a suppression from a non-detection");
    // The point of suppressing at attachment: the framework's guidance never reaches a prompt.
    const dev = r.plan.profile.phase_prompts_injection.development ?? "";
    assert.match(dev, /ALPHA RULES/);
    assert.doesNotMatch(dev, /BETA RULES/, "a suppressed framework must not enrich any phase");
    assert.ok(r.prints.some((x) => /suppressed: beta \(frameworks\.disable\)/.test(x)), "the banner has to say detection was overridden");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("without the override both contesting frameworks still attach", () => {
  const w = world({ frameworks: true });
  try {
    const r = resolvePlan({ cwd: w.proj, args: "--dry-run", env: w.env });
    assert.deepEqual(r.plan.stack.additive_profiles, ["alpha", "beta"], "detection-only behaviour is unchanged");
    assert.deepEqual(r.plan.stack.suppressed_profiles, []);
    assert.ok(!r.prints.some((x) => /suppressed/.test(x)));
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a disable naming nothing installed warns instead of failing quietly", () => {
  const w = world({ frameworks: true, localYaml: "frameworks:\n  disable: [gamma]\n" });
  try {
    const r = resolvePlan({ cwd: w.proj, args: "--dry-run", env: w.env });
    assert.deepEqual(r.plan.stack.additive_profiles, ["alpha", "beta"]);
    assert.ok(r.warnings.some((x) => /frameworks\.disable 'gamma'/.test(x)), `got ${JSON.stringify(r.warnings)}`);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("a stale frameworks.enable block is reported rather than read as honoured", () => {
  const w = world({ frameworks: true, localYaml: "frameworks:\n  enable: [gamma]\n  disable: [beta]\n" });
  try {
    const r = resolvePlan({ cwd: w.proj, args: "--dry-run", env: w.env });
    assert.deepEqual(r.plan.stack.additive_profiles, ["alpha"], "the supported half still applies");
    assert.ok(r.warnings.some((x) => /frameworks\.enable is not supported/.test(x)));
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("an unknown top-level key in a real sdlc.local.yaml warns on every run", () => {
  const w = world({ localYaml: "skip_phase:\n  - security\n" });
  try {
    const r = resolvePlan({ cwd: w.proj, args: "--dry-run", env: w.env });
    assert.ok(r.warnings.some((x) => /unknown key 'skip_phase'/.test(x)), `got ${JSON.stringify(r.warnings)}`);
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});
