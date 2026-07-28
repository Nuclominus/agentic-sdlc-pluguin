# H3 — The Machine-Value Invariant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** State the rule that the orchestrator never computes a value a machine already holds, remove the six places it still does, and add a `sdlc-lint` check that fails on new ones.

**Architecture:** A contract document shipped inside the plugin (`plugins/sdlc/MACHINE-VALUES.md`) carries both the written audit and a machine-readable registry of `key: owner` lines. A new `sdlc-lint machine-values` verb parses that registry and fails any shipped prose that puts a registry key on the left of a computation. `SKILL.md` then drops the six formulas the check finds, and the verb joins `all`, which CI already runs.

**Tech Stack:** Node 22 ESM, `node:test` + `node:assert/strict`, `tinyglobby`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-28-h3-machine-value-invariant-design.md` — read it before Task 1.

## Global Constraints

- **Source-tree only.** `lib/machine-values.mjs` never runs at pipeline runtime, so — like `lib/read-discipline.mjs` and `lib/plugin-paths.mjs`, unlike `lib/usage.mjs` — it gets **no** mirrored copy under `plugins/sdlc/tools/`. Say so in the file's header comment.
- **Exit codes, uniform across every verb:** `0` clean, `1` violations, `2` tool error (unreadable file, missing contract).
- **Escape hatch:** `<!-- machine-values: ok — reason -->` on the offending line or the line directly above it. A bare marker is not a justification — a stated reason after `ok` is required, using an **em-dash** (`—`), matching the two existing lints exactly.
- **Registry keys are `[A-Za-z0-9_]+`.** The parser rejects anything else. This is what makes it safe to interpolate registry keys straight into a `RegExp` — no escaping, no injection from a document.
- **Commit style:** Conventional Commits. Every commit ends with the two trailers:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
  ```
- **Staging:** `git add` explicit paths only. Never `git add -A` — the user edits files concurrently.
- **Test command:** `node --test tools/sdlc-lint/test/*.test.mjs` from the repo root. The trailing-slash directory form does not auto-discover on Node 22.
- **Branch:** `feat/h3-machine-value-invariant`, already created from `track-h`.

## File Structure

| File | Responsibility |
|---|---|
| `plugins/sdlc/MACHINE-VALUES.md` (create) | The invariant, the `machine-values` registry block, the audit table, the lint's stated limits. Ships with the plugin. |
| `tools/sdlc-lint/lib/machine-values.mjs` (create) | `parseRegistry`, `violationRe`, `scanText`, `checkContractReference`, `checkMachineValues`. |
| `tools/sdlc-lint/fixtures/machine-values/*.md` (create) | Registry and scanner fixtures. |
| `tools/sdlc-lint/test/machine-values.test.mjs` (create) | Unit + integration tests for the above. |
| `tools/sdlc-lint/cli.mjs` (modify) | `printMachineValues`, the `machine-values` case, the `all` entry, the usage lines. |
| `tools/sdlc-lint/test/all.test.mjs` (modify) | New `all` case; re-anchor the existing Step 5 prose test. |
| `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (modify) | Remove six formulas from 3d-1 and Step 5; placeholder the machine keys in the telemetry example; reference the contract. |
| `.brain/decisions/ADR-0015-*.md` (create), `.brain/planning/*.md` (modify) | The decision record and the track/roadmap updates. |

---

### Task 1: The contract document and its parser

**Files:**
- Create: `plugins/sdlc/MACHINE-VALUES.md`
- Create: `tools/sdlc-lint/lib/machine-values.mjs`
- Create: `tools/sdlc-lint/fixtures/machine-values/registry-no-block.md`
- Create: `tools/sdlc-lint/fixtures/machine-values/registry-empty.md`
- Create: `tools/sdlc-lint/fixtures/machine-values/registry-malformed.md`
- Test: `tools/sdlc-lint/test/machine-values.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CONTRACT_PATH: string` = `"plugins/sdlc/MACHINE-VALUES.md"`
  - `parseRegistry(text: string) => { keys: string[], owners: Map<string,string>, errors: string[] }` — `keys` sorted longest-first, then alphabetically.

- [ ] **Step 1: Write the failing test**

Create `tools/sdlc-lint/test/machine-values.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseRegistry, CONTRACT_PATH } from "../lib/machine-values.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "machine-values");
const REPO = resolve(HERE, "..", "..", "..");
const fixture = (name) => readFileSync(join(FIX, name), "utf8");
const contract = () => readFileSync(resolve(REPO, CONTRACT_PATH), "utf8");

test("the shipped contract's registry parses cleanly and is non-empty", () => {
  const { keys, owners, errors } = parseRegistry(contract());
  assert.deepEqual(errors, []);
  assert.ok(keys.length >= 15, `expected the full machine-owned set, got ${keys.length}`);
  for (const k of keys) assert.ok(owners.get(k), `key '${k}' names no owner`);
});

test("the registry holds the keys finish actually writes", () => {
  const { owners } = parseRegistry(contract());
  for (const k of ["cost_usd", "input_tokens", "total_cost_usd", "cache_hit_ratio",
                   "started_at", "wall_clock_seconds", "orchestration_overhead"]) {
    assert.ok(owners.has(k), `machine-owned key '${k}' missing from the registry`);
  }
});

test("model-owned values stay OUT of the registry", () => {
  const { owners } = parseRegistry(contract());
  // total_subagent_tokens is the one sum finish never recomputes (usage.mjs sums only
  // usage_source: "transcript" phases), so the model remains its only writer. agent_id and
  // qa_iterations_used exist solely in the model's context. Registering any of these would
  // make the lint demand their removal and delete the value outright.
  for (const k of ["agent_id", "subagent_tokens", "total_subagent_tokens",
                   "qa_iterations_used", "compact_summary_chars"]) {
    assert.equal(owners.has(k), false, `model-owned key '${k}' must not be in the registry`);
  }
});

test("keys sort longest-first so an error names the most specific match", () => {
  const { keys } = parseRegistry(contract());
  const i = keys.indexOf("total_input_tokens");
  const j = keys.indexOf("input_tokens");
  assert.ok(i > -1 && j > -1);
  assert.ok(i < j, "total_input_tokens must precede input_tokens");
});

test("a document with no registry block is an error, not an empty pass", () => {
  const { keys, errors } = parseRegistry(fixture("registry-no-block.md"));
  assert.deepEqual(keys, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /missing ```machine-values registry block/);
});

test("an empty registry block is an error — a lint with no keys checks nothing", () => {
  const { errors } = parseRegistry(fixture("registry-empty.md"));
  assert.equal(errors.length, 1);
  assert.match(errors[0], /empty/);
});

test("a malformed entry is reported by line, and good entries around it still parse", () => {
  const { keys, errors } = parseRegistry(fixture("registry-malformed.md"));
  assert.equal(errors.length, 3);
  assert.match(errors[0], /^registry line 2: expected '<key>: <owner>'/);
  assert.match(errors[1], /^registry line 3: expected '<key>: <owner>'/);   // owner missing
  assert.match(errors[2], /^registry line 5: duplicate key 'cost_usd'/);
  assert.deepEqual(keys, ["cost_usd"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/sdlc-lint/test/machine-values.test.mjs`
Expected: FAIL — `Cannot find module '../lib/machine-values.mjs'`.

- [ ] **Step 3: Create the three registry fixtures**

`tools/sdlc-lint/fixtures/machine-values/registry-no-block.md`:

```markdown
# No registry here

This document talks about machine values but never declares one.
```

`tools/sdlc-lint/fixtures/machine-values/registry-empty.md`:

````markdown
# Empty registry

```machine-values

```
````

`tools/sdlc-lint/fixtures/machine-values/registry-malformed.md`:

````markdown
# Malformed registry

```machine-values
cost_usd: tools/run/cli.mjs finish
this line has no colon
no_owner:
total_cost_usd: tools/run/cli.mjs finish
cost_usd: tools/run/cli.mjs finish
```
````

> The malformed fixture's registry body starts at line 1 (`cost_usd: …`), so the bad lines are
> registry lines 2, 3 and 5. `no_owner:` fails the entry pattern because the owner is empty —
> a key with no named writer is an unsupported claim, not a valid entry.

- [ ] **Step 4: Write `lib/machine-values.mjs` — the parser only**

```javascript
// Dev/CI lint for Track H3 (the machine-value invariant): shipped prose must never
// ask the model to compute a value a machine already writes. Checks the SOURCE TREE
// only — it never runs at pipeline runtime, so (like lib/read-discipline.mjs and
// lib/plugin-paths.mjs, unlike lib/usage.mjs) it has no mirrored copy under
// plugins/sdlc/tools/. The rule itself lives in plugins/sdlc/MACHINE-VALUES.md,
// which is also the registry this reads.

export const CONTRACT_PATH = "plugins/sdlc/MACHINE-VALUES.md";

// A fenced block whose info string is exactly `machine-values` — the same shape as the
// ```sdlc-contract blocks lib/contracts.mjs already pulls out of this same prose.
const BLOCK = /^```machine-values[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/m;

// `<key>: <owner>`. The key charset is deliberately narrow: it is interpolated straight
// into a RegExp by violationRe(), and `[A-Za-z0-9_]+` cannot carry a metacharacter.
const ENTRY = /^([A-Za-z0-9_]+)\s*:\s*(\S.*)$/;

/**
 * Parse the machine-owned key registry out of the contract document.
 * @param {string} text
 * @returns {{ keys: string[], owners: Map<string,string>, errors: string[] }}
 */
export function parseRegistry(text) {
  const m = BLOCK.exec(text);
  if (!m) {
    return { keys: [], owners: new Map(), errors: ["missing ```machine-values registry block"] };
  }
  const errors = [];
  const owners = new Map();
  const body = m[1].split("\n");
  for (let i = 0; i < body.length; i++) {
    const line = body[i].trim();
    if (!line || line.startsWith("#")) continue;
    const e = ENTRY.exec(line);
    if (!e) {
      errors.push(`registry line ${i + 1}: expected '<key>: <owner>', got ${JSON.stringify(line)}`);
      continue;
    }
    const [, key, owner] = e;
    if (owners.has(key)) {
      errors.push(`registry line ${i + 1}: duplicate key '${key}'`);
      continue;
    }
    owners.set(key, owner.trim());
  }
  if (owners.size === 0 && errors.length === 0) {
    errors.push("registry block is empty — a lint with no keys checks nothing");
  }
  // Longest-first: alternation is ordered, so this makes an error name `total_input_tokens`
  // rather than a shorter key that happens to be a suffix of it.
  const keys = [...owners.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return { keys, owners, errors };
}
```

- [ ] **Step 5: Write `plugins/sdlc/MACHINE-VALUES.md`**

````markdown
# Machine values — the invariant

> The rule Track H3 makes enforceable. Shipped with the plugin, like `PLUGIN-PATHS.md`, so the
> contract travels with the text it governs. Enforced by `sdlc-lint machine-values`, which parses
> the registry below — this document *is* the check's input, so it cannot drift from it.

## The invariant

**The model never transcribes or computes a value a machine already holds. Where the value exists
on disk, the contract passes the path — never the number.**

Three of the four defects in the incident that opened Track H were instances of this one rule being
absent (`ADR-0012`). H2 fixed the worst of them by making `run/cli.mjs finish` the sole writer of
the run clock (`ADR-0014`); this document generalises that fix and gives it teeth.

Why a lint rather than firmer wording: the two definitions of `cache_hit_ratio` had **already**
diverged before anyone noticed —

```
SKILL.md (prose, removed by H3)   cached / max(input, 1)
tools/usage/usage.mjs:628          cached / (input + cached)
```

Same key, different denominators, no symptom — because the tool overwrites whatever the model
computed. A drift that survives human review for as long as both spellings have existed is not
fixed by asking more emphatically.

## Registry — machine-owned keys

Each entry is `<key>: <owner command>`. A key listed here must never appear as the subject of a
computation in shipped prose.

```machine-values
cost_usd: tools/usage/cli.mjs phase-cost, then tools/run/cli.mjs finish
input_tokens: tools/run/cli.mjs finish
output_tokens: tools/run/cli.mjs finish
cached_input_tokens: tools/run/cli.mjs finish
cache_creation_tokens: tools/run/cli.mjs finish
billed_tokens: tools/run/cli.mjs finish
turns: tools/run/cli.mjs finish
peak_prefix_tokens: tools/run/cli.mjs finish
cache_pressure: tools/run/cli.mjs finish
total_input_tokens: tools/run/cli.mjs finish
total_output_tokens: tools/run/cli.mjs finish
total_cached_input_tokens: tools/run/cli.mjs finish
total_cache_creation_tokens: tools/run/cli.mjs finish
total_cost_usd: tools/run/cli.mjs finish
cache_hit_ratio: tools/run/cli.mjs finish
orchestration_overhead: tools/run/cli.mjs finish
cost_basis: tools/run/cli.mjs finish
plugin_version: tools/run/cli.mjs finish
started_at: tools/run/cli.mjs finish
completed_at: tools/run/cli.mjs finish
wall_clock_seconds: tools/run/cli.mjs finish
```

## Audit — what the orchestrator was asked to produce

Every machine-known value `pipeline-orchestrator/SKILL.md` asked the model to compute, and what
became of it.

| value | site | disposition |
|---|---|---|
| `cost_usd` | 3d-1 pricing formula | **removed** — `phase-cost` computes it one step later from the same registry |
| `input_tokens` / `output_tokens` / `cached_input_tokens` | 3d-1 envelope shape 1 | **removed** — this harness's envelope never exposes the split; the transcript does |
| token estimate `len / 4` | 3d-1 envelope shape 3 | **removed** — inventing a number for a value a machine holds is the invariant's purest violation |
| `total_input_tokens` / `total_output_tokens` / `total_cached_input_tokens` | Step 5 | **removed** — `usage.mjs:621–623` assigns them unconditionally |
| `total_cost_usd` | Step 5 | **removed** — `usage.mjs:626` |
| `cache_hit_ratio` | Step 5 | **removed** — `usage.mjs:628`, and the two definitions had already diverged |
| `started_at` / `completed_at` / `wall_clock_seconds` | Step 5 | **removed by H2** — `clock.mjs` is their sole writer (`ADR-0014`) |

Values that stay with the model, and why the invariant does not reach them:

| value | why |
|---|---|
| `agent_id` | exists only in the Agent result envelope; no file records it |
| `subagent_tokens`, `total_subagent_tokens` | the envelope's aggregate count. `finish` sums only `usage_source: "transcript"` phases and never writes this key — removing it would delete the value, not relocate it |
| `qa_iterations_used`, `qa_status` | parsed from the agent's compact summary, which exists only in context |
| `compact_summary_chars` | the length of a string that exists only in context |
| `model` | a registry *lookup* from the declared tier, not a value stored on disk under that key |
| `CONTEXT.running_cost_usd` | feeds a decision **inside** the run. `phase-cost` returns each phase's number; the accumulation is the gate's own state |
| `cap_status` | the gate's verdict. `finish` may override it to `exceeded-undetected`, but does not originate it |
| `touched_files` | git holds it — a genuine instance, deliberately deferred (see Limits) |

## What this check does not do

Stated so the guarantee is not oversold:

- **Left-hand anchoring only.** `foo = cost_usd + bar` is not caught. Broadening to "a machine key
  anywhere near an operator" re-admits false positives like `max_total_cost_usd=0.60` and
  `CONTEXT.running_cost_usd = 0`; the narrowness *is* the design.
- **Lexical, not semantic.** Prose that asks for the same computation without `=`, `sum of`,
  `computed from` or `derived from` evades it. The check raises the cost of adding a new
  transcription; it does not make one impossible.
- **Registry-bounded.** A machine value never added to the registry is never checked.
- **Deferred instances.** `touched_files` (git) and the cap gate's running-total accumulation are
  real instances left model-owned. Both need tool changes rather than deletions, and H3 is a
  subtraction. They are recorded here so the next person finds them already reasoned about.

## Escape hatch

A line that must state a computation carries, on itself or the line directly above:

```
<!-- machine-values: ok — reason -->
```

The reason is required. As of H3 the tree contains **zero** of these; if you are adding the first
one, the question to answer is why the value cannot come from the path instead.
````

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/machine-values.test.mjs`
Expected: PASS, 7/7.

- [ ] **Step 7: Commit**

```bash
git add plugins/sdlc/MACHINE-VALUES.md tools/sdlc-lint/lib/machine-values.mjs \
        tools/sdlc-lint/test/machine-values.test.mjs \
        tools/sdlc-lint/fixtures/machine-values
git commit -m "$(cat <<'EOF'
feat(lint): declare the machine-value invariant and parse its registry

MACHINE-VALUES.md is the contract, the written audit, and the lint's own
input at once — a document the check reads cannot drift from the check.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
)"
```

---

### Task 2: The violation scanner

**Files:**
- Modify: `tools/sdlc-lint/lib/machine-values.mjs`
- Create: `tools/sdlc-lint/fixtures/machine-values/violations.md`
- Create: `tools/sdlc-lint/fixtures/machine-values/clean.md`
- Create: `tools/sdlc-lint/fixtures/machine-values/suppressed-same-line.md`
- Create: `tools/sdlc-lint/fixtures/machine-values/suppressed-prev-line.md`
- Create: `tools/sdlc-lint/fixtures/machine-values/marker-no-reason.md`
- Test: `tools/sdlc-lint/test/machine-values.test.mjs`

**Interfaces:**
- Consumes: `parseRegistry` from Task 1.
- Produces:
  - `OK_MARKER: string` = `"<!-- machine-values: ok"`
  - `violationRe(keys: string[]) => RegExp` — capture group 1 is the matched key.
  - `scanText(text: string, keys: string[]) => { ok: boolean, errors: string[] }` — one error per line, `` `line N: "<key>" is computed here …` ``.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/machine-values.test.mjs` (and extend the import at the top to
`import { parseRegistry, scanText, violationRe, OK_MARKER, CONTRACT_PATH } from "../lib/machine-values.mjs";`):

```javascript
const KEYS = ["total_input_tokens", "total_cost_usd", "cache_hit_ratio", "cost_usd", "input_tokens"]
  .sort((a, b) => b.length - a.length || a.localeCompare(b));

test("each of the six real formula shapes is flagged exactly once", () => {
  const { ok, errors } = scanText(fixture("violations.md"), KEYS);
  assert.equal(ok, false);
  assert.equal(errors.length, 6);
  assert.match(errors[0], /^line 3: "cost_usd" is computed here/);
  assert.match(errors[1], /^line 4: "total_input_tokens" is computed here/);
  assert.match(errors[2], /^line 5: "total_cost_usd" is computed here/);
  assert.match(errors[3], /^line 6: "cache_hit_ratio" is computed here/);
  assert.match(errors[4], /^line 7: "total_cost_usd" is computed here/);
  assert.match(errors[5], /^line 8: "cost_usd" is computed here/);
});

test("a violation names the contract so the fix is discoverable", () => {
  assert.match(scanText(fixture("violations.md"), KEYS).errors[0], /MACHINE-VALUES\.md/);
});

test("the three near-misses that would make the check noise are NOT flagged", () => {
  // 1. `max_total_cost_usd=0.60` — a config example, rejected by the leading \b.
  // 2. `CONTEXT.running_cost_usd = 0` — the cap gate's own state, same \b rejection.
  // 3. descriptive prose about the same keys, of which SKILL.md has dozens.
  assert.deepEqual(scanText(fixture("clean.md"), KEYS), { ok: true, errors: [] });
});

test("a model-owned key is invisible to the check even when it IS a sum", () => {
  // total_subagent_tokens is absent from the registry, so its legitimate Step 5 sum passes.
  const line = "- `total_subagent_tokens` = sum of phase `subagent_tokens`.";
  assert.deepEqual(scanText(line, KEYS), { ok: true, errors: [] });
});

test("comparisons are not assignments", () => {
  for (const line of ["when `total_cost_usd` == 0", "if `cost_usd` != null", "`cost_usd` >= 1"]) {
    assert.deepEqual(scanText(line, KEYS), { ok: true, errors: [] }, line);
  }
});

test("marker on the matching line suppresses it", () => {
  assert.equal(scanText(fixture("suppressed-same-line.md"), KEYS).ok, true);
});

test("marker on the preceding line suppresses it", () => {
  assert.equal(scanText(fixture("suppressed-prev-line.md"), KEYS).ok, true);
});

test("a marker with no stated reason does not suppress", () => {
  const { ok, errors } = scanText(fixture("marker-no-reason.md"), KEYS);
  assert.equal(ok, false);
  assert.equal(errors.length, 2, "both the bare marker and the `-->`-only marker must still fail");
});

test("an empty key list scans nothing rather than building an empty alternation", () => {
  // new RegExp("\\b()\\b…") matches at every position — a registry failure must not
  // become a firehose of violations on every file in the tree.
  assert.deepEqual(scanText("cost_usd = 1", []), { ok: true, errors: [] });
});

test("violationRe captures the key it matched", () => {
  assert.equal(violationRe(KEYS).exec("- `total_cost_usd` = sum of")[1], "total_cost_usd");
});

test("OK_MARKER is the string the error message tells authors to write", () => {
  assert.ok(scanText(fixture("violations.md"), KEYS).errors[0].includes(OK_MARKER));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/machine-values.test.mjs`
Expected: FAIL — `scanText is not a function`.

- [ ] **Step 3: Create the scanner fixtures**

`tools/sdlc-lint/fixtures/machine-values/violations.md` — the six real shapes, transcribed from
`SKILL.md` before this change:

````markdown
# Violations

  - `cost_usd = (input_tokens - cached_input_tokens)/1e6 * P.input`
- `total_input_tokens` = sum of phase `input_tokens`.
- `total_cost_usd` = **sum of phase `cost_usd` PLUS overhead**
- `cache_hit_ratio` = `total_cached_input_tokens / max(total_input_tokens, 1)`
- `total_cost_usd` is the sum of every priced phase
- `cost_usd` computed from the registry pricing
````

`tools/sdlc-lint/fixtures/machine-values/clean.md`:

````markdown
# Clean

caps:    max_total_cost_usd=0.60
1. Maintain a running total. Initialize `CONTEXT.running_cost_usd = 0`,
⚠️ `total_cost_usd` is NOT what the cost cap gates on, and the two legitimately disagree.
Read `cost_usd` from the phase entry that `phase-cost` wrote.
The report renders `cache_hit_ratio` beside the cap verdict.
"total_cost_usd": 16.87,
````

`tools/sdlc-lint/fixtures/machine-values/suppressed-same-line.md`:

````markdown
# Suppressed on the line

- `total_cost_usd` = sum of phase costs <!-- machine-values: ok — historical formula, quoted as evidence in ADR-0015 -->
````

`tools/sdlc-lint/fixtures/machine-values/suppressed-prev-line.md`:

````markdown
# Suppressed from above

<!-- machine-values: ok — historical formula, quoted as evidence in ADR-0015 -->
- `total_cost_usd` = sum of phase costs
````

`tools/sdlc-lint/fixtures/machine-values/marker-no-reason.md`:

````markdown
# Markers that justify nothing

- `total_cost_usd` = sum of phase costs <!-- machine-values: ok -->
- `cache_hit_ratio` = cached / input <!-- machine-values: ok — -->
````

- [ ] **Step 4: Add the scanner to `lib/machine-values.mjs`**

Append below `parseRegistry`:

```javascript
export const OK_MARKER = "<!-- machine-values: ok";

// A bare marker is not a justification: require a stated reason after `ok`. The lookahead
// keeps the closing `-->` from passing as a one-character reason (its leading `-` would
// otherwise satisfy a bare `\S`). Same guard as lib/plugin-paths.mjs.
const OK_MARKER_RE = /<!--\s*machine-values:\s*ok\s*—\s*(?!-->)\S/;

/**
 * A registry key as the SUBJECT of a computation. Anchoring on the left-hand side is what
 * keeps the check silent on the dozens of lines that merely discuss these keys — and what
 * makes `max_total_cost_usd=0.60` and `CONTEXT.running_cost_usd = 0` pass, since neither
 * has a word boundary before the key. `=(?!=)` excludes `==`; `!=`, `>=` and `<=` never
 * reach it, because the character after `\s*` is not `=`.
 * @param {string[]} keys
 * @returns {RegExp} capture group 1 is the matched key
 */
export function violationRe(keys) {
  return new RegExp(
    "\\b(" + keys.join("|") + ")\\b`?\\s*(?:=(?!=)|(?:is )?(?:the )?sum of|computed from|derived from)",
  );
}

/**
 * Scan one shipped-prose file for arithmetic over a machine-owned key.
 * @param {string} text
 * @param {string[]} keys registry keys, longest-first
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function scanText(text, keys) {
  // An empty alternation matches everywhere. A broken registry must fail loudly at its own
  // entry (parseRegistry), never flood every file in the tree with phantom violations.
  if (!keys.length) return { ok: true, errors: [] };
  const re = violationRe(keys);
  const lines = text.split("\n");
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    if (OK_MARKER_RE.test(lines[i])) continue;
    if (i > 0 && OK_MARKER_RE.test(lines[i - 1])) continue;
    const m = lines[i].match(re);
    if (m) {
      errors.push(
        `line ${i + 1}: "${m[1]}" is computed here — a machine already writes it ` +
        `(see ${CONTRACT_PATH}). Pass the path, not the number, or justify with ` +
        `${OK_MARKER} — reason -->`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/machine-values.test.mjs`
Expected: PASS, 18/18.

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/lib/machine-values.mjs tools/sdlc-lint/test/machine-values.test.mjs \
        tools/sdlc-lint/fixtures/machine-values
git commit -m "$(cat <<'EOF'
feat(lint): flag arithmetic over a machine-owned key

Anchors on the left-hand side of the computation. That narrowness is the
design: it keeps the dozens of lines that merely discuss these keys quiet,
and lets max_total_cost_usd=0.60 and CONTEXT.running_cost_usd = 0 pass on
the leading word boundary alone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
)"
```

---

### Task 3: Repo-wide check and the CLI verb

**Files:**
- Modify: `tools/sdlc-lint/lib/machine-values.mjs`
- Modify: `tools/sdlc-lint/cli.mjs:1-20` (imports), `:64` (after `printPluginPaths`), `:198` (switch), `:239-242` (usage)
- Test: `tools/sdlc-lint/test/machine-values.test.mjs`

**Interfaces:**
- Consumes: `parseRegistry`, `scanText` from Tasks 1–2.
- Produces:
  - `ORCHESTRATOR_PATH`, `PLUGIN_GLOB`, `IGNORE` constants
  - `checkContractReference(text: string) => { ok: boolean, errors: string[] }`
  - `checkMachineValues(root?: string) => Array<{ file: string, ok: boolean, errors: string[], tool_error?: boolean }>`
  - CLI: `node tools/sdlc-lint/cli.mjs machine-values [--json]`

> **This task deliberately ends with the repo still dirty.** `SKILL.md` holds six real violations
> until Task 4. The integration test here asserts the lint finds *exactly those six, by line* —
> which is the proof the check works against its real target rather than only against fixtures.
> Task 4 replaces that assertion with a zero-violation one. The verb is **not** added to `all` yet;
> doing so now would turn `all.test.mjs` red.

- [ ] **Step 1: Write the failing test**

Append to `tools/sdlc-lint/test/machine-values.test.mjs`:

```javascript
import { execFileSync } from "node:child_process";
import { checkMachineValues, checkContractReference, ORCHESTRATOR_PATH } from "../lib/machine-values.mjs";

const CLI = resolve(REPO, "tools/sdlc-lint/cli.mjs");

test("SKILL.md must point at the contract, so the rule has one definition", () => {
  assert.deepEqual(checkContractReference("… see MACHINE-VALUES.md for the rule …"), { ok: true, errors: [] });
  const { ok, errors } = checkContractReference("no reference at all");
  assert.equal(ok, false);
  assert.match(errors[0], /MACHINE-VALUES\.md/);
});

// PRE-STATE TEST — Task 4 replaces this with the zero-violation assertion below it.
test("the check finds the six real formulas in the live SKILL.md", () => {
  // SKILL.md appears TWICE in the results — once for checkContractReference, once for the
  // glob scan (lib/plugin-paths.mjs has the same double entry). `find` would return the
  // contract-reference row and its empty errors; flatten both rows instead.
  const errs = checkMachineValues(REPO)
    .filter(r => r.file === ORCHESTRATOR_PATH)
    .flatMap(r => r.errors);
  assert.equal(errs.length, 6, `expected six violations, got:\n${errs.join("\n")}`);
  for (const n of [1429, 2002, 2003, 2004, 2006, 2036]) {
    assert.ok(errs.some(e => e.startsWith(`line ${n}:`)), `expected a violation on line ${n}`);
  }
});

test("no file OTHER than SKILL.md violates the invariant", () => {
  const others = checkMachineValues(REPO).filter(r => !r.ok && r.file !== ORCHESTRATOR_PATH);
  assert.deepEqual(others, [], "the check must be silent everywhere it has nothing to say");
});

test("the contract document itself is exempt — it quotes the formulas as evidence", () => {
  const results = checkMachineValues(REPO);
  const contract = results.find(r => r.file === CONTRACT_PATH);
  assert.ok(contract, "the contract must still be checked for a well-formed registry");
  assert.deepEqual(contract.errors, [], "its audit table quotes removed formulas; scanning it would be circular");
});

test("a missing contract is a tool error (exit 2), not a silent all-clear", () => {
  const results = checkMachineValues(join(FIX, "..", "vanilla-node"));
  assert.equal(results.length, 1);
  assert.equal(results[0].tool_error, true);
  assert.match(results[0].errors[0], /^read:/);
});

test("the CLI verb exits 1 while SKILL.md still holds the formulas", () => {
  let status = 0;
  try { execFileSync("node", [CLI, "machine-values", "--json"], { cwd: REPO, encoding: "utf8" }); }
  catch (e) { status = e.status; }
  assert.equal(status, 1, "violations must exit 1, distinct from a tool error's 2");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/sdlc-lint/test/machine-values.test.mjs`
Expected: FAIL — `checkMachineValues is not a function`.

- [ ] **Step 3: Add the repo walk to `lib/machine-values.mjs`**

Add to the imports at the top of the file:

```javascript
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { globSync } from "tinyglobby";
```

And append:

```javascript
export const ORCHESTRATOR_PATH = "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md";
// Text that ships to consumers and is read by an LLM as instruction: skills, agents, rules,
// commands. Excludes node_modules and per-tool test fixtures, matching lib/plugin-paths.mjs.
export const PLUGIN_GLOB = "plugins/**/*.md";
export const IGNORE = ["**/node_modules/**", "plugins/*/tools/*/test/**"];

/**
 * Check 1 — the orchestrator points at the contract, so the invariant has exactly one
 * definition and the file it governs says where to find it.
 * @param {string} text contents of pipeline-orchestrator/SKILL.md
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkContractReference(text) {
  return text.includes("MACHINE-VALUES.md")
    ? { ok: true, errors: [] }
    : { ok: false, errors: [`must reference ${CONTRACT_PATH} — the machine-value invariant`] };
}

/**
 * Checks 1–3 over a repository root.
 * @returns {Array<{file: string, ok: boolean, errors: string[], tool_error?: boolean}>}
 */
export function checkMachineValues(root = process.cwd()) {
  const results = [];

  let keys = [];
  try {
    const { keys: parsed, errors } = parseRegistry(readFileSync(resolve(root, CONTRACT_PATH), "utf8"));
    keys = parsed;
    results.push({ file: CONTRACT_PATH, ok: errors.length === 0, errors });
  } catch (e) {
    // No registry means no key list. Returning here rather than scanning with `keys = []`
    // keeps a missing contract from reading as a clean tree.
    return [{ file: CONTRACT_PATH, ok: false, tool_error: true, errors: [`read: ${e.message}`] }];
  }

  try {
    results.push({ file: ORCHESTRATOR_PATH, ...checkContractReference(readFileSync(resolve(root, ORCHESTRATOR_PATH), "utf8")) });
  } catch (e) {
    results.push({ file: ORCHESTRATOR_PATH, ok: false, tool_error: true, errors: [`read: ${e.message}`] });
  }

  for (const abs of globSync(PLUGIN_GLOB, { cwd: root, absolute: true, ignore: IGNORE }).sort()) {
    const file = relative(root, abs).split("\\").join("/");
    // The contract quotes the very formulas it retires, as the audit's evidence. Scanning it
    // would make the document that defines the rule its own first violation.
    if (file === CONTRACT_PATH) continue;
    try {
      results.push({ file, ...scanText(readFileSync(abs, "utf8"), keys) });
    } catch (e) {
      results.push({ file, ok: false, tool_error: true, errors: [`read: ${e.message}`] });
    }
  }
  return results;
}
```

- [ ] **Step 4: Wire the CLI verb**

In `tools/sdlc-lint/cli.mjs`, add to the imports beside the other lint libs (near line 11):

```javascript
import { checkMachineValues } from "./lib/machine-values.mjs";
```

Add the printer immediately after `printPluginPaths` (line 64), copying its shape exactly:

```javascript
function printMachineValues(results) {
  const failed = results.filter(r => !r.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ command: "machine-values", checked: results.length, failed: failed.length, failures: failed }));
  } else {
    for (const r of failed) console.error(`✗ ${r.file}\n    ${r.errors.join("\n    ")}`);
    console.log(`machine-values: ${results.length - failed.length}/${results.length} clean`);
  }
  return failed.some(r => r.tool_error) ? 2 : failed.length ? 1 : 0;
}
```

Add the switch case after `plugin-paths` (line 198):

```javascript
  case "machine-values": code = printMachineValues(checkMachineValues(root)); break;
```

Update the two usage lines (239–242):

```javascript
    console.log("Usage: sdlc-lint <schema|cycles|detect|resume|report|rollup|read-discipline|plugin-paths|machine-values|compliance|all> [--json]");
```

and add, after the `plugin-paths` description line:

```javascript
    console.log("  machine-values    H3: no prose computing a value a machine already writes");
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/machine-values.test.mjs`
Expected: PASS, 24/24.

Then confirm the verb reports the real defect:

Run: `node tools/sdlc-lint/cli.mjs machine-values; echo "exit=$?"`
Expected: six `✗ plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` errors naming lines 1429, 2002, 2003, 2004, 2006, 2036, and `exit=1`.

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/lib/machine-values.mjs tools/sdlc-lint/cli.mjs \
        tools/sdlc-lint/test/machine-values.test.mjs
git commit -m "$(cat <<'EOF'
feat(lint): add the machine-values verb

Reports six real violations in SKILL.md — the check proving itself against
its actual target before the target is cleaned up in the next commit. Not
yet wired into `all`, which would go red until then.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
)"
```

---

### Task 4: Remove the six formulas from `SKILL.md`

**Files:**
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` — `:1414-1431` (3d-1), `:1926-1971` (telemetry example), `:1997-2036` (Step 5 aggregates)
- Modify: `tools/sdlc-lint/test/machine-values.test.mjs` (replace the pre-state test)
- Modify: `tools/sdlc-lint/test/all.test.mjs` (re-anchor the Step 5 prose test)

**Interfaces:**
- Consumes: `checkMachineValues` from Task 3.
- Produces: a `SKILL.md` whose 3d-1 records `agent_id`, `model`, `subagent_tokens`, `compact_summary_chars`, `status`, `output_file`, `aspect`, `cost_usd: null` and `usage_source: "subagent_aggregate" | "pending"`.

> **Refinement of the spec, applied here:** the spec's 3d-1 row says `usage_source: "pending"`.
> Shape 2 (an aggregate `subagent_tokens` in the envelope) is a *real observation*, not a pending
> one, so it keeps `"subagent_aggregate"`; `"pending"` is for the case where the envelope carries no
> usage at all — which is what old shape 3 used to fill with an invented estimate. Both are new-ish
> to downstream readers, which is what Task 6 verifies.

- [ ] **Step 1: Flip the pre-state test to the post-state assertion**

In `tools/sdlc-lint/test/machine-values.test.mjs`, replace the whole
`"the check finds the six real formulas in the live SKILL.md"` test with:

```javascript
test("the live tree is clean, with zero escape-hatch markers", () => {
  const failed = checkMachineValues(REPO).filter(r => !r.ok);
  assert.deepEqual(failed, [], "every machine value must come from a path, not a formula");
});

test("the invariant holds without exemptions — no ok-marker anywhere in shipped prose", () => {
  // A check whose green run depends on suppressions is measuring the suppressions.
  const out = execFileSync("git", ["grep", "-l", OK_MARKER, "--", "plugins/"],
    { cwd: REPO, encoding: "utf8" }).trim();
  assert.equal(out, "", `unexpected machine-values exemptions in: ${out}`);
});
```

> `git grep -l` exits 1 with no output when nothing matches, so wrap it:
> ```javascript
> let out = "";
> try { out = execFileSync("git", ["grep", "-l", OK_MARKER, "--", "plugins/"], { cwd: REPO, encoding: "utf8" }).trim(); }
> catch (e) { if (e.status !== 1) throw e; }   // status 1 == no matches, which is the pass
> assert.equal(out, "");
> ```
> Use this form.

Also replace `"the CLI verb exits 1 while SKILL.md still holds the formulas"` with:

```javascript
test("the CLI verb exits 0 on the clean tree", () => {
  const out = execFileSync("node", [CLI, "machine-values", "--json"], { cwd: REPO, encoding: "utf8" });
  const report = JSON.parse(out.trim().split("\n").pop());
  assert.equal(report.failed, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/machine-values.test.mjs`
Expected: FAIL — six violations still reported in `SKILL.md`.

- [ ] **Step 3: Rewrite 3d-1 (`SKILL.md:1414-1431`)**

Replace everything from `**3d-1. Capture per-phase telemetry**` up to (but not including) the
` ```sdlc-contract ` block that opens 3d-1b, with:

````markdown
**3d-1. Capture per-phase telemetry** — record from the Agent tool result **only what nothing on
disk can give back**. Everything priceable is read from the phase's own subagent transcript by
3d-1b, one step later; this step must not anticipate it, estimate it, or compute it. See
`{SDLC_PLUGIN_ROOT}/MACHINE-VALUES.md` for the invariant and the full list of machine-owned keys.

**Always** record `agent_id` on the phase entry — the subagent id from the Agent result envelope
(e.g. `agentId: a1b2c3…`). For a multi-pass phase (e.g. dev plan + implement), record the list of
ids. This is what 3d-1b and Step 5b use to locate each phase's subagent transcript
(`{CONFIG_DIR}/projects/<encoded-cwd>/<session>/subagents/agent-<id>.jsonl`) and derive the real
input/output/cache split and cost.

> **This is REQUIRED, not best-effort.** A phase whose `agent_id` is absent from `_telemetry.json`
> loses its real cost (the whole run then reads as `$—`). Write the id verbatim into **both** the
> checkpoint (Step 3d-3) **and** the `phases[]` entry. Step 5b recovers a missing id from
> `.checkpoint/<phase>.json` as a safety net, but do not rely on the net — record it here.
>
> `agent_id` is the one number in this step that is genuinely yours: it exists only in the result
> envelope, and no file records it. That is why it is transcribed and the token counts beside it
> are not.

Then record:

- `subagent_tokens` — when the envelope carries an aggregate (`<usage>subagent_tokens: N,
  tool_uses, duration_ms</usage>`, the ordinary shape on this harness), write `N` **verbatim** and
  set `usage_source: "subagent_aggregate"`. When the envelope carries no usage at all, omit the key
  and set `usage_source: "pending"`. Never split an aggregate into `input_tokens` /
  `output_tokens` / `cached_input_tokens`, and never estimate any of them from text length: those
  three come from the transcript in 3d-1b, and a fabricated number would be indistinguishable from
  a measured one.
- `cost_usd: null` — always, here. Pricing is 3d-1b's job, from the transcript and the registry.
  A `null` reaching the cap gate is counted as `$0` and flagged `cap_gate_blind` (3d-1b point 3),
  which is the honest signal; a guessed price would silence it.
- `model` — the full model ID, resolved from the agent's declared `model:` tier against the
  registry loaded in 3d-0 (`MODELS.models[].model_id` where `tag` == the tier). The tier is the
  authoritative value because the PreToolUse hook enforces it at dispatch time; this mapping exists
  solely so telemetry records the concrete model. **Do not** read this from the Agent result
  envelope (it is not exposed there).
- `compact_summary_chars` — `len(CONTEXT.{phase}_output)`. If > 3000 chars (≈ 3K-token target),
  record `compact_handoff_violation: true` and emit a one-line warning to stderr:
  `WARN: {phase} compact summary exceeded budget ({chars} chars > 3000)`. Do not abort — the
  violation is recorded for post-run analysis.
- For aspect-aware phase fan-out, push one entry **per aspect** into `phases[]` with
  `phase: "{phase_name}"` and `aspect: "{aspect}"` set; aspect-agnostic phases omit `aspect`.
````

- [ ] **Step 4: Rewrite the Step 5 aggregates (`SKILL.md:1997-2036`)**

Replace the paragraph beginning `Compute aggregates from `phases[]`` and the bullets for
`total_input_tokens`, `total_output_tokens`, `total_cached_input_tokens`, `total_cost_usd` and
`cache_hit_ratio` with the text below. **Keep `total_subagent_tokens`' bullet exactly as it is** —
`finish` sums only `usage_source: "transcript"` phases and never writes that key, so the model
remains its only writer. Keep every judgement paragraph attached to `total_cost_usd`, reproduced
verbatim below.

````markdown
**The cost and token totals are not yours to write either.** Set these keys to `null` and let Step
5b's `finish` fill them from the subagent transcripts (ADR-0005, ADR-0015):
`total_input_tokens`, `total_output_tokens`, `total_cached_input_tokens`,
`total_cache_creation_tokens`, `total_cost_usd`, `cache_hit_ratio`, `orchestration_overhead`,
`cost_basis`. `finish` assigns each of them unconditionally, so any number you put here is
discarded — the only thing hand-summing can change is whether the run is briefly wrong before it is
overwritten. `null`, not omission and not `0`: an unknown must not be encoded as a measured zero,
and if no phase transcript resolves, `finish` leaves the run alone and your `null` is what an
honest reader sees.

- `total_subagent_tokens` = sum of phase `subagent_tokens` (the aggregate, unsplit counts from
  `usage_source: "subagent_aggregate"` phases). Omit the key when no phase reported an aggregate.
  **This one is yours**: it is the envelope's own count, `finish` sums only transcript-priced
  phases and never writes this key, so dropping it here would delete the value rather than move it.

Reading the totals `finish` writes — this is judgement, and stays yours:

  ⚠️ **`total_cost_usd` is NOT what the cost cap gates on, and the two legitimately disagree.** Step
  3d-cap compares `CONTEXT.running_cost_usd` — which accumulates phase `cost_usd` only (3d-cap point
  1) — against `caps.max_total_cost_usd`. Orchestration overhead never enters that comparison. So a
  run may report `total_cost_usd: 1.33` beside `cap_status: "within"` under a $1.00 cap, and be
  correct on both counts: $0.33 of capped dispatch spend, $1.00 of uncapped overhead. Recipe caps
  are therefore sized against **phase** spend; read them that way when tuning one, and do not
  "reconcile" the two numbers by folding overhead into the gate — that would silently re-tighten
  every existing recipe's cap.

  The overhead is not a rounding error: across real runs it has ranged from **$1.00 to $1.17
  against $0.33–$0.51 of phase spend**, i.e. larger than the work it wraps. `finish` prints the
  split for exactly that reason — a reader shown only a single total cannot tell those apart.

  What this does **not** excuse is `cap_status: "within"` beside a **phase** spend over the cap.
  That combination is always a gate failure, never a legitimate disagreement, and Step 5b's `finish`
  now rewrites it to `"exceeded-undetected"` automatically. If you are reading a run where the two
  disagree, check the difference is overhead before believing it.

  **When NOTHING carries a price — no phase and no overhead — `finish` writes `total_cost_usd` as
  `null`, not `0`.** An all-unpriced run and a genuinely free run are different facts, and `0`
  asserts the second while meaning the first. (Observed: a real headless run where both phases
  reported `subagent_aggregate` usage printed an honest `$— (unpriced)` banner while writing
  `total_cost_usd: 0` into the JSON beside it.) `cache_hit_ratio` resolves the same ambiguity the
  same way. Do not "repair" either back to a number.
````

- [ ] **Step 5: Placeholder the machine keys in the telemetry example (`SKILL.md:1926-1971`)**

In the `json` example block, replace the literal values of machine-owned keys with the placeholder
string already used for the clock keys at lines 1914–1918. In **both** phase entries:

```json
      "usage_source": "subagent_aggregate",
      "input_tokens": "<written by Step 5b's finish — do NOT hand-transcribe>",
      "output_tokens": "<written by Step 5b's finish — do NOT hand-transcribe>",
      "cached_input_tokens": "<written by Step 5b's finish — do NOT hand-transcribe>",
      "cache_creation_tokens": "<written by Step 5b's finish — do NOT hand-transcribe>",
      "billed_tokens": "<written by Step 5b's finish — do NOT hand-transcribe>",
      "cost_usd": null,
```

and in the run-level block:

```json
  "total_input_tokens": "<written by Step 5b's finish — do NOT hand-transcribe>",
  "total_output_tokens": "<written by Step 5b's finish — do NOT hand-transcribe>",
  "total_cached_input_tokens": "<written by Step 5b's finish — do NOT hand-transcribe>",
  "total_cache_creation_tokens": "<written by Step 5b's finish — do NOT hand-transcribe>",
  "total_subagent_tokens": 590655,
  "total_cost_usd": null,
  "cost_basis": "<written by Step 5b's finish — do NOT hand-transcribe>",
  "orchestration_overhead": "<written by Step 5b's finish — do NOT hand-transcribe>",
```

Leave `agent_id`, `subagent_tokens`, `total_subagent_tokens`, `qa_iterations_used`, `qa_status`,
`compact_summary_chars`, `compact_handoff_violation`, `model`, `status`, `recovery`, `cost_cap_usd`
and `cap_status` as literals — those are the model's to write.

Add one line of prose directly under the closing fence of the example:

```markdown
Keys shown as `<written by …>` are placeholders, not strings to copy: **omit** them and let
`finish` write them. The block documents the shape of the sealed file, not the shape of what you
hand-assemble.
```

- [ ] **Step 6: Re-anchor the existing Step 5 prose test in `all.test.mjs`**

The test `"total_cost_usd is null, not 0, when no phase carries a price"` anchors on
`` text.indexOf("- `total_cost_usd` =") `` and `` text.indexOf("- `cache_hit_ratio` =") `` — both
bullets are now gone. Its four assertions each defend a fact that survives; re-point the window and
keep every reasoning message. Replace the test with:

```javascript
test("total_cost_usd is null, not 0, when no phase carries a price", () => {
  const text = readFileSync(SKILL, "utf8");
  // H3 removed the `- `total_cost_usd` = …` bullet (the formula is finish's now, ADR-0015), so
  // the window is anchored on the judgement block that replaced it. The facts below are
  // unchanged — only the model's obligation to COMPUTE them went away.
  const idx = text.indexOf("**The cost and token totals are not yours to write either.**");
  assert.ok(idx > -1, "Step 5 totals block missing");
  const end = text.indexOf("### Step 5b", idx);
  assert.ok(end > idx, "Step 5b heading (the block's terminator) missing");
  const rule = text.slice(idx, end);

  assert.match(rule, /`total_cost_usd` as\s+`null`,\s+not\s+`0`/,
    "an all-unpriced run and a genuinely free run are different facts; writing 0 asserts the " +
    "second while meaning the first. Observed in a real run: the banner honestly printed " +
    "'$— (unpriced)' while the JSON beside it carried total_cost_usd: 0");
  assert.match(rule, /cache_hit_ratio/,
    "the rule should point at cache_hit_ratio, which resolves this exact ambiguity the same way — " +
    "an unknown must not be encoded as a measured zero");
  assert.match(rule, /larger than the work it wraps/,
    "total_cost_usd includes orchestration overhead — verified across 4 real runs (1.68 = 0.51 " +
    "phases + 1.17 overhead; 1.33 = 0.33 + 1.00). A total defined as the phase sum alone " +
    "understates the run by more than the phases themselves cost");
  assert.match(rule, /NOT what the cost cap gates on/,
    "3d-cap compares running_cost_usd (phase costs only) against max_total_cost_usd, so a run can " +
    "report total_cost_usd above the cap with cap_status \"within\" and both be right. Undocumented, " +
    "that reads as a bug and invites someone to fold overhead into the gate — silently " +
    "re-tightening every existing recipe cap");
});
```

- [ ] **Step 7: Run the full suite to verify it passes**

Run: `node --test tools/sdlc-lint/test/*.test.mjs`
Expected: PASS, all files.

Then confirm the tree is clean and the count dropped:

Run: `node tools/sdlc-lint/cli.mjs machine-values; echo "exit=$?"`
Expected: `machine-values: N/N clean`, `exit=0`.

Run: `wc -l plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`
Expected: fewer than 2436 lines. Record the number — the ADR cites it.

- [ ] **Step 8: Commit**

```bash
git add plugins/sdlc/skills/pipeline-orchestrator/SKILL.md \
        tools/sdlc-lint/test/machine-values.test.mjs tools/sdlc-lint/test/all.test.mjs
git commit -m "$(cat <<'EOF'
refactor(sdlc): stop the orchestrator computing what finish already writes

Removes six formulas from SKILL.md — the 3d-1 pricing arithmetic, the two
dead envelope shapes (a split triple this harness never emits, and a
len/4 estimate that invents a machine value), and the Step 5 aggregates.
usage.mjs assigns every one of them unconditionally, so hand-summing could
only ever make the run briefly wrong before being overwritten.

total_subagent_tokens stays: finish sums only transcript-priced phases and
never writes that key, so removing it would delete the value.

The judgement prose beside the formulas is kept verbatim — why the cap and
the total disagree, why an unknown is null and not 0. Track H cannot make
those deterministic and must not thin them out while removing arithmetic.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
)"
```

---

### Task 5: Wire the verb into `all`

**Files:**
- Modify: `tools/sdlc-lint/cli.mjs:179-191` (`runAll`)
- Modify: `tools/sdlc-lint/test/all.test.mjs`

**Interfaces:**
- Consumes: `checkMachineValues`, `printMachineValues` from Task 3.
- Produces: `sdlc-lint all --json` emits a `{"command":"machine-values",…}` line. CI needs no change — `.github/workflows/ci.yml:18` already runs `all --json`.

- [ ] **Step 1: Write the failing test**

Append to `tools/sdlc-lint/test/all.test.mjs`, beside the identical `plugin-paths` case:

```javascript
test("`all` runs machine-values and stays green", () => {
  const out = execFileSync("node", [CLI, "all", "--json"], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /"command":"machine-values"/);
  assert.match(out, /"command":"all","ok":true/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/sdlc-lint/test/all.test.mjs`
Expected: FAIL — no `"command":"machine-values"` in the output.

- [ ] **Step 3: Add it to `runAll`**

In `tools/sdlc-lint/cli.mjs`, insert into the `codes` array immediately after `printPluginPaths`:

```javascript
    printMachineValues(checkMachineValues(root)),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/*.test.mjs`
Expected: PASS.

Run: `node tools/sdlc-lint/cli.mjs all --json | tail -1`
Expected: `{"command":"all","ok":true,"exit":0}`.

- [ ] **Step 5: Commit**

```bash
git add tools/sdlc-lint/cli.mjs tools/sdlc-lint/test/all.test.mjs
git commit -m "$(cat <<'EOF'
feat(lint): run machine-values inside `all`

CI already invokes `sdlc-lint all --json`, so this is the whole wiring.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
)"
```

---

### Task 6: Verify the downstream readers

**Files:**
- Read: `tools/sdlc-lint/lib/report.mjs`, `tools/sdlc-lint/lib/rollup.mjs`, `tools/sdlc-lint/lib/aar-metrics.mjs`, `plugins/sdlc/tools/report/`, `plugins/sdlc/tools/rollup/`
- Modify: whichever of those cannot read the new pre-enrich shape
- Test: the existing suites for each

**Interfaces:**
- Consumes: the telemetry shape Task 4 produces — `usage_source: "pending"`, `cost_usd: null`, and `null` run-level totals on an unenriched run.
- Produces: no API change. Either a confirmation that readers already tolerate it, or minimal guards.

- [ ] **Step 1: Find every reader of the affected keys**

Run:

```bash
grep -rn "usage_source\|total_input_tokens\|total_cost_usd\|cache_hit_ratio\|cost_basis" \
  tools/sdlc-lint/lib plugins/sdlc/tools --include='*.mjs' | grep -v node_modules
```

For each hit, answer one question: **does it assume a number?** The failure shapes to look for are
arithmetic on a possibly-`null` (`a + b` silently yields a string or `NaN`), `.toFixed()` on `null`
(throws), and a `switch`/lookup on `usage_source` with no default branch (renders `undefined`).

- [ ] **Step 2: Write a failing test for each unguarded reader**

For every reader that assumes a number, add a case to that module's existing test file using a
telemetry fixture in the new shape. Example, for the report renderer:

```javascript
test("renders an unenriched run whose totals are null", () => {
  const tel = {
    task_slug: "unenriched", stack: "vanilla",
    phases: [{ phase: "development", agent: "developer", model: "claude-sonnet-5",
               status: "completed", agent_id: "a1", usage_source: "pending", cost_usd: null }],
    total_input_tokens: null, total_output_tokens: null, total_cached_input_tokens: null,
    total_cost_usd: null, cache_hit_ratio: null,
  };
  const html = renderReport(tel);          // use this module's actual entry point
  assert.doesNotMatch(html, /NaN|undefined|\$null/);
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test tools/sdlc-lint/test/*.test.mjs`
Expected: FAIL on each unguarded reader, with `NaN`, `undefined` or a `toFixed` TypeError.

- [ ] **Step 4: Guard each reader at its read site**

Apply the narrowest fix that makes the value's absence legible rather than wrong. The house style
for an unknown is a dash, never a zero:

```javascript
const fmtUsd = (v) => (v == null ? "$—" : `$${v.toFixed(2)}`);
const fmtNum = (v) => (v == null ? "—" : v.toLocaleString("en-US"));
```

Do **not** substitute `0` or `?? 0` anywhere. "An unknown must not be encoded as a measured zero"
is the doctrine this whole track defends, and a reader that quietly zeroes a `null` re-creates the
exact defect ADR-0012 records.

If a reader turns out to need the *old* enum members specifically, the fallback named in the spec
applies: leave `usage_source` unset in 3d-1 until 3d-1b writes it, rather than reintroducing the
estimate. Amend Task 4's 3d-1 text and note the change in the ADR.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/*.test.mjs` and `node tools/sdlc-lint/cli.mjs all --json | tail -1`
Expected: all PASS; `{"command":"all","ok":true,"exit":0}`.

- [ ] **Step 6: Commit**

```bash
# stage only the files actually changed
git add tools/sdlc-lint/lib tools/sdlc-lint/test plugins/sdlc/tools
git commit -m "$(cat <<'EOF'
fix(tools): read an unenriched run without inventing zeros

3d-1 now leaves cost and token keys null until finish fills them, so the
readers meet null totals and usage_source "pending" on a run that stopped
before sealing. Each renders a dash — never 0, which would assert a
measurement that was never taken.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
)"
```

> If Step 1 finds every reader already tolerant, skip Steps 2–6 and record that finding in Task 7's
> ADR: "verified, no guards needed" is a result worth writing down.

---

### Task 7: The vault

**Files:**
- Create: `.brain/decisions/ADR-0015-the-machine-value-invariant.md`
- Modify: `.brain/planning/h-instruction-fidelity.md:113-121` (H3), `:141-148` (the H4 gate)
- Modify: `.brain/planning/roadmap.md:29` (the H3 row)

**Interfaces:**
- Consumes: the measured numbers from Task 4 Step 7 and the Task 6 finding.
- Produces: nothing code-facing.

> **Do not** write a change note under `.brain/changes/`. Those are machine-generated by
> `tools/brain-sync` when the PR merges; enrich the generated stub afterwards, never before.
> Frontmatter and `_moc-changes.md` are machine-owned.

- [ ] **Step 1: Write ADR-0015**

Follow `.brain/_templates/adr.md` (`adr`, `status`, `date`, then context / decision / consequences).
Content it must carry:

- **Context** — three of the four Track H incident defects were the same rule missing. H2 fixed the
  worst instance (`ADR-0014`) without stating the rule. The `cache_hit_ratio` divergence
  (`SKILL.md` said `cached / max(input,1)`, `usage.mjs:628` says `cached / (input + cached)`) is
  the evidence that prose and tool drift silently when the tool overwrites the prose's answer.
- **Decision** — the invariant, stated. `MACHINE-VALUES.md` as contract + audit + lint input in one
  document. `sdlc-lint machine-values` anchoring on the left-hand side of a computation.
- **Consequences** — six formulas removed; `SKILL.md` at the line count measured in Task 4 Step 7;
  the check green with zero exemptions; `total_subagent_tokens` deliberately left model-owned and
  why; `touched_files` and the cap-gate accumulation deferred and why; the three stated limits.
- Reference the implementing PR as plain text (`#N`), **never** a `[[changes/…]]` wikilink.
- Link `[[decisions/ADR-0014-the-run-tail-is-one-command]]`,
  `[[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]]`,
  `[[decisions/ADR-0005-transcript-derived-cost]]`,
  `[[decisions/ADR-0008-read-discipline-contract]]` (the same medium/message failure, and the lint
  this one is modelled on) and `[[planning/h-instruction-fidelity]]`.
- **Numbering:** `ADR-0013` does not exist in `.brain/decisions/` and is referenced nowhere in the
  vault. Do not backfill it or reuse the number — ADRs are chronological, so the one written after
  `ADR-0014` is `ADR-0015` and the gap stands as the historical artifact it is.

- [ ] **Step 2: Mark H3 shipped in the track note**

In `.brain/planning/h-instruction-fidelity.md`, change the `### H3 — The machine-value invariant`
heading to carry `✅`, keep the original item text, and append a **Shipped** paragraph plus a
measured table in the same shape H2 uses (lines 85–111): formulas removed, `SKILL.md` line count
before/after, exemptions in the tree, and a link to `[[decisions/ADR-0015-the-machine-value-invariant]]`.

Update the dependency diagram at lines 170–177 so H3 carries `✅` beside H2.

- [ ] **Step 3: Update the H4 gate paragraph**

Lines 141–148 say H4 is gated on "H2 and H3 landed plus enough runs on the new tail". With H3
landed, rewrite that to state precisely what remains: **only** the re-measurement — ~10 runs
carrying `plugin_version` on the new tail, then `sdlc-lint compliance` again. Keep the gate closed.
Note explicitly that H3 adds **no** new mandated step and therefore produces no new compliance rate
of its own; its effect is a smaller surface under the rates H1 already tracks.

- [ ] **Step 4: Update the roadmap row**

In `.brain/planning/roadmap.md:29`, change the H3 row from `planned` to the shipped state, matching
how the H2 row (line 28) is written, and cite the PR number.

- [ ] **Step 5: Verify the vault**

Run: `node tools/brain-sync/cli.mjs check --vault .brain`
Expected: clean — no broken wikilinks, no structural errors.

- [ ] **Step 6: Commit**

```bash
git add .brain/decisions/ADR-0015-the-machine-value-invariant.md \
        .brain/planning/h-instruction-fidelity.md .brain/planning/roadmap.md
git commit -m "$(cat <<'EOF'
docs(brain): record ADR-0015 and mark H3 landed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
)"
```

---

## Final verification

Before opening the PR, all four must hold:

```bash
node --test tools/sdlc-lint/test/*.test.mjs        # every suite green
node tools/sdlc-lint/cli.mjs all --json | tail -1  # {"command":"all","ok":true,"exit":0}
node tools/brain-sync/cli.mjs check --vault .brain # clean
git grep -c "machine-values: ok" -- plugins/       # no output — zero exemptions
```

The PR targets `track-h`, not `develop`.
