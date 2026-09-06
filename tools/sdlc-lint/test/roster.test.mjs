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

const agent = (name, extra = "") => `---\nname: ${name}\ndescription: d\nmodel: sonnet\ntools: [Read]\n---\n\n## Stack expertise\n\nRun \`node \${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs expertise --role ${name}\`.\n${extra}`;

/** A minimal marketplace tree that satisfies every roster invariant. */
function goodTree() {
  const root = mkdtempSync(join(tmpdir(), "sdlc-roster-"));
  write(root, CORE_MANIFEST, [
    "kind: foundation", "stack: vanilla", "priority: 0", "detect:", '  any: ["*"]',
    "agents_per_phase:", "  development: developer", "  qa: qa-engineer", "  review: reviewer",
    "on_demand_agents: [debugger]", "",
  ].join("\n"));
  for (const n of ["developer", "qa-engineer", "reviewer", "debugger"]) write(root, `plugins/sdlc/agents/${n}.md`, agent(n));
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

test("slot: a core agent without its own `expertise --role <name>` line, or an orchestrator without the block, is a violation", () => {
  const root = goodTree();
  try {
    write(root, "plugins/sdlc/agents/developer.md", "---\nname: developer\ndescription: d\nmodel: sonnet\ntools: [Read]\n---\n\nno slot here\n");
    write(root, "plugins/sdlc/agents/reviewer.md", agent("reviewer").replace("expertise --role reviewer", "expertise --role developer"));
    write(root, ORCHESTRATOR, "=== STABLE PREFIX ===\n=== PER-CALL CONTEXT ===\n");
    const errs = failures(checkRoster(root));
    assert.ok(errs.some((e) => /slot: .*developer\.md.*expertise --role developer/.test(e)), errs.join("\n"));
    assert.ok(errs.some((e) => /slot: .*reviewer\.md.*expertise --role reviewer/.test(e)), errs.join("\n"));
    assert.ok(errs.some((e) => /slot: .*SKILL\.md.*Stack expertise for/.test(e)), errs.join("\n"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the shipped marketplace honors every roster invariant", () => {
  const results = checkRoster(REPO);
  assert.deepEqual(failures(results), []);
  assert.ok(results.some((r) => r.check === "agents" && /plugins\/sdlc\/agents\/reviewer\.md/.test(r.file)), "the new core roles are in scope");
});
