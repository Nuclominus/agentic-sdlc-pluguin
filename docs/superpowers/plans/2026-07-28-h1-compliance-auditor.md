# H1 Transcript Compliance Auditor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure, from session transcripts already on disk, how often the SDLC orchestrator executes its own mandated steps, and publish a per-step compliance rate that sizes Track H's H4 decision.

**Architecture:** Six `sdlc-contract` YAML blocks are embedded in `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` next to the prose they describe, so a contract cannot drift from its step. A new `sdlc-lint compliance` verb parses those blocks, resolves each historical run directory to the session transcript(s) that produced it, extracts an ordered fact stream of `tool_use` calls, and reports `pass / partial / fail / na` per contract per run.

**Tech Stack:** Node 22 ESM, no build step. `node:test` + `node:assert/strict`. Existing deps only: `yaml` (contract blocks), `tinyglobby` (run globs). Reuses `tools/sdlc-lint/lib/usage.mjs` (a re-export shim over the shipped `plugins/sdlc/tools/usage/usage.mjs`).

**Spec:** `.brain/planning/h1-compliance-auditor.md`. Read it before starting — it records why the manifest lives inside `SKILL.md` and why the resulting rates are `provisional`.

## Global Constraints

- **ESM only.** Every file is `.mjs` with `import`/`export`. `tools/sdlc-lint/package.json` sets `"type": "module"`.
- **No new dependencies.** Use only `yaml`, `tinyglobby`, `ajv`, `ajv-formats` — already in `tools/sdlc-lint/package.json`.
- **Import conventions, copied from the existing lib files:** `import { globSync } from "tinyglobby";` and `import YAML from "yaml";` (default import, not named).
- **`tools/sdlc-lint/` is dev/CI only.** Nothing in this plan ships in the plugin payload. The one exception is Task 6, which edits `plugins/sdlc/tools/usage/usage.mjs` — that file *is* shipped and must stay dependency-free (node built-ins only).
- **Layer boundary, enforced by review:** `lib/compliance.mjs` parses neither JSONL nor Markdown; `cli.mjs` computes no verdicts; `lib/transcript-facts.mjs` contains the string "SDLC" nowhere.
- **Never throw on malformed input.** Transcripts are append-only logs that can end mid-write; contract blocks are hand-authored. Return errors in the result, do not throw. The only legal throw is a caller error (missing required CLI argument).
- **Never derive a session from the cwd.** Resolve it from an `agent_id` anchor. See `sessionOwnsRun`'s doc comment in `plugins/sdlc/tools/usage/usage.mjs:284`.
- **Tests run with** `cd tools/sdlc-lint && node --test`. The trailing-slash directory form does not auto-discover on Node 22 — pass file paths or run bare.
- **Commit style:** Conventional Commits, imperative mood. Stage explicit paths — never `git add -A`.

---

### Task 1: Transcript fact extractor

The only unit that knows the session `.jsonl` wire format. Everything downstream consumes its output.

**Files:**
- Create: `tools/sdlc-lint/lib/transcript-facts.mjs`
- Create: `tools/sdlc-lint/fixtures/compliance/session-basic.jsonl`
- Create: `tools/sdlc-lint/test/transcript-facts.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `extractFacts(transcriptPath: string) => Fact[]`
  - `extractFactsFrom(paths: string[]) => Fact[]` — concatenates in the given order, renumbering `seq` globally and adding `source`.
  - `Fact = { seq: number, tool: string|null, command: string|null, subagent_type: string|null, path: string|null }`; `extractFactsFrom` adds `source: string`.

- [ ] **Step 1: Write the fixture transcript**

Create `tools/sdlc-lint/fixtures/compliance/session-basic.jsonl`. Five lines: a `Bash` call, an `Agent` dispatch, a `Write`, a non-assistant line that must be ignored, and a **truncated** final line that must not throw. Each line is one JSON object; the last line is deliberately invalid JSON.

```jsonl
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"node \"${CLAUDE_PLUGIN_ROOT}/tools/usage/cli.mjs\" enrich my-slug","description":"Enrich cost"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_2","name":"Agent","input":{"subagent_type":"session-recorder","description":"Close SDLC session"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_3","name":"Write","input":{"file_path":"/tmp/out.md","content":"x"}}]}}
{"type":"user","message":{"role":"user","content":"not a tool call"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"toolu_4","na
```

- [ ] **Step 2: Write the failing test**

Create `tools/sdlc-lint/test/transcript-facts.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractFacts, extractFactsFrom } from "../lib/transcript-facts.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "compliance");

test("extracts one fact per tool_use block, in order", () => {
  const facts = extractFacts(join(FIX, "session-basic.jsonl"));
  assert.equal(facts.length, 3);
  assert.deepEqual(facts.map((f) => f.tool), ["Bash", "Agent", "Write"]);
  assert.deepEqual(facts.map((f) => f.seq), [0, 1, 2]);
});

test("carries the fields each tool kind identifies itself by", () => {
  const [bash, agent, write] = extractFacts(join(FIX, "session-basic.jsonl"));
  assert.match(bash.command, /usage\/cli\.mjs" enrich my-slug$/);
  assert.equal(bash.subagent_type, null);
  assert.equal(agent.subagent_type, "session-recorder");
  assert.equal(agent.command, null);
  assert.equal(write.path, "/tmp/out.md");
});

test("a truncated final line is skipped, not thrown on", () => {
  assert.doesNotThrow(() => extractFacts(join(FIX, "session-basic.jsonl")));
});

test("a missing transcript yields no facts rather than an error", () => {
  assert.deepEqual(extractFacts(join(FIX, "does-not-exist.jsonl")), []);
});

test("extractFactsFrom concatenates, renumbers seq globally and records the source", () => {
  const p = join(FIX, "session-basic.jsonl");
  const facts = extractFactsFrom([p, p]);
  assert.equal(facts.length, 6);
  assert.deepEqual(facts.map((f) => f.seq), [0, 1, 2, 3, 4, 5]);
  assert.ok(facts.every((f) => f.source === p));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/transcript-facts.test.mjs`
Expected: FAIL — `Cannot find module '../lib/transcript-facts.mjs'`.

- [ ] **Step 4: Write the implementation**

Create `tools/sdlc-lint/lib/transcript-facts.mjs`:

```js
import { existsSync, readFileSync } from "node:fs";

/**
 * Normalise ONE session transcript into an ordered fact stream — a single fact
 * per `tool_use` block found in an assistant message.
 *
 * This module knows the transcript wire format and nothing else: no SDLC step,
 * contract or run concept may leak in here. Compliance auditing, and any later
 * consumer (H4's runner, an AAR pass), consumes this shape rather than re-parsing
 * JSONL for itself.
 *
 * Never throws. A transcript is an append-only log that can end mid-write, so a
 * malformed line is skipped, not fatal.
 */
export function extractFacts(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  let raw;
  try { raw = readFileSync(transcriptPath, "utf8"); } catch { return []; }

  const facts = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }   // truncated tail, or a non-JSON line
    const content = d && d.message && Array.isArray(d.message.content) ? d.message.content : null;
    if (!content) continue;
    for (const b of content) {
      if (!b || typeof b !== "object" || b.type !== "tool_use") continue;
      const input = b.input && typeof b.input === "object" ? b.input : {};
      facts.push({
        seq: facts.length,
        tool: typeof b.name === "string" ? b.name : null,
        command: typeof input.command === "string" ? input.command : null,
        subagent_type: typeof input.subagent_type === "string" ? input.subagent_type : null,
        path: typeof input.file_path === "string" ? input.file_path : null,
      });
    }
  }
  return facts;
}

/**
 * Facts from several transcripts, concatenated in the order given, with `seq`
 * renumbered across the whole stream and each fact tagged with its source file.
 *
 * A run under `--resume` spans several sessions; its facts must be evaluated as
 * one stream, or a step performed in the second session reads as a miss.
 */
export function extractFactsFrom(paths) {
  const out = [];
  for (const p of paths || []) {
    for (const f of extractFacts(p)) out.push({ ...f, seq: out.length, source: p });
  }
  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tools/sdlc-lint && node --test test/transcript-facts.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/lib/transcript-facts.mjs \
        tools/sdlc-lint/test/transcript-facts.test.mjs \
        tools/sdlc-lint/fixtures/compliance/session-basic.jsonl
git commit -m "feat(sdlc-lint): extract an ordered tool_use fact stream from session transcripts"
```

---

### Task 2: Contract block parser

The only unit that knows the `sdlc-contract` format. Validates without throwing, so the CLI decides severity.

**Files:**
- Create: `tools/sdlc-lint/lib/contracts.mjs`
- Create: `tools/sdlc-lint/fixtures/compliance/skill-contracts-ok.md`
- Create: `tools/sdlc-lint/fixtures/compliance/skill-contracts-bad.md`
- Create: `tools/sdlc-lint/test/contracts.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `parseContracts(skillPath: string) => { contracts: Contract[], errors: string[] }`
  - `Contract = { id, requires, pattern, cardinality, since, applies_when: Condition[] }`
  - `Condition = { field: string, op: "=="|"!="|"exists"|"absent", value: string|number|boolean|null }`
  - `REQUIRES: Set<string>`, `CARDINALITIES: Set<string>`, `OPS: Set<string>` — exported for tests.

- [ ] **Step 1: Write the fixtures**

Create `tools/sdlc-lint/fixtures/compliance/skill-contracts-ok.md` — two valid contracts, one with `applies_when`, plus prose and an unrelated fenced block that must be ignored:

````markdown
# Fixture skill

Some prose that is not a contract.

```bash
echo "this fenced block must be ignored"
```

```sdlc-contract
id: 5b-0-enrich
requires: bash_match
pattern: usage/cli\.mjs enrich
cardinality: once-per-run
since: 2026-07-07
```

More prose.

```sdlc-contract
id: 6-journal
requires: agent_dispatch
pattern: session-recorder
cardinality: once-per-run
since: 2026-07-06
applies_when:
  - telemetry.headless_mode == false
```
````

Create `tools/sdlc-lint/fixtures/compliance/skill-contracts-bad.md` — one error of each class:

````markdown
```sdlc-contract
id: dup
requires: bash_match
pattern: a
cardinality: once-per-run
since: 2026-07-01
```

```sdlc-contract
id: dup
requires: bash_match
pattern: b
cardinality: once-per-run
since: 2026-07-01
```

```sdlc-contract
id: unknown-requires
requires: telepathy
pattern: a
cardinality: once-per-run
since: 2026-07-01
```

```sdlc-contract
id: bad-regex
requires: bash_match
pattern: "a([b"
cardinality: once-per-run
since: 2026-07-01
```

```sdlc-contract
id: bad-since
requires: bash_match
pattern: a
cardinality: once-per-run
since: last Tuesday
```

```sdlc-contract
id: bad-condition
requires: bash_match
pattern: a
cardinality: once-per-run
since: 2026-07-01
applies_when:
  - telemetry.foo ~~ 3
```

```sdlc-contract
id: not-a-mapping
```
````

- [ ] **Step 2: Write the failing test**

Create `tools/sdlc-lint/test/contracts.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseContracts } from "../lib/contracts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "compliance");
const REPO = resolve(HERE, "..", "..", "..");

test("parses every sdlc-contract block and ignores other fenced blocks", () => {
  const { contracts, errors } = parseContracts(join(FIX, "skill-contracts-ok.md"));
  assert.deepEqual(errors, []);
  assert.deepEqual(contracts.map((c) => c.id), ["5b-0-enrich", "6-journal"]);
  assert.equal(contracts[0].requires, "bash_match");
  assert.equal(contracts[0].cardinality, "once-per-run");
  assert.equal(contracts[0].since, "2026-07-07");
  assert.deepEqual(contracts[0].applies_when, []);
});

test("parses applies_when into structured conditions", () => {
  const { contracts } = parseContracts(join(FIX, "skill-contracts-ok.md"));
  assert.deepEqual(contracts[1].applies_when, [
    { field: "headless_mode", op: "==", value: false },
  ]);
});

test("every error class is reported, and none is thrown", () => {
  let res;
  assert.doesNotThrow(() => { res = parseContracts(join(FIX, "skill-contracts-bad.md")); });
  const joined = res.errors.join("\n");
  assert.match(joined, /duplicate id 'dup'/);
  assert.match(joined, /unknown requires 'telepathy'/);
  assert.match(joined, /uncompilable pattern/);
  assert.match(joined, /since must be YYYY-MM-DD/);
  assert.match(joined, /unparseable applies_when condition/);
  assert.match(joined, /not a mapping|missing required field/);
});

test("a contract with errors is excluded from the returned set", () => {
  const { contracts } = parseContracts(join(FIX, "skill-contracts-bad.md"));
  assert.equal(contracts.some((c) => c.id === "bad-regex"), false);
});

test("a missing file is an error, not a throw", () => {
  const { contracts, errors } = parseContracts(join(FIX, "no-such-file.md"));
  assert.deepEqual(contracts, []);
  assert.match(errors.join(" "), /cannot read/);
});

test("the real orchestrator SKILL.md parses with zero errors", () => {
  const { errors } = parseContracts(
    join(REPO, "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md"));
  assert.deepEqual(errors, []);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/contracts.test.mjs`
Expected: FAIL — `Cannot find module '../lib/contracts.mjs'`.

- [ ] **Step 4: Write the implementation**

Create `tools/sdlc-lint/lib/contracts.mjs`:

```js
import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";

export const REQUIRES = new Set(["bash_match", "agent_dispatch"]);
export const CARDINALITIES = new Set(["once-per-run", "once-per-phase"]);
export const OPS = new Set(["==", "!=", "exists", "absent"]);

// A fenced block whose info string is exactly `sdlc-contract`. Non-greedy body so
// consecutive blocks do not merge into one.
const BLOCK = /^```sdlc-contract[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

// `telemetry.<dotted.path> <op>[ <value>]` — deliberately not an expression
// language. The moment the grammar grows parentheses it needs its own test suite.
const CONDITION = /^telemetry\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\s+(==|!=|exists|absent)(?:\s+(.*))?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseCondition(raw) {
  const m = CONDITION.exec(String(raw).trim());
  if (!m) return null;
  const [, field, op, rest] = m;
  if (op === "exists" || op === "absent") {
    return rest && rest.trim() ? null : { field, op, value: null };
  }
  if (!rest || !rest.trim()) return null;
  let value;
  try { value = YAML.parse(rest.trim()); } catch { value = rest.trim(); }
  return { field, op, value };
}

function validate(raw, seen) {
  const errs = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: ["contract block is not a mapping"] };
  }
  const id = raw.id;
  const label = typeof id === "string" && id ? `'${id}'` : "(unnamed)";
  if (typeof id !== "string" || !id) errs.push("missing required field 'id'");
  else if (seen.has(id)) errs.push(`duplicate id '${id}'`);

  if (!REQUIRES.has(raw.requires)) {
    errs.push(`${label}: unknown requires '${raw.requires}' (expected ${[...REQUIRES].join(" | ")})`);
  }
  if (!CARDINALITIES.has(raw.cardinality)) {
    errs.push(`${label}: unknown cardinality '${raw.cardinality}' (expected ${[...CARDINALITIES].join(" | ")})`);
  }
  if (typeof raw.pattern !== "string" || !raw.pattern) {
    errs.push(`${label}: missing required field 'pattern'`);
  } else if (raw.requires === "bash_match") {
    try { new RegExp(raw.pattern); } catch (e) { errs.push(`${label}: uncompilable pattern — ${e.message}`); }
  }
  if (typeof raw.since !== "string" || !ISO_DATE.test(raw.since) || Number.isNaN(Date.parse(raw.since))) {
    errs.push(`${label}: since must be YYYY-MM-DD, got '${raw.since}'`);
  }

  const conditions = [];
  const aw = raw.applies_when;
  if (aw != null) {
    if (!Array.isArray(aw)) errs.push(`${label}: applies_when must be a list`);
    else for (const c of aw) {
      const parsed = parseCondition(c);
      if (!parsed) errs.push(`${label}: unparseable applies_when condition '${c}'`);
      else conditions.push(parsed);
    }
  }

  if (errs.length) return { errors: errs };
  return {
    errors: [],
    contract: {
      id, requires: raw.requires, pattern: raw.pattern,
      cardinality: raw.cardinality, since: raw.since, applies_when: conditions,
    },
  };
}

/**
 * Read every `sdlc-contract` block out of a SKILL.md.
 *
 * The contracts live inside the skill, adjacent to the prose they describe, so
 * that renumbering a step without updating its contract shows up in one diff. A
 * manifest kept in a separate file drifts on the first such edit and then either
 * fails forever or silently audits nothing.
 *
 * Returns errors rather than throwing: the CLI decides whether a malformed
 * contract is fatal.
 */
export function parseContracts(skillPath) {
  if (!skillPath || !existsSync(skillPath)) {
    return { contracts: [], errors: [`cannot read ${skillPath}`] };
  }
  let text;
  try { text = readFileSync(skillPath, "utf8"); }
  catch (e) { return { contracts: [], errors: [`cannot read ${skillPath}: ${e.message}`] }; }

  const contracts = [], errors = [], seen = new Set();
  BLOCK.lastIndex = 0;
  for (const m of text.matchAll(BLOCK)) {
    let raw;
    try { raw = YAML.parse(m[1]); }
    catch (e) { errors.push(`contract block: unparseable YAML — ${e.message}`); continue; }
    const { errors: errs, contract } = validate(raw, seen);
    if (errs.length) { errors.push(...errs); continue; }
    seen.add(contract.id);
    contracts.push(contract);
  }
  return { contracts, errors };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tools/sdlc-lint && node --test test/contracts.test.mjs`
Expected: PASS — 6 tests. The last one ("the real orchestrator SKILL.md parses with zero errors") passes trivially at this point because `SKILL.md` has no contract blocks yet; Task 3 gives it teeth.

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/lib/contracts.mjs \
        tools/sdlc-lint/test/contracts.test.mjs \
        tools/sdlc-lint/fixtures/compliance/skill-contracts-ok.md \
        tools/sdlc-lint/fixtures/compliance/skill-contracts-bad.md
git commit -m "feat(sdlc-lint): parse sdlc-contract blocks out of a skill, reporting errors instead of throwing"
```

---

### Task 3: The six contracts in the orchestrator's SKILL.md

Annotating the procedure with its own observable trace. This is the change that makes Task 2's last test meaningful.

**Files:**
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (6 insertion points)
- Modify: `tools/sdlc-lint/test/contracts.test.mjs` (add the count assertion)

**Interfaces:**
- Consumes: `parseContracts` from Task 2.
- Produces: six contracts with ids `2-4-anchor`, `3d-1b-phase-cost`, `5-clock`, `5b-0-enrich`, `5b-2-report`, `6-journal` — referenced by name in Task 4's fixtures and Task 7's report.

- [ ] **Step 1: Write the failing test**

Append to `tools/sdlc-lint/test/contracts.test.mjs`:

```js
test("the orchestrator declares exactly the v1 contract set", () => {
  const { contracts } = parseContracts(
    join(REPO, "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md"));
  assert.deepEqual(contracts.map((c) => c.id).sort(), [
    "2-4-anchor", "3d-1b-phase-cost", "5-clock",
    "5b-0-enrich", "5b-2-report", "6-journal",
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/contracts.test.mjs`
Expected: FAIL — actual `[]`, expected the six ids.

- [ ] **Step 3: Insert the six contract blocks**

Each block goes **immediately before** the prose of the step it describes, inside its own fenced block. It describes the step's observable trace and never restates the instruction — the prose below it remains the instruction.

At `SKILL.md` **Step 2**, immediately before the numbered list item `4. **Start the real clock (write-once).**`:

````markdown
```sdlc-contract
id: 2-4-anchor
requires: bash_match
pattern: _started_at
cardinality: once-per-run
since: 2026-07-06
```
````

At **Step 3d-1b**, immediately before its numbered list (the item beginning `1. Resolve the session transcript`):

````markdown
```sdlc-contract
id: 3d-1b-phase-cost
requires: bash_match
pattern: usage/cli\.mjs" phase-cost
cardinality: once-per-phase
since: 2026-07-28
```
````

At **Step 5**, immediately before the line `Compute the timing from the real clock captured in Step 2 (via \`Bash\`):`:

````markdown
```sdlc-contract
id: 5-clock
requires: bash_match
pattern: date -u (-r |-d @)
cardinality: once-per-run
since: 2026-07-06
```
````

At **Step 5b**, immediately before the numbered item `0. **Enrich cost (transcript-derived).**`:

````markdown
```sdlc-contract
id: 5b-0-enrich
requires: bash_match
pattern: usage/cli\.mjs" enrich
cardinality: once-per-run
since: 2026-07-07
```
````

At **Step 5b**, immediately before the numbered item `2. Else run via \`Bash\`: \`node "${CLAUDE_PLUGIN_ROOT}/tools/report/cli.mjs" report {task_slug}\`.`:

````markdown
```sdlc-contract
id: 5b-2-report
requires: bash_match
pattern: report/cli\.mjs" report
cardinality: once-per-run
since: 2026-07-03
```
````

At **Step 6**, immediately before the line `Dispatch via the \`Agent\` tool:`:

````markdown
```sdlc-contract
id: 6-journal
requires: agent_dispatch
pattern: session-recorder
cardinality: once-per-run
since: 2026-07-06
```
````

- [ ] **Step 4: Add the one-paragraph explainer**

The blocks must not read as instructions to the orchestrator. Add this paragraph once, at the end of the `## Hard rules for the orchestrator` section (around `SKILL.md:2408`):

```markdown
**`sdlc-contract` blocks are not instructions.** Fenced blocks whose info string is
`sdlc-contract` describe, for a machine, the observable trace a mandated step leaves in
the session transcript. They are read by `sdlc-lint compliance` after the fact; they are
never executed, never a substitute for the prose beside them, and nothing in a run depends
on them. Ignore them while running the pipeline. When you change a step that carries one,
change its contract in the same edit — that adjacency is the whole reason they live here.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tools/sdlc-lint && node --test test/contracts.test.mjs`
Expected: PASS — 7 tests, including the new set assertion and the zero-errors assertion.

- [ ] **Step 6: Verify no other lint check regressed**

`SKILL.md` is covered by `read-discipline` and `plugin-paths`, both of which scan its text.

Run: `node tools/sdlc-lint/cli.mjs all`
Expected: every line reports clean; exit 0.

- [ ] **Step 7: Commit**

```bash
git add plugins/sdlc/skills/pipeline-orchestrator/SKILL.md \
        tools/sdlc-lint/test/contracts.test.mjs
git commit -m "feat(sdlc): declare the six step contracts inside the orchestrator skill"
```

---

### Task 4: Run auditor

Pure evaluation: a run directory plus the contract set becomes a verdict per contract. No printing.

**Files:**
- Create: `tools/sdlc-lint/lib/compliance.mjs`
- Create: fixture run dirs under `tools/sdlc-lint/fixtures/compliance/runs/` (six, listed in Step 1)
- Create: `tools/sdlc-lint/test/compliance.test.mjs`

**Interfaces:**
- Consumes: `extractFactsFrom` (Task 1); `Contract` (Task 2); `knownRunAgentIds`, `findAgentTranscript` from `./usage.mjs`.
- Produces:
  - `auditRun(runDir: string, contracts: Contract[], opts?: { projectsRoot?: string }) => RunResult`
  - `resolveRunSessions(runDir, phases, opts) => string[]` (exported for tests)
  - `RunResult = { run: string, dir: string, date: string|null, date_source: "started_at"|"mtime"|"none", plugin_version: string|null, status: "auditable"|"unauditable", reason: string|null, sessions: string[], verdicts: Verdict[] }`
  - `Verdict = { id: string, verdict: "pass"|"partial"|"fail"|"na", reason: string|null, matched: number, expected: number }`

- [ ] **Step 1: Build the fixture runs**

Fixtures live under `tools/sdlc-lint/fixtures/compliance/runs/`. Each is a run directory plus a fake `projects` tree so `findAgentTranscript` resolves without touching the real `~/.claude`. Tests pass `projectsRoot` explicitly.

The shared fake projects root is `tools/sdlc-lint/fixtures/compliance/projects/`, laid out exactly as the harness does:

```
fixtures/compliance/projects/
  -fake-proj/
    sess-a.jsonl                      # session transcript (facts live here)
    sess-a/subagents/agent-aaa111.jsonl   # ownership anchor; content may be "{}\n"
    sess-b.jsonl
    sess-b/subagents/agent-bbb222.jsonl
```

`sess-a.jsonl` — a compliant run's session. Six `tool_use` lines: `phase-cost` twice, `_started_at`, `date -u -r`, `enrich`, `report`, and an `Agent` dispatch of `session-recorder`:

```jsonl
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"mkdir -p docs/plans/x/.checkpoint\n[ -f docs/plans/x/.checkpoint/_started_at ] || date -u +%s > docs/plans/x/.checkpoint/_started_at"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"node \"${CLAUDE_PLUGIN_ROOT}/tools/usage/cli.mjs\" phase-cost aaa111 --json"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t3","name":"Bash","input":{"command":"node \"${CLAUDE_PLUGIN_ROOT}/tools/usage/cli.mjs\" phase-cost bbb222 --json"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t4","name":"Bash","input":{"command":"date -u -r 1753700000 +%FT%TZ"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t5","name":"Bash","input":{"command":"node \"${CLAUDE_PLUGIN_ROOT}/tools/usage/cli.mjs\" enrich x"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t6","name":"Bash","input":{"command":"node \"${CLAUDE_PLUGIN_ROOT}/tools/report/cli.mjs\" report x"}}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t7","name":"Agent","input":{"subagent_type":"session-recorder","description":"Close SDLC session"}}]}}
```

`sess-b.jsonl` — the *second* session of a resumed run. One line only, the `enrich` call:

```jsonl
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"node \"${CLAUDE_PLUGIN_ROOT}/tools/usage/cli.mjs\" enrich resumed"}}]}}
```

The six run directories, each holding only `_telemetry.json`:

1. `runs/compliant/_telemetry.json` — every contract satisfied by `sess-a`:
```json
{
  "task_slug": "compliant",
  "started_at": "2026-07-28T10:00:00Z",
  "plugin_version": "1.14.1",
  "phases": [
    { "phase": "development", "agent_id": "aaa111" },
    { "phase": "qa", "agent_id": "bbb222" }
  ]
}
```

2. `runs/incident/_telemetry.json` — reproduces the real incident: a session that rendered the report but never enriched. It needs its own session, `sess-c`, because the run must contain a `report` call and **no** `enrich` call.

`projects/-fake-proj/sess-c.jsonl` (one line, a `report` call and nothing else):
```jsonl
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"node \"${CLAUDE_PLUGIN_ROOT}/tools/report/cli.mjs\" report incident"}}]}}
```
plus `projects/-fake-proj/sess-c/subagents/agent-ccc333.jsonl` containing `{}`.

```json
{
  "task_slug": "incident",
  "started_at": "2026-07-28T14:24:17Z",
  "phases": [{ "phase": "development", "agent_id": "ccc333" }]
}
```

3. `runs/resumed/_telemetry.json` — two phases whose agents live in **different** sessions, so the union matters. Add `projects/-fake-proj/sess-a/subagents/agent-ddd444.jsonl` (`{}`) and `projects/-fake-proj/sess-b/subagents/agent-eee555.jsonl` (`{}`):
```json
{
  "task_slug": "resumed",
  "started_at": "2026-07-28T10:00:00Z",
  "phases": [
    { "phase": "development", "agent_id": "ddd444" },
    { "phase": "qa", "agent_id": "eee555" }
  ]
}
```

4. `runs/no-anchor/_telemetry.json` — unauditable:
```json
{ "task_slug": "no-anchor", "started_at": "2026-07-20T10:00:00Z", "phases": [{ "phase": "development" }] }
```

5. `runs/old/_telemetry.json` — predates `3d-1b-phase-cost`, anchored on `sess-a`. Add `projects/-fake-proj/sess-a/subagents/agent-fff666.jsonl` (`{}`):
```json
{
  "task_slug": "old",
  "started_at": "2026-07-10T10:00:00Z",
  "phases": [{ "phase": "development", "agent_id": "fff666" }]
}
```

6. `runs/partial/_telemetry.json` — three dispatching phases against `sess-a`'s two `phase-cost` calls. Add `projects/-fake-proj/sess-a/subagents/agent-ggg777.jsonl` (`{}`):
```json
{
  "task_slug": "partial",
  "started_at": "2026-07-28T10:00:00Z",
  "phases": [
    { "phase": "development", "agent_id": "ggg777" },
    { "phase": "qa", "agent_id": "ggg777" },
    { "phase": "security", "agent_id": "ggg777" }
  ]
}
```

> Note: `knownRunAgentIds` de-duplicates ids into a `Set`, so `partial`'s expected denominator must be computed from **phases that carry an `agent_id`**, not from the id set. That is what Step 4's `expectedPhases` does — three phases, one id.

- [ ] **Step 2: Write the failing test**

Create `tools/sdlc-lint/test/compliance.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { auditRun } from "../lib/compliance.mjs";
import { parseContracts } from "../lib/contracts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "compliance");
const REPO = resolve(HERE, "..", "..", "..");
const PROJECTS = join(FIX, "projects");
const run = (name) => join(FIX, "runs", name);

const { contracts } = parseContracts(join(REPO, "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md"));
const audit = (name) => auditRun(run(name), contracts, { projectsRoot: PROJECTS });
const verdict = (res, id) => res.verdicts.find((v) => v.id === id);

test("a fully compliant run passes every contract", () => {
  const res = audit("compliant");
  assert.equal(res.status, "auditable");
  assert.deepEqual(res.verdicts.filter((v) => v.verdict !== "pass"), []);
});

test("the incident shape fails 5b-0-enrich", () => {
  const res = audit("incident");
  assert.equal(verdict(res, "5b-0-enrich").verdict, "fail");
  assert.equal(verdict(res, "5b-2-report").verdict, "pass");
});

test("a resumed run unions its sessions rather than picking one", () => {
  const res = audit("resumed");
  assert.equal(res.sessions.length, 2);
  assert.equal(verdict(res, "5b-0-enrich").verdict, "pass");
});

test("a run with no resolvable agent id is unauditable and yields no verdicts", () => {
  const res = audit("no-anchor");
  assert.equal(res.status, "unauditable");
  assert.equal(res.reason, "no-agent-ids");
  assert.deepEqual(res.verdicts, []);
});

test("a contract newer than the run is na: predates", () => {
  const v = verdict(audit("old"), "3d-1b-phase-cost");
  assert.equal(v.verdict, "na");
  assert.equal(v.reason, "predates");
});

test("once-per-phase short of its denominator is partial, with the fraction", () => {
  const v = verdict(audit("partial"), "3d-1b-phase-cost");
  assert.equal(v.verdict, "partial");
  assert.equal(v.matched, 2);
  assert.equal(v.expected, 3);
});

test("the run date falls back to mtime when started_at is absent", () => {
  const res = audit("compliant");
  assert.equal(res.date_source, "started_at");
  assert.equal(res.date, "2026-07-28");
});

test("plugin_version is surfaced when telemetry carries it", () => {
  assert.equal(audit("compliant").plugin_version, "1.14.1");
  assert.equal(audit("incident").plugin_version, null);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/compliance.test.mjs`
Expected: FAIL — `Cannot find module '../lib/compliance.mjs'`.

- [ ] **Step 4: Write the implementation**

Create `tools/sdlc-lint/lib/compliance.mjs`:

```js
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { extractFactsFrom } from "./transcript-facts.mjs";
import { knownRunAgentIds, findAgentTranscript } from "./usage.mjs";

/**
 * Every session transcript that owns at least one of this run's agents, oldest first.
 *
 * The union, not the newest: a run under `--resume` spans sessions, and a step
 * performed in the second one must not read as a miss. Never derived from the cwd —
 * the harness files a session under the directory it STARTED in, so a worktree-isolated
 * run resolves to an unrelated session (see sessionOwnsRun in the shipped usage.mjs).
 */
export function resolveRunSessions(runDir, phases, opts = {}) {
  const sessions = new Map();   // path -> mtimeMs
  for (const id of knownRunAgentIds(runDir, phases)) {
    const agentPath = findAgentTranscript(id, { projectsRoot: opts.projectsRoot });
    if (!agentPath) continue;
    // .../<sid>/subagents/agent-<id>.jsonl  ->  .../<sid>.jsonl
    const session = `${dirname(dirname(agentPath))}.jsonl`;
    if (sessions.has(session) || !existsSync(session)) continue;
    let mtime = 0;
    try { mtime = statSync(session).mtimeMs; } catch { /* unreadable: sort first */ }
    sessions.set(session, mtime);
  }
  return [...sessions.entries()].sort((a, b) => a[1] - b[1]).map(([p]) => p);
}

function telemetryValue(tel, field) {
  return field.split(".").reduce((o, k) => (o == null ? undefined : o[k]), tel);
}

function conditionHolds(cond, tel) {
  const actual = telemetryValue(tel, cond.field);
  if (cond.op === "exists") return actual !== undefined && actual !== null;
  if (cond.op === "absent") return actual === undefined || actual === null;
  const equal = actual === cond.value;
  return cond.op === "==" ? equal : !equal;
}

function countMatches(contract, facts) {
  if (contract.requires === "agent_dispatch") {
    return facts.filter((f) => f.tool === "Agent" && f.subagent_type === contract.pattern).length;
  }
  const re = new RegExp(contract.pattern);
  return facts.filter((f) => f.tool === "Bash" && f.command && re.test(f.command)).length;
}

// Phases that actually dispatched an agent. NOT the id set: one resumed subagent can
// serve several phases, and the denominator is phases, not distinct agents.
function expectedPhases(phases) {
  return (phases || []).filter((p) => {
    const a = p.agent_id;
    return Array.isArray(a) ? a.length > 0 : Boolean(a);
  }).length;
}

function runDate(runDir, tel) {
  const iso = typeof tel.started_at === "string" ? Date.parse(tel.started_at) : NaN;
  if (Number.isFinite(iso)) {
    return { date: new Date(iso).toISOString().slice(0, 10), date_source: "started_at" };
  }
  try {
    const m = statSync(join(runDir, "_telemetry.json")).mtimeMs;
    return { date: new Date(m).toISOString().slice(0, 10), date_source: "mtime" };
  } catch {
    return { date: null, date_source: "none" };
  }
}

function evaluate(contract, { facts, tel, phaseCount, date }) {
  const na = (reason) => ({ id: contract.id, verdict: "na", reason, matched: 0, expected: 0 });

  if (date && contract.since > date) return na("predates");
  for (const c of contract.applies_when) if (!conditionHolds(c, tel)) return na("not-applicable");

  const matched = countMatches(contract, facts);
  if (contract.cardinality === "once-per-phase") {
    if (phaseCount === 0) return na("phase-skipped");
    const verdict = matched >= phaseCount ? "pass" : matched > 0 ? "partial" : "fail";
    return { id: contract.id, verdict, reason: null, matched, expected: phaseCount };
  }
  return {
    id: contract.id,
    verdict: matched > 0 ? "pass" : "fail",
    reason: null, matched, expected: 1,
  };
}

/**
 * Audit ONE run directory against the contract set.
 *
 * Pure: reads files, returns a result, prints nothing and throws nothing. A run with
 * no resolvable transcript is `unauditable` and carries no verdicts at all — folding
 * such runs into the rate would silently dilute it.
 */
export function auditRun(runDir, contracts, opts = {}) {
  const base = { run: basename(runDir), dir: runDir, sessions: [], verdicts: [] };
  const telPath = join(runDir, "_telemetry.json");
  if (!existsSync(telPath)) {
    return { ...base, date: null, date_source: "none", plugin_version: null,
             status: "unauditable", reason: "no-telemetry" };
  }
  let tel;
  try { tel = JSON.parse(readFileSync(telPath, "utf8")); }
  catch { return { ...base, date: null, date_source: "none", plugin_version: null,
                   status: "unauditable", reason: "unreadable-telemetry" }; }

  const phases = tel.phases || [];
  const { date, date_source } = runDate(runDir, tel);
  const plugin_version = typeof tel.plugin_version === "string" ? tel.plugin_version : null;
  const head = { ...base, date, date_source, plugin_version };

  const sessions = resolveRunSessions(runDir, phases, opts);
  if (!sessions.length) {
    return { ...head, status: "unauditable", reason: "no-agent-ids" };
  }

  const facts = extractFactsFrom(sessions);
  const phaseCount = expectedPhases(phases);
  return {
    ...head,
    sessions,
    status: "auditable",
    reason: null,
    verdicts: contracts.map((c) => evaluate(c, { facts, tel, phaseCount, date })),
  };
}
```

> `contract.since > date` is a lexicographic comparison of two `YYYY-MM-DD` strings, which is exactly chronological for that format. Both are validated to it — `since` by `parseContracts`, `date` by construction from `toISOString().slice(0, 10)`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd tools/sdlc-lint && node --test test/compliance.test.mjs`
Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/lib/compliance.mjs \
        tools/sdlc-lint/test/compliance.test.mjs \
        tools/sdlc-lint/fixtures/compliance/
git commit -m "feat(sdlc-lint): audit a run against the step contracts, unioning its sessions"
```

---

### Task 5: The `compliance` CLI verb

Aggregation and printing. The only unit that writes to stdout.

**Files:**
- Create: `tools/sdlc-lint/lib/compliance-report.mjs`
- Modify: `tools/sdlc-lint/cli.mjs` (imports, a `printCompliance` function, the `switch`, the `--help` text)
- Create: `tools/sdlc-lint/test/compliance-report.test.mjs`

**Interfaces:**
- Consumes: `auditRun` (Task 4), `parseContracts` (Task 2).
- Produces:
  - `aggregate(results: RunResult[], contracts: Contract[]) => Aggregate`
  - `Aggregate = { contracts: ContractRow[], auditable: number, excluded: { run, reason }[] }`
  - `ContractRow = { id, pass, partial, fail, na, denominator, rate: number|null, annotations: string[] }`
  - `renderText(agg, results) => string`

The rate is **strict**: `pass / (pass + partial + fail)`. `partial` never counts as success. `denominator` is that same sum; `rate` is `null` when the denominator is 0.

- [ ] **Step 1: Write the failing test**

Create `tools/sdlc-lint/test/compliance-report.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, renderText } from "../lib/compliance-report.mjs";

const contracts = [
  { id: "a", requires: "bash_match", pattern: "x", cardinality: "once-per-run", since: "2026-01-01", applies_when: [] },
  { id: "b", requires: "bash_match", pattern: "y", cardinality: "once-per-phase", since: "2026-01-01", applies_when: [] },
];

const results = [
  { run: "r1", status: "auditable", date: "2026-07-01", date_source: "started_at", plugin_version: null,
    verdicts: [{ id: "a", verdict: "pass", reason: null, matched: 1, expected: 1 },
               { id: "b", verdict: "partial", reason: null, matched: 1, expected: 3 }] },
  { run: "r2", status: "auditable", date: "2026-07-02", date_source: "mtime", plugin_version: "1.14.1",
    verdicts: [{ id: "a", verdict: "fail", reason: null, matched: 0, expected: 1 },
               { id: "b", verdict: "na", reason: "predates", matched: 0, expected: 0 }] },
  { run: "r3", status: "unauditable", reason: "no-agent-ids", date: null, date_source: "none",
    plugin_version: null, verdicts: [] },
];

test("rate counts only pass over applicable runs, never partial", () => {
  const agg = aggregate(results, contracts);
  const a = agg.contracts.find((c) => c.id === "a");
  assert.deepEqual([a.pass, a.partial, a.fail, a.na], [1, 0, 1, 0]);
  assert.equal(a.denominator, 2);
  assert.equal(a.rate, 0.5);

  const b = agg.contracts.find((c) => c.id === "b");
  assert.deepEqual([b.pass, b.partial, b.fail, b.na], [0, 1, 0, 1]);
  assert.equal(b.denominator, 1);
  assert.equal(b.rate, 0);
});

test("unauditable runs are excluded, never folded into a denominator", () => {
  const agg = aggregate(results, contracts);
  assert.equal(agg.auditable, 2);
  assert.deepEqual(agg.excluded, [{ run: "r3", reason: "no-agent-ids" }]);
});

test("a denominator below 5 is annotated thin", () => {
  const agg = aggregate(results, contracts);
  assert.ok(agg.contracts.every((c) => c.annotations.includes(`thin denominator (n=${c.denominator})`)));
});

test("rates are annotated provisional while any audited run lacks plugin_version", () => {
  const agg = aggregate(results, contracts);
  assert.ok(agg.contracts.every((c) => c.annotations.includes("provisional")));
});

test("5b-2-report carries its confounder annotation", () => {
  const withReport = [{ id: "5b-2-report", requires: "bash_match", pattern: "z",
                        cardinality: "once-per-run", since: "2026-01-01", applies_when: [] }];
  const rows = aggregate([{ run: "r", status: "auditable", date: "2026-07-01", date_source: "started_at",
    plugin_version: "1.14.1",
    verdicts: [{ id: "5b-2-report", verdict: "pass", reason: null, matched: 1, expected: 1 }] }], withReport);
  assert.ok(rows.contracts[0].annotations.includes("confounded by --no-report (not recorded)"));
});

test("a zero denominator yields a null rate rather than NaN", () => {
  const agg = aggregate([{ run: "r", status: "auditable", date: "2026-07-01", date_source: "started_at",
    plugin_version: "1.14.1",
    verdicts: [{ id: "a", verdict: "na", reason: "predates", matched: 0, expected: 0 }] }], [contracts[0]]);
  assert.equal(agg.contracts[0].rate, null);
});

test("the rendered report names all three sections", () => {
  const text = renderText(aggregate(results, contracts), results);
  assert.match(text, /per-contract/i);
  assert.match(text, /per-run/i);
  assert.match(text, /excluded/i);
  assert.match(text, /no-agent-ids/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/compliance-report.test.mjs`
Expected: FAIL — `Cannot find module '../lib/compliance-report.mjs'`.

- [ ] **Step 3: Write the aggregator and renderer**

Create `tools/sdlc-lint/lib/compliance-report.mjs`:

```js
const THIN = 5;

/**
 * Roll per-run verdicts up into one row per contract.
 *
 * The rate is strict — `pass / (pass + partial + fail)` — because a partially
 * executed once-per-phase step is not a success: the cost cap went blind on exactly
 * the phases that were missed. `na` never enters a denominator, and neither does an
 * unauditable run.
 */
export function aggregate(results, contracts) {
  const audited = results.filter((r) => r.status === "auditable");
  const anyUnversioned = audited.some((r) => !r.plugin_version);

  const rows = contracts.map((c) => {
    const counts = { pass: 0, partial: 0, fail: 0, na: 0 };
    for (const r of audited) {
      const v = r.verdicts.find((x) => x.id === c.id);
      if (v) counts[v.verdict] += 1;
    }
    const denominator = counts.pass + counts.partial + counts.fail;
    const annotations = [];
    // `since` is a commit date in THIS repo — an upper bound on when a step could have
    // reached a downstream install, not evidence that it did. Until plugin_version is
    // present on every audited run, no rate here is a measurement of what was installed.
    if (anyUnversioned) annotations.push("provisional");
    if (denominator < THIN) annotations.push(`thin denominator (n=${denominator})`);
    if (c.id === "5b-2-report") annotations.push("confounded by --no-report (not recorded)");
    return { id: c.id, ...counts, denominator, rate: denominator ? counts.pass / denominator : null, annotations };
  });

  return {
    contracts: rows,
    auditable: audited.length,
    excluded: results.filter((r) => r.status !== "auditable").map((r) => ({ run: r.run, reason: r.reason })),
  };
}

const pct = (rate) => (rate === null ? "  n/a" : `${String(Math.round(rate * 100)).padStart(3)}%`);

export function renderText(agg, results) {
  const out = [];
  out.push(`compliance — per-contract rates over ${agg.auditable} auditable run(s)`);
  out.push("");
  for (const c of agg.contracts) {
    const note = c.annotations.length ? `  [${c.annotations.join("; ")}]` : "";
    out.push(`  ${pct(c.rate)}  ${c.id.padEnd(20)} pass=${c.pass} partial=${c.partial} fail=${c.fail} na=${c.na}${note}`);
  }

  out.push("");
  out.push("per-run detail (non-pass verdicts only)");
  for (const r of results.filter((x) => x.status === "auditable")) {
    const bad = r.verdicts.filter((v) => v.verdict !== "pass");
    const date = `${r.date ?? "?"}${r.date_source === "mtime" ? " (date-inferred)" : ""}`;
    if (!bad.length) { out.push(`  ✓ ${r.run}  ${date}`); continue; }
    const detail = bad.map((v) => v.verdict === "partial"
      ? `${v.id}=partial ${v.matched}/${v.expected}`
      : `${v.id}=${v.verdict}${v.reason ? `:${v.reason}` : ""}`).join("  ");
    out.push(`  ✗ ${r.run}  ${date}  ${detail}`);
  }

  out.push("");
  out.push(`excluded — unauditable runs (${agg.excluded.length})`);
  for (const e of agg.excluded) out.push(`  – ${e.run}  ${e.reason}`);
  return out.join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tools/sdlc-lint && node --test test/compliance-report.test.mjs`
Expected: PASS — 7 tests.

- [ ] **Step 5: Wire the verb into the CLI**

In `tools/sdlc-lint/cli.mjs`, add to the import block (after the `checkPluginPaths` import on line 11):

```js
import { parseContracts } from "./lib/contracts.mjs";
import { auditRun } from "./lib/compliance.mjs";
import { aggregate, renderText } from "./lib/compliance-report.mjs";
```

Add the option reader and the printer, above `function runAll()`:

```js
function opt(name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
}

function printCompliance() {
  const skill = resolve(root, "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md");
  const { contracts, errors } = parseContracts(skill);
  for (const e of errors) console.error(`✗ contract: ${e}`);
  if (!contracts.length) {
    console.error("✗ compliance: no sdlc-contract blocks found — nothing to audit");
    return 2;
  }

  const pattern = opt("--runs", "docs/plans/*");
  const dirs = globSync(pattern, { cwd: root, absolute: true, onlyDirectories: true })
    .filter((d) => existsSync(join(d, "_telemetry.json"))).sort();
  if (!dirs.length) {
    console.error(`✗ compliance: no run directories with _telemetry.json matched '${pattern}'`);
    return 2;
  }

  const results = dirs.map((d) => auditRun(d, contracts));
  const agg = aggregate(results, contracts);
  if (jsonOut) console.log(JSON.stringify({ command: "compliance", contracts: agg.contracts, auditable: agg.auditable, excluded: agg.excluded, runs: results }));
  else console.log(renderText(agg, results));

  // An instrument, not a gate: findings must not fail a build until the rate is known.
  return errors.length ? 2 : 0;
}
```

Add `import { globSync } from "tinyglobby";` to the imports, and add the case to the `switch`, right before `case "all"`:

```js
  case "compliance": code = printCompliance(); break;
```

Extend the `--help` output:

```js
    console.log("Usage: sdlc-lint <schema|cycles|detect|resume|report|rollup|read-discipline|plugin-paths|compliance|all> [--json]");
```

and add one description line beside the existing two:

```js
    console.log("  compliance        H1: did the orchestrator run its own mandated steps? [--runs <glob>]");
```

> `compliance` is deliberately **not** added to `runAll()`. `all` is the CI gate and returns a non-zero exit on findings; this verb is diagnostic and depends on transcripts that exist only on a developer's machine.

- [ ] **Step 6: Verify the verb runs end-to-end against the fixtures**

Run: `node tools/sdlc-lint/cli.mjs compliance --runs 'tools/sdlc-lint/fixtures/compliance/runs/*'`

Expected: the three-section report. `incident` shows `5b-0-enrich=fail`, `partial` shows `3d-1b-phase-cost=partial 2/3`, and `no-anchor` appears under `excluded` with `no-agent-ids`.

> The fixtures resolve against the real `~/.claude` here because the CLI passes no `projectsRoot`; the fixture agent ids will not be found there, so **every fixture run may report `no-agent-ids`**. That is expected from the CLI path — the resolution logic is covered with an explicit `projectsRoot` in Task 4. What this step verifies is that the verb wires up, prints three sections and exits 0.

- [ ] **Step 7: Confirm the CI gate is unchanged**

Run: `node tools/sdlc-lint/cli.mjs all`
Expected: identical output to before this task; exit 0.

- [ ] **Step 8: Commit**

```bash
git add tools/sdlc-lint/lib/compliance-report.mjs \
        tools/sdlc-lint/test/compliance-report.test.mjs \
        tools/sdlc-lint/cli.mjs
git commit -m "feat(sdlc-lint): add the compliance verb reporting per-step rates with their caveats"
```

---

### Task 6: Record `plugin_version` in telemetry

So a future audit can tell whether a step had actually reached the install, instead of inferring it from a commit date in this repository.

**Files:**
- Modify: `plugins/sdlc/tools/usage/usage.mjs` (inside `enrichTelemetry`, before the `writeFileSync` at line ~611)
- Modify: `tools/sdlc-lint/test/usage.test.mjs` (append one test)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `_telemetry.json.plugin_version: string` — read in Task 4 by `auditRun`.

- [ ] **Step 1: Write the failing test**

Append to `tools/sdlc-lint/test/usage.test.mjs`:

```js
test("enrich stamps the plugin version it ran from", () => {
  const dir = mkdtempSync(join(tmpdir(), "plugin-version-"));
  writeFileSync(join(dir, "_telemetry.json"),
    JSON.stringify({ task_slug: "x", phases: [{ phase: "development" }] }));

  // No transcripts resolve here; the stamp must be written regardless, because it
  // describes the tool that ran, not the pricing it managed to recover.
  enrichTelemetry(dir, { projectsRoot: join(dir, "no-projects") });

  const tel = JSON.parse(readFileSync(join(dir, "_telemetry.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(
    resolve(REPO, "plugins/sdlc/.claude-plugin/plugin.json"), "utf8"));
  assert.equal(tel.plugin_version, manifest.version);
});
```

> Reuse whatever `REPO`, `mkdtempSync`, `writeFileSync`, `readFileSync`, `tmpdir` and `enrichTelemetry` bindings the file already has; add only the imports it lacks.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tools/sdlc-lint && node --test test/usage.test.mjs`
Expected: FAIL — `tel.plugin_version` is `undefined`.

- [ ] **Step 3: Implement the stamp**

In `plugins/sdlc/tools/usage/usage.mjs`, add near the other module-level helpers:

```js
/**
 * The version of the plugin this enricher shipped in, read from its own manifest.
 *
 * Stamped into telemetry so a later compliance audit can tell whether a mandated
 * step had actually reached this install, rather than inferring it from a commit
 * date in the marketplace repo. Read here, by the machine that already holds the
 * value — asking the orchestrator to `cat` the manifest and copy the number into
 * JSON would add exactly the class of hand-transcribed machine value that Track H
 * exists to remove.
 *
 * Best-effort: a missing or malformed manifest yields null, never a throw. Pricing
 * must not fail over a diagnostic field.
 */
function pluginVersion() {
  try {
    const manifest = new URL("../../.claude-plugin/plugin.json", import.meta.url);
    const v = JSON.parse(readFileSync(manifest, "utf8")).version;
    return typeof v === "string" ? v : null;
  } catch { return null; }
}
```

Then, inside `enrichTelemetry`, immediately before `writeFileSync(telPath, ...)`:

```js
  const pv = pluginVersion();
  if (pv) tel.plugin_version = pv;
```

> `import.meta.url` here is `<plugin-root>/tools/usage/usage.mjs`, so `../../.claude-plugin/plugin.json` resolves to `<plugin-root>/.claude-plugin/plugin.json`. Verify with `node -e 'import("./plugins/sdlc/tools/usage/usage.mjs")'` if the path is in doubt — this is the one place where a wrong relative path fails silently, since the helper swallows its own errors.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd tools/sdlc-lint && node --test test/usage.test.mjs`
Expected: PASS — the existing usage tests plus the new one.

- [ ] **Step 5: Document the field in the orchestrator's telemetry template**

In `SKILL.md` Step 5, in the JSON template (around line 1900), add one line after `"model_enforcement_corrections": 0,`:

```json
  "plugin_version": "<written by Step 5b's enrich — do NOT hand-transcribe>",
```

- [ ] **Step 6: Run the full suite**

Run: `cd tools/sdlc-lint && node --test && cd - && node tools/sdlc-lint/cli.mjs all`
Expected: all tests pass; `all` exits 0.

- [ ] **Step 7: Commit**

```bash
git add plugins/sdlc/tools/usage/usage.mjs \
        plugins/sdlc/skills/pipeline-orchestrator/SKILL.md \
        tools/sdlc-lint/test/usage.test.mjs
git commit -m "feat(sdlc): stamp plugin_version into telemetry from the enricher, not from prose"
```

---

### Task 7: Run the audit and publish the rate

The deliverable the whole item exists for. Everything before this is instrumentation.

**Files:**
- Modify: `.brain/planning/h1-compliance-auditor.md` (add a "Measured result" section)
- Modify: `.brain/planning/h-instruction-fidelity.md` (fold the number into the H4 gate)
- Modify: `.brain/planning/roadmap.md` (H1 → `done`)

**Interfaces:**
- Consumes: the `compliance` verb (Task 5).
- Produces: the compliance rate that gates H4.

- [ ] **Step 1: Run the audit over the real corpus**

```bash
node tools/sdlc-lint/cli.mjs compliance --runs "$HOME/parlor-android/docs/plans/*" --json \
  > /tmp/h1-compliance.json
node tools/sdlc-lint/cli.mjs compliance --runs "$HOME/parlor-android/docs/plans/*"
```

Expected shape, from the corpus survey in the spec: 18 run directories matched, ~12 auditable, ~6 excluded with `no-agent-ids`.

- [ ] **Step 2: Verify the known-positive**

```bash
node -e 'const r=require("/tmp/h1-compliance.json").runs.find(x=>x.run==="native-chat-engine-s2-thread-list");console.log(JSON.stringify(r.verdicts,null,1))'
```

Expected: `5b-0-enrich` has `"verdict": "fail"`.

**If it does not, stop.** The auditor is wrong and the numbers from Step 1 mean nothing — that run is known to have skipped enrichment (`cost_basis: "subagent_aggregate"`, `usage/cli.mjs` absent from all 42 of its `Bash` calls). Debug before publishing anything.

- [ ] **Step 3: Write the measured result into the spec**

Add a `## Measured result` section to `.brain/planning/h1-compliance-auditor.md`, directly after `## Measured corpus — and its limits`. Include: the date of the audit, the per-contract table (rate, pass/partial/fail/na, denominator, annotations), the excluded-run count, and — required — the sentence stating that every rate is `provisional` because no run in the corpus predating this work carries `plugin_version`.

Do not round a thin denominator into a headline. If `3d-1b-phase-cost` lands on `n≤3`, write `no usable rate (n=N)`, not a percentage.

- [ ] **Step 4: Answer the H4 gate in the parent note**

In `.brain/planning/h-instruction-fidelity.md`, under `### H4 — Deterministic control flow`, replace the "Gated on H1's numbers" paragraph with the actual reading: the measured rate, and which of the three outcomes it selects —

- **≥95%** → H2 + H3 + H6 suffice; H4 is not worth the rewrite. Say so and mark H4 `rejected` in the roadmap with the number as the reason.
- **≤80%** → H4 is the only real fix. Mark it `planned` and note that it needs its own spec.
- **in between, or `provisional` with `n=12`** → not a decision. Say that explicitly, and state the condition that would settle it: re-run the audit once N runs carry `plugin_version`. Pick N and write it down.

- [ ] **Step 5: Update the roadmap**

In `.brain/planning/roadmap.md`, change the H1 row's status from `specced` to `done`, and update the "Highest-ROI next step" paragraph so it reflects what H1 measured rather than what it was expected to measure.

- [ ] **Step 6: Validate the vault**

Run: `node tools/brain-sync/cli.mjs check --vault .brain`
Expected: `check: clean`.

- [ ] **Step 7: Commit**

```bash
git add .brain/planning/h1-compliance-auditor.md \
        .brain/planning/h-instruction-fidelity.md \
        .brain/planning/roadmap.md
git commit -m "docs(brain): publish H1's measured compliance rates and settle the H4 gate"
```

---

## Verification

After Task 7, all of the following must hold:

```bash
cd tools/sdlc-lint && node --test          # every suite green, including 5 new files
cd - && node tools/sdlc-lint/cli.mjs all   # exit 0, output unchanged from before this work
node tools/brain-sync/cli.mjs check --vault .brain   # check: clean
```

And, mapping back to the spec's Definition of Done:

1. Six contracts in `SKILL.md`, parsed with zero errors — Task 3.
2. `plugin_version` written by `enrich` — Task 6.
3. `compliance --runs "$HOME/parlor-android/docs/plans/*"` produces the three-part report — Task 5, run in Task 7.
4. The incident run reports `fail` on `5b-0-enrich` — Task 7 Step 2, a hard stop if it does not.
5. A published per-step rate with denominators and the `provisional` caveat — Task 7 Steps 3–5.
6. `node --test` green — every task's final step.

## Out of scope — do not add these

Listed because each is a plausible-looking improvement that the spec deliberately rejects:

- **Failing CI on a low rate.** `compliance` is not in `runAll()` and returns 0 on findings. It is an instrument; gating needs a rate we do not have yet.
- **`text_match` on assistant output.** It would catch the unprinted `WARN: cost enrichment incomplete`, but measures wording rather than action.
- **Calling `compliance` from the orchestrator during a run.** That is H6's territory, and implementing it as prose telling the orchestrator to audit itself would be self-refuting.
- **Shipping the auditor in the plugin payload.** It stays in `tools/sdlc-lint/`.
- **Fixing `SKILL.md` Step 3d-1b's cwd-encoded session resolution.** A real defect — it contradicts Step 5b(a), which forbids exactly that — but it is filed as a follow-up in the spec and belongs in its own change with its own note.
