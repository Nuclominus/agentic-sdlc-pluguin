import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { loadHost, listHosts, emitAll, emitPlugin, rewriteAgent, rewriteHooks } from "../lib/emit/index.mjs";
import { resolveModel, modelPairs, TIERS } from "../lib/emit/models.mjs";
import { checkHost } from "../lib/emit/check.mjs";
import { frontmatter, parseTools } from "../lib/agent-tools.mjs";

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
