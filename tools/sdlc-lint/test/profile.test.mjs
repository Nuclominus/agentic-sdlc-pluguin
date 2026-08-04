// Step 1 as code. Most of these assert the GRACEFUL half of the contract: a project's
// optional config file must never be able to stop a run, so every validation failure drops
// one entry and continues rather than aborting.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeProfiles, applyLocalOverrides, parseCostCaps, parseExtensionSkills,
  parseModelOverrides, renderOverridesPrint, renderModelPrint,
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
  const ok = parseModelOverrides({ default: "sonnet", agents: { "android-ba": "opus" } });
  assert.deepEqual(ok.overrides, { default: "sonnet", agents: { "android-ba": "opus" } });
  assert.deepEqual(ok.warnings, []);

  const bad = parseModelOverrides({ default: "sonnet", agents: { "android-ba": "gpt" } });
  assert.deepEqual(bad.overrides, {}, "a partly-applied tier map is harder to reason about than none");
  assert.match(bad.warnings[0], /unknown tier 'gpt'/);
});

test("the verbatim blocks are silent when nothing was overridden", () => {
  assert.equal(renderOverridesPrint({}), null);
  assert.equal(renderModelPrint({ agents: {} }), null);
  assert.match(renderOverridesPrint({ skip_phases: "security" }), /^🔧 Local overrides applied.*\n {3}skip_phases: security$/s);
  assert.match(renderModelPrint({ agents: { qa: "haiku" } }), /default: \(none\)\n {3}qa: haiku/);
});
