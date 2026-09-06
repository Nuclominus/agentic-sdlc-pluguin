// ADR-0021 — the legacy android-* agent names survive one release as aliases. Consumers'
// `.claude/sdlc.local.yaml` (`extensions.skills[].agents`) and `.claude/model.local.json`
// (`agents{}`) were written against the foundation roster; the resolver must keep honoring
// them, warn once per site, and never silently drop a row because of a rename.

import { test } from "node:test";
import assert from "node:assert/strict";
import { LEGACY_AGENT_ALIASES, canonicalAgentName, legacyNamesFor } from "../../../plugins/sdlc/tools/resolve/aliases.mjs";

test("every deleted android-foundation agent has exactly one core successor", () => {
  assert.deepEqual(LEGACY_AGENT_ALIASES, {
    "android-ba": "business-analyst",
    "android-developer": "developer",
    "android-reviewer": "reviewer",
    "android-security": "security-analyst",
    "android-tester": "tester",
    "android-qa": "qa-engineer",
    "android-docs": "document-writer",
    "android-debugger": "debugger",
    "android-devops": "devops",
    "android-cicd": "cicd",
    "android-aar": "aar-analyst",
  });
});

test("a legacy name is mapped and warned about, naming where it was found", () => {
  const warnings = [];
  assert.equal(canonicalAgentName("android-developer", warnings, "sdlc.local.yaml extensions.skills[0]"), "developer");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^WARN: sdlc\.local\.yaml extensions\.skills\[0\] names legacy agent 'android-developer' → 'developer' \(deprecated alias, ADR-0021/);
});

test("a plugin-qualified legacy name is mapped too — dispatch names carry the prefix", () => {
  const warnings = [];
  assert.equal(canonicalAgentName("android-foundation:android-ba", warnings, "x"), "business-analyst");
  assert.equal(warnings.length, 1);
});

test("a canonical name passes through untouched and silently", () => {
  const warnings = [];
  assert.equal(canonicalAgentName("developer", warnings, "x"), "developer");
  assert.equal(canonicalAgentName("sdlc:qa-engineer", warnings, "x"), "qa-engineer", "the prefix is stripped either way");
  assert.equal(canonicalAgentName("all", warnings, "x"), "all", "the extensions wildcard is not an agent name");
  assert.deepEqual(warnings, []);
});

test("an unknown name is not an alias — it passes through for the caller to validate", () => {
  const warnings = [];
  assert.equal(canonicalAgentName("acme-agent", warnings, "x"), "acme-agent");
  assert.deepEqual(warnings, []);
});

test("legacyNamesFor is the reverse lookup the hook mirror is built from", () => {
  assert.deepEqual(legacyNamesFor("developer"), ["android-developer"]);
  assert.deepEqual(legacyNamesFor("session-recorder"), [], "a role that never had a foundation twin");
});
