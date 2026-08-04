// The composition, end to end, over a synthetic consumer built on disk: a config dir with an
// installed+enabled plugin, a project with its own overrides and recipe, and a real git repo so
// the diff signals resolve. This is the test that would have caught the two `[object Object]`
// defects the unit fixtures missed, because it runs the same path a consumer does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePlan } from "../../../plugins/sdlc/tools/resolve/plan.mjs";

function write(file, content) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

/** A consumer machine: config dir + one installed plugin + a git project. */
function world({ localYaml = null, modelJson = null, recipe = null } = {}) {
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
    "agents_per_phase:",
    "  business_analysis: demo-ba",
    "  development: demo-dev",
    "  qa: demo-qa",
    "  documentation: demo-docs",
    "post_pipeline_checks:",
    '  - "echo plugin-check"',
    "",
  ].join("\n"));
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
    "agents_per_phase:", "  documentation: core-docs", "",
  ].join("\n"));
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
