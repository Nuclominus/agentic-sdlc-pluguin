// The gate that makes the shipped YAML subset parser trustworthy.
//
// plugins/sdlc/tools/resolve/yaml.mjs exists because the plugin ships without dependencies
// (no package.json, no node_modules), so the `yaml` package cannot travel with it. Hand-written
// parsers earn trust by differential testing, not by review: every YAML file the resolve command
// can encounter is parsed by BOTH implementations and the results must be deep-equal.
//
// A divergence here is a red build. Without it, the failure mode is a user's
// `extra_phase_prompts` block scalar silently losing a line and an agent receiving a corrupted
// prompt — invisible, and exactly the class of defect ADR-0019 is meant to remove rather than
// relocate.
//
// Consumer projects are not present in CI. Repository YAML and the fixtures below always run;
// a real project's `.claude/` is additionally checked when SDLC_PARITY_PROJECTS names one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { parseYaml, YamlSubsetError } from "../../../plugins/sdlc/tools/resolve/yaml.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function walkYaml(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walkYaml(p, out);
    else if (/\.ya?ml$/.test(e.name)) out.push(p);
  }
  return out;
}

const repoFiles = [
  ...walkYaml(join(REPO, "plugins")),
  ...walkYaml(join(REPO, "schemas")),
  ...walkYaml(join(REPO, ".github")),
];

test("the repository has YAML for this test to be about", () => {
  assert.ok(repoFiles.length >= 10, `expected the corpus to be non-trivial, got ${repoFiles.length}`);
});

for (const file of repoFiles) {
  test(`parity: ${relative(REPO, file)}`, () => {
    const src = readFileSync(file, "utf8");
    let expected;
    try { expected = YAML.parse(src); } catch { return; }   // invalid YAML is not this test's subject
    assert.deepEqual(parseYaml(src), expected);
  });
}

// Shapes taken from real consumer projects, pinned here so CI keeps covering them even though
// those projects are not available to it. The block scalar is the one that matters: it is prose
// containing colons, dashes and a blank line, i.e. everything that breaks a naive parser.
const WILD = {
  "block scalar with prose (Citrus extra_phase_prompts)": `
extra_phase_prompts:
  development: |
    Logging/error visibility: Kermit is NOT a dependency — use Firebase.

    Second paragraph: keep the blank line above.
      An indented continuation line.
  qa: "plain"
`,
  "post_pipeline_checks with quoted shell": `
post_pipeline_checks:
  - "sh -c './gradlew :app:testDevelopmentDebugUnitTest'"
  - "sh -c './gradlew :app:compileDevelopmentDebugKotlin'"
`,
  "extensions: sequence of mappings with flow sequence": `
extensions:
  skills:
    - skill: "superpowers:test-driven-development"
      agents: [android-developer, android-tester]
      when: always
    - skill: "local:our-conventions"
      agents: all
`,
  "inline comments after values": `
active_workflow: android-feature      # detected default for the PRIMARY profile
priority: 300                         # highest wins
enabled: true                         # not a string
`,
  "detect block: nested any/all sequences": `
detect:
  all:
    - any:
        - file_exists: settings.gradle.kts
        - file_exists: settings.gradle
    - file_glob: "**/*.kt"
`,
  "null and empty values": `
cost_caps:
  hotfix: null
  default:
  "*": 8.00
`,
  "folded scalar": `
note: >
  one line
  folded into another

  after a blank line
`,
  "chomping indicators": `
strip: |-
  no trailing newline
keep: |+
  trailing kept

clip: |
  exactly one
`,
  "flow mapping and empty collections": `
empty_list: []
empty_map: {}
flow_map: {a: 1, b: "two"}
`,
  "quoted keys and escapes": `
"quoted key": "line\\nbreak"
'single': 'it''s fine'
`,
  "aspects and always-match detect": `
aspects: [android]
detect:
  any: ["*"]
`,
  // Found by this gate on a real .gitlab-ci.yml: a plain scalar continuing over more-indented
  // lines. Ordinary YAML, and just as writable in .claude/sdlc.local.yaml — the parser threw
  // on it before this case existed.
  "multi-line plain scalar in a sequence": `
script:
  - firebase appdistribution:distribute builds/parlor_release.aab
    --app "\$FIREBASE_APP_ID"
    --groups "Olearis"
  - chmod +x firebase
`,
  "multi-line plain scalar in a mapping": `
extra_phase_prompts:
  development: Follow our internal module-structure.md
    and keep new modules under the feature namespace
  qa: single line
`,
};

for (const [name, src] of Object.entries(WILD)) {
  test(`parity (wild shape): ${name}`, () => {
    assert.deepEqual(parseYaml(src), YAML.parse(src));
  });
}

// The subset must FAIL LOUDLY outside its grammar. A parser that returns something plausible
// for input it does not understand is worse than the prose ADR-0019 replaces.
const UNSUPPORTED = {
  anchors: "base: &a\n  x: 1\nother: *a\n",
  "multi-document stream": "a: 1\n---\nb: 2\n",
  directives: "%YAML 1.2\n---\na: 1\n",
  "complex key": "? [a, b]\n: value\n",
  tabs: "a:\n\t- 1\n",
};

for (const [name, src] of Object.entries(UNSUPPORTED)) {
  test(`rejects unsupported: ${name}`, () => {
    assert.throws(() => parseYaml(src), (e) => e instanceof YamlSubsetError || e instanceof Error);
  });
}

test("optional: a real project's SDLC config, when SDLC_PARITY_PROJECTS names one", () => {
  const roots = (process.env.SDLC_PARITY_PROJECTS || "").split(":").filter(Boolean);
  if (roots.length === 0) return;

  // Exactly the project files the resolve command reads — not everything under .claude/.
  // A stale worktree there can hold an entire unrelated checkout (.gitlab-ci.yml, pubspec.yaml,
  // Maestro flows), and asserting parity on those would claim a guarantee the command never
  // needs. The wild-shape fixtures above are where broad coverage belongs, because CI has them.
  let checked = 0;
  for (const root of roots) {
    const candidates = [
      join(root, ".claude", "sdlc.local.yaml"),
      ...walkYaml(join(root, ".claude", "sdlc-workflows")),
    ];
    for (const f of candidates) {
      if (!existsSync(f) || !statSync(f).isFile()) continue;
      const src = readFileSync(f, "utf8");
      let expected;
      try { expected = YAML.parse(src); } catch { continue; }
      assert.deepEqual(parseYaml(src), expected, `divergence in ${f}`);
      checked++;
    }
  }
  assert.ok(checked > 0, `SDLC_PARITY_PROJECTS was set but no SDLC config YAML was found`);
});
