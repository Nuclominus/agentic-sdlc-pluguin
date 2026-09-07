// ADR-0021 drift guards — agents live in the core; foundations carry expertise.
//
// Each invariant here regresses silently without a check: a recipe naming a phase nothing
// binds is skipped at runtime with one line in telemetry; a `role_expertise` rule path that
// does not exist becomes a dead `Read` in every dispatch; a mandated superpowers skill nobody
// declares is exactly the inversion h5-d2 found and fixed by hand.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRoster, CORE_MANIFEST, ORCHESTRATOR } from "../lib/roster.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function write(root, rel, content) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A well-formed core agent: `Bash` plus the bootstrap line it enables. */
const agent = (name, { bash = true, body = null } = {}) => [
  "---", `name: ${name}`, "description: d", "model: sonnet",
  `tools: [Read${bash ? ", Bash" : ""}]`, "---", "",
  "## Stack expertise (how platform knowledge reaches you)", "",
  body ?? (bash
    ? `Run \`node \${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs expertise --role ${name}\` when no block is present.`
    : "No block, no bootstrap: this agent holds no Bash. Apply the generic guidance below."),
  "",
].join("\n");

/** A minimal marketplace tree that satisfies every roster invariant. */
function goodTree() {
  const root = mkdtempSync(join(tmpdir(), "sdlc-roster-"));
  write(root, CORE_MANIFEST, [
    "kind: foundation", "stack: vanilla", "priority: 0", "detect:", '  any: ["*"]',
    "agents_per_phase:", "  development: developer", "  qa: qa-engineer", "  review: reviewer",
    "on_demand_agents: [debugger]", "",
  ].join("\n"));
  for (const n of ["developer", "reviewer", "debugger"]) write(root, `plugins/sdlc/agents/${n}.md`, agent(n));
  write(root, "plugins/sdlc/agents/qa-engineer.md", agent("qa-engineer", { bash: false }));
  write(root, ORCHESTRATOR, "=== STABLE PREFIX ===\n{role_expertise_block — Stack expertise for <role>}\n=== PER-CALL CONTEXT ===\n");
  write(root, "plugins/sdlc/workflows/default.yaml", "name: default\nphases:\n  - development\n  - parallel: [qa, review]\n");
  write(root, "plugins/foo-foundation/manifest.yaml", [
    "kind: foundation", "stack: foo", "priority: 300", "detect:", "  any: [{ file_exists: foo }]",
    "extra_phases:", "  - { name: audit, after: qa, agent: reviewer }",
    "role_expertise:",
    "  developer:",
    "    invariants: Foo rule.",
    "    rules: [rules/house.md]",
    "    skills:",
    "      - { skill: foo-foundation:foo-conventions }",
    "      - { skill: superpowers:test-driven-development }",
    "",
  ].join("\n"));
  write(root, "plugins/foo-foundation/rules/house.md", "# house\n");
  write(root, "plugins/foo-foundation/skills/foo-conventions/SKILL.md", "---\nname: foo-conventions\n---\n");
  write(root, "plugins/foo-foundation/runtime-dependencies.json", JSON.stringify({ dependencies: [{ name: "superpowers", skills_used: ["test-driven-development"] }] }));
  write(root, "plugins/foo-foundation/workflows/foo-flow.yaml", "name: foo-flow\nphases:\n  - development\n  - audit\n");
  return root;
}

const failures = (results) => results.filter((r) => !r.ok).flatMap((r) => r.errors.map((e) => `${r.check}: ${e}`));

test("a tree that honors every invariant is clean, and every check reports it ran", () => {
  const root = goodTree();
  try {
    const results = checkRoster(root);
    assert.deepEqual(failures(results), []);
    for (const check of ["agents", "phases", "expertise", "slot"]) {
      assert.ok(results.some((r) => r.check === check), `check '${check}' did not run`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("agents: a bound agent with no core .md, or a mismatched name:, is a violation", () => {
  const root = goodTree();
  try {
    rmSync(join(root, "plugins/sdlc/agents/reviewer.md"));
    write(root, "plugins/sdlc/agents/debugger.md", agent("debugr"));
    const errs = failures(checkRoster(root));
    assert.ok(errs.some((e) => /agents: .*'reviewer'.*plugins\/sdlc\/agents\/reviewer\.md/.test(e)), errs.join("\n"));
    assert.ok(errs.some((e) => /agents: .*debugger\.md.*name: debugr/.test(e)), errs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("phases: a recipe phase the core manifest does not bind (and no extra_phases adds) is a violation", () => {
  const root = goodTree();
  try {
    write(root, "plugins/foo-foundation/workflows/foo-flow.yaml", "name: foo-flow\nphases:\n  - development\n  - parallel: [qa, penetration]\n");
    const errs = failures(checkRoster(root));
    assert.ok(errs.some((e) => /phases: .*foo-flow\.yaml.*'penetration'/.test(e)), errs.join("\n"));
    assert.ok(!errs.some((e) => /'audit'/.test(e)), "an extra_phases name is a valid phase");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("expertise: unknown role, missing rule file, missing own skill, undeclared superpowers skill", () => {
  const root = goodTree();
  try {
    write(root, "plugins/foo-foundation/manifest.yaml", [
      "kind: foundation", "stack: foo", "priority: 300", "detect:", "  any: [{ file_exists: foo }]",
      "role_expertise:",
      "  android-developer:", "    invariants: legacy name",
      "  developer:",
      "    rules: [rules/gone.md]",
      "    skills:",
      "      - { skill: foo-foundation:nope }",
      "      - { skill: superpowers:brainstorming }",
      "",
    ].join("\n"));
    const errs = failures(checkRoster(root));
    assert.ok(errs.some((e) => /expertise: .*'android-developer' is not a core role/.test(e)), errs.join("\n"));
    assert.ok(errs.some((e) => /expertise: .*rules\/gone\.md.*not found/.test(e)), errs.join("\n"));
    assert.ok(errs.some((e) => /expertise: .*foo-foundation:nope.*skills\/nope\/SKILL\.md/.test(e)), errs.join("\n"));
    assert.ok(errs.some((e) => /expertise: .*superpowers:brainstorming.*runtime-dependencies\.json/.test(e)), errs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("expertise: an UNDECLARED external skill is a violation whoever owns it, not just superpowers", () => {
  // The check was keyed on the literal `superpowers`, so the one omission this rule exists to
  // catch — `frontend-design:frontend-design`, mandated by the Android developer role and absent
  // from runtime-dependencies.json — passed it green. The declaring plugin's own skills ship with
  // it and need no declaration; anything else is a dependency whether or not it is superpowers.
  const root = goodTree();
  try {
    write(root, "plugins/foo-foundation/manifest.yaml", [
      "kind: foundation", "stack: foo", "priority: 300", "detect:", "  any: [{ file_exists: foo }]",
      "role_expertise:",
      "  developer:",
      "    skills:",
      "      - { skill: foo-foundation:foo-conventions }",
      "      - { skill: superpowers:test-driven-development }",
      "      - { skill: frontend-design:frontend-design }",
      "",
    ].join("\n"));
    const errs = failures(checkRoster(root));
    assert.ok(errs.some((e) => /expertise: .*frontend-design:frontend-design.*runtime-dependencies\.json/.test(e)), errs.join("\n"));
    assert.ok(!errs.some((e) => /foo-foundation:foo-conventions/.test(e)), "a plugin's own skill needs no declaration");
    assert.ok(!errs.some((e) => /superpowers:test-driven-development/.test(e)), "a declared dependency is fine");

    // Declaring it clears the finding.
    write(root, "plugins/foo-foundation/runtime-dependencies.json", JSON.stringify({ dependencies: [
      { name: "superpowers", skills_used: ["test-driven-development"] },
      { name: "frontend-design", skills_used: ["frontend-design"] },
    ] }));
    assert.deepEqual(failures(checkRoster(root)).filter((e) => /frontend-design/.test(e)), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("slot: a Bash-holding agent needs its own bootstrap line; every agent needs the slot; the orchestrator needs the block", () => {
  const root = goodTree();
  try {
    write(root, "plugins/sdlc/agents/developer.md", "---\nname: developer\ndescription: d\nmodel: sonnet\ntools: [Read, Bash]\n---\n\nno slot here\n");
    write(root, "plugins/sdlc/agents/reviewer.md", agent("reviewer", { body: "Run `cli.mjs expertise --role developer`." }));
    write(root, ORCHESTRATOR, "=== STABLE PREFIX ===\n=== PER-CALL CONTEXT ===\n");
    const errs = failures(checkRoster(root));
    assert.ok(errs.some((e) => /slot: .*developer\.md.*expertise --role developer/.test(e)), errs.join("\n"));
    assert.ok(errs.some((e) => /slot: .*reviewer\.md.*expertise --role reviewer/.test(e)), errs.join("\n"));
    assert.ok(errs.some((e) => /slot: .*SKILL\.md.*Stack expertise for/.test(e)), errs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("slot: an agent holding no Bash must NOT be told to run the bootstrap command it cannot run", () => {
  // The check was a bare substring test, so business-analyst.md and security-analyst.md passed it
  // with a sentence that was also false: neither holds Bash, and the orchestrator never issues
  // `expertise --role` (it pastes prompt_blocks from `plan --json`).
  const root = goodTree();
  try {
    write(root, "plugins/sdlc/agents/qa-engineer.md", agent("qa-engineer", { bash: false }));
    assert.deepEqual(failures(checkRoster(root)).filter((e) => /qa-engineer/.test(e)), [],
      "a Bash-less agent is clean when it only describes the orchestrated path");

    write(root, "plugins/sdlc/agents/qa-engineer.md", agent("qa-engineer", {
      bash: false, body: "Run `cli.mjs expertise --role qa-engineer` first.",
    }));
    const errs = failures(checkRoster(root));
    assert.ok(errs.some((e) => /slot: .*qa-engineer\.md.*holds no `Bash`/.test(e)), errs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("slot: every core agent carries the slot heading, whatever its tools", () => {
  const root = goodTree();
  try {
    write(root, "plugins/sdlc/agents/qa-engineer.md", "---\nname: qa-engineer\ndescription: d\nmodel: sonnet\ntools: [Read]\n---\n\nnothing\n");
    const errs = failures(checkRoster(root));
    assert.ok(errs.some((e) => /slot: .*qa-engineer\.md.*Stack expertise/.test(e)), errs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("home: an agents/ directory outside the core is a violation", () => {
  // The whole point of ADR-0021. A foundation that re-adds `agents/` gets its agents dispatched
  // by name the moment a manifest binds them, and the split silently reverts.
  const root = goodTree();
  try {
    assert.deepEqual(failures(checkRoster(root)).filter((e) => /^home:/.test(e)), []);
    write(root, "plugins/foo-foundation/agents/foo-developer.md", agent("foo-developer"));
    const errs = failures(checkRoster(root));
    assert.ok(errs.some((e) => /home: .*foo-foundation\/agents.*only plugins\/sdlc\/agents may/.test(e)), errs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("stragglers: a retired agent name, or a plugin-root path inside foundation rules, is a violation", () => {
  // Two different ways the move leaves a trap behind. A retired name in a shipped file is an
  // instruction to dispatch something that no longer exists; a plugin-root path inside `rules/`
  // resolves against the plugin owning the *agent* — now always `sdlc` — so every such path misses.
  const root = goodTree();
  try {
    assert.deepEqual(failures(checkRoster(root)).filter((e) => /^stragglers:/.test(e)), []);
    write(root, "plugins/foo-foundation/skills/foo-conventions/SKILL.md",
      "---\nname: foo-conventions\n---\n\nHand off to `android-developer` when done.\n");
    write(root, "plugins/foo-foundation/rules/house.md",
      "# house\n\nSee `${CLAUDE_PLUGIN_ROOT}/hooks/validate.sh`.\n");
    const errs = failures(checkRoster(root));
    assert.ok(errs.some((e) => /stragglers: .*foo-conventions\/SKILL\.md.*'android-developer'/.test(e)), errs.join("\n"));
    assert.ok(errs.some((e) => /stragglers: .*rules\/house\.md.*CLAUDE_PLUGIN_ROOT/.test(e)), errs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("stragglers: the migration data and the doctor command that applies it are exempt", () => {
  // `config/agent-migrations.json` is a map FROM the retired names; a check that forbade them
  // there would forbid the migration itself. Same for the command that shows the rename to a user.
  const root = goodTree();
  try {
    write(root, "plugins/sdlc/config/agent-migrations.json",
      JSON.stringify({ migrations: [{ renamed: { "android-ba": "business-analyst" } }] }));
    write(root, "plugins/sdlc/commands/doctor.md", "---\nname: doctor\n---\n\nagents: android-ba → business-analyst\n");
    assert.deepEqual(failures(checkRoster(root)).filter((e) => /^stragglers:/.test(e)), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the shipped marketplace honors every roster invariant", () => {
  const results = checkRoster(REPO);
  assert.deepEqual(failures(results), []);
  assert.ok(results.some((r) => r.check === "agents" && /plugins\/sdlc\/agents\/reviewer\.md/.test(r.file)), "the new core roles are in scope");
});
