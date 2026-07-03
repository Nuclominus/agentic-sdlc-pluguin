# SDLC `--resume` via Per-Phase Checkpoints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an interrupted `/sdlc:start` run resume from where it stopped instead of re-running every phase, by writing an atomic per-phase checkpoint after each phase and re-entering the DAG at the first incomplete phase.

**Architecture:** Two layers. (1) A **deterministic Node engine** in the existing `tools/sdlc-lint` package: a pure `computeReentry(resolvedPhases, checkpoints)` function, a `resume` CLI subcommand, a `checkpoint.schema.json`, and fixture-driven `node:test` coverage — this is the testable source of truth for skip-semantics. (2) **Additive edits to the LLM-executable markdown** orchestrator (`pipeline-orchestrator/SKILL.md`) and command (`start.md`): persist the resolved phase list + per-phase checkpoints (write-path), and skip already-completed phases on `--resume` (read-path). The markdown mirrors the Node engine's rules; CI guards drift by testing the engine against fixtures that encode the exact same semantics.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test`, `ajv`/`ajv-formats` (already deps), `tinyglobby` (already dep), JSON Schema 2020-12. Orchestrator layer is Markdown prose consumed by the LLM at runtime.

## Global Constraints

- **Core-rarely-changes invariant:** orchestrator edits are ADDITIVE only — no phase logic, agent, or pricing change. Copy this constraint into every markdown task.
- **Node engine is pure & offline:** `lib/resume.mjs` reads only JSON files on disk; it never resolves the workflow itself, never spawns anything, never imports YAML/manifest code. It receives the already-resolved phase list from `.checkpoint/_run.json`.
- **Fail-safe on doubt:** a checkpoint that is `.tmp`, unparseable, or missing `status` means the phase is NOT complete → re-run it. Never skip on a doubtful checkpoint.
- **Atomic writes:** every checkpoint is written to `<name>.json.tmp` then `rename`d to `<name>.json`.
- **Checkpoint schema == telemetry `phases[]` element + `output_file` + `completed_at`** — one structure, so Step 5 assembles `_telemetry.json` from checkpoints with no field drift.
- **Exit codes (all `sdlc-lint` subcommands):** `0` clean, `1` findings, `2` tool error.
- **CLI style:** match existing `cli.mjs` — `switch (cmd)`, one `printX(results)` per subcommand returning an exit code, `runAll` takes `Math.max(...codes)`, `--json` prints a machine summary line.
- Node 20; deps already pinned in `tools/sdlc-lint/package.json` (no new deps).

---

## File Structure

**Node engine (new / modified):**
- Create `schemas/checkpoint.schema.json` — one checkpoint record.
- Create `schemas/run.schema.json` — the `_run.json` resolved-phase manifest.
- Create `tools/sdlc-lint/lib/resume.mjs` — pure re-entry computation + workspace loader.
- Modify `tools/sdlc-lint/lib/schema.mjs` — add checkpoint + run globs to `SCHEMA_MAP` (with a per-entry `reject` filter).
- Modify `tools/sdlc-lint/cli.mjs` — add `resume` subcommand + fold into `all`.
- Create `tools/sdlc-lint/fixtures/resume-*/` — 6 fixture workspaces (`.checkpoint/_run.json` + unit checkpoints + `expected-reentry.json`).
- Create `tools/sdlc-lint/test/resume.test.mjs` — `node:test` over the fixtures.
- Modify `tools/sdlc-lint/test/all.test.mjs` — assert `all` runs `resume`.

**Orchestrator markdown (modified):**
- Modify `plugins/sdlc/commands/start.md` — parse `--resume[=slug]`; document resume + non-goal.
- Modify `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` — write `_run.json` (Step 3 start); write checkpoint (new 3d-3); assemble telemetry from checkpoints (Step 5); resume branch (Step 2); skip completed phases (Step 3); drift-guard comments.

**Docs (modified):**
- Modify `README.md` (or `plugins/sdlc/README.md`) + `docs/WORKFLOW.md` — "Resuming an interrupted run".

---

## Data Contracts (used across tasks)

**`.checkpoint/{unit}.json`** — one completed unit. `{unit}` = `{phase}` (aspect-agnostic) or `{phase}-{aspect}` (aspect-aware) or `{phase}-plan[-{aspect}]` (dev planning pass).

```json
{
  "phase": "development",
  "aspect": "backend",
  "status": "completed",
  "agent": "android-developer",
  "model": "claude-sonnet-5",
  "input_tokens": 28000,
  "output_tokens": 2100,
  "cached_input_tokens": 18000,
  "cost_usd": 0.04,
  "usage_source": "reported",
  "compact_summary_chars": 1450,
  "compact_handoff_violation": false,
  "output_file": "docs/plans/{slug}/02-development-backend.md",
  "completed_at": "2026-07-03T10:15:00Z"
}
```
- `status` ∈ `"completed" | "skipped" | "approved"`. `"approved"` only on `{phase}-plan…` units.
- `aspect` is `null` for aspect-agnostic phases.
- QA units add `qa_iterations_used` (int) + `qa_status` (`"completed" | "capped"`).

**`.checkpoint/_run.json`** — the resolved DAG, written once at Step 3 start:

```json
{
  "task_slug": "add-dark-mode",
  "workflow": "default",
  "stack": "android",
  "resolved_phases": [
    { "name": "business_analysis", "kind": "plain", "aspects": null },
    { "name": "development", "kind": "plain", "aspects": ["database", "backend"] },
    { "name": "review", "kind": "loop", "aspects": null },
    { "name": "qa", "kind": "plain", "aspects": null },
    { "name": "security", "kind": "plain", "aspects": null },
    { "name": "documentation", "kind": "plain", "aspects": null }
  ]
}
```
- `kind` ∈ `"plain" | "loop" | "parallel"`.
- Parallel groups add `"members": ["phaseA", "phaseB"]` and each member is itself resolved like a plain phase (members carry their own `aspects`).
- `aspects` is `null` for aspect-agnostic phases, else the ordered aspect list actually dispatched.

**`expected-reentry.json`** (fixture assertion):

```json
{ "completed": ["business_analysis", "development-database"], "reenter_at": "development", "remaining": ["development", "review", "qa", "security", "documentation"] }
```

---

## Task 1: Checkpoint + run schemas, wired into `sdlc-lint schema`

**Files:**
- Create: `schemas/checkpoint.schema.json`
- Create: `schemas/run.schema.json`
- Modify: `tools/sdlc-lint/lib/schema.mjs:8-14` (the `SCHEMA_MAP` array + the file filter at line 30-31)
- Test: `tools/sdlc-lint/test/schema.test.mjs` (extend existing)

**Interfaces:**
- Produces: `schemas/checkpoint.schema.json`, `schemas/run.schema.json`; `SCHEMA_MAP` entries gain an optional `reject` (RegExp) applied during file filtering. Later tasks (Task 4) rely on these schemas existing so their emitted JSON validates.

- [ ] **Step 1: Write `schemas/checkpoint.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin/schemas/checkpoint.schema.json",
  "title": "SDLC Phase Checkpoint",
  "description": "One completed unit of pipeline work, written atomically after a phase (or aspect, or dev planning pass) finishes. Structurally a telemetry phases[] element plus output_file + completed_at, so Step 5 assembles _telemetry.json from these files without drift.",
  "type": "object",
  "additionalProperties": false,
  "required": ["phase", "status", "completed_at"],
  "properties": {
    "phase": { "type": "string", "minLength": 1 },
    "aspect": { "type": ["string", "null"] },
    "status": { "enum": ["completed", "skipped", "approved"] },
    "agent": { "type": "string" },
    "model": { "type": "string" },
    "input_tokens": { "type": "integer", "minimum": 0 },
    "output_tokens": { "type": "integer", "minimum": 0 },
    "cached_input_tokens": { "type": "integer", "minimum": 0 },
    "cost_usd": { "type": ["number", "null"], "minimum": 0 },
    "usage_source": { "enum": ["reported", "estimated"] },
    "compact_summary_chars": { "type": "integer", "minimum": 0 },
    "compact_handoff_violation": { "type": "boolean" },
    "qa_iterations_used": { "type": "integer", "minimum": 0 },
    "qa_status": { "enum": ["completed", "capped"] },
    "output_file": { "type": "string" },
    "completed_at": { "type": "string", "format": "date-time" }
  }
}
```

- [ ] **Step 2: Write `schemas/run.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin/schemas/run.schema.json",
  "title": "SDLC Resolved Run Manifest",
  "description": "The resolved phase DAG for one pipeline run, persisted once at Step 3 start so --resume (and sdlc-lint resume) can compute the re-entry point without re-resolving the workflow.",
  "type": "object",
  "additionalProperties": false,
  "required": ["task_slug", "workflow", "resolved_phases"],
  "properties": {
    "task_slug": { "type": "string", "minLength": 1 },
    "workflow": { "type": "string", "minLength": 1 },
    "stack": { "type": "string" },
    "resolved_phases": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "kind"],
        "properties": {
          "name": { "type": "string", "minLength": 1 },
          "kind": { "enum": ["plain", "loop", "parallel"] },
          "aspects": {
            "type": ["array", "null"],
            "items": { "type": "string" }
          },
          "members": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["name"],
              "properties": {
                "name": { "type": "string" },
                "aspects": { "type": ["array", "null"], "items": { "type": "string" } }
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 3: Add a failing test for the new schema mappings**

Append to `tools/sdlc-lint/test/schema.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";

function compile(path) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(readFileSync(path, "utf8")));
}

test("checkpoint.schema accepts a valid completed unit", () => {
  const v = compile("schemas/checkpoint.schema.json");
  assert.ok(v({ phase: "security", aspect: null, status: "completed", completed_at: "2026-07-03T10:15:00Z" }));
});

test("checkpoint.schema rejects an unknown status", () => {
  const v = compile("schemas/checkpoint.schema.json");
  assert.equal(v({ phase: "security", status: "half", completed_at: "2026-07-03T10:15:00Z" }), false);
});

test("run.schema accepts a resolved phase list", () => {
  const v = compile("schemas/run.schema.json");
  assert.ok(v({ task_slug: "x", workflow: "default", resolved_phases: [{ name: "qa", kind: "plain", aspects: null }] }));
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/schema.test.mjs`
Expected: FAIL — the two `compile(...)` calls throw `ENOENT` until Steps 1-2 files exist. (If you did Steps 1-2 first, they PASS immediately — that is also acceptable; the point is the assertions exist and pass against the real schemas.)

- [ ] **Step 5: Add checkpoint + run globs to `SCHEMA_MAP` with a `reject` filter**

In `tools/sdlc-lint/lib/schema.mjs`, extend the `SCHEMA_MAP` array (currently lines 8-14) — add two entries after the existing ones:

```javascript
  { glob: "plugins/**/.claude-plugin/plugin.json", schema: "schemas/plugin.schema.json", parse: "json" },
  { glob: "docs/plans/**/.checkpoint/*.json", schema: "schemas/checkpoint.schema.json", parse: "json", reject: /\/_run\.json$/ },
  { glob: "docs/plans/**/.checkpoint/_run.json", schema: "schemas/run.schema.json", parse: "json" },
];
```

Then apply `reject` in the file filter. Change the existing filter (line 30-31):

```javascript
    const files = globSync(glob, { cwd: root, absolute: true, dot: true })
      .filter(f => !f.includes("/test-fixtures/"))
      .filter(f => !(typeof reject !== "undefined" && reject && reject.test(f)));
```

and add `reject` to the destructure on line 22:

```javascript
  for (const { glob, schema, parse, reject } of SCHEMA_MAP) {
```

- [ ] **Step 6: Run the full node test + real schema check**

Run: `cd tools/sdlc-lint && node --test test/schema.test.mjs && node cli.mjs schema`
Expected: node tests PASS; `sdlc-lint schema` prints `schema: N/N passed` (no `docs/plans/**/.checkpoint/` files exist yet, so the new globs match nothing — that is correct, not a failure).

- [ ] **Step 7: Commit**

```bash
git add schemas/checkpoint.schema.json schemas/run.schema.json tools/sdlc-lint/lib/schema.mjs tools/sdlc-lint/test/schema.test.mjs
git commit -m "feat(sdlc-lint): checkpoint + run JSON schemas wired into schema check"
```

---

## Task 2: `lib/resume.mjs` re-entry engine + fixtures + unit tests

This is the heart of the feature — a pure function that decides which phases are done and where to re-enter. Fully TDD-able.

**Files:**
- Create: `tools/sdlc-lint/lib/resume.mjs`
- Create: `tools/sdlc-lint/fixtures/resume-clean-midpoint/` (+ `_run.json`, unit checkpoints, `expected-reentry.json`)
- Create: `tools/sdlc-lint/fixtures/resume-aspect-partial/`
- Create: `tools/sdlc-lint/fixtures/resume-dev-plan-approved/`
- Create: `tools/sdlc-lint/fixtures/resume-loop-not-approved/`
- Create: `tools/sdlc-lint/fixtures/resume-all-done/`
- Create: `tools/sdlc-lint/fixtures/resume-corrupt-tmp/`
- Test: `tools/sdlc-lint/test/resume.test.mjs`

**Interfaces:**
- Consumes: the data contracts above (`.checkpoint/_run.json`, `.checkpoint/{unit}.json`, `expected-reentry.json`).
- Produces:
  - `loadCheckpoints(checkpointDir) → { units: Map<string, object>, warnings: string[] }` — reads every `*.json` except `_run.json`, skips `*.tmp`; a file that fails to parse or lacks `status` is excluded and adds a warning. Map key = filename without `.json` (the unit id).
  - `computeReentry(resolvedPhases, units) → { completed: string[], reenter_at: string|null, remaining: string[] }` — pure; `units` is the Map from `loadCheckpoints`.
  - `resolveWorkspace(workspaceDir) → { completed, reenter_at, remaining, warnings }` — reads `<workspaceDir>/.checkpoint/`, loads `_run.json` (throws a clear Error if absent), calls the two above. Used by the CLI in Task 3.

- [ ] **Step 1: Write the failing tests**

Create `tools/sdlc-lint/test/resume.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkspace } from "../lib/resume.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const resumeFixtures = readdirSync(FIX, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name.startsWith("resume-"))
  .map(e => e.name)
  .sort();

for (const name of resumeFixtures) {
  test(`re-entry: ${name}`, () => {
    const expected = JSON.parse(readFileSync(join(FIX, name, "expected-reentry.json"), "utf8"));
    const got = resolveWorkspace(join(FIX, name));
    assert.deepEqual(got.completed.sort(), [...expected.completed].sort(), "completed set");
    assert.equal(got.reenter_at, expected.reenter_at, "reenter_at");
    assert.deepEqual(got.remaining, expected.remaining, "remaining");
  });
}

test("corrupt/.tmp checkpoint is treated as incomplete and warns", () => {
  const got = resolveWorkspace(join(FIX, "resume-corrupt-tmp"));
  assert.equal(got.reenter_at, "security");
  assert.ok(got.warnings.length >= 1, "expected a warning for the corrupt checkpoint");
});

test("missing _run.json throws a clear error", () => {
  assert.throws(() => resolveWorkspace(join(FIX, "does-not-exist")), /_run\.json/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd tools/sdlc-lint && node --test test/resume.test.mjs`
Expected: FAIL — `Cannot find module '../lib/resume.mjs'`.

- [ ] **Step 3: Implement `lib/resume.mjs`**

Create `tools/sdlc-lint/lib/resume.mjs`:

```javascript
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Unit id for a (phase, aspect): aspect-agnostic → phase; aspect-aware → `${phase}-${aspect}`.
const unitId = (phase, aspect) => (aspect == null ? phase : `${phase}-${aspect}`);

export function loadCheckpoints(checkpointDir) {
  const units = new Map();
  const warnings = [];
  if (!existsSync(checkpointDir)) return { units, warnings };
  for (const f of readdirSync(checkpointDir)) {
    if (!f.endsWith(".json") || f === "_run.json") continue; // .tmp and _run.json ignored
    let data;
    try {
      data = JSON.parse(readFileSync(join(checkpointDir, f), "utf8"));
    } catch {
      warnings.push(`unparseable checkpoint ignored (treated as incomplete): ${f}`);
      continue;
    }
    if (!data || typeof data.status !== "string") {
      warnings.push(`checkpoint missing status ignored (treated as incomplete): ${f}`);
      continue;
    }
    units.set(f.slice(0, -".json".length), data); // key = filename sans .json
  }
  return { units, warnings };
}

const DONE = new Set(["completed", "skipped"]);
const isDone = (u) => u != null && DONE.has(u.status);

// Is one resolved (plain) phase fully done? aspect-aware → every aspect done.
function plainDone(phase, units) {
  if (phase.aspects == null) return isDone(units.get(phase.name));
  return phase.aspects.every(a => isDone(units.get(unitId(phase.name, a))));
}

function phaseDone(phase, units) {
  if (phase.kind === "loop") {
    // A loop is done only when its own checkpoint says completed (verdict approved).
    return isDone(units.get(phase.name));
  }
  if (phase.kind === "parallel") {
    return (phase.members ?? []).every(m => plainDone(m, units));
  }
  return plainDone(phase, units);
}

// Collect the unit ids that are done, for the human/print "completed" list.
function completedUnits(resolvedPhases, units) {
  const out = [];
  const pushPlain = (p) => {
    if (p.aspects == null) { if (isDone(units.get(p.name))) out.push(p.name); }
    else for (const a of p.aspects) { const id = unitId(p.name, a); if (isDone(units.get(id))) out.push(id); }
  };
  for (const p of resolvedPhases) {
    if (p.kind === "parallel") (p.members ?? []).forEach(pushPlain);
    else if (p.kind === "loop") { if (isDone(units.get(p.name))) out.push(p.name); }
    else pushPlain(p);
  }
  return out;
}

export function computeReentry(resolvedPhases, units) {
  const completed = completedUnits(resolvedPhases, units);
  const idx = resolvedPhases.findIndex(p => !phaseDone(p, units));
  if (idx === -1) return { completed, reenter_at: null, remaining: [] };
  return {
    completed,
    reenter_at: resolvedPhases[idx].name,
    remaining: resolvedPhases.slice(idx).map(p => p.name),
  };
}

export function resolveWorkspace(workspaceDir) {
  const checkpointDir = join(workspaceDir, ".checkpoint");
  const runPath = join(checkpointDir, "_run.json");
  if (!existsSync(runPath)) {
    throw new Error(`cannot resume ${workspaceDir}: .checkpoint/_run.json not found`);
  }
  const run = JSON.parse(readFileSync(runPath, "utf8"));
  const { units, warnings } = loadCheckpoints(checkpointDir);
  return { ...computeReentry(run.resolved_phases, units), warnings };
}
```

- [ ] **Step 4: Create fixture `resume-clean-midpoint` (BA + all dev aspects done → re-enter at qa)**

`tools/sdlc-lint/fixtures/resume-clean-midpoint/.checkpoint/_run.json`:

```json
{ "task_slug": "clean-midpoint", "workflow": "default", "stack": "android",
  "resolved_phases": [
    { "name": "business_analysis", "kind": "plain", "aspects": null },
    { "name": "development", "kind": "plain", "aspects": ["database", "backend"] },
    { "name": "qa", "kind": "plain", "aspects": null },
    { "name": "security", "kind": "plain", "aspects": null },
    { "name": "documentation", "kind": "plain", "aspects": null } ] }
```

`.checkpoint/business_analysis.json`:
```json
{ "phase": "business_analysis", "aspect": null, "status": "completed", "cost_usd": 0.16, "completed_at": "2026-07-03T10:00:00Z" }
```
`.checkpoint/development-database.json`:
```json
{ "phase": "development", "aspect": "database", "status": "completed", "cost_usd": 0.05, "completed_at": "2026-07-03T10:05:00Z" }
```
`.checkpoint/development-backend.json`:
```json
{ "phase": "development", "aspect": "backend", "status": "completed", "cost_usd": 0.06, "completed_at": "2026-07-03T10:08:00Z" }
```
`expected-reentry.json`:
```json
{ "completed": ["business_analysis", "development-database", "development-backend"], "reenter_at": "qa", "remaining": ["qa", "security", "documentation"] }
```

- [ ] **Step 5: Create fixture `resume-aspect-partial` (dev-database done, dev-backend missing → re-enter at development)**

`.checkpoint/_run.json` — same `resolved_phases` as Step 4.
`.checkpoint/business_analysis.json` — same as Step 4.
`.checkpoint/development-database.json` — same as Step 4.
(NO `development-backend.json`.)
`expected-reentry.json`:
```json
{ "completed": ["business_analysis", "development-database"], "reenter_at": "development", "remaining": ["development", "qa", "security", "documentation"] }
```

- [ ] **Step 6: Create fixture `resume-dev-plan-approved` (plan approved, implement missing → re-enter at development)**

`.checkpoint/_run.json` — `resolved_phases` with development aspect-agnostic:
```json
{ "task_slug": "dev-plan-approved", "workflow": "default", "stack": "vanilla",
  "resolved_phases": [
    { "name": "business_analysis", "kind": "plain", "aspects": null },
    { "name": "development", "kind": "plain", "aspects": null },
    { "name": "qa", "kind": "plain", "aspects": null } ] }
```
`.checkpoint/business_analysis.json`:
```json
{ "phase": "business_analysis", "aspect": null, "status": "completed", "completed_at": "2026-07-03T10:00:00Z" }
```
`.checkpoint/development-plan.json` (approved plan, NOT the implement unit):
```json
{ "phase": "development-plan", "aspect": null, "status": "approved", "completed_at": "2026-07-03T10:03:00Z" }
```
`expected-reentry.json` (the `approved` plan unit is NOT in `completed`, since only `completed`/`skipped` count as done; development is still the re-entry):
```json
{ "completed": ["business_analysis"], "reenter_at": "development", "remaining": ["development", "qa"] }
```

- [ ] **Step 7: Create fixture `resume-loop-not-approved` (return_to done, loop verdict absent → re-enter at review)**

`.checkpoint/_run.json`:
```json
{ "task_slug": "loop-not-approved", "workflow": "review-loop", "stack": "vanilla",
  "resolved_phases": [
    { "name": "business_analysis", "kind": "plain", "aspects": null },
    { "name": "development", "kind": "plain", "aspects": null },
    { "name": "review", "kind": "loop", "aspects": null },
    { "name": "documentation", "kind": "plain", "aspects": null } ] }
```
`.checkpoint/business_analysis.json` + `.checkpoint/development.json` both `status: "completed"`:
```json
{ "phase": "business_analysis", "aspect": null, "status": "completed", "completed_at": "2026-07-03T10:00:00Z" }
```
```json
{ "phase": "development", "aspect": null, "status": "completed", "completed_at": "2026-07-03T10:05:00Z" }
```
(NO `review.json` — the loop never reached an approved verdict.)
`expected-reentry.json`:
```json
{ "completed": ["business_analysis", "development"], "reenter_at": "review", "remaining": ["review", "documentation"] }
```

- [ ] **Step 8: Create fixture `resume-all-done` (everything completed → reenter_at null)**

`.checkpoint/_run.json`:
```json
{ "task_slug": "all-done", "workflow": "default", "stack": "vanilla",
  "resolved_phases": [
    { "name": "business_analysis", "kind": "plain", "aspects": null },
    { "name": "documentation", "kind": "plain", "aspects": null } ] }
```
`.checkpoint/business_analysis.json` + `.checkpoint/documentation.json`, both `status: "completed"` (use the same shape as Step 7).
`expected-reentry.json`:
```json
{ "completed": ["business_analysis", "documentation"], "reenter_at": null, "remaining": [] }
```

- [ ] **Step 9: Create fixture `resume-corrupt-tmp` (unparseable + .tmp for security → security incomplete)**

`.checkpoint/_run.json`:
```json
{ "task_slug": "corrupt-tmp", "workflow": "default", "stack": "vanilla",
  "resolved_phases": [
    { "name": "business_analysis", "kind": "plain", "aspects": null },
    { "name": "security", "kind": "plain", "aspects": null },
    { "name": "documentation", "kind": "plain", "aspects": null } ] }
```
`.checkpoint/business_analysis.json` — `status: "completed"` (shape as Step 7).
`.checkpoint/security.json` — deliberately invalid JSON. File content exactly:
```
{ "phase": "security", "status": "comple
```
`.checkpoint/security.json.tmp` — a leftover temp write. File content:
```json
{ "phase": "security", "aspect": null, "status": "completed", "completed_at": "2026-07-03T10:20:00Z" }
```
`expected-reentry.json` (the `.tmp` is ignored, the truncated `.json` is unparseable → security not done):
```json
{ "completed": ["business_analysis"], "reenter_at": "security", "remaining": ["security", "documentation"] }
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `cd tools/sdlc-lint && node --test test/resume.test.mjs`
Expected: PASS — 6 `re-entry: resume-*` tests + the corrupt-tmp warning test + the missing-`_run.json` throw test all green.

- [ ] **Step 11: Commit**

```bash
git add tools/sdlc-lint/lib/resume.mjs tools/sdlc-lint/fixtures/resume-* tools/sdlc-lint/test/resume.test.mjs
git commit -m "feat(sdlc-lint): pure resume re-entry engine + fixture coverage"
```

---

## Task 3: `sdlc-lint resume` subcommand + fold into `all`

**Files:**
- Modify: `tools/sdlc-lint/cli.mjs` (add `resume` case, `printResume`, extend `runAll`, add fixture lister)
- Test: `tools/sdlc-lint/test/all.test.mjs` (assert `all` exercises resume)

**Interfaces:**
- Consumes: `resolveWorkspace` from `lib/resume.mjs` (Task 2), `listFixtures`-style directory scan.
- Produces: CLI exit `0/1/2` for `resume`; `all` now = schema + cycles + detect + resume.

- [ ] **Step 1: Add a failing test to `all.test.mjs`**

Append to `tools/sdlc-lint/test/all.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("`resume` over a good fixture exits 0", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "resume-clean-midpoint");
  const out = execFileSync("node", [CLI, "resume", dir, "--json"], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /"reenter_at":"qa"/);
});

test("`all` runs resume and stays green", () => {
  const out = execFileSync("node", [CLI, "all", "--json"], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /"command":"resume"/);
  assert.match(out, /"command":"all","ok":true/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/all.test.mjs`
Expected: FAIL — `resume` is an `unknown command` (exit 2) and `all` output has no `"command":"resume"`.

- [ ] **Step 3: Wire `resume` into `cli.mjs`**

In `tools/sdlc-lint/cli.mjs`, add the import (after line 6):

```javascript
import { resolveWorkspace } from "./lib/resume.mjs";
import { readdirSync } from "node:fs";
```

Add a printer + fixture-runner (after `printDetect`, near line 50):

```javascript
function printResumeOne(dir) {
  let res, err;
  try { res = resolveWorkspace(dir); } catch (e) { err = e; }
  if (jsonOut) {
    console.log(JSON.stringify(err
      ? { command: "resume", dir, ok: false, error: err.message }
      : { command: "resume", dir, ok: true, reenter_at: res.reenter_at, completed: res.completed, warnings: res.warnings }));
  } else if (err) {
    console.error(`✗ ${dir}: ${err.message}`);
  } else {
    console.log(`resume ${dir}: reenter_at=${res.reenter_at ?? "(none — all done)"} completed=${res.completed.length}${res.warnings.length ? ` warnings=${res.warnings.length}` : ""}`);
  }
  return err ? 2 : 0;
}

function resumeFixtureDirs() {
  return readdirSync(FIX, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.startsWith("resume-"))
    .map(e => e.name).sort();
}

function printResumeFixtures() {
  const failed = [];
  for (const name of resumeFixtureDirs()) {
    const dir = join(FIX, name);
    let expected, actual;
    try {
      expected = JSON.parse(readFileSync(join(dir, "expected-reentry.json"), "utf8"));
      actual = resolveWorkspace(dir);
    } catch (e) {
      // misconfigured fixture (missing/malformed expected-reentry.json or _run.json) = tool error
      failed.push({ name, error: e.message, tool_error: true });
      continue;
    }
    const ok = actual.reenter_at === expected.reenter_at
      && JSON.stringify(actual.remaining) === JSON.stringify(expected.remaining)
      && JSON.stringify([...actual.completed].sort()) === JSON.stringify([...expected.completed].sort());
    if (!ok) failed.push({ name, expected, actual: { reenter_at: actual.reenter_at, remaining: actual.remaining, completed: actual.completed } });
  }
  if (jsonOut) {
    console.log(JSON.stringify({ command: "resume", checked: resumeFixtureDirs().length, failed: failed.length, failures: failed }));
  } else {
    for (const f of failed) console.error(`✗ ${f.name}: ${f.error ?? JSON.stringify(f.actual)}`);
    console.log(`resume: ${resumeFixtureDirs().length - failed.length}/${resumeFixtureDirs().length} fixtures matched`);
  }
  return failed.some(r => r.tool_error) ? 2 : failed.length ? 1 : 0; // 2=misconfig, 1=mismatch, 0=clean
}
```

(`cli.mjs` currently imports NOTHING from `node:fs` — add the import: `import { readdirSync, readFileSync } from "node:fs";`.)

Extend `runAll` (line 52-57) to include resume fixtures:

```javascript
function runAll() {
  const codes = [
    printSchema(checkSchemas(root)),
    printCycles(checkAllWorkflows(root)),
    printDetect2(detectRows()),
    printResumeFixtures(),
  ];
  const exit = Math.max(...codes);
  if (jsonOut) console.log(JSON.stringify({ command: "all", ok: exit === 0, exit }));
  return exit;
}
```

Add the `resume` case to the `switch` (near line 63) — `resume <dir>` inspects one workspace; bare `resume` runs the fixtures:

```javascript
  case "resume":
    code = args[1] && !args[1].startsWith("--") ? printResumeOne(resolve(root, args[1])) : printResumeFixtures();
    break;
```

Update the `--help` usage string (line 67):

```javascript
    console.log("Usage: sdlc-lint <schema|cycles|detect|resume|all> [--json]");
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools/sdlc-lint && node --test test/all.test.mjs && node cli.mjs all --json`
Expected: both tests PASS; `all --json` prints a `"command":"resume"` line and finishes with `"command":"all","ok":true`.

- [ ] **Step 5: Run the entire suite + full lint**

Run: `cd tools/sdlc-lint && npm test && node cli.mjs all`
Expected: all `node:test` files green; `all` prints `schema`, `cycles`, `detect`, `resume` summary lines, exit 0.

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/cli.mjs tools/sdlc-lint/test/all.test.mjs
git commit -m "feat(sdlc-lint): resume subcommand + fold resume fixtures into all"
```

---

## Task 4: Orchestrator write-path — persist `_run.json`, checkpoints, telemetry-from-checkpoints

Additive edits to `SKILL.md`. No phase logic changes. The "test" for this markdown is that the JSON shapes it emits match the schemas from Task 1 and the fixtures from Task 2 — a reviewer verifies by reading, plus the grep checks below.

**Files:**
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` — Step 3 opening (write `_run.json`), new Step 3d-3 (write checkpoint), Step 5 (assemble from checkpoints + new fields).

**Interfaces:**
- Consumes: `CONTEXT.resolved_phases` (already built at Step 1c), per-phase telemetry fields built in 3d-1/3d-2.
- Produces: `docs/plans/{slug}/.checkpoint/_run.json` and `.checkpoint/{unit}.json` files matching Task 1 schemas; `_telemetry.json` gains `resumed`, `resumed_at`, `resume_slug`, and per-phase `origin`.

- [ ] **Step 1: Persist the resolved DAG at Step 3 start**

In `SKILL.md`, find `### Step 3 — Execute each phase` (line ~762). Immediately after its intro paragraph, insert a new sub-step:

```markdown
**3-checkpoint-init.** Before dispatching any phase, create `docs/plans/{task_slug}/.checkpoint/`
and write `.checkpoint/_run.json` — the resolved DAG, so `--resume` (and `sdlc-lint resume`) can
compute the re-entry point without re-resolving the workflow. Shape (validated by
`schemas/run.schema.json`): `{ task_slug, workflow: CONTEXT.active_workflow, stack: primary_stack,
resolved_phases: [ {name, kind: "plain"|"loop"|"parallel", aspects: <ordered aspect list or null>,
members?: [{name, aspects}] } ] }`. Derive each entry from `CONTEXT.resolved_phases`: a loop phase
sets `kind:"loop"`; a `{parallel:[...]}` group sets `kind:"parallel"` + `members`; an aspect-aware
phase sets `aspects` to the aspects actually dispatched (from 3a), else `null`. Write it atomically
(`.tmp` → rename). This file is overwritten (not appended) on every fresh run.
```

- [ ] **Step 2: Add Step 3d-3 — write a checkpoint after each unit**

In `SKILL.md`, immediately after Step 3e (`### Step 3e ...` block ends around line 1031, before `### Step 4`), OR at the end of the 3d group — place it right after **3e. Validate phase output** so it fires only once validation passed. Insert:

```markdown
**3d-3. Write the phase checkpoint (resume substrate).** After 3d-1/3d-2 (telemetry computed) AND
3e (validation passed), atomically write `docs/plans/{task_slug}/.checkpoint/{unit}.json` where
`{unit}` = `{phase}` for an aspect-agnostic phase or `{phase}-{aspect}` for an aspect-aware one.
The file IS the `phases[]` telemetry entry for this unit (same fields — see Step 5) plus
`output_file` (the `0X-{phase}{-aspect}.md` path) and `completed_at` (ISO). Set `status:"completed"`.
Validated by `schemas/checkpoint.schema.json`. Write to `{unit}.json.tmp` then rename (atomic).

- **Dev planning pass:** right after the plan approval gate (3b-special) is approved, write
  `.checkpoint/{phase}-plan{-aspect}.json` with `status:"approved"` (no cost fields required). This
  lets resume skip the planning gate and re-enter directly at the implement pass.
- **Skipped phases:** when a phase is skipped by a skip-rule (Step 0c) or by an empty agent map
  (3a), write its checkpoint with `status:"skipped"` so resume treats it as done (nothing to do).

This is the ONLY change to the orchestrator write-path. It adds files; it changes no phase logic.
```

- [ ] **Step 3: Assemble telemetry from checkpoints in Step 5 + add resume fields**

In `SKILL.md` Step 5 (line ~1054), replace the opening instruction "Write `docs/plans/{task_slug}/_telemetry.json`:" lead-in with an assembly note (keep the existing JSON example and aggregate rules that follow):

```markdown
Assemble `phases[]` by reading `docs/plans/{task_slug}/.checkpoint/*.json` (every unit file except
`_run.json`), ordered by `completed_at`. Because each checkpoint IS a `phases[]` element, no
re-derivation is needed — this makes the totals correct even after a `--resume` (the cost of
phases finished in an earlier session is preserved in their checkpoints, not lost). Then write
`docs/plans/{task_slug}/_telemetry.json`:
```

Then, in the field list after the JSON example (near the `cap_status` bullet, line ~1131), add:

```markdown
- `resumed` = `true` when this run entered via `--resume` (else omit or `false`).
- `resumed_at` = ISO timestamp of the resume entry (only when `resumed`).
- `resume_slug` = the resumed slug (only when `resumed`).
- each `phases[]` element carries `origin: "resumed" | "fresh"` — `"resumed"` when it was loaded
  from a checkpoint written in an earlier session (not dispatched this run), else `"fresh"`.
```

- [ ] **Step 4: Verify the required content landed (grep gate)**

Run:
```bash
grep -c "3-checkpoint-init\|3d-3. Write the phase checkpoint\|origin: \"resumed\"\|_run.json" plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
```
Expected: a count `≥ 4` (all four markers present).

- [ ] **Step 5: Confirm the emitted shapes match the schemas (hand-check against Task 1)**

Create a throwaway workspace and validate a sample checkpoint + run file against the real schemas (proves the shapes the markdown describes are valid):

```bash
mkdir -p docs/plans/_schematest/.checkpoint
cat > docs/plans/_schematest/.checkpoint/_run.json <<'JSON'
{ "task_slug": "_schematest", "workflow": "default", "resolved_phases": [ { "name": "qa", "kind": "plain", "aspects": null } ] }
JSON
cat > docs/plans/_schematest/.checkpoint/qa.json <<'JSON'
{ "phase": "qa", "aspect": null, "status": "completed", "qa_status": "completed", "qa_iterations_used": 2, "completed_at": "2026-07-03T10:00:00Z" }
JSON
node tools/sdlc-lint/cli.mjs schema
rm -rf docs/plans/_schematest
```
Expected: `schema: N/N passed` (both new files validate). Then the `rm -rf` cleans up.

- [ ] **Step 6: Commit**

```bash
git add plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
git commit -m "feat(sdlc): write per-phase checkpoints + _run.json; assemble telemetry from them"
```

---

## Task 5: Orchestrator read-path — `--resume` flag + Step 2 branch + Step 3 skip

**Files:**
- Modify: `plugins/sdlc/commands/start.md` — parse `--resume[=slug]`; pass to skill; document.
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` — Step 2 resume branch; Step 3 skip check; drift-guard comment.

**Interfaces:**
- Consumes: `CONTEXT.resolved_phases`, `.checkpoint/*.json` + `_run.json` (from Task 4). The skip rules MUST match `lib/resume.mjs` (Task 2) exactly.
- Produces: on resume, `CONTEXT.completed_units` and re-entry behavior; the same completed-set / re-entry decision `sdlc-lint resume` computes.

- [ ] **Step 1: Parse `--resume` in `start.md`**

In `plugins/sdlc/commands/start.md` Step 1 (after the `--stack=NAME` handling, line ~18), add:

```markdown
If `$ARGUMENTS` contains `--resume` or `--resume=<slug>`: set `resume` mode. For `--resume=<slug>`
remember `<slug>` as `resume_slug`; for bare `--resume` the slug is derived from the description
exactly as in the skill's Step 2. Strip the flag from the description. Pass `resume` / `resume_slug`
to the skill in Step 2.
```

Update the `argument-hint` on line 3:

```markdown
argument-hint: "<feature description> [--stack=NAME] [--dry-run] [--resume[=slug]]"
```

Add a documentation section after "## Dry-run preview" (near line 96):

```markdown
## Resuming an interrupted run (`--resume`)

If a run was interrupted (crash, cost-cap abort, fatal halt), re-invoke with `--resume` to continue
from the first unfinished phase instead of re-running everything:

```
/sdlc:start "Add subscription billing with Stripe" --resume
/sdlc:start --resume=add-subscription-billing-with-stripe
```

The orchestrator reads `docs/plans/{slug}/.checkpoint/` — phases with a `completed`/`skipped`
checkpoint are skipped (their cost is preserved in the final telemetry); the pipeline re-enters at
the first unfinished phase. Combine with `--dry-run` to preview what would be skipped without
dispatching anything.

**Non-goal:** `--resume` does NOT restore repository state. It trusts the workspace and the code on
disk; if git moved under the completed phases, that is the operator's responsibility.
```

- [ ] **Step 2: Add the Step 2 resume branch in `SKILL.md`**

In `SKILL.md` `### Step 2 — Generate task slug and prepare workspace` (line ~754), append after item 3:

```markdown
**Resume mode.** When invoked with `resume` (see `start.md` Step 1):

1. Resolve `task_slug` from `resume_slug` or derive it from `$ARGUMENTS` (same algorithm as item 1).
2. If `docs/plans/{task_slug}/` does not exist → HALT:
   `⛔ Nothing to resume: docs/plans/{task_slug}/ not found. Run without --resume to start fresh.`
3. Do NOT recreate `_brief.md`. Read the existing one (it is the SSOT description for agents). If a
   non-empty description was passed AND it differs from `_brief.md`, print
   `⚠️ --resume: description differs from saved _brief.md; using saved brief` and continue with the saved brief.
4. Read `.checkpoint/*.json` (ignore `_run.json`, any `*.tmp`, and any file that fails to parse or
   lacks `status` — those units are treated as NOT complete). Build `CONTEXT.completed_units` =
   the set of `(phase, aspect, status)` from valid checkpoints. Set `CONTEXT.resumed = true`.
5. **MUST PRINT VERBATIM:**
   ```
   ⏭ Resume: {task_slug}
      Completed: {comma-list of completed unit ids}
      Re-entering at: {first unfinished resolved phase}
   ```
   The "first unfinished resolved phase" is computed by the SAME rules as Step 3's skip check below.
```

- [ ] **Step 3: Add the Step 3 skip check + drift-guard**

In `SKILL.md` Step 3, at the top of the per-phase loop (right before `**3a. Look up agent(s):**`, line ~800-802), insert:

```markdown
**3-resume-skip (resume mode only).** Before 3a, if `CONTEXT.resumed` is set, decide whether this
resolved phase is already complete and can be skipped. The rules MUST match `tools/sdlc-lint/lib/resume.mjs`
(the tested source of truth) exactly:

- **Plain aspect-agnostic** — done if `.checkpoint/{phase}.json` status ∈ {completed, skipped}.
- **Plain aspect-aware** — done if EVERY dispatched aspect has `.checkpoint/{phase}-{aspect}.json`
  status ∈ {completed, skipped}. If only some aspects are done, do NOT skip the phase; run only the
  aspects whose checkpoint is missing (in canonical order), skipping the done aspects.
- **Development two-pass** — if `.checkpoint/{phase}[-{aspect}].json` is completed → skip the aspect.
  Else if `.checkpoint/{phase}-plan[-{aspect}].json` is `approved` → skip the planning pass + gate,
  go straight to the implement pass (the plan is on disk, approved).
- **Loop phase** — skip ONLY if `.checkpoint/{phase}.json` is completed (verdict was approved).
  Otherwise re-run the loop as a unit from round 1. (Its `return_to` phase is re-dispatched by the
  loop as normal, even if that phase has a completed checkpoint — consistent with "a phase returned
  via changes is not complete".)

When a unit is skipped: load its checkpoint into `CONTEXT.phases[]` (set that element's
`origin: "resumed"`), add its `cost_usd` to `CONTEXT.running_cost_usd`, and **MUST PRINT VERBATIM:**
```
⏩ Phase {N}/{total}: {phase_name}{ — aspect} → skipped (resumed from checkpoint)
```
Freshly-dispatched units (this run) get `origin: "fresh"`. If ALL resolved phases are already done,
print `Resume: nothing left to run — re-verifying.` and go straight to Step 4 (post-checks) then
Step 5 (re-assemble telemetry).

<!-- DRIFT GUARD: these skip rules are mirrored in tools/sdlc-lint/lib/resume.mjs and its
     fixtures/resume-* . When you change resume skip-semantics here, update resume.mjs + the
     fixtures + resume.test.mjs in the SAME change, or CI (sdlc-lint all) will diverge from runtime. -->
```

- [ ] **Step 4: Verify required content landed (grep gate)**

Run:
```bash
grep -c "3-resume-skip\|⏭ Resume\|⏩ Phase\|DRIFT GUARD\|Nothing to resume" plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
grep -c "Resuming an interrupted run\|--resume" plugins/sdlc/commands/start.md
```
Expected: first `≥ 5`, second `≥ 2`.

- [ ] **Step 5: Full lint stays green (schemas + engine untouched by markdown)**

Run: `node tools/sdlc-lint/cli.mjs all && cd tools/sdlc-lint && npm test`
Expected: exit 0; all node tests pass. (Markdown edits don't affect the engine — this confirms nothing regressed.)

- [ ] **Step 6: Commit**

```bash
git add plugins/sdlc/commands/start.md plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
git commit -m "feat(sdlc): --resume read-path — flag parsing, resume branch, skip completed phases"
```

---

## Task 6: User-facing docs

**Files:**
- Modify: `README.md` (repo root) — one line pointing to resume.
- Modify: `docs/WORKFLOW.md` — a "Resuming an interrupted run" subsection.

**Interfaces:**
- Consumes: behavior finalized in Tasks 4-5.
- Produces: none (docs only).

- [ ] **Step 1: Locate the existing resume/telemetry references to anchor the docs**

Run: `grep -n "aborted_at_phase\|_telemetry\|## " docs/WORKFLOW.md | head -30`
Expected: prints the section headers; pick the section that describes telemetry/abort to place the new subsection after it.

- [ ] **Step 2: Add the WORKFLOW.md subsection**

Add after the telemetry/abort section identified in Step 1:

```markdown
### Resuming an interrupted run

Every phase writes an atomic checkpoint to `docs/plans/{slug}/.checkpoint/` the moment it finishes.
If a run is interrupted — crash, `Ctrl-C`, a cost-cap abort, or a fatal halt — re-run with
`--resume` to continue from the first unfinished phase:

```
/sdlc:start "<same description>" --resume
# or target the workspace directly:
/sdlc:start --resume=<slug>
```

Completed phases are skipped and their cost is preserved in the final `_telemetry.json` (each phase
records `origin: "resumed" | "fresh"`). `--resume --dry-run` previews what would be skipped without
dispatching anything.

You can inspect a workspace's re-entry point deterministically with the linter:

```
node tools/sdlc-lint/cli.mjs resume docs/plans/<slug>
```

**Non-goal:** resume trusts the code on disk; it does not restore git state.
```

- [ ] **Step 3: Add a README pointer**

In `README.md`, find the section that lists pipeline flags/features (search for `--dry-run`). Add one bullet next to it:

```markdown
- **`--resume`** — continue an interrupted pipeline from the first unfinished phase (per-phase
  checkpoints in `docs/plans/{slug}/.checkpoint/`). See `docs/WORKFLOW.md`.
```

If README has no such list, add the bullet under the most relevant "Usage"/"Features" heading.

- [ ] **Step 4: Verify docs mention resume**

Run: `grep -rc "\-\-resume" README.md docs/WORKFLOW.md`
Expected: both files report `≥ 1`.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/WORKFLOW.md
git commit -m "docs(sdlc): document --resume and checkpoint-based recovery"
```

---

## Final verification (after all tasks)

- [ ] **Full CI-equivalent run:**

```bash
node tools/sdlc-lint/cli.mjs all
cd tools/sdlc-lint && npm test
```
Expected: `all` prints `schema`, `cycles`, `detect`, `resume` summaries and exits 0; every `node:test` file green.

- [ ] **Drift check:** confirm the DRIFT GUARD comment in `SKILL.md` Step 3 and the resume fixtures both exist, and that `resume.mjs`'s four skip rules (plain-agnostic / plain-aspect / dev-two-pass / loop) are each reflected by a `resume-*` fixture.

---

## Self-Review Notes (author)

- **Spec coverage:** Component 1 (checkpoint files) → Tasks 1,4. Component 2 (recognition/Step 2) → Task 5. Component 3 (Step 3 skip + 3d-3 write) → Tasks 4,5. Component 4 (telemetry from checkpoints + new fields) → Task 4. Component 5 (`--resume --dry-run`) → documented in Task 5 Step 1 (behavior is "preview skip set"; the dry-run engine already exists in 1d-2 and needs no new code — resume-mode simply reports the completed set, so no separate task). Testing section (schema + `sdlc-lint resume` fixtures + node:test) → Tasks 1,2,3. Deliverables 1-8 all mapped. `_run.json` (not explicit in spec deliverables) added as the minimal enabler for CLI-computable re-entry — noted in spec's Component 1 spirit.
- **Type consistency:** `resolveWorkspace` / `computeReentry` / `loadCheckpoints` signatures identical in Task 2 (definition), Task 3 (CLI consumer), and Task 5 (markdown mirror). Unit id scheme `{phase}` / `{phase}-{aspect}` / `{phase}-plan[-aspect]` identical across schema, engine, fixtures, and markdown. `status` enum `completed|skipped|approved` identical in schema (Task 1), engine `DONE` set (Task 2), and markdown (Tasks 4-5).
- **Placeholder scan:** the only `placeholder` word is the deliberate throwaway stub in Task 3 Step 3 that the same step instructs you to delete/replace — real code follows immediately.
