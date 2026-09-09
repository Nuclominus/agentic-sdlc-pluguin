import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { resolveHost, hasTranscriptCost } from "../../../plugins/sdlc/tools/resolve/host.mjs";
import { loadHost, listHosts, emitAll, emitPlugin, rewriteAgent, rewriteHooks } from "../lib/emit/index.mjs";
import { resolveModel, modelPairs, TIERS } from "../lib/emit/models.mjs";
import { checkHost } from "../lib/emit/check.mjs";
import { sectionRange, applyOverlays, overlaysFor } from "../lib/emit/overlay.mjs";
import { frontmatter, parseTools } from "../lib/agent-tools.mjs";
import { loadRegistry, lookupPricing } from "../../../plugins/sdlc/tools/usage/usage.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ANTIGRAVITY = loadHost(REPO, "antigravity");

const agent = (fm) => `---\n${fm.join("\n")}\n---\n\nbody\n`;

// ---------------------------------------------------------------- models

test("tier+effort resolves to one host model id", () => {
  const r = resolveModel("sonnet", "medium", ANTIGRAVITY);
  assert.ok(r.ok);
  assert.equal(r.model, "gemini-3.8-flash-medium");
  // The effort rode into the id, so it must not survive as a second spelling.
  assert.equal(r.effort, null);
});

test("a host keyed on tier+effort refuses a tier with no effort", () => {
  // Defaulting here would silently pick a reasoning budget nobody wrote down.
  const r = resolveModel("sonnet", null, ANTIGRAVITY);
  assert.equal(r.ok, false);
  assert.match(r.error, /no `effort:`/);
});

test("an unknown tier is reported, never passed through", () => {
  const r = resolveModel("gpt-9", "high", ANTIGRAVITY);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown tier/);
});

test("every pipeline tier is mapped at every effort", () => {
  for (const tier of TIERS) {
    for (const effort of ["high", "medium", "low"]) {
      const r = resolveModel(tier, effort, ANTIGRAVITY);
      assert.ok(r.ok, `${tier}/${effort} is unmapped: ${r.error}`);
    }
  }
});

test("the model map is a golden table — a silent edit shows up here", () => {
  assert.deepEqual(modelPairs(ANTIGRAVITY), [
    ["fable/high", "gemini-3.1-pro-high"],
    ["fable/low", "gemini-3.1-pro-low"],
    ["fable/medium", "gemini-3.1-pro-high"],
    ["haiku/high", "gemini-3.8-flash-medium"],
    ["haiku/low", "gemini-3.8-flash-low"],
    ["haiku/medium", "gemini-3.8-flash-medium"],
    ["opus/high", "gemini-3.1-pro-high"],
    ["opus/low", "gemini-3.1-pro-low"],
    ["opus/medium", "gemini-3.1-pro-high"],
    ["sonnet/high", "gemini-3.8-flash-high"],
    ["sonnet/low", "gemini-3.8-flash-low"],
    ["sonnet/medium", "gemini-3.8-flash-medium"],
  ]);
});

test("every model the host map can emit is priced by that host's registry", () => {
  // Ties hosts/<host>.json to config/models/<host>.yaml. Without it the emitter
  // can bake in a model string telemetry cannot price, and the failure surfaces
  // as a silently unpriced phase rather than as a broken build.
  const registry = loadRegistry(join(REPO, "plugins", "sdlc", "config", "models", `${ANTIGRAVITY.host}.yaml`));
  for (const [pair, id] of modelPairs(ANTIGRAVITY)) {
    assert.ok(lookupPricing(id, registry), `${pair} emits \`${id}\`, which config/models/${ANTIGRAVITY.host}.yaml does not price`);
  }
});

test("a registry prices its own provider only — never another's by accident", () => {
  // The split's whole safety property: a cross-provider lookup must return null,
  // so a mis-attributed model is unpriced rather than priced at someone else's
  // rate. A wrong number is worse than no number (ADR-0012).
  const claude = loadRegistry(join(REPO, "plugins", "sdlc", "config", "models", "claude.yaml"));
  const anti = loadRegistry(join(REPO, "plugins", "sdlc", "config", "models", "antigravity.yaml"));
  assert.ok(lookupPricing("claude-opus-5", claude));
  assert.equal(lookupPricing("gemini-3.1-pro-high", claude), null);
  assert.ok(lookupPricing("gemini-3.1-pro-high", anti));
  assert.equal(lookupPricing("claude-opus-5", anti), null);
});

test("a host package carries its own registry and no other", () => {
  const { outputs, drops } = emitPlugin(REPO, "sdlc", ANTIGRAVITY);
  const registries = [...outputs.keys()].filter((p) => p.includes("/config/models/"));
  assert.deepEqual(registries, ["dist/antigravity/plugins/sdlc/config/models/antigravity.yaml"]);
  assert.ok(drops.some((d) => d.path === "config/models/claude.yaml" && /this package is antigravity/.test(d.reason)));
});

// ---------------------------------------------------------------- agents

test("rewriting an agent maps the model and removes the folded effort", () => {
  const r = rewriteAgent(agent(["name: dev", "description: d", "model: sonnet", "effort: medium", "tools: [Read]"]), ANTIGRAVITY);
  assert.ok(r.ok);
  const fm = frontmatter(r.text);
  assert.match(fm, /^model: gemini-3\.8-flash-medium$/m);
  assert.equal(/^effort:/m.test(fm), false);
});

test("rewriting touches only the model and effort lines", () => {
  // A YAML round-trip would rewrite the `description: |` block and every
  // <example> inside it, burying real changes in noise on every dist/ diff.
  const src = agent(["name: dev", "description: |", "  line one", "  line two — ⇄ ADR-0018", "model: opus", "effort: high", "tools: [Read, Grep]"]);
  const r = rewriteAgent(src, ANTIGRAVITY);
  assert.ok(r.ok);
  assert.ok(r.text.includes("  line two — ⇄ ADR-0018"));
  assert.deepEqual(parseTools(frontmatter(r.text)), ["Read", "Grep"]);
});

test("an agent with no frontmatter is an error, not a passthrough", () => {
  const r = rewriteAgent("no frontmatter here\n", ANTIGRAVITY);
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------- hooks

test("a hook on an event the host does not fire is dropped with a reason", () => {
  const src = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "bash x.sh" }] }] } });
  const r = rewriteHooks(src, ANTIGRAVITY);
  assert.ok(r.ok);
  assert.deepEqual(r.json.hooks, {});
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0].reason, /does not fire the SessionStart/);
});

test("a dropped handler takes its now-empty event registration with it", () => {
  // An event registered with no handlers reads as coverage that is not there.
  const src = JSON.stringify({
    hooks: { PreToolUse: [{ matcher: "Agent", hooks: [{ type: "command", command: "bash ${CLAUDE_PLUGIN_ROOT}/hooks/enforce-agent-model.sh" }] }] },
  });
  const r = rewriteHooks(src, ANTIGRAVITY);
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.json.hooks), []);
  assert.ok(r.dropped.some((d) => d.what.includes("enforce-agent-model.sh")));
});

test("a supported event with a surviving handler is kept intact", () => {
  const src = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "bash seal-run.sh" }] }] } });
  const r = rewriteHooks(src, ANTIGRAVITY);
  assert.deepEqual(r.json.hooks.Stop[0].hooks.length, 1);
  assert.deepEqual(r.dropped, []);
});

test("unparseable hooks.json is a tool error, not a silent empty config", () => {
  const r = rewriteHooks("{ not json", ANTIGRAVITY);
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------- plan

test("the plan moves the manifest and the hooks config to the plugin root", () => {
  // Antigravity reads plugin.json and hooks.json at the root; `agy plugin
  // validate` says `missing plugin.json` / `hooks: skipped` otherwise.
  const { outputs } = emitPlugin(REPO, "sdlc", ANTIGRAVITY);
  assert.ok(outputs.has("dist/antigravity/plugins/sdlc/plugin.json"));
  assert.ok(outputs.has("dist/antigravity/plugins/sdlc/hooks.json"));
  assert.equal(outputs.has("dist/antigravity/plugins/sdlc/.claude-plugin/plugin.json"), false);
  assert.equal(outputs.has("dist/antigravity/plugins/sdlc/hooks/hooks.json"), false);
});

test("commands are carried verbatim — the host converts them itself", () => {
  // Observed on agy 1.1.27: `commands: 11 processed (converted to skills)`.
  // Converting them here too would be a second, drift-prone implementation.
  const { outputs } = emitPlugin(REPO, "sdlc", ANTIGRAVITY);
  const commands = [...outputs.keys()].filter((p) => p.includes("/commands/"));
  assert.ok(commands.length >= 11, `expected the command set to be carried, saw ${commands.length}`);
  assert.equal(outputs.get(commands[0]).kind, "copy");
});

test("commands are renamed into the plugin's namespace", () => {
  // The skill name comes from the filename, and the host registers skills
  // globally — so unprefixed files would claim /start, /init, /report, /doctor.
  const { outputs } = emitPlugin(REPO, "sdlc", ANTIGRAVITY);
  const commands = [...outputs.keys()].filter((p) => p.includes("/commands/"));
  for (const p of commands) {
    assert.match(p, /\/commands\/sdlc-[^/]+\.md$/, `${p} would register outside the plugin's namespace`);
  }
  assert.ok(outputs.has("dist/antigravity/plugins/sdlc/commands/sdlc-start.md"));
});

test("every emitted agent carries a host model id, never a tier tag", () => {
  const { outputs, errors } = emitPlugin(REPO, "sdlc", ANTIGRAVITY);
  assert.deepEqual(errors, []);
  const agents = [...outputs].filter(([p]) => /\/agents\/[^/]+\.md$/.test(p));
  assert.equal(agents.length, 12);
  for (const [path, entry] of agents) {
    const fm = frontmatter(entry.content);
    const model = fm.match(/^model:\s*(\S+)$/m)?.[1];
    assert.ok(model?.startsWith("gemini-"), `${path} kept a non-host model: ${model}`);
    assert.equal(/^effort:/m.test(fm), false, `${path} still carries an effort: key`);
  }
});

test("ADR-0018: read-only agents keep an Edit-free tools allowlist through emission", () => {
  // The tools: key is what carries "reviewers do not write code" on this host,
  // so the transform must not touch it.
  const { outputs } = emitPlugin(REPO, "sdlc", ANTIGRAVITY);
  for (const role of ["reviewer", "security-analyst", "debugger", "aar-analyst"]) {
    const entry = outputs.get(`dist/antigravity/plugins/sdlc/agents/${role}.md`);
    assert.ok(entry, `${role} was not emitted`);
    const tools = parseTools(frontmatter(entry.content));
    assert.ok(Array.isArray(tools) && tools.length, `${role} lost its tools allowlist`);
    assert.equal(tools.includes("Edit"), false, `${role} gained Edit`);
    assert.equal(tools.includes("Write") && role !== "reviewer" && role !== "security-analyst" && role !== "debugger" && role !== "aar-analyst", false);
  }
});

test("emission is deterministic — the same tree renders the same bytes", () => {
  const a = emitAll(REPO, ANTIGRAVITY);
  const b = emitAll(REPO, ANTIGRAVITY);
  assert.deepEqual([...a.outputs.keys()].sort(), [...b.outputs.keys()].sort());
  for (const [k, v] of a.outputs) {
    if (v.kind === "rewrite") assert.equal(v.content, b.outputs.get(k).content, `${k} is not deterministic`);
  }
});

test("every drop states a reason", () => {
  // The expertise-coverage lesson: a paragraph that fails to land raises no
  // error, it just stops existing. A drop without a reason is that failure.
  const { drops } = emitAll(REPO, ANTIGRAVITY);
  for (const d of drops) assert.ok(d.reason && d.reason.trim(), `${d.plugin}/${d.path} was dropped with no reason`);
});

// ---------------------------------------------------------------- overlays

const DOC = [
  "intro line",
  "**3b. Earlier step** does things.",
  "more earlier",
  "",
  "**3c. Spawn the agent** via the `Agent` tool:",
  "```",
  "Agent({ subagent_type: 'x' })",
  "```",
  "trailing note",
  "",
  "**3d. Save the summary** and move on.",
  "tail",
].join("\n");

test("a section runs from its own heading to the next step heading", () => {
  const r = sectionRange(DOC, "3c");
  assert.deepEqual(r, { start: 4, end: 10 });
});

test("the last section runs to end of file", () => {
  const r = sectionRange(DOC, "3d");
  assert.equal(r.end, DOC.split("\n").length);
});

test("a dashed step id anchors exactly, not as a prefix", () => {
  // `3c` must not swallow `3c-crash`, and vice versa.
  const doc = "**3c. A** x\n**3c-crash. B** y\n**3d. C** z\n";
  assert.deepEqual(sectionRange(doc, "3c"), { start: 0, end: 1 });
  assert.deepEqual(sectionRange(doc, "3c-crash"), { start: 1, end: 2 });
});

test("applying an overlay replaces the whole section and nothing else", () => {
  const dir = join(REPO, "plugins", "sdlc", "hosts", "antigravity", "overlays", "pipeline-orchestrator");
  const r = applyOverlays(DOC, new Map([["3c", join(dir, "3c.md")]]));
  assert.ok(r.ok);
  assert.ok(r.text.includes("**3b. Earlier step**"), "the preceding section survived");
  assert.ok(r.text.includes("**3d. Save the summary**"), "the following section survived");
  assert.ok(r.text.includes("invoke_subagent"), "the overlay landed");
  assert.equal(r.text.includes("Agent({ subagent_type: 'x' })"), false, "the replaced body is gone");
});

test("a renamed heading fails emission — it never silently passes through", () => {
  // This is the whole reason the module exists. An overlay that stops applying
  // ships the Claude Code text on another host, and raises nothing.
  const renamed = DOC.replace("**3c. Spawn the agent**", "**3c9. Spawn the agent**");
  const r = applyOverlays(renamed, new Map([["3c", join(REPO, "plugins", "sdlc", "hosts", "antigravity", "overlays", "pipeline-orchestrator", "3c.md")]]));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /matches nothing in the SSOT/);
});

test("every declared overlay anchor resolves in the live orchestrator", () => {
  const ssot = readFileSync(join(REPO, "plugins", "sdlc", "skills", "pipeline-orchestrator", "SKILL.md"), "utf8");
  const overlays = overlaysFor(REPO, "sdlc", "antigravity", "pipeline-orchestrator");
  assert.ok(overlays.size >= 3, "expected the dispatch overlays to be declared");
  for (const anchor of overlays.keys()) {
    assert.ok(sectionRange(ssot, anchor), `overlay \`${anchor}\` anchors to nothing`);
  }
});

test("the emitted orchestrator carries no Claude-only dispatch vocabulary", () => {
  // A live instruction naming a tool the host does not have is worse than no
  // instruction: the model can follow it.
  const body = readFileSync(join(REPO, "dist", "antigravity", "plugins", "sdlc", "skills", "pipeline-orchestrator", "SKILL.md"), "utf8");
  assert.equal(/`Agent` tool/.test(body), false, "still tells the model to use the Agent tool");
  assert.equal(/subagent_type/.test(body), false, "still names the subagent_type parameter");
  assert.ok(body.includes("invoke_subagent"), "the host's own dispatch tool is not named");
});

test("overlay sources are build inputs and never ship", () => {
  const { outputs } = emitPlugin(REPO, "sdlc", ANTIGRAVITY);
  assert.equal([...outputs.keys()].some((p) => p.includes("/hosts/")), false);
});

// ---------------------------------------------------------------- host declaration

test("the authored tree declares no host and defaults to Claude Code", () => {
  const h = resolveHost(join(REPO, "plugins", "sdlc"));
  assert.equal(h.host, "claude");
  assert.equal(h.declared, false);
  assert.equal(hasTranscriptCost(join(REPO, "plugins", "sdlc")), true);
});

test("an emitted package declares its host, so nothing has to guess", () => {
  // Env sniffing would be wrong in exactly the cases that matter — two packages
  // under one config dir, or a dev checkout run by hand — and a wrong answer
  // silently changes how cost is accounted.
  const root = join(REPO, "dist", "antigravity", "plugins", "sdlc");
  const h = resolveHost(root);
  assert.equal(h.host, "antigravity");
  assert.equal(h.declared, true);
  assert.equal(h.telemetry_mode, "run-envelope");
  assert.equal(hasTranscriptCost(root), false);
});

test("a malformed declaration is reported, not guessed around", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-host-"));
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(join(dir, "config", "host.json"), "{ not json");
  const h = resolveHost(dir);
  assert.equal(h.host, "unknown");
  assert.equal(h.telemetry_mode, "none");
  assert.match(h.source, /unreadable/);
  rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------- cross-host root isolation

test("an emitted package resolves its own root, never another host's install", () => {
  // The defect this locks: running the emitted cli.mjs still resolved
  // sdlc_plugin_root to a Claude Code cache copy, so the package read a foreign
  // install's config (no host declaration -> "claude") and would have tried to
  // price the run from transcripts that do not exist. Issue #70's failure mode —
  // one run mixing two plugin trees — reappearing across hosts.
  const project = mkdtempSync(join(tmpdir(), "sdlc-xhost-"));
  writeFileSync(join(project, "package.json"), '{"name":"x","version":"1.0.0"}\n');
  writeFileSync(join(project, ".sdlc-enable-vanilla"), "");

  const cli = join(REPO, "dist", "antigravity", "plugins", "sdlc", "tools", "resolve", "cli.mjs");
  const out = execFileSync(process.execPath, [cli, "plan", "--json", "add a thing"], {
    cwd: project,
    encoding: "utf8",
    // A CLAUDE_PLUGIN_ROOT in the environment must NOT win over the package's
    // own declaration — that is exactly how the leak happened.
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: join(REPO, "plugins", "sdlc") },
  });
  const r = JSON.parse(out);
  assert.ok(r.ok, `resolver failed: ${r.halt ?? r.error}`);
  assert.equal(r.plan.roots.host, "antigravity");
  assert.ok(
    r.plan.roots.sdlc_plugin_root.includes(join("dist", "antigravity")),
    `resolved outside its own package: ${r.plan.roots.sdlc_plugin_root}`,
  );
  // The leak's signature is the Claude plugin CACHE, not the substring
  // ".claude" — this repo's own worktrees live under .claude/worktrees/.
  assert.equal(r.plan.roots.sdlc_plugin_root.includes("/plugins/cache/"), false, "reached into a Claude Code plugin cache");
  rmSync(project, { recursive: true, force: true });
});

test("an emitted package finds its own recipes", () => {
  // Discovery runs off installed_plugins.json, which only Claude Code writes. A
  // package that ships workflows and then reports `Available: (none)` is worse
  // than one that ships none.
  //
  // $HOME is redirected on purpose. Without that, this test passed by reading
  // the developer's own ~/.gemini install rather than the tree under test — it
  // asserted "the package finds its recipes" while measuring something else
  // entirely, and went on passing after sibling discovery was added but SELF
  // discovery was left out. An isolated HOME is what makes the assertion mean
  // what its name says, on a clean CI runner as much as here.
  const home = mkdtempSync(join(tmpdir(), "sdlc-recipes-home-"));
  const project = mkdtempSync(join(tmpdir(), "sdlc-recipes-"));
  try {
    writeFileSync(join(project, "package.json"), '{"name":"x","version":"1.0.0"}\n');
    const cli = join(REPO, "dist", "antigravity", "plugins", "sdlc", "tools", "resolve", "cli.mjs");
    const env = { ...process.env, HOME: home };
    delete env.GEMINI_CONFIG_DIR;
    const r = JSON.parse(execFileSync(process.execPath, [cli, "plan", "--json", "add a thing"], {
      cwd: project, encoding: "utf8", env,
    }));
    assert.ok(r.ok, `resolver failed: ${r.halt ?? r.error}`);
    assert.equal(r.plan.workflow.name, "default");
    assert.ok(r.plan.workflow.resolved_phases.length >= 5);
    assert.equal(r.plan.workflow.origin, "plugin");
    assert.ok(r.plan.workflow.file.includes(join("dist", "antigravity")),
      `the recipe came from outside the package under test: ${r.plan.workflow.file}`);
  } finally {
    for (const d of [home, project]) rmSync(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- check

test("the committed dist/ is in sync with the SSOT", () => {
  const r = checkHost(REPO, ANTIGRAVITY);
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
});

test("every host descriptor on disk is loadable and declares a model map", () => {
  const hosts = listHosts(REPO);
  assert.ok(hosts.includes("antigravity"));
  for (const h of hosts) {
    const desc = loadHost(REPO, h);
    assert.equal(desc.host, h, `hosts/${h}.json declares host "${desc.host}"`);
    assert.ok(desc.models?.map, `hosts/${h}.json has no models.map`);
    assert.ok(desc.verified_on?.cli_version, `hosts/${h}.json states no verified_on.cli_version`);
  }
});

test("the emitted package keeps the plugin manifest byte-identical", () => {
  // The manifest MOVES; it is not rewritten. If a host ever needs a different
  // manifest shape, that becomes a rewrite entry and this test should fail.
  const src = readFileSync(join(REPO, "plugins", "sdlc", ".claude-plugin", "plugin.json"), "utf8");
  const out = readFileSync(join(REPO, "dist", "antigravity", "plugins", "sdlc", "plugin.json"), "utf8");
  assert.equal(out, src);
});

// -------------------------------------- a baked model makes overrides inert

test("a project tier override is reported inert, not previewed as active", () => {
  // The defect a real project surfaced: `.claude/model.local.json` said
  // `business-analyst: opus` and the dry run printed
  // "Model tier overrides loaded" plus `(opus)` — while the emitted agent file
  // said `gemini-3.1-pro-high` and the dispatch passes no model at all. The
  // preview named a model the run would not use.
  //
  // Both halves are asserted, because either one alone is a different bug:
  // dropping the override silently would hide a file the user wrote and expects
  // to matter, and honouring it is impossible. ADR-0022 §4 — declare the gap,
  // never substitute a mechanism for it.
  const home = mkdtempSync(join(tmpdir(), "sdlc-inert-home-"));
  const project = mkdtempSync(join(tmpdir(), "sdlc-inert-"));
  try {
    writeFileSync(join(project, "package.json"), '{"name":"x","version":"1.0.0"}\n');
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(join(project, ".claude", "model.local.json"),
      JSON.stringify({ default: "opus", agents: { "document-writer": "haiku" } }));

    const cli = join(REPO, "dist", "antigravity", "plugins", "sdlc", "tools", "resolve", "cli.mjs");
    const env = { ...process.env, HOME: home };
    delete env.GEMINI_CONFIG_DIR;
    const r = JSON.parse(execFileSync(process.execPath, [cli, "plan", "--json", "add a thing"], {
      cwd: project, encoding: "utf8", env,
    }));
    assert.ok(r.ok, `resolver failed: ${r.halt ?? r.error}`);

    const warned = r.warnings.filter((w) => /model\.local\.json is INERT/.test(w));
    assert.equal(warned.length, 1, `the inert override was not reported: ${JSON.stringify(r.warnings)}`);
    assert.match(warned[0], /host antigravity/);

    const all = r.prints.join("\n");
    assert.ok(!/Model tier overrides loaded/.test(all),
      "an override that cannot take effect must not be announced as loaded");
    // The emitted agent files carry gemini ids; no Claude tier may appear as a
    // model anywhere in the preview.
    assert.ok(!/\((opus|sonnet|haiku|fable)\)/.test(all),
      `a Claude tier name was previewed as the dispatched model:\n${all}`);
  } finally {
    for (const d of [home, project]) rmSync(d, { recursive: true, force: true });
  }
});

test("the host declaration carries whether a dispatch can name a model", () => {
  const decl = JSON.parse(readFileSync(
    join(REPO, "dist", "antigravity", "plugins", "sdlc", "config", "host.json"), "utf8"));
  assert.equal(decl.model_arg, false);
  // Absence must read as "capable": that is what every package built before this
  // field existed was built for, and a missing key must not silently disable a
  // working mechanism.
  assert.equal(ANTIGRAVITY.dispatch.model_arg, false);
});

// ------------------------------------------------------------- install doc

test("the install doc names every plugin the package carries", () => {
  const r = emitAll(REPO, ANTIGRAVITY);
  const doc = r.outputs.get("dist/antigravity/INSTALL.md")?.content;
  assert.ok(doc, "no INSTALL.md was emitted");
  for (const p of r.plugins) {
    assert.ok(doc.includes(`dist/antigravity/plugins/${p}`), `INSTALL.md omits ${p}`);
  }
});

test("every drop reaches the install doc, with its reason", () => {
  // A capability lost at emit time is stated, not substituted (ADR-0022 §4) —
  // and a reason that lives only in a build log is not stated to the person
  // installing the package. This is what makes the drops list reach a reader.
  const r = emitAll(REPO, ANTIGRAVITY);
  const doc = r.outputs.get("dist/antigravity/INSTALL.md").content;
  assert.ok(r.drops.length > 0, "the fixture is meaningless with no drops");
  for (const d of r.drops) {
    assert.ok(doc.includes(d.path), `INSTALL.md omits the drop ${d.path}`);
    const head = String(d.reason).replace(/\s+/g, " ").slice(0, 40);
    assert.ok(doc.includes(head), `INSTALL.md omits the reason for ${d.path}`);
  }
});

test("a dropped hook event names the script that stops running", () => {
  // "The host does not fire SessionStart" says which event vanished, not which
  // capability. The reader of the drops table is deciding whether they can live
  // without it, so the answer has to be in the row.
  const hooks = JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ command: 'bash "${CLAUDE_PLUGIN_ROOT}/hooks/android-cli-check.sh"' }] }] },
  });
  const r = rewriteHooks(hooks, ANTIGRAVITY);
  assert.ok(r.ok);
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0].reason, /android-cli-check\.sh never runs/);
});

// ------------------------------------------- config-dir search is a superset

test("a declared host searches the env-named config dir AND the default", () => {
  // Measured on agy 1.1.28: `agy plugin install` ignores GEMINI_CONFIG_DIR and
  // always installs under $HOME/.gemini; `agy plugin list` ignores it too. The
  // resolver used to take the env value INSTEAD of the default, so a developer
  // who exported that variable got a search path pointing at an empty directory
  // while every sibling plugin sat in the default one. Nothing errored — the
  // foundation simply was not found and an Android project quietly ran the
  // vanilla profile. A wrong answer wearing the shape of a right one, which is
  // what ADR-0015 is about, so the search is a superset and this holds it there.
  const home = mkdtempSync(join(tmpdir(), "sdlc-home-"));
  const emptyCfg = mkdtempSync(join(tmpdir(), "sdlc-emptycfg-"));
  const project = mkdtempSync(join(tmpdir(), "sdlc-cfgdir-"));
  try {
    // A foundation sitting where the host actually puts it.
    const found = join(home, ".gemini", "config", "plugins", "probe-foundation");
    mkdirSync(found, { recursive: true });
    writeFileSync(join(found, "manifest.yaml"), [
      "kind: foundation",
      "stack: probe",
      "priority: 500",
      "aspects: [probe]",
      "detect:",
      "  all:",
      "    - file_exists: .probe-marker",
      "",
    ].join("\n"));
    writeFileSync(join(project, ".probe-marker"), "");
    writeFileSync(join(project, "package.json"), '{"name":"x","version":"1.0.0"}\n');

    const cli = join(REPO, "dist", "antigravity", "plugins", "sdlc", "tools", "resolve", "cli.mjs");
    const r = JSON.parse(execFileSync(process.execPath, [cli, "plan", "--json", "add a thing"], {
      cwd: project,
      encoding: "utf8",
      env: { ...process.env, HOME: home, GEMINI_CONFIG_DIR: emptyCfg },
    }));

    assert.ok(r.ok, `resolver failed: ${r.halt ?? r.error}`);
    assert.equal(r.plan.stack.primary_profile, "probe",
      "the foundation is in the DEFAULT config dir; taking the env value instead of it loses the profile");

    const paths = r.plan.roots.plugin_search_paths;
    assert.ok(paths.some((p) => p.startsWith(emptyCfg)), "the env-named dir must still be searched");
    assert.ok(paths.some((p) => p.startsWith(join(home, ".gemini"))), "the default dir must still be searched");

    // Provenance names the variable only when the variable supplied the value.
    assert.equal(r.plan.roots.sources.config_dir, "GEMINI_CONFIG_DIR");
    assert.equal(r.plan.roots.config_dir, emptyCfg);
  } finally {
    for (const d of [home, emptyCfg, project]) rmSync(d, { recursive: true, force: true });
  }
});

test("the running package shadows an installed copy of itself", () => {
  // With the release installed AND a branch checkout running — the documented
  // way this project tests unreleased work against a real project — the same
  // plugin was reachable at two paths, and the run halted on
  // `Workflow 'default' is ambiguous`, listing one plugin twice. Discovery
  // deduped by file path, which cannot see that two paths are one plugin.
  //
  // The installed copy here is deliberately NOT a stub: it carries a recipe of
  // the same name, so merging the two would reproduce the ambiguity, and the
  // code that is running has to be the code whose recipes count. Mixing two
  // copies of one plugin tree is issue #70's failure a layer out.
  const home = mkdtempSync(join(tmpdir(), "sdlc-shadow-home-"));
  const project = mkdtempSync(join(tmpdir(), "sdlc-shadow-"));
  try {
    const installed = join(home, ".gemini", "config", "plugins", "sdlc");
    mkdirSync(join(installed, "workflows"), { recursive: true });
    writeFileSync(join(installed, "plugin.json"), '{"name":"sdlc","version":"0.0.1"}\n');
    writeFileSync(join(installed, "manifest.yaml"), "kind: core\n");
    writeFileSync(join(installed, "workflows", "default.yaml"), [
      "name: default",
      "description: an older copy that must not win",
      "phases:",
      "  - name: business_analysis",
      "  - name: development",
      "",
    ].join("\n"));
    writeFileSync(join(project, "package.json"), '{"name":"x","version":"1.0.0"}\n');

    const cli = join(REPO, "dist", "antigravity", "plugins", "sdlc", "tools", "resolve", "cli.mjs");
    const env = { ...process.env, HOME: home };
    delete env.GEMINI_CONFIG_DIR;
    const r = JSON.parse(execFileSync(process.execPath, [cli, "plan", "--json", "add a thing"], {
      cwd: project, encoding: "utf8", env,
    }));

    assert.ok(r.ok, `resolver failed: ${r.halt ?? r.error}`);
    assert.ok(r.plan.workflow.file.includes(join("dist", "antigravity")),
      `the installed copy won over the running package: ${r.plan.workflow.file}`);
    assert.ok(r.plan.workflow.resolved_phases.length > 2,
      "resolved the two-phase decoy from the installed copy");
  } finally {
    for (const d of [home, project]) rmSync(d, { recursive: true, force: true });
  }
});

test("with no env override the config dir reports the default, not the variable name", () => {
  const home = mkdtempSync(join(tmpdir(), "sdlc-home2-"));
  const project = mkdtempSync(join(tmpdir(), "sdlc-cfgdir2-"));
  try {
    writeFileSync(join(project, "package.json"), '{"name":"x","version":"1.0.0"}\n');
    const cli = join(REPO, "dist", "antigravity", "plugins", "sdlc", "tools", "resolve", "cli.mjs");
    const env = { ...process.env, HOME: home };
    delete env.GEMINI_CONFIG_DIR;
    const r = JSON.parse(execFileSync(process.execPath, [cli, "plan", "--json", "add a thing"], {
      cwd: project, encoding: "utf8", env,
    }));
    assert.ok(r.ok, `resolver failed: ${r.halt ?? r.error}`);
    assert.equal(r.plan.roots.config_dir, join(home, ".gemini"));
    assert.equal(r.plan.roots.sources.config_dir, "$HOME/.gemini",
      "claiming GEMINI_CONFIG_DIR for a path that came from $HOME is a false provenance claim");
  } finally {
    for (const d of [home, project]) rmSync(d, { recursive: true, force: true });
  }
});
