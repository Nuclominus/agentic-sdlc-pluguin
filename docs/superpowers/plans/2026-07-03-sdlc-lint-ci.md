# sdlc-lint CLI + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic Node CLI (`tools/sdlc-lint`) that validates every plugin manifest/workflow/model file against its JSON Schema, detects illegal workflow DAGs, and verifies stack auto-detection against fixture project trees — wired into GitHub Actions CI.

**Architecture:** A standalone ESM package under `tools/sdlc-lint`. Pure file-reading verifier — it never invokes or imports the `pipeline-orchestrator` skill (the "core never changes" invariant holds; this is a *parallel* verification layer). Subcommands `schema`/`cycles`/`detect`/`all` compose small `lib/*.mjs` modules; `all` is what CI runs.

**Tech Stack:** Node.js 20+ (ESM `.mjs`), `yaml` (parse manifests/workflows), `ajv` + `ajv-formats` (JSON Schema draft 2020-12), `tinyglobby` (globbing), `node:test` (unit tests), GitHub Actions, `shellcheck`.

## Global Constraints

- Node **20+**, ESM only (`"type": "module"`). No TypeScript, no build step — run `.mjs` directly.
- Dependencies limited to: `yaml ^2`, `ajv ^8`, `ajv-formats ^3`, `tinyglobby ^0.2`. No others.
- **Do NOT modify `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` logic.** The only allowed touch is a one-line guard *comment* in its Step 0b (Task 7).
- All schemas live in `schemas/` and use `$schema: draft/2020-12` — Ajv must be imported as `ajv/dist/2020.js`.
- Exit codes everywhere: `0` clean, `1` findings (validation/detection failure), `2` tool error (missing schema, missing `expected.json`, unreadable file).
- Git: work on branch `feat/sdlc-lint-ci` (already created). Stage **only** the exact paths each step names — never `git add -A` (the user edits files concurrently).
- Framework `stack` values used as additive identifiers: `retrofit`, `room`, `dagger`.

---

### Task 1: Package scaffold + manifest/workflow loader

**Files:**
- Create: `tools/sdlc-lint/package.json`
- Create: `tools/sdlc-lint/lib/load.mjs`
- Test: `tools/sdlc-lint/test/load.test.mjs`

**Interfaces:**
- Produces: `loadManifests(root) → { foundations: [{file,doc}], frameworks: [{file,doc}], errors: [{file,error}] }` where `doc` is the parsed YAML; foundations/frameworks split by `doc.kind`.
- Produces: `loadWorkflows(root) → { workflows: [{file,doc}], errors: [{file,error}] }` — excludes any path containing `/test-fixtures/`.

- [ ] **Step 1: Create the package manifest**

`tools/sdlc-lint/package.json`:
```json
{
  "name": "sdlc-lint",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "sdlc-lint": "./cli.mjs" },
  "scripts": { "test": "node --test test" },
  "dependencies": {
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "tinyglobby": "^0.2.10",
    "yaml": "^2.6.1"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install --prefix tools/sdlc-lint`
Expected: creates `tools/sdlc-lint/node_modules` + `package-lock.json`, no errors.

- [ ] **Step 3: Write the failing test**

`tools/sdlc-lint/test/load.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadManifests, loadWorkflows } from "../lib/load.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("loadManifests splits foundations and frameworks", () => {
  const { foundations, frameworks, errors } = loadManifests(REPO);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  const fstacks = foundations.map(f => f.doc.stack).sort();
  assert.deepEqual(fstacks, ["android", "vanilla"]);
  const fwstacks = frameworks.map(f => f.doc.stack).sort();
  assert.deepEqual(fwstacks, ["dagger", "retrofit", "room"]);
});

test("loadWorkflows excludes test-fixtures", () => {
  const { workflows } = loadWorkflows(REPO);
  assert.ok(workflows.length >= 5);
  assert.ok(!workflows.some(w => w.file.includes("/test-fixtures/")));
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test tools/sdlc-lint/test/load.test.mjs`
Expected: FAIL — `Cannot find module '../lib/load.mjs'`.

- [ ] **Step 5: Implement the loader**

`tools/sdlc-lint/lib/load.mjs`:
```js
import { readFileSync } from "node:fs";
import { globSync } from "tinyglobby";
import YAML from "yaml";

export function loadManifests(root = process.cwd()) {
  const files = globSync("plugins/**/manifest.yaml", { cwd: root, absolute: true });
  const foundations = [], frameworks = [], errors = [];
  for (const file of files) {
    let doc;
    try { doc = YAML.parse(readFileSync(file, "utf8")); }
    catch (e) { errors.push({ file, error: `YAML parse: ${e.message}` }); continue; }
    if (doc?.kind === "foundation") foundations.push({ file, doc });
    else if (doc?.kind === "framework") frameworks.push({ file, doc });
    else errors.push({ file, error: `unknown or missing kind: ${doc?.kind}` });
  }
  return { foundations, frameworks, errors };
}

export function loadWorkflows(root = process.cwd()) {
  const files = globSync("plugins/**/workflows/*.yaml", { cwd: root, absolute: true })
    .filter(f => !f.includes("/test-fixtures/"));
  const workflows = [], errors = [];
  for (const file of files) {
    try { workflows.push({ file, doc: YAML.parse(readFileSync(file, "utf8")) }); }
    catch (e) { errors.push({ file, error: `YAML parse: ${e.message}` }); }
  }
  return { workflows, errors };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tools/sdlc-lint/test/load.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add tools/sdlc-lint/package.json tools/sdlc-lint/package-lock.json tools/sdlc-lint/lib/load.mjs tools/sdlc-lint/test/load.test.mjs
git commit -m "feat(sdlc-lint): package scaffold + manifest/workflow loader"
```

---

### Task 2: Schema validation module + `schema` subcommand

**Files:**
- Create: `tools/sdlc-lint/lib/schema.mjs`
- Create: `tools/sdlc-lint/cli.mjs`
- Test: `tools/sdlc-lint/test/schema.test.mjs`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `checkSchemas(root) → [{ file, schema, ok, errors:[string] }]` — one entry per validated file across the four schema mappings (excludes `/test-fixtures/`).
- Produces: `cli.mjs` dispatching `schema` (more subcommands added later).

- [ ] **Step 1: Write the failing test**

`tools/sdlc-lint/test/schema.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { checkSchemas } from "../lib/schema.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("all real plugin files pass their schema", () => {
  const results = checkSchemas(REPO);
  const failed = results.filter(r => !r.ok);
  assert.equal(failed.length, 0, JSON.stringify(failed, null, 2));
  assert.ok(results.some(r => r.schema.endsWith("manifest.schema.json")));
  assert.ok(results.some(r => r.schema.endsWith("workflow.schema.json")));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/sdlc-lint/test/schema.test.mjs`
Expected: FAIL — `Cannot find module '../lib/schema.mjs'`.

- [ ] **Step 3: Implement the schema module**

`tools/sdlc-lint/lib/schema.mjs`:
```js
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "tinyglobby";
import YAML from "yaml";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const SCHEMA_MAP = [
  { glob: "plugins/**/manifest.yaml",        schema: "schemas/manifest.schema.json",    parse: "yaml" },
  { glob: "plugins/**/workflows/*.yaml",     schema: "schemas/workflow.schema.json",    parse: "yaml" },
  { glob: "plugins/sdlc/config/models.json", schema: "schemas/models.schema.json",      parse: "json" },
  { glob: "**/.claude/model.local.json",     schema: "schemas/model-local.schema.json", parse: "json" },
];

const fmtErr = (e) => `${e.instancePath || "/"} ${e.message}`;

export function checkSchemas(root = process.cwd()) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const results = [];
  for (const { glob, schema, parse } of SCHEMA_MAP) {
    let validate;
    try {
      validate = ajv.compile(JSON.parse(readFileSync(join(root, schema), "utf8")));
    } catch (e) {
      results.push({ file: schema, schema, ok: false, tool_error: true, errors: [`schema load: ${e.message}`] });
      continue;
    }
    const files = globSync(glob, { cwd: root, absolute: true, dot: true })
      .filter(f => !f.includes("/test-fixtures/"));
    for (const file of files) {
      let data;
      try {
        const raw = readFileSync(file, "utf8");
        data = parse === "yaml" ? YAML.parse(raw) : JSON.parse(raw);
      } catch (e) {
        results.push({ file, schema, ok: false, errors: [`parse: ${e.message}`] });
        continue;
      }
      const ok = validate(data);
      results.push({ file, schema, ok, errors: ok ? [] : validate.errors.map(fmtErr) });
    }
  }
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/sdlc-lint/test/schema.test.mjs`
Expected: PASS. (If a real manifest legitimately fails, that is a genuine finding — fix the manifest, not the test.)

- [ ] **Step 5: Create the CLI router with the `schema` subcommand**

`tools/sdlc-lint/cli.mjs`:
```js
#!/usr/bin/env node
import { checkSchemas } from "./lib/schema.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const jsonOut = args.includes("--json");
const root = process.cwd();

function printSchema(results) {
  const failed = results.filter(r => !r.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ command: "schema", checked: results.length, failed: failed.length, failures: failed }));
  } else {
    for (const r of failed) console.error(`✗ ${r.file}\n    ${r.errors.join("\n    ")}`);
    console.log(`schema: ${results.length - failed.length}/${results.length} passed`);
  }
  return failed.some(r => r.tool_error) ? 2 : failed.length ? 1 : 0;
}

let code = 0;
switch (cmd) {
  case "schema": code = printSchema(checkSchemas(root)); break;
  case undefined:
  case "--help":
    console.log("Usage: sdlc-lint <schema|cycles|detect|all> [--json]");
    break;
  default:
    console.error(`unknown command: ${cmd}`);
    code = 2;
}
process.exit(code);
```

- [ ] **Step 6: Run the subcommand against the repo**

Run: `node tools/sdlc-lint/cli.mjs schema`
Expected: `schema: N/N passed`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add tools/sdlc-lint/lib/schema.mjs tools/sdlc-lint/cli.mjs tools/sdlc-lint/test/schema.test.mjs
git commit -m "feat(sdlc-lint): JSON Schema validation + schema subcommand"
```

---

### Task 3: Workflow acyclic check + `cycles` subcommand

**Files:**
- Create: `tools/sdlc-lint/lib/cycles.mjs`
- Modify: `tools/sdlc-lint/cli.mjs` (add `cycles` case)
- Test: `tools/sdlc-lint/test/cycles.test.mjs`

**Interfaces:**
- Consumes: `loadWorkflows` from Task 1.
- Produces: `checkWorkflow(doc) → { ok, errors:[string] }` — flags duplicate phase names and invalid `loop.return_to` back-edges (target must be an earlier declared phase).
- Produces: `checkAllWorkflows(root) → [{ file, ok, errors }]`.

- [ ] **Step 1: Write the failing test**

`tools/sdlc-lint/test/cycles.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import YAML from "yaml";
import { checkWorkflow, checkAllWorkflows } from "../lib/cycles.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("duplicate phase name is flagged", () => {
  const doc = YAML.parse(readFileSync(
    resolve(REPO, "plugins/sdlc/workflows/test-fixtures/cyclic.yaml"), "utf8"));
  const { ok, errors } = checkWorkflow(doc);
  assert.equal(ok, false);
  assert.match(errors.join(" "), /duplicate phase 'business_analysis'/);
});

test("android-feature loop back-edge is valid", () => {
  const doc = YAML.parse(readFileSync(
    resolve(REPO, "plugins/android-foundation/workflows/android-feature.yaml"), "utf8"));
  assert.equal(checkWorkflow(doc).ok, true);
});

test("loop return_to to a later phase is flagged", () => {
  const doc = { name: "bad", phases: [
    { name: "review", loop: { return_to: "development", max_rounds: 2 } },
    "development",
  ]};
  const { ok, errors } = checkWorkflow(doc);
  assert.equal(ok, false);
  assert.match(errors.join(" "), /must be an EARLIER phase/);
});

test("all real workflows are clean", () => {
  const failed = checkAllWorkflows(REPO).filter(r => !r.ok);
  assert.equal(failed.length, 0, JSON.stringify(failed, null, 2));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/sdlc-lint/test/cycles.test.mjs`
Expected: FAIL — `Cannot find module '../lib/cycles.mjs'`.

- [ ] **Step 3: Implement the cycles module**

`tools/sdlc-lint/lib/cycles.mjs`:
```js
import { loadWorkflows } from "./load.mjs";

export function checkWorkflow(doc) {
  const errors = [];
  const order = new Map();
  const loops = [];
  let idx = 0;
  const record = (name) => {
    if (order.has(name)) errors.push(`duplicate phase '${name}' — a workflow DAG must be acyclic`);
    else order.set(name, idx);
    idx++;
  };
  for (const p of doc?.phases ?? []) {
    if (typeof p === "string") record(p);
    else if (p && Array.isArray(p.parallel)) for (const n of p.parallel) record(n);
    else if (p && p.name) {
      record(p.name);
      if (p.loop?.return_to) loops.push({ phase: p.name, target: p.loop.return_to });
    }
  }
  for (const { phase, target } of loops) {
    if (!order.has(target)) errors.push(`loop phase '${phase}' return_to='${target}' is not a declared phase`);
    else if (order.get(target) >= order.get(phase)) errors.push(`loop phase '${phase}' return_to='${target}' must be an EARLIER phase`);
  }
  return { ok: errors.length === 0, errors };
}

export function checkAllWorkflows(root = process.cwd()) {
  const { workflows, errors } = loadWorkflows(root);
  const results = workflows.map(({ file, doc }) => ({ file, ...checkWorkflow(doc) }));
  for (const e of errors) results.push({ file: e.file, ok: false, errors: [e.error] });
  return results;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/sdlc-lint/test/cycles.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the `cycles` subcommand into the CLI**

In `tools/sdlc-lint/cli.mjs`, add the import at the top:
```js
import { checkAllWorkflows } from "./lib/cycles.mjs";
```
Add this function above `switch`:
```js
function printCycles(results) {
  const failed = results.filter(r => !r.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ command: "cycles", checked: results.length, failed: failed.length, failures: failed }));
  } else {
    for (const r of failed) console.error(`✗ ${r.file}\n    ${r.errors.join("\n    ")}`);
    console.log(`cycles: ${results.length - failed.length}/${results.length} clean`);
  }
  return failed.length ? 1 : 0;
}
```
Add the case:
```js
  case "cycles": code = printCycles(checkAllWorkflows(root)); break;
```

- [ ] **Step 6: Run the subcommand**

Run: `node tools/sdlc-lint/cli.mjs cycles`
Expected: `cycles: N/N clean`, exit 0.

- [ ] **Step 7: Commit**

```bash
git add tools/sdlc-lint/lib/cycles.mjs tools/sdlc-lint/cli.mjs tools/sdlc-lint/test/cycles.test.mjs
git commit -m "feat(sdlc-lint): workflow acyclic check + cycles subcommand"
```

---

### Task 4: Detection engine + fixtures + `detect` subcommand

**Files:**
- Create: `tools/sdlc-lint/lib/detect.mjs`
- Create fixtures (5 trees, each with `expected.json`) under `tools/sdlc-lint/fixtures/`
- Modify: `tools/sdlc-lint/cli.mjs` (add `detect` case)
- Test: `tools/sdlc-lint/test/detect.test.mjs`

**Interfaces:**
- Consumes: `loadManifests` from Task 1.
- Produces: `evalRule(rule, root) → boolean` — evaluates `file_exists`/`file_contains`/`file_glob`/`any`/`all`, plus the literal string `"*"` (always true).
- Produces: `resolveStack(evalRoot, { foundations, frameworks }) → { foundation, priority, additive:[string] }` — highest-priority matching foundation + sorted additive framework `stack`s whose `dependency` coordinate is present and whose `enriches_aspect` is hosted.
- Produces: `resolveFixture(fixtureDir, repoRoot) → { actual, expected, ok }`.

- [ ] **Step 1: Create the five fixture trees**

```
tools/sdlc-lint/fixtures/android-bare/settings.gradle.kts          → rootProject.name = "demo"
tools/sdlc-lint/fixtures/android-bare/app/src/main/kotlin/Main.kt   → fun main() {}
tools/sdlc-lint/fixtures/android-bare/expected.json                 → {"foundation":"android","priority":300,"additive":[]}

tools/sdlc-lint/fixtures/android-retrofit/settings.gradle.kts         → rootProject.name = "demo"
tools/sdlc-lint/fixtures/android-retrofit/app/src/main/kotlin/Main.kt → fun main() {}
tools/sdlc-lint/fixtures/android-retrofit/gradle/libs.versions.toml   → retrofit = { module = "com.squareup.retrofit2:retrofit", version = "2.11.0" }
tools/sdlc-lint/fixtures/android-retrofit/expected.json              → {"foundation":"android","priority":300,"additive":["retrofit"]}

tools/sdlc-lint/fixtures/android-full/settings.gradle.kts         → rootProject.name = "demo"
tools/sdlc-lint/fixtures/android-full/app/src/main/kotlin/Main.kt → fun main() {}
tools/sdlc-lint/fixtures/android-full/gradle/libs.versions.toml   → (see content below)
tools/sdlc-lint/fixtures/android-full/expected.json              → {"foundation":"android","priority":300,"additive":["dagger","retrofit","room"]}

tools/sdlc-lint/fixtures/vanilla-node/package.json → {"name":"demo"}
tools/sdlc-lint/fixtures/vanilla-node/expected.json → {"foundation":"vanilla","priority":0,"additive":[]}

tools/sdlc-lint/fixtures/no-kotlin/settings.gradle.kts → rootProject.name = "demo"
tools/sdlc-lint/fixtures/no-kotlin/expected.json      → {"foundation":"vanilla","priority":0,"additive":[]}
```

`android-full/gradle/libs.versions.toml` content (coordinates matched as substrings against each framework's `dependency`):
```toml
[libraries]
retrofit = { module = "com.squareup.retrofit2:retrofit", version = "2.11.0" }
room-runtime = { module = "androidx.room:room-runtime", version = "2.6.1" }
hilt-android = { module = "com.google.dagger:hilt-android", version = "2.51" }
```

> Note `no-kotlin` has `settings.gradle.kts` but **zero `*.kt`** files, so the android `detect` (`all: [settings.gradle*, file_glob **/*.kt]`) fails and vanilla wins — this guards the AND branch.

- [ ] **Step 2: Write the failing test**

`tools/sdlc-lint/test/detect.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { resolveFixture } from "../lib/detect.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const FIX = resolve(HERE, "..", "fixtures");

for (const name of readdirSync(FIX)) {
  test(`fixture ${name} resolves to expected stack`, () => {
    const { actual, expected, ok } = resolveFixture(join(FIX, name), REPO);
    assert.equal(ok, true, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  });
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tools/sdlc-lint/test/detect.test.mjs`
Expected: FAIL — `Cannot find module '../lib/detect.mjs'`.

- [ ] **Step 4: Implement the detection engine**

`tools/sdlc-lint/lib/detect.mjs`:
```js
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "tinyglobby";
import { loadManifests } from "./load.mjs";

export function evalRule(rule, root) {
  if (rule === "*") return true;
  if (rule == null || typeof rule !== "object") return false;
  if ("file_exists" in rule) return existsSync(join(root, rule.file_exists));
  if ("file_glob" in rule) return globSync(rule.file_glob, { cwd: root, dot: true }).length > 0;
  if ("file_contains" in rule) {
    const { path, pattern } = rule.file_contains;
    const re = new RegExp(pattern);
    return globSync(path, { cwd: root, absolute: true, dot: true })
      .some(f => re.test(readFileSync(f, "utf8")));
  }
  if ("any" in rule) return rule.any.some(r => evalRule(r, root));
  if ("all" in rule) return rule.all.every(r => evalRule(r, root));
  return false;
}

function dependencyPresent(root, paths, coordinate) {
  if (!coordinate) return false;
  for (const p of paths) {
    for (const f of globSync(p, { cwd: root, absolute: true, dot: true })) {
      if (readFileSync(f, "utf8").includes(coordinate)) return true;
    }
  }
  return false;
}

export function resolveStack(evalRoot, { foundations, frameworks }) {
  const winner = foundations
    .filter(f => evalRule(f.doc.detect, evalRoot))
    .sort((a, b) => (b.doc.priority ?? 0) - (a.doc.priority ?? 0))[0];
  if (!winner) return { foundation: null, priority: null, additive: [] };
  const hosts = winner.doc.hosts_aspects;
  const paths = winner.doc.framework_detection ?? [];
  const additive = [];
  for (const fw of frameworks) {
    const hosted = hosts === "all" || (Array.isArray(hosts) && hosts.includes(fw.doc.enriches_aspect));
    if (hosted && dependencyPresent(evalRoot, paths, fw.doc.dependency)) additive.push(fw.doc.stack);
  }
  return { foundation: winner.doc.stack, priority: winner.doc.priority ?? 0, additive: additive.sort() };
}

export function resolveFixture(fixtureDir, repoRoot) {
  const { foundations, frameworks } = loadManifests(repoRoot);
  const actual = resolveStack(fixtureDir, { foundations, frameworks });
  const expected = JSON.parse(readFileSync(join(fixtureDir, "expected.json"), "utf8"));
  const ok = actual.foundation === expected.foundation
    && actual.priority === expected.priority
    && JSON.stringify(actual.additive) === JSON.stringify(expected.additive);
  return { actual, expected, ok };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tools/sdlc-lint/test/detect.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 6: Wire the `detect` subcommand**

In `tools/sdlc-lint/cli.mjs`, add imports:
```js
import { readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { resolveFixture } from "./lib/detect.mjs";
```
Add above `switch`:
```js
const FIX = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
function printDetect() {
  const rows = listFixtures(FIX).map(name => ({ name, ...resolveFixture(join(FIX, name), root) }));
  const failed = rows.filter(r => !r.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ command: "detect", checked: rows.length, failed: failed.length, failures: failed }));
  } else {
    for (const r of failed) console.error(`✗ ${r.name}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`);
    console.log(`detect: ${rows.length - failed.length}/${rows.length} fixtures matched`);
  }
  return failed.length ? 1 : 0;
}
```
Add the case:
```js
  case "detect": code = printDetect(); break;
```

- [ ] **Step 7: Run the subcommand**

Run: `node tools/sdlc-lint/cli.mjs detect`
Expected: `detect: 5/5 fixtures matched`, exit 0.

- [ ] **Step 8: Commit**

```bash
git add tools/sdlc-lint/lib/detect.mjs tools/sdlc-lint/fixtures tools/sdlc-lint/cli.mjs tools/sdlc-lint/test/detect.test.mjs
git commit -m "feat(sdlc-lint): detection engine + fixture matrix + detect subcommand"
```

---

### Task 5: `all` subcommand (aggregate + exit code)

**Files:**
- Modify: `tools/sdlc-lint/cli.mjs`
- Test: `tools/sdlc-lint/test/all.test.mjs`

**Interfaces:**
- Consumes: `checkSchemas`, `checkAllWorkflows`, `resolveFixture`.
- Produces: `all` subcommand — runs the three checks, prints a combined summary, exits with the worst code (`2` > `1` > `0`).

- [ ] **Step 1: Write the failing test**

`tools/sdlc-lint/test/all.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CLI = resolve(REPO, "tools/sdlc-lint/cli.mjs");

test("`all --json` exits 0 on a clean repo", () => {
  const out = execFileSync("node", [CLI, "all", "--json"], { cwd: REPO, encoding: "utf8" });
  const report = JSON.parse(out.trim().split("\n").pop());
  assert.equal(report.ok, true);
  assert.equal(report.exit, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/sdlc-lint/test/all.test.mjs`
Expected: FAIL — `all` prints the unknown-command message / exit 2, JSON parse fails.

- [ ] **Step 3: Implement the `all` subcommand**

In `tools/sdlc-lint/cli.mjs`, add above `switch`:
```js
function runAll() {
  const schema = checkSchemas(root);
  const cycles = checkAllWorkflows(root);
  const detect = listFixtures(FIX).map(name => ({ name, ...resolveFixture(join(FIX, name), root) }));
  const codes = [printSchema(schema), printCycles(cycles), printDetect2(detect)];
  const exit = Math.max(...codes);
  if (jsonOut) console.log(JSON.stringify({ command: "all", ok: exit === 0, exit }));
  return exit;
}
```
Refactor `printDetect` to accept precomputed rows so `all` reuses it — replace the body of `printDetect` with a call to a shared `printDetect2(rows)`:
```js
function printDetect2(rows) {
  const failed = rows.filter(r => !r.ok);
  if (!jsonOut) {
    for (const r of failed) console.error(`✗ ${r.name}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`);
    console.log(`detect: ${rows.length - failed.length}/${rows.length} fixtures matched`);
  }
  return failed.length ? 1 : 0;
}
function printDetect() {
  return printDetect2(listFixtures(FIX).map(name => ({ name, ...resolveFixture(join(FIX, name), root) })));
}
```
Add the case:
```js
  case "all": code = runAll(); break;
```

> Note: in `--json` mode each `print*` still emits its own JSON line; `all` appends a final summary line. The test reads the **last** line. This is intentional and documented.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/sdlc-lint/test/all.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run the full suite + the command**

Run: `npm test --prefix tools/sdlc-lint && node tools/sdlc-lint/cli.mjs all`
Expected: all unit tests pass; `all` prints three summary lines, exit 0.

> Note: use `npm test --prefix tools/sdlc-lint` (auto-discovery from the package dir), NOT `node --test tools/sdlc-lint/test` — a bare directory positional is read as a module path by Node 22 and fails.

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/cli.mjs tools/sdlc-lint/test/all.test.mjs
git commit -m "feat(sdlc-lint): all subcommand aggregating schema+cycles+detect"
```

---

### Task 6: GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `tools/sdlc-lint` (Tasks 1–5), existing `tests/*.sh` / `tests/*.py`, plugin hook scripts.

- [ ] **Step 1: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [develop, main]
  pull_request:

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install sdlc-lint deps
        run: npm ci --prefix tools/sdlc-lint
      - name: sdlc-lint (schema + cycles + detect)
        run: node tools/sdlc-lint/cli.mjs all --json
      - name: sdlc-lint unit tests
        run: npm test --prefix tools/sdlc-lint
      - name: shellcheck hooks
        run: |
          sudo apt-get update && sudo apt-get install -y shellcheck
          find plugins -type f -name '*.sh' -path '*/hooks/*' -print0 | xargs -0 -r shellcheck
      - name: enforce-agent-model test
        run: bash tests/test-enforce-agent-model.sh
      - name: model-local schema test
        run: python3 tests/test-model-local-schema.py
```

- [ ] **Step 2: Simulate the CI steps locally**

Run:
```bash
npm ci --prefix tools/sdlc-lint && \
node tools/sdlc-lint/cli.mjs all --json && \
npm test --prefix tools/sdlc-lint && \
find plugins -type f -name '*.sh' -path '*/hooks/*' -print0 | xargs -0 -r shellcheck ; \
bash tests/test-enforce-agent-model.sh && \
python3 tests/test-model-local-schema.py
```
Expected: every step exits 0. (If `shellcheck` is not installed locally, note it — CI installs it; the other steps must still pass.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run sdlc-lint, unit tests, shellcheck, existing tests on push/PR"
```

---

### Task 7: Cleanup + docs + orchestrator guard comment

**Files:**
- Delete: `plugins/android-plugin/`
- Modify: `.gitignore`
- Modify: `README.md` (add a short "Verifying plugins locally" subsection)
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (Step 0b — **comment only**)

- [ ] **Step 1: Remove the dead legacy plugin and untrack .DS_Store**

Run:
```bash
git rm -r --cached --ignore-unmatch plugins/android-plugin
rm -rf plugins/android-plugin
git ls-files -z '*.DS_Store' | xargs -0 -r git rm --cached
```
Expected: `plugins/android-plugin` gone; `.DS_Store` files untracked (remain on disk).

- [ ] **Step 2: Add `.DS_Store` to `.gitignore`**

Read `.gitignore`, then append a line `.DS_Store` if not already present (use Edit to add it under existing entries).

- [ ] **Step 3: Add the README verification subsection**

In `README.md`, after the Quickstart section, add:
```markdown
### Verifying plugins locally

Before opening a PR, run the deterministic verifier (schema + workflow-cycle + stack-detection checks):

```bash
npm ci --prefix tools/sdlc-lint
node tools/sdlc-lint/cli.mjs all
```

CI runs the same `sdlc-lint all` plus `shellcheck` and the unit tests on every push/PR.
```

- [ ] **Step 4: Add the guard comment to the orchestrator (comment only — no logic change)**

In `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`, locate the Step 0b stack-detection section. Add a single HTML/markdown comment line immediately under its heading:
```
<!-- Detection-rule semantics here are independently verified by tools/sdlc-lint (detect.mjs + fixtures). If you change file_exists/file_contains/file_glob/any/all handling, update detect.mjs and the fixture expected.json files to match. -->
```
Do not alter any surrounding instruction text.

- [ ] **Step 5: Verify the suite still passes after cleanup**

Run: `node tools/sdlc-lint/cli.mjs all && npm test --prefix tools/sdlc-lint`
Expected: exit 0 (removing `android-plugin` must not change detection — it had no manifest).

- [ ] **Step 6: Commit**

```bash
git add -- .gitignore README.md plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
git commit -m "chore: remove dead android-plugin, ignore .DS_Store, document sdlc-lint + orchestrator guard note"
```

---

## Self-Review

**1. Spec coverage** (against `2026-07-03-sdlc-lint-ci-design.md`):
- CLI `schema`/`cycles`/`detect`/`all` → Tasks 2/3/4/5. ✅
- 5 fixtures + `expected.json` → Task 4. ✅
- `node:test` units → Tasks 1–5. ✅
- `.github/workflows/ci.yml` (sdlc-lint + shellcheck + existing tests) → Task 6. ✅
- Cleanup (android-plugin, `.DS_Store`) → Task 7. ✅
- Guard comment in Step 0b, README verify section → Task 7. ✅
- Orchestrator logic untouched (parallel verification) → enforced by Global Constraints + Task 7 comment-only. ✅
- Deferred (out of scope, correctly not planned): `/sdlc:doctor` wiring, `/sdlc:validate`, `/sdlc:report`. ✅

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅

**3. Type consistency:** `loadManifests`/`loadWorkflows` (Task 1) consumed unchanged in Tasks 3–4; `checkSchemas`/`checkAllWorkflows`/`resolveFixture` names identical across definition and `all` (Task 5); `printDetect2` shared helper introduced in Task 5 with the Task 4 `printDetect` refactored to call it. ✅
