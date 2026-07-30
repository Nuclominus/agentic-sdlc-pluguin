import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { scanAgent, parseTools, frontmatter, checkAgentTools, DISPATCH_TOOLS, READ_ONLY_AGENTS }
  from "../lib/agent-tools.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const agent = (fmLines) => `---\n${fmLines.join("\n")}\n---\n\nbody\n`;
const OK = ["name: developer", "description: does things", "tools: [Read, Glob, Grep, Edit, Write, Bash]"];

test("a well-formed agent passes", () => {
  const r = scanAgent(agent(OK));
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
  assert.equal(r.name, "developer");
  assert.deepEqual(r.tools, ["Read", "Glob", "Grep", "Edit", "Write", "Bash"]);
});

test("a missing tools: key is a violation, not a default", () => {
  // The whole point: omitting `tools:` grants EVERY tool. Ten of eleven
  // android-foundation agents shipped this way.
  const r = scanAgent(agent(["name: developer", "description: does things"]));
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /does NOT mean "the defaults", it grants the FULL toolset/);
});

test("parseTools distinguishes an absent key from an empty list", () => {
  assert.equal(parseTools("name: x\n"), null);
  assert.deepEqual(parseTools("tools: []\n"), []);
  assert.deepEqual(parseTools("tools: [Read, Bash]\n"), ["Read", "Bash"]);
});

test("an empty tools list is a violation too", () => {
  const r = scanAgent(agent(["name: x", "description: d", "tools: []"]));
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /cannot act/);
});

test("every agent-dispatch tool is rejected", () => {
  // Only the orchestrator dispatches agents. A subagent's children would run
  // outside checkpoints, telemetry, and the cost cap.
  for (const tool of DISPATCH_TOOLS) {
    const r = scanAgent(agent(["name: x", "description: d", `tools: [Read, ${tool}]`]));
    assert.equal(r.ok, false, `${tool} must be rejected`);
    assert.match(r.errors.join("\n"), /only the orchestrator may dispatch agents/);
  }
});

test("DISPATCH_TOOLS covers dispatch, resume, and fan-out — not just Agent", () => {
  // Task is the legacy name, SendMessage resumes an existing agent, Workflow
  // fans out to many. Blocking only "Agent" would leave three open doors.
  assert.deepEqual([...DISPATCH_TOOLS].sort(), ["Agent", "SendMessage", "Task", "Workflow"]);
});

test("a reviewing agent declaring Edit is rejected", () => {
  const r = scanAgent(agent(["name: android-reviewer", "description: d", "tools: [Read, Edit, Write]"]));
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /reviewers report, the development agent applies/);
});

test("a reviewing agent may still hold Write for its own report", () => {
  const r = scanAgent(agent(["name: android-security", "description: d", "tools: [Read, Glob, Grep, Write, Bash, Skill]"]));
  assert.deepEqual(r.errors, []);
});

test("Edit is fine on an agent that is not a reviewer", () => {
  const r = scanAgent(agent(["name: android-developer", "description: d", "tools: [Read, Edit, Write]"]));
  assert.deepEqual(r.errors, []);
});

test("a missing description is a violation — it makes the agent unselectable", () => {
  const r = scanAgent(agent(["name: android-cicd", "tools: [Read, Bash]"]));
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /never be selected by trigger words/);
});

test("a file with no frontmatter fails closed", () => {
  const r = scanAgent("# just a heading\n");
  assert.equal(r.ok, false);
  assert.equal(frontmatter("# just a heading\n"), null);
});

test("every shipped agent in this repo is clean", () => {
  const results = checkAgentTools(REPO);
  assert.ok(results.length >= 18, `expected the full agent roster, found ${results.length}`);
  assert.deepEqual(results.filter(r => !r.ok), []);
});

test("no shipped agent holds a dispatch tool — the orchestrator's exclusive right", () => {
  const results = checkAgentTools(REPO);
  // Guard against the check passing vacuously if the glob ever stops matching.
  assert.ok(results.some(r => r.file.includes("android-")), "android agents must be in scope");
  assert.ok(results.some(r => r.file.includes("plugins/sdlc/")), "core agents must be in scope");
});

test("READ_ONLY_AGENTS names real shipped agents, not stale entries", () => {
  // A typo here would silently exempt a reviewer from the Edit ban.
  const shipped = new Set(checkAgentTools(REPO).map(r => r.file.split("/").pop().replace(/\.md$/, "")));
  for (const name of READ_ONLY_AGENTS) {
    assert.ok(shipped.has(name), `${name} is listed read-only but ships no agent file of that name`);
  }
});
