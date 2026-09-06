// Step 1 as code. Most of these assert the GRACEFUL half of the contract: a project's
// optional config file must never be able to stop a run, so every validation failure drops
// one entry and continues rather than aborting.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mergeProfiles, applyLocalOverrides, parseCostCaps, parseExtensionSkills,
  parseModelOverrides, renderOverridesPrint, renderModelPrint, renderStackPrint,
  mergeRoleExpertise, renderRoleExpertiseBlock, renderSkillsBlock,
} from "../../../plugins/sdlc/tools/resolve/profile.mjs";

const vanilla = {
  stack: "vanilla",
  agents_per_phase: { business_analysis: "business-analyst", security: "security-analyst", documentation: "document-writer", development: "developer" },
};
const android = {
  stack: "android", workflow: "android-feature",
  agents_per_phase: { business_analysis: "android-ba", development: { android: "android-developer" }, security: "android-security" },
  convention_skills: ["android-foundation:android-architecture"],
  phase_injections: { development: "ANDROID DEV RULES" },
  post_pipeline_checks: ["./gradlew testDebugUnitTest"],
  heal_checks: ["./gradlew compileDebugKotlin"],
};
const retrofit = { stack: "retrofit", convention_skills: ["retrofit-plugin:retrofit-conventions"], phase_injections: { development: "RETROFIT RULES" } };
const room = { stack: "room", convention_skills: ["room-plugin:room-conventions"], phase_injections: { development: "ROOM RULES" } };

function merged(extra = {}) {
  return mergeProfiles({ primary: android, active: { android }, additive: [room, retrofit], vanilla, ...extra });
}

test("aspect-agnostic phases come from the primary, falling back to vanilla", () => {
  const { profile } = merged();
  assert.equal(profile.agents_per_phase.business_analysis, "android-ba");
  assert.equal(profile.agents_per_phase.documentation, "document-writer", "absent in primary -> vanilla");
});

test("aspect-aware phases build a {aspect: agent} map", () => {
  const { profile } = merged();
  assert.deepEqual(profile.agents_per_phase.development, { android: "android-developer" });
});

test("additive profiles never supply agents", () => {
  const sneaky = { stack: "sneaky", agents_per_phase: { security: "sneaky-agent" } };
  const { profile } = mergeProfiles({ primary: android, active: { android }, additive: [sneaky], vanilla });
  assert.equal(profile.agents_per_phase.security, "android-security", "a framework must not win an agent slot");
});

test("injections concatenate stack-first, then additive alphabetically by stack", () => {
  const { profile } = merged();
  assert.equal(profile.phase_prompts_injection.development, "ANDROID DEV RULES\n\nRETROFIT RULES\n\nROOM RULES",
    "retrofit before room — deterministic, not filesystem order");
});

test("convention skills union across stack and additive profiles", () => {
  const { profile } = merged();
  assert.deepEqual(profile.convention_skills.sort(), [
    "android-foundation:android-architecture", "retrofit-plugin:retrofit-conventions", "room-plugin:room-conventions",
  ]);
});

test("a duplicated extra_phase name is an error, not a silent overwrite", () => {
  const a = { stack: "a", extra_phases: [{ name: "audit", after: "qa" }] };
  const b = { stack: "b", extra_phases: [{ name: "audit", after: "security" }] };
  const { profile, errors } = mergeProfiles({ primary: a, active: { x: a }, additive: [b], vanilla });
  assert.equal(profile.extra_phases.length, 1);
  assert.equal(errors[0].code, "extra_phase_conflict");
});

test("post_pipeline_checks REPLACE, extra_phase_prompts APPEND", () => {
  const { profile } = merged();
  const r = applyLocalOverrides(profile, {
    post_pipeline_checks: ["./gradlew :app:testDevelopmentDebugUnitTest"],
    extra_phase_prompts: { development: "Kermit is NOT a dependency here." },
  });
  assert.deepEqual(r.profile.post_pipeline_checks, ["./gradlew :app:testDevelopmentDebugUnitTest"]);
  assert.match(r.profile.phase_prompts_injection.development, /^ANDROID DEV RULES/, "plugin guidance survives");
  assert.match(r.profile.phase_prompts_injection.development, /Kermit is NOT a dependency here\.$/);
});

test("an empty array disables the plugin's checks entirely", () => {
  const { profile } = merged();
  const r = applyLocalOverrides(profile, { heal_checks: [] });
  assert.deepEqual(r.profile.heal_checks, [], "[] must mean 'off', not 'unset'");
  assert.equal(r.applied.heal_checks, "replaced (0 items)");
});

test("the plugin profile is not mutated by applying overrides", () => {
  const { profile } = merged();
  const before = JSON.stringify(profile);
  applyLocalOverrides(profile, { post_pipeline_checks: [], convention_skills_extra: ["acme:x"] });
  assert.equal(JSON.stringify(profile), before, "a fallback is only a fallback if it survives intact");
});

test("cost_caps: null survives, bad values are dropped with a warning, unknown names are fine", () => {
  const warnings = [];
  const caps = parseCostCaps({ "android-feature": 8, hotfix: null, "*": 5, bad: "eight", negative: -1 }, warnings);
  assert.equal(caps["android-feature"], 8);
  assert.equal(caps.hotfix, null, "explicit null is the only way to opt out of a shipped cap");
  assert.equal(caps["*"], 5);
  assert.ok(!("bad" in caps));
  assert.ok(!("negative" in caps));
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => w.startsWith("WARN: cost_caps.")));
});

test("extension skills: dropped when unusable, downgraded when merely absent", () => {
  const warnings = [];
  const rows = parseExtensionSkills({
    skills: [
      { skill: "superpowers:test-driven-development", agents: ["android-developer"], policy: "mandatory" },
      { skill: "  ", agents: ["x"] },
      { skill: "acme:thing", agents: [] },
      { skill: "acme:other", agents: "all", policy: "nonsense" },
      { skill: "gone:missing", agents: ["x"], policy: "mandatory", when: "sometimes" },
    ],
  }, { availableSkills: new Set(["superpowers:test-driven-development", "acme:other"]) }, warnings);

  assert.equal(rows.length, 3, "the blank skill and the agent-less row are dropped");
  assert.equal(rows[0].policy, "mandatory");
  assert.equal(rows[1].agents, "all");
  assert.equal(rows[1].policy, "recommended", "an unknown policy falls back rather than aborting");
  const missing = rows[2];
  assert.equal(missing.policy, "recommended", "a missing skill must never block a project");
  assert.match(missing.when, /sometimes \(skill not installed — best-effort\)/);
});

test("an unavailable plugin downgrades its extension rows too", () => {
  const rows = parseExtensionSkills(
    { skills: [{ skill: "superpowers:x", agents: "all", policy: "mandatory" }] },
    { unavailablePlugins: { superpowers_unavailable: true } }, []);
  assert.equal(rows[0].policy, "recommended");
});

test("model overrides: one bad tier discards the whole file", () => {
  const ok = parseModelOverrides({ default: "sonnet", agents: { "business-analyst": "opus" } });
  assert.deepEqual(ok.overrides, { default: "sonnet", agents: { "business-analyst": "opus" } });
  assert.deepEqual(ok.warnings, []);

  const bad = parseModelOverrides({ default: "sonnet", agents: { "business-analyst": "gpt" } });
  assert.deepEqual(bad.overrides, {}, "a partly-applied tier map is harder to reason about than none");
  assert.match(bad.warnings[0], /unknown tier 'gpt'/);
});

test("the verbatim blocks are silent when nothing was overridden", () => {
  assert.equal(renderOverridesPrint({}), null);
  assert.equal(renderModelPrint({ agents: {} }), null);
  assert.match(renderOverridesPrint({ skip_phases: "security" }), /^🔧 Local overrides applied.*\n {3}skip_phases: security$/s);
  assert.match(renderModelPrint({ agents: { qa: "haiku" } }), /default: \(none\)\n {3}qa: haiku/);
});

test("only development and per-aspect declarations fan out; flat phases stay flat", () => {
  // Found on real project data, not in a fixture: making every non-agnostic phase an aspect
  // map turned `test: android-tester` into `{android: android-tester}`, which the dry-run row
  // then printed as `[object Object]`. Step 1a names the aspect-aware set exactly.
  const { profile } = merged();
  assert.deepEqual(profile.agents_per_phase.development, { android: "android-developer" }, "development always fans out");
  assert.equal(profile.agents_per_phase.security, "android-security");

  const perAspect = {
    stack: "multi",
    agents_per_phase: { development: "d", qa: { android: "qa-android", backend: "qa-backend" }, test: "t" },
  };
  const { profile: p2 } = mergeProfiles({ primary: perAspect, active: { android: perAspect }, additive: [], vanilla });
  assert.equal(p2.agents_per_phase.test, "t", "a flatly-declared phase stays a plain agent name");
  assert.equal(typeof p2.agents_per_phase.qa, "object", "a phase DECLARED per-aspect does fan out");
});

test("the stack banner degrades to em-dashes rather than fabricating aspects", () => {
  const out = renderStackPrint({ foundation: "x", priority: 0, source: "core/manifest.yaml", aspects: [], additive: [], forced: true });
  assert.match(out, /aspects: {2}—/);
  assert.match(out, /additive: —/);
  assert.match(out, /forced via --stack: yes/);
  assert.equal(renderStackPrint({ foundation: null }), null, "no winning foundation, no banner");
  assert.equal(renderStackPrint(null), null);
});

// ---- ADR-0021: agents live in the core; foundations carry expertise -------------------------

const coreVanilla = {
  stack: "vanilla",
  agents_per_phase: {
    business_analysis: "business-analyst", development: "developer", review: "reviewer", security: "security-analyst",
    remediation: "developer", test: "tester", qa: "qa-engineer", debugging: "debugger", documentation: "document-writer",
  },
};

test("a foundation that binds no agents still fans development out over its aspect, bound to the core agent", () => {
  // Post-ADR-0021 an Android run must keep its dry-run/telemetry row shape
  // (`development — android → developer`), so the vanilla FLAT binding expands per active aspect.
  const expertiseOnly = { stack: "android", aspects: ["android"], workflow: "android-feature" };
  const { profile } = mergeProfiles({ primary: expertiseOnly, active: { android: expertiseOnly }, additive: [], vanilla: coreVanilla });
  assert.deepEqual(profile.agents_per_phase.development, { android: "developer" });
  assert.equal(profile.agents_per_phase.review, "reviewer", "a flat core phase stays flat");
  assert.equal(profile.agents_per_phase.test, "tester");
});

test("renderSkillsBlock resolves an equal-policy collision deterministically, by the alphabetically-first `when`", () => {
  // File order must not change the prompt: the stable prefix is cache-keyed on its bytes, and two
  // mandatory rows for one skill are exactly what an `agents: [x]` row plus an `agents: "all"` row
  // produce. Documented in the prose this block replaced; now pinned in code.
  const rows = [
    { skill: "s:x", policy: "mandatory", when: "zulu" },
    { skill: "s:x", policy: "mandatory", when: "alpha" },
  ];
  const forward = renderSkillsBlock("developer", { roleSkills: rows, extensionRows: [] });
  const reversed = renderSkillsBlock("developer", { roleSkills: [...rows].reverse(), extensionRows: [] });
  assert.equal(forward, reversed, "reordering sdlc.local.yaml must not invalidate the cached prefix");
  assert.match(forward, /— alpha\./);
});

test("a foundation still binding agents_per_phase is honored but warned about (deprecated, ADR-0021)", () => {
  const { profile, warnings } = merged();
  assert.equal(profile.agents_per_phase.business_analysis, "android-ba", "PR-1 keeps the override alive");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^WARN: foundation 'android' declares agents_per_phase — deprecated \(ADR-0021\)/);
  const clean = mergeProfiles({ primary: { stack: "x", aspects: ["android"] }, active: {}, additive: [], vanilla: coreVanilla });
  assert.deepEqual(clean.warnings, [], "no binding, no warning — the core manifest itself never warns");
});

test("extra_phases[].agent binds a core role for a phase the core map does not know", () => {
  const audit = { stack: "x", aspects: ["android"], extra_phases: [{ name: "audit", after: "qa", agent: "reviewer" }] };
  const { profile } = mergeProfiles({ primary: audit, active: { android: audit }, additive: [], vanilla: coreVanilla });
  assert.equal(profile.agents_per_phase.audit, "reviewer");
});

function expertiseWorld() {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-expertise-"));
  const found = join(dir, "android-foundation");
  const fw = join(dir, "room-plugin");
  mkdirSync(join(found, "rules", "snippets"), { recursive: true });
  mkdirSync(join(fw, "rules"), { recursive: true });
  writeFileSync(join(found, "rules", "snippets", "non-negotiable.md"), "# forbidden\n");
  writeFileSync(join(found, "rules", "logging.md"), "# logging\n");
  writeFileSync(join(fw, "rules", "room.md"), "# room\n");
  return { dir, found, fw };
}

test("mergeRoleExpertise: primary first, then additive alphabetically; rules absolute; missing rule dropped with a warning", () => {
  const w = expertiseWorld();
  try {
    const sources = [
      { stack: "android", dir: w.found, role_expertise: {
        developer: {
          invariants: "ANDROID DEV",
          rules: [{ path: "rules/snippets/non-negotiable.md", note: "forbidden patterns" }, "rules/logging.md", "rules/does-not-exist.md"],
          skills: [{ skill: "superpowers:test-driven-development", when: "before the first edit" }],
        },
      } },
      { stack: "room", dir: w.fw, role_expertise: { developer: { invariants: "ROOM DEV", rules: ["rules/room.md"] } } },
      { stack: "dagger", dir: w.fw, role_expertise: { developer: { invariants: "DAGGER DEV" } } },
    ];
    const { role_expertise: rx, warnings } = mergeRoleExpertise(sources);
    assert.equal(rx.developer.invariants, "ANDROID DEV\n\nDAGGER DEV\n\nROOM DEV", "foundation first, then frameworks by stack name");
    assert.deepEqual(rx.developer.rules, [
      { path: join(w.found, "rules/snippets/non-negotiable.md"), note: "forbidden patterns" },
      { path: join(w.found, "rules/logging.md"), note: "" },
      { path: join(w.fw, "rules/room.md"), note: "" },
    ]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /role_expertise\.developer\.rules: rules\/does-not-exist\.md not found under android — dropped/);
    assert.deepEqual(rx.developer.skills, [{ skill: "superpowers:test-driven-development", policy: "mandatory", when: "before the first edit" }],
      "policy defaults to mandatory");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("mergeRoleExpertise: the same skill from two sources collapses to one row, strictest policy wins", () => {
  const sources = [
    { stack: "a", dir: "/nowhere", role_expertise: { tester: { skills: [{ skill: "s:x", policy: "recommended", when: "sometimes" }] } } },
    { stack: "b", dir: "/nowhere", role_expertise: { tester: { skills: [{ skill: "s:x", policy: "mandatory", when: "always" }, { skill: "s:y", policy: "recommended" }] } } },
  ];
  const { role_expertise: rx } = mergeRoleExpertise(sources);
  assert.deepEqual(rx.tester.skills, [
    { skill: "s:x", policy: "mandatory", when: "always" },
    { skill: "s:y", policy: "recommended", when: "" },
  ]);
});

test("renderRoleExpertiseBlock: header, invariants, rule list — or null when the role has nothing", () => {
  const block = renderRoleExpertiseBlock("developer", {
    invariants: "Never block main.",
    rules: [{ path: "/abs/rules/non-negotiable.md", note: "forbidden patterns" }, { path: "/abs/rules/logging.md", note: "" }],
    skills: [],
  }, { stack: "android" });
  assert.equal(block, [
    "Stack expertise for developer (android):",
    "Never block main.",
    "Rule files (Read the ones your task touches):",
    "- /abs/rules/non-negotiable.md — forbidden patterns",
    "- /abs/rules/logging.md",
  ].join("\n"));
  assert.equal(renderRoleExpertiseBlock("developer", { skills: [{ skill: "s:x", policy: "mandatory" }] }, { stack: "android" }), null,
    "skills render in their own block — this one is empty without invariants or rules");
  assert.equal(renderRoleExpertiseBlock("developer", undefined, { stack: "vanilla" }), null);
});

test("renderSkillsBlock: role skills and matching extension rows, deduped, mandatory first then alphabetical — or null", () => {
  const block = renderSkillsBlock("developer", {
    roleSkills: [
      { skill: "superpowers:test-driven-development", policy: "mandatory", when: "before the first edit" },
      { skill: "acme:zed", policy: "recommended", when: "" },
    ],
    extensionRows: [
      { skill: "superpowers:test-driven-development", agents: "all", policy: "recommended", when: "project says so" },
      { skill: "acme:alpha", agents: ["developer"], policy: "mandatory", when: "" },
      { skill: "acme:other", agents: ["reviewer"], policy: "mandatory", when: "" },
    ],
  });
  assert.equal(block, [
    "Skills for this role (from the active stack profile and this project's .claude/sdlc.local.yaml):",
    "- MANDATORY — invoke `acme:alpha`. Do not skip; this project requires it.",
    "- MANDATORY — invoke `superpowers:test-driven-development` — before the first edit. Do not skip; this project requires it.",
    "- RECOMMENDED — consider invoking `acme:zed`.",
  ].join("\n"));
  assert.equal(renderSkillsBlock("developer", { roleSkills: [], extensionRows: [{ skill: "s", agents: ["reviewer"], policy: "mandatory", when: "" }] }), null);
});

test("an extension row targeting an agent that does not exist is reported, not silently ignored", () => {
  // ADR-0021 renamed the roster and ships NO aliases: a project still naming `android-developer`
  // targets nothing. Translating it silently was the bug class this replaces — say so instead.
  const warnings = [];
  const known = new Set(["developer", "reviewer"]);
  const rows = parseExtensionSkills({
    skills: [
      { skill: "acme:x", agents: ["android-developer", "developer"], policy: "mandatory" },
      { skill: "acme:y", agents: ["android-tester"], policy: "mandatory" },
    ],
  }, { knownAgents: known }, warnings);

  assert.deepEqual(rows.map((r) => r.skill), ["acme:x"], "a row left with no real target is dropped");
  assert.deepEqual(rows[0].agents, ["developer"], "the unknown name is filtered out, the real one survives");
  assert.match(warnings[0], /^WARN: extensions\.skills\[0\] targets unknown agent 'android-developer'/);
  assert.match(warnings[0], /run \/sdlc:doctor/);
  assert.match(warnings[1], /extensions\.skills\[1\] targets unknown agent 'android-tester'/);
  assert.match(warnings[2], /extensions\.skills\[1\] \(acme:y\) targets no known agent — dropped/);
});

test("agent names are validated only when the roster is known, and `all` is never an agent name", () => {
  const warnings = [];
  const rows = parseExtensionSkills({ skills: [{ skill: "acme:x", agents: ["whatever"] }, { skill: "acme:y", agents: "all" }] }, {}, warnings);
  assert.equal(rows.length, 2, "no roster passed, no validation — the parser must never guess");
  assert.deepEqual(warnings, []);
  const w2 = [];
  parseExtensionSkills({ skills: [{ skill: "acme:y", agents: "all" }] }, { knownAgents: new Set(["developer"]) }, w2);
  assert.deepEqual(w2, [], "`all` is a wildcard, not a name to validate");
});

test("a model override keyed by an agent that does not exist is dropped and reported, without discarding the file", () => {
  const known = new Set(["developer", "business-analyst"]);
  const r = parseModelOverrides({ default: "sonnet", agents: { "android-ba": "opus", developer: "haiku" } }, { knownAgents: known });
  assert.deepEqual(r.overrides, { default: "sonnet", agents: { developer: "haiku" } },
    "an unknown key is a no-op entry, not a corrupt file — unlike a bad tier it must not fail the whole map closed");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^WARN: \.claude\/model\.local\.json names unknown agent 'android-ba'/);
  assert.match(r.warnings[0], /run \/sdlc:doctor/);
});
