# E2 — Read Discipline Contract + Lint Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the ~73% "growth" half of per-run prompt-cache cost by putting one read-discipline contract in the orchestrator's cache-stable prefix, resolving the contradictory re-read instructions in four agent contracts, and adding a deterministic `sdlc-lint read-discipline` rule so neither can rot.

**Architecture:** Three artifacts. (1) A paragraph in `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` inside `=== STABLE PREFIX ===`, so it reaches every dispatched agent of every stack at zero per-agent cost. (2) Reworded read semantics in four `plugins/sdlc/agents/*.md` files. (3) A dev-only lint module `tools/sdlc-lint/lib/read-discipline.mjs` with three checks — anchor placement, anti-pattern scan with an escape hatch, and a pinned cache-pressure budget — wired into `runAll()`.

**Tech Stack:** Node 22 ESM, `node:test` + `node:assert/strict`, `tinyglobby` (already a dependency, see `tools/sdlc-lint/lib/load.mjs`), no new packages.

**Spec:** `docs/superpowers/specs/2026-07-25-e2-read-discipline-design.md`

## Global Constraints

- **Spec is authoritative.** Any deviation must be raised, not silently taken.
- **No new dependencies.** `tinyglobby`, `yaml`, and Node builtins only.
- **`read-discipline.mjs` is dev-tooling only.** Do NOT create a mirrored copy under `plugins/sdlc/tools/`. It checks the source tree, like `schema.mjs` / `cycles.mjs` / `detect.mjs`, and never runs at pipeline runtime. (The SSOT re-export pattern in `lib/usage.mjs`, `lib/report.mjs`, `lib/rollup.mjs` exists only because those also ship inside the plugin payload.)
- **Exit-code convention:** `0` clean, `1` violations, `2` tool error (unreadable/missing file). `runAll()` takes `Math.max` of all verb codes.
- **Do NOT modify** `plugins/sdlc/tools/usage/usage.mjs`, `plugins/sdlc/tools/aar/metrics.mjs`, or `plugins/sdlc/tools/report/report.mjs` measurement logic. E5 already produces the numbers; E2 only reads them.
- **Do NOT modify** `plugins/android-foundation/agents/*.md` — verified clean against the lint patterns.
- **Test runner:** `node --test tools/sdlc-lint/test/*.test.mjs` — the trailing-slash directory form does NOT auto-discover on Node 22.
- **Staging:** stage explicit paths only. Never `git add -A` (the working tree carries unrelated `.brain/.obsidian/*` and `.claude/settings.json` changes).
- **Branch:** `feat/e2-read-discipline` (already created; the spec commit `f4063a8` is its first commit).
- **Anchor token, verbatim:** `Read discipline:`
- **Escape-hatch marker, verbatim:** `<!-- read-discipline: ok — <reason> -->` (em dash U+2014).
- **Cache-pressure budget:** `CACHE_PRESSURE_PEAK_TOKENS = 80_000`, defined at `plugins/sdlc/tools/usage/usage.mjs:57`, already re-exported by `tools/sdlc-lint/lib/usage.mjs`.

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `tools/sdlc-lint/lib/read-discipline.mjs` | create | All three checks. Pure functions over text + a `checkReadDiscipline(root)` driver. No I/O in the checking functions themselves, so they are trivially testable. |
| `tools/sdlc-lint/cli.mjs` | modify | `printReadDiscipline()` reporter, `read-discipline` verb, inclusion in `runAll()`, `--help` line. |
| `tools/sdlc-lint/fixtures/read-discipline/` | create | Seven fixture files exercising anchor placement and scan behavior. |
| `tools/sdlc-lint/test/read-discipline.test.mjs` | create | Unit tests over the fixtures + a "real tree is clean" assertion. |
| `tools/sdlc-lint/test/usage.test.mjs` | modify | Budget pin + boundary assertions. |
| `tools/sdlc-lint/test/all.test.mjs` | modify | Assert `read-discipline` participates in `runAll()`. |
| `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` | modify | The contract paragraph + DRIFT GUARD comment. |
| `plugins/sdlc/agents/{developer,qa-engineer,security-analyst,document-writer}.md` | modify | Reworded read semantics (5 lines total). |
| `plugins/sdlc/.claude-plugin/plugin.json` | modify | Version `1.9.1` → `1.10.0`. |
| `.brain/decisions/ADR-0008-read-discipline-contract.md` | create | The decision record. |
| `.brain/planning/{roadmap,backlog}.md`, `.brain/components/sdlc.md`, `.brain/decisions/_moc-decisions.md` | modify | Vault currency. |

**Task order rationale:** the lint module is built first against its own fixtures (fully red→green in isolation), then pointed at the real tree, which is then made clean, and only then wired into `runAll()`. This keeps `node tools/sdlc-lint/cli.mjs all` green at every commit.

---

### Task 1: Anchor check — the contract cannot be deleted or displaced

Check 1 of 3. The token `Read discipline:` must appear in `SKILL.md` **between** the `=== STABLE PREFIX ===` and `=== PER-CALL CONTEXT ===` lines. Present-but-outside is a failure: in the per-call trailer it would break cache stability, which is the entire point of the change.

**Files:**
- Create: `tools/sdlc-lint/lib/read-discipline.mjs`
- Create: `tools/sdlc-lint/fixtures/read-discipline/skill-ok.md`
- Create: `tools/sdlc-lint/fixtures/read-discipline/skill-missing.md`
- Create: `tools/sdlc-lint/fixtures/read-discipline/skill-displaced.md`
- Create: `tools/sdlc-lint/fixtures/read-discipline/skill-prose-mention.md`
- Create: `tools/sdlc-lint/test/read-discipline.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export const ANCHOR = "Read discipline:"`
  - `export const PREFIX_START = "=== STABLE PREFIX ==="`
  - `export const PREFIX_END = "=== PER-CALL CONTEXT ==="`
  - `export function checkAnchor(text: string): { ok: boolean, errors: string[] }`

- [ ] **Step 1: Write the fixtures**

`tools/sdlc-lint/fixtures/read-discipline/skill-ok.md`:

```markdown
# fixture: anchor correctly inside the stable prefix

=== STABLE PREFIX ===

Compact handoff contract: return ONLY a COMPACT summary.

Read discipline: your entire prompt prefix is re-read and billed on every turn.

=== PER-CALL CONTEXT ===

task_slug: {task_slug}
```

`tools/sdlc-lint/fixtures/read-discipline/skill-missing.md`:

```markdown
# fixture: anchor absent entirely

=== STABLE PREFIX ===

Compact handoff contract: return ONLY a COMPACT summary.

=== PER-CALL CONTEXT ===

task_slug: {task_slug}
```

`tools/sdlc-lint/fixtures/read-discipline/skill-displaced.md`:

```markdown
# fixture: anchor present but in the per-call trailer

=== STABLE PREFIX ===

Compact handoff contract: return ONLY a COMPACT summary.

=== PER-CALL CONTEXT ===

task_slug: {task_slug}
Read discipline: your entire prompt prefix is re-read and billed on every turn.
```

`tools/sdlc-lint/fixtures/read-discipline/skill-prose-mention.md` — reproduces the real `SKILL.md`, which explains the template in prose (quoting the delimiter) three lines above the template itself:

```markdown
# fixture: prose mentions the delimiter before the template block

The prompt MUST be assembled in this exact order so the stable prefix (everything
down to `=== PER-CALL CONTEXT ===`) is identical across runs.

=== STABLE PREFIX ===

Compact handoff contract: return ONLY a COMPACT summary.

Read discipline: your entire prompt prefix is re-read and billed on every turn.

=== PER-CALL CONTEXT ===

task_slug: {task_slug}
```

- [ ] **Step 2: Write the failing test**

`tools/sdlc-lint/test/read-discipline.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { checkAnchor } from "../lib/read-discipline.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "read-discipline");
const fixture = (name) => readFileSync(join(FIX, name), "utf8");

test("anchor inside the stable prefix passes", () => {
  assert.deepEqual(checkAnchor(fixture("skill-ok.md")), { ok: true, errors: [] });
});

test("missing anchor is flagged", () => {
  const { ok, errors } = checkAnchor(fixture("skill-missing.md"));
  assert.equal(ok, false);
  assert.match(errors.join(" "), /missing 'Read discipline:'/);
});

test("anchor in the per-call trailer is flagged as displaced", () => {
  const { ok, errors } = checkAnchor(fixture("skill-displaced.md"));
  assert.equal(ok, false);
  assert.match(errors.join(" "), /must sit between/);
});

test("a file with no stable-prefix delimiters is a structural failure", () => {
  const { ok, errors } = checkAnchor("# nothing here\n");
  assert.equal(ok, false);
  assert.match(errors.join(" "), /delimiter/);
});

test("a prose mention of the delimiter above the template does not confuse the check", () => {
  assert.deepEqual(checkAnchor(fixture("skill-prose-mention.md")), { ok: true, errors: [] });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tools/sdlc-lint/test/read-discipline.test.mjs`
Expected: FAIL — `Cannot find module '../lib/read-discipline.mjs'`

- [ ] **Step 4: Write the minimal implementation**

`tools/sdlc-lint/lib/read-discipline.mjs`:

```js
// Dev/CI lint for Track E2 (read discipline). Checks the SOURCE TREE only —
// it never runs at pipeline runtime, so unlike lib/usage.mjs it has no
// mirrored copy under plugins/sdlc/tools/.

export const ANCHOR = "Read discipline:";
export const PREFIX_START = "=== STABLE PREFIX ===";
export const PREFIX_END = "=== PER-CALL CONTEXT ===";

/**
 * Check 1 — the read-discipline contract exists and sits in the cache-stable
 * prefix of the orchestrator prompt template.
 * @param {string} text contents of pipeline-orchestrator/SKILL.md
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkAnchor(text) {
  const errors = [];
  const start = text.indexOf(PREFIX_START);
  // Anchored to `start`: the real SKILL.md mentions PREFIX_END in prose (line 928)
  // three lines ABOVE the actual template delimiter, so a bare indexOf would give
  // end < start and report a malformed template forever. Search for the first
  // PREFIX_END that follows PREFIX_START.
  const end = text.indexOf(PREFIX_END, start);
  if (start === -1 || end === -1 || end < start) {
    errors.push(`missing or malformed prompt-template delimiter ('${PREFIX_START}' … '${PREFIX_END}')`);
    return { ok: false, errors };
  }
  const at = text.indexOf(ANCHOR);
  if (at === -1) {
    errors.push(`missing '${ANCHOR}' contract — the E2 read-discipline paragraph must be present`);
  } else if (at < start || at > end) {
    errors.push(`'${ANCHOR}' must sit between '${PREFIX_START}' and '${PREFIX_END}' — outside it loses prompt-cache stability`);
  }
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tools/sdlc-lint/test/read-discipline.test.mjs`
Expected: PASS — 5/5

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/lib/read-discipline.mjs \
        tools/sdlc-lint/test/read-discipline.test.mjs \
        tools/sdlc-lint/fixtures/read-discipline/
git commit -m "feat(sdlc-lint): read-discipline anchor check"
```

---

### Task 2: Anti-pattern scan with escape hatch

Check 2 of 3. Scan `plugins/*/agents/*.md` for phrasing that tells agents to re-read or read whole files. Patterns are deliberately narrow — verified against the live tree they match exactly five lines and nothing else. A broad `/full/` or `/all/` would be noise; `android-debugger.md:34` ("Read the full stack trace") must NOT match, because the second pattern requires `file`/`files` after the adjective. Plural forms (`re-reads`, as used in `aar-analyst.md:36`) must NOT match either — `\b` after `read` prevents it.

**Files:**
- Modify: `tools/sdlc-lint/lib/read-discipline.mjs`
- Create: `tools/sdlc-lint/fixtures/read-discipline/agent-clean.md`
- Create: `tools/sdlc-lint/fixtures/read-discipline/agent-violations.md`
- Create: `tools/sdlc-lint/fixtures/read-discipline/agent-suppressed-same-line.md`
- Create: `tools/sdlc-lint/fixtures/read-discipline/agent-suppressed-prev-line.md`
- Modify: `tools/sdlc-lint/test/read-discipline.test.mjs`

**Interfaces:**
- Consumes: `ANCHOR`, `checkAnchor` from Task 1 (same module).
- Produces:
  - `export const PATTERNS: RegExp[]`
  - `export const OK_MARKER = "<!-- read-discipline: ok"`
  - `export function scanAgentText(text: string): { ok: boolean, errors: string[] }` — errors are formatted `line {n}: {matched text} — matches /{pattern}/`

- [ ] **Step 1: Write the fixtures**

`tools/sdlc-lint/fixtures/read-discipline/agent-clean.md`:

```markdown
# fixture: no anti-patterns

1. Read the spec with `offset`/`limit`, or grep to the section you need.
2. Read the full stack trace — exact file, line, thread.
3. The AAR may recommend surgical reads and fewer re-reads.
```

`tools/sdlc-lint/fixtures/read-discipline/agent-violations.md`:

```markdown
# fixture: one line per pattern

1. **Read all prior phase outputs:**
2. **Verify** what you wrote: re-read changed files.
3. Do not read the whole file just to find one symbol.
```

`tools/sdlc-lint/fixtures/read-discipline/agent-suppressed-same-line.md`:

```markdown
# fixture: suppressed on the matching line

1. Dump the crash context and re-read it. <!-- read-discipline: ok — crash context is regenerated each attempt -->
```

`tools/sdlc-lint/fixtures/read-discipline/agent-suppressed-prev-line.md`:

```markdown
# fixture: suppressed by the preceding line

<!-- read-discipline: ok — generated file, contents change between turns -->
1. Dump the crash context and re-read it.
```

- [ ] **Step 2: Write the failing test**

Append to `tools/sdlc-lint/test/read-discipline.test.mjs`:

```js
import { scanAgentText, PATTERNS } from "../lib/read-discipline.mjs";

test("clean agent text passes — 'full stack trace' and 'no re-reads' are not violations", () => {
  assert.deepEqual(scanAgentText(fixture("agent-clean.md")), { ok: true, errors: [] });
});

test("each anti-pattern is flagged exactly once", () => {
  const { ok, errors } = scanAgentText(fixture("agent-violations.md"));
  assert.equal(ok, false);
  assert.equal(errors.length, 3);
  assert.match(errors[0], /^line 3:/);
  assert.match(errors[1], /^line 4:/);
  assert.match(errors[2], /^line 5:/);
});

test("marker on the matching line suppresses it", () => {
  assert.equal(scanAgentText(fixture("agent-suppressed-same-line.md")).ok, true);
});

test("marker on the preceding line suppresses it", () => {
  assert.equal(scanAgentText(fixture("agent-suppressed-prev-line.md")).ok, true);
});

test("patterns are narrow: plural 're-reads' does not match", () => {
  assert.equal(PATTERNS.some((p) => p.test("no re-reads of the same file")), false);
});

test("patterns are narrow: 'read the full stack trace' does not match", () => {
  assert.equal(PATTERNS.some((p) => p.test("Read the full stack trace")), false);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tools/sdlc-lint/test/read-discipline.test.mjs`
Expected: FAIL — `scanAgentText is not a function` (or an import error)

- [ ] **Step 4: Write the minimal implementation**

Append to `tools/sdlc-lint/lib/read-discipline.mjs`:

```js
// Narrow on purpose. Verified against the live tree: these match exactly the
// five known lines and nothing else. `\b` after `read` keeps the plural
// ("no re-reads", as the AAR analyst legitimately says) out. The second
// pattern requires file/files so "read the full stack trace" stays legal.
export const PATTERNS = [
  /\bre-?read\b/i,
  /\bread (the )?(entire|whole|full) files?\b/i,
  /\bread all\b/i,
];

export const OK_MARKER = "<!-- read-discipline: ok";

/**
 * Check 2 — no agent contract instructs a re-read or a whole-file read,
 * unless the line (or the line above it) carries an explicit, reasoned
 * escape-hatch marker.
 * @param {string} text contents of one plugins/<p>/agents/<a>.md
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function scanAgentText(text) {
  const lines = text.split("\n");
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes(OK_MARKER)) continue;
    if (i > 0 && lines[i - 1].includes(OK_MARKER)) continue;
    for (const p of PATTERNS) {
      const m = line.match(p);
      if (m) {
        errors.push(`line ${i + 1}: "${m[0]}" — matches ${p}. Reword, or justify with ${OK_MARKER} — reason -->`);
        break; // one error per line keeps output readable
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
```

Note on the regex literals: `PATTERNS` carries no `/g` flag, so `.test()` is stateless and safe to call repeatedly.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tools/sdlc-lint/test/read-discipline.test.mjs`
Expected: PASS — 11/11

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/lib/read-discipline.mjs \
        tools/sdlc-lint/test/read-discipline.test.mjs \
        tools/sdlc-lint/fixtures/read-discipline/
git commit -m "feat(sdlc-lint): read-discipline anti-pattern scan with escape hatch"
```

---

### Task 3: Driver + CLI verb, pointed at the real tree

Wire the two checks into a `checkReadDiscipline(root)` driver and a standalone `read-discipline` verb. **Not** added to `runAll()` yet — the real tree still violates both checks, and `all.test.mjs` asserts a clean repo. The verb exiting `1` here is the expected, informative state.

**Files:**
- Modify: `tools/sdlc-lint/lib/read-discipline.mjs`
- Modify: `tools/sdlc-lint/cli.mjs`
- Modify: `tools/sdlc-lint/test/read-discipline.test.mjs`

**Interfaces:**
- Consumes: `checkAnchor` (Task 1), `scanAgentText` (Task 2).
- Produces:
  - `export const SKILL_PATH = "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md"`
  - `export const AGENT_GLOB = "plugins/*/agents/*.md"`
  - `export function checkReadDiscipline(root: string): Array<{ file: string, ok: boolean, errors: string[], tool_error?: boolean }>` — `file` is repo-relative.
  - CLI verb `read-discipline`, and reporter `printReadDiscipline(results)` returning `2` on `tool_error`, `1` on violations, `0` clean.

- [ ] **Step 1: Write the failing test**

Append to `tools/sdlc-lint/test/read-discipline.test.mjs`:

```js
import { checkReadDiscipline } from "../lib/read-discipline.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("driver returns one result row per agent file plus the skill", () => {
  const rows = checkReadDiscipline(REPO);
  assert.ok(rows.length > 5, `expected the skill + all agent files, got ${rows.length}`);
  assert.ok(rows.some((r) => r.file.endsWith("pipeline-orchestrator/SKILL.md")));
  assert.ok(rows.some((r) => r.file.endsWith("plugins/sdlc/agents/developer.md")));
});

test("a missing skill file is a tool error, not a violation", () => {
  const rows = checkReadDiscipline(resolve(REPO, "tools/sdlc-lint/fixtures"));
  const skill = rows.find((r) => r.file.endsWith("SKILL.md"));
  assert.equal(skill.ok, false);
  assert.equal(skill.tool_error, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/sdlc-lint/test/read-discipline.test.mjs`
Expected: FAIL — `checkReadDiscipline is not a function`

- [ ] **Step 3: Write the driver**

Append to `tools/sdlc-lint/lib/read-discipline.mjs`:

```js
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { globSync } from "tinyglobby";

export const SKILL_PATH = "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md";
export const AGENT_GLOB = "plugins/*/agents/*.md";

/**
 * Check 1 + Check 2 over a repository root.
 * @returns {Array<{file: string, ok: boolean, errors: string[], tool_error?: boolean}>}
 */
export function checkReadDiscipline(root = process.cwd()) {
  const results = [];

  const skillAbs = resolve(root, SKILL_PATH);
  try {
    results.push({ file: SKILL_PATH, ...checkAnchor(readFileSync(skillAbs, "utf8")) });
  } catch (e) {
    results.push({ file: SKILL_PATH, ok: false, tool_error: true, errors: [`read: ${e.message}`] });
  }

  for (const abs of globSync(AGENT_GLOB, { cwd: root, absolute: true }).sort()) {
    const file = relative(root, abs);
    try {
      results.push({ file, ...scanAgentText(readFileSync(abs, "utf8")) });
    } catch (e) {
      results.push({ file, ok: false, tool_error: true, errors: [`read: ${e.message}`] });
    }
  }
  return results;
}
```

Move the two `import` lines to the top of the file alongside the existing ones — ESM hoists them regardless, but keeping imports at the top matches `lib/load.mjs` and `lib/cycles.mjs`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tools/sdlc-lint/test/read-discipline.test.mjs`
Expected: PASS — 13/13

- [ ] **Step 5: Add the CLI reporter and verb**

In `tools/sdlc-lint/cli.mjs`, add the import next to the existing lib imports (after line 9):

```js
import { checkReadDiscipline } from "./lib/read-discipline.mjs";
```

Add the reporter after `printCycles` (which ends at line 37), matching its shape:

```js
function printReadDiscipline(results) {
  const failed = results.filter(r => !r.ok);
  if (jsonOut) {
    console.log(JSON.stringify({ command: "read-discipline", checked: results.length, failed: failed.length, failures: failed }));
  } else {
    for (const r of failed) console.error(`✗ ${r.file}\n    ${r.errors.join("\n    ")}`);
    console.log(`read-discipline: ${results.length - failed.length}/${results.length} clean`);
  }
  return failed.some(r => r.tool_error) ? 2 : failed.length ? 1 : 0;
}
```

Add the verb to the `switch` next to `case "cycles":`:

```js
  case "read-discipline": code = printReadDiscipline(checkReadDiscipline(root)); break;
```

Add a line to the `--help` output describing the verb (match the wording style of the neighbouring entries):

```
  read-discipline   E2: contract present in the stable prefix; no re-read phrasing in agents
```

- [ ] **Step 6: Run the verb against the real tree and confirm it reports the known violations**

Run: `node tools/sdlc-lint/cli.mjs read-discipline`
Expected: exit `1`, and the output names exactly these six problems — the missing anchor in `SKILL.md`, plus:

```
plugins/sdlc/agents/document-writer.md    line 36
plugins/sdlc/agents/developer.md          line 47
plugins/sdlc/agents/security-analyst.md   line 36
plugins/sdlc/agents/security-analyst.md   line 58
plugins/sdlc/agents/qa-engineer.md        line 59
```

If any `plugins/android-foundation/agents/*.md` file appears, STOP — the patterns are too broad and the spec's narrowness claim is wrong. Report it rather than widening the escape hatch.

- [ ] **Step 7: Confirm `all` is still green (read-discipline is not wired in yet)**

Run: `node tools/sdlc-lint/cli.mjs all --json`
Expected: `"command":"all","ok":true`

- [ ] **Step 8: Commit**

```bash
git add tools/sdlc-lint/lib/read-discipline.mjs \
        tools/sdlc-lint/cli.mjs \
        tools/sdlc-lint/test/read-discipline.test.mjs
git commit -m "feat(sdlc-lint): read-discipline driver + CLI verb"
```

---

### Task 4: The contract in the orchestrator stable prefix

Now make the anchor check pass against the real tree. The paragraph goes inside `=== STABLE PREFIX ===` at Step 3b-1, immediately after the existing "Compact handoff contract" line (currently `SKILL.md:947`), for the same reason `project_extension_skills_block` and `sdlc_lessons_block` live there: the prefix is byte-identical across runs and qualifies for prompt caching.

**Files:**
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md:947`

**Interfaces:**
- Consumes: the `ANCHOR` token from Task 1 — the inserted text MUST begin with the exact string `Read discipline:`.
- Produces: an orchestrator prompt template whose stable prefix carries the contract. No code interface.

- [ ] **Step 1: Verify the anchor check currently fails**

Run: `node tools/sdlc-lint/cli.mjs read-discipline --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s.trim().split('\n').pop());console.log(r.failures.find(f=>f.file.endsWith('SKILL.md')).errors)})"`
Expected: `[ "missing 'Read discipline:' contract — the E2 read-discipline paragraph must be present" ]`

- [ ] **Step 2: Insert the contract**

In `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`, find this line (947) inside the fenced prompt template:

```
Compact handoff contract: return ONLY a COMPACT summary (≤2-3K tokens). The full deliverable goes to a per-call file path supplied below. Do NOT inline a previous phase's full output into your reasoning; read prior outputs from the file system as needed.
```

Insert immediately after it, separated by one blank line, still **inside** the fenced block and **above** `=== PER-CALL CONTEXT ===`:

```
Read discipline: your entire prompt prefix is re-read and billed on every turn, so
what you pull into context costs on every subsequent turn, not once.
- Locate before you load: Grep/Glob to find the region, then Read with offset/limit.
  Do not read a large file whole to find one symbol.
- A file quoted or summarised in your prompt may be stale — open it yourself with
  Read. Once you have Read it and have not edited it, you have its current contents;
  do not Read it a second time.
- After an Edit/Write, trust the tool result. Do not read the file back to confirm
  the edit landed.
- Keep verification output terse: targeted commands, tail the log. Never dump a full
  build/test log into context.
```

- [ ] **Step 3: Add the DRIFT GUARD comment**

Immediately **after** the closing ``` of that fenced template block (the line following the `aspect_constraint` block, currently line 970-971), add — outside the fence, so it never reaches an agent's prompt:

```markdown
<!-- DRIFT GUARD: the "Read discipline:" paragraph above is asserted by
     tools/sdlc-lint/lib/read-discipline.mjs (verb: read-discipline, part of `all`).
     It must stay INSIDE the stable prefix — moving it below === PER-CALL CONTEXT ===
     breaks prompt-cache stability and fails the lint. Reword freely; do not relocate
     or delete. Track E2. -->
```

- [ ] **Step 4: Verify the anchor check now passes**

Run: `node tools/sdlc-lint/cli.mjs read-discipline`
Expected: `SKILL.md` no longer listed; still exit `1` with exactly the five agent-file violations from Task 3 Step 6.

- [ ] **Step 5: Run the full test suite**

Run: `node --test tools/sdlc-lint/test/*.test.mjs`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
git commit -m "feat(sdlc): read-discipline contract in the orchestrator stable prefix"
```

---

### Task 5: Resolve the re-read contradiction in four agent contracts

Five lines across four files. **Do not simply delete the word.** Each of these instructions encodes a real correctness requirement — between phases the files on disk change, so an agent must not review content pasted into its prompt. The rewrite keeps "take it from the file system" and drops only "take it twice".

**Files:**
- Modify: `plugins/sdlc/agents/document-writer.md:36`
- Modify: `plugins/sdlc/agents/developer.md:47`
- Modify: `plugins/sdlc/agents/security-analyst.md:36` and `:58`
- Modify: `plugins/sdlc/agents/qa-engineer.md:59`

**Interfaces:**
- Consumes: `PATTERNS` from Task 2 — every replacement line must fail to match all three patterns.
- Produces: an agent corpus that scans clean. No code interface.

- [ ] **Step 1: Rewrite `document-writer.md:36`**

From:

```markdown
1. **Read all prior phase outputs:**
```

To:

```markdown
1. **Pull what you need from the prior phase outputs** — grep or `offset`/`limit` to the
   sections you will actually cite, not the whole file (see the read-discipline contract
   in your prompt). Sources:
```

Leave the bulleted file list beneath it unchanged.

*Why this file matters most:* the `documentation` phase carries a ~21k floor, ~50% of its own cache reads, and 23 turns — the second-worst turn count after `development` (39).

- [ ] **Step 2: Rewrite `developer.md:47`**

From:

```markdown
5. **Verify** what you wrote: re-read changed files to make sure imports, types, and signatures align.
```

To:

```markdown
5. **Verify** what you wrote: the `Edit`/`Write` result confirms the change landed — you do not need to pull the file back into context for that. What you do need is consistency beyond the hunk: grep the file for the imports, types, and signatures you touched and confirm they still line up.
```

- [ ] **Step 3: Rewrite `security-analyst.md:36`**

From:

```markdown
2. **Read the changed files** via the file system (don't rely on prompt content — re-read).
```

To:

```markdown
2. **Read the changed files from the file system**, not from content pasted into your prompt — the prompt copy may be stale. Read each one ONCE, scoped with `offset`/`limit` or grep to the changed regions.
```

- [ ] **Step 4: Rewrite `security-analyst.md:58`**

From:

```markdown
5. **Verify your fixes** — re-read the file, make sure the change actually closes the path.
```

To:

```markdown
5. **Verify your fixes** — the `Edit` result confirms the change landed. Then confirm the path is actually closed: grep for every other use of the same tainted value or sink in the file. A fix that closes one call site and misses a second is a false pass.
```

- [ ] **Step 5: Rewrite `qa-engineer.md:59`**

From:

```markdown
3. **Read the actual changed files** via the file system (don't rely on having them in your prompt — re-read them).
```

To:

```markdown
3. **Read the actual changed files from the file system**, not from content pasted into your prompt — the prompt copy may be stale. Read each one ONCE, scoped with `offset`/`limit` or grep to the changed regions.
```

- [ ] **Step 6: Verify the whole tree is now clean**

Run: `node tools/sdlc-lint/cli.mjs read-discipline`
Expected: exit `0`, `read-discipline: N/N clean`

- [ ] **Step 7: Run the full test suite**

Run: `node --test tools/sdlc-lint/test/*.test.mjs`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add plugins/sdlc/agents/document-writer.md \
        plugins/sdlc/agents/developer.md \
        plugins/sdlc/agents/security-analyst.md \
        plugins/sdlc/agents/qa-engineer.md
git commit -m "fix(sdlc): separate 'read from disk' from 'read twice' in agent contracts"
```

---

### Task 6: Wire into `runAll()` and pin the tree clean

The tree is clean, so the rule can now become a merge gate without turning CI red.

**Files:**
- Modify: `tools/sdlc-lint/cli.mjs` (`runAll`, currently lines 103-113)
- Modify: `tools/sdlc-lint/test/read-discipline.test.mjs`
- Modify: `tools/sdlc-lint/test/all.test.mjs`

**Interfaces:**
- Consumes: `checkReadDiscipline` + `printReadDiscipline` from Task 3.
- Produces: `read-discipline` as part of the `all` gate. No new exports.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/read-discipline.test.mjs`:

```js
test("the real repository tree is clean", () => {
  const failed = checkReadDiscipline(REPO).filter(r => !r.ok);
  assert.equal(failed.length, 0, JSON.stringify(failed, null, 2));
});
```

Append to `tools/sdlc-lint/test/all.test.mjs`:

```js
test("`all` runs read-discipline and stays green", () => {
  const out = execFileSync("node", [CLI, "all", "--json"], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /"command":"read-discipline"/);
  assert.match(out, /"command":"all","ok":true/);
});
```

- [ ] **Step 2: Run the tests to verify the `all` one fails**

Run: `node --test tools/sdlc-lint/test/all.test.mjs`
Expected: FAIL on `"command":"read-discipline"` — the verb is not in `runAll()` yet. (The "real tree is clean" test in `read-discipline.test.mjs` already passes after Task 5; that is expected and fine.)

- [ ] **Step 3: Add the verb to `runAll()`**

In `tools/sdlc-lint/cli.mjs`, extend the `codes` array — place it after `printCycles`, so source-tree checks stay grouped before the fixture-driven ones:

```js
function runAll() {
  const codes = [
    printSchema(checkSchemas(root)),
    printCycles(checkAllWorkflows(root)),
    printReadDiscipline(checkReadDiscipline(root)),
    printDetect2(detectRows()),
    printResumeFixtures(),
  ];
  const exit = Math.max(...codes);
  if (jsonOut) console.log(JSON.stringify({ command: "all", ok: exit === 0, exit }));
  return exit;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/*.test.mjs`
Expected: PASS, whole suite.

- [ ] **Step 5: Verify the gate end-to-end**

Run: `node tools/sdlc-lint/cli.mjs all --json`
Expected: output contains `"command":"read-discipline"` and ends with `"command":"all","ok":true,"exit":0`

- [ ] **Step 6: Commit**

```bash
git add tools/sdlc-lint/cli.mjs \
        tools/sdlc-lint/test/read-discipline.test.mjs \
        tools/sdlc-lint/test/all.test.mjs
git commit -m "feat(sdlc-lint): include read-discipline in the all gate"
```

---

### Task 7: Pin the cache-pressure budget

Check 3 of 3. `CACHE_PRESSURE_PEAK_TOKENS` is currently an untested constant — a silent edit would move the threshold that decides whether a phase is flagged, invalidating cross-run comparisons. Pin the value and the comparison boundary so changing it becomes a deliberate act that updates a test.

`usage.test.mjs` already covers `cache_pressure` true (1M and 200k peaks) and false (60k peak). What is missing is the **value pin** and the **exact boundary**.

**Files:**
- Modify: `tools/sdlc-lint/test/usage.test.mjs`

**Interfaces:**
- Consumes: `CACHE_PRESSURE_PEAK_TOKENS` and `enrichTelemetry`, both already re-exported by `tools/sdlc-lint/lib/usage.mjs`. Reuses the file's existing `turn()` and `writeAgent()` helpers.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

In `tools/sdlc-lint/test/usage.test.mjs`, add `CACHE_PRESSURE_PEAK_TOKENS` to the existing import block (lines 7-10), then append:

```js
test("cache-pressure budget is pinned at 80k", () => {
  // A documented budget, not an incidental constant: moving it changes which
  // phases the report and AAR flag, and breaks cross-run comparability.
  assert.equal(CACHE_PRESSURE_PEAK_TOKENS, 80_000);
});

// Build a one-phase run whose single turn has an exact peak cache-read, and
// return the enriched phase. Mirrors the self-contained pattern used by the
// "flags cache_pressure=false" test above.
function enrichWithPeak(agentId, peak) {
  const root = mkdtempSync(join(tmpdir(), "run-"));
  const sub = join(root, "proj", "sess", "subagents");
  writeAgent(sub, agentId, [
    turn("claude-sonnet-5", { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: peak }),
  ]);
  const runDir = join(root, "plan");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
    task_slug: "boundary", started_at: "2026-07-07T13:28:00Z", completed_at: "2026-07-07T14:16:00Z",
    phases: [
      { phase: "development", agent: "x-dev", model: "claude-sonnet-5", status: "completed",
        agent_id: agentId, subagent_tokens: 100, usage_source: "subagent_aggregate", cost_usd: null },
    ],
    total_subagent_tokens: 100, total_cost_usd: null, cache_hit_ratio: null,
  }));
  enrichTelemetry(runDir, { registry: reg, projectsRoot: join(root, "proj") });
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  return tel.phases[0];
}

test("one token under the budget is not flagged", () => {
  assert.equal(enrichWithPeak("aaaa11112222", CACHE_PRESSURE_PEAK_TOKENS - 1).cache_pressure, false);
});

test("exactly at the budget is not flagged (strict greater-than)", () => {
  assert.equal(enrichWithPeak("bbbb22223333", CACHE_PRESSURE_PEAK_TOKENS).cache_pressure, false);
});

test("one token over the budget is flagged", () => {
  assert.equal(enrichWithPeak("cccc33334444", CACHE_PRESSURE_PEAK_TOKENS + 1).cache_pressure, true);
});
```

Note: the flip is `peak_prefix_tokens > CACHE_PRESSURE_PEAK_TOKENS` (`plugins/sdlc/tools/usage/usage.mjs:352`), so the boundary value itself is NOT flagged. The middle test pins that strictness.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/sdlc-lint/test/usage.test.mjs`
Expected: FAIL — `CACHE_PRESSURE_PEAK_TOKENS is not defined` before the import is added; after adding the import, all four new tests should pass on the first implementation-free run, because the behavior already exists. **That is expected here** — this task pins existing behavior rather than adding it. If any of the three boundary tests fails, the constant or the comparison has already drifted from the spec; report it before "fixing" the test.

- [ ] **Step 3: Run the full suite**

Run: `node --test tools/sdlc-lint/test/*.test.mjs`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tools/sdlc-lint/test/usage.test.mjs
git commit -m "test(sdlc-lint): pin cache-pressure budget and its boundary"
```

---

### Task 8: ADR-0008, vault currency, version bump

The orchestrator↔subagent prompt contract gained a mandatory stable-prefix block and four agent contracts changed their read semantics — the backlog flags E2 as *"may warrant an ADR if it changes agent contracts materially"*, and it does.

**Files:**
- Create: `.brain/decisions/ADR-0008-read-discipline-contract.md`
- Modify: `.brain/decisions/_moc-decisions.md`
- Modify: `.brain/planning/roadmap.md`
- Modify: `.brain/planning/backlog.md`
- Modify: `.brain/components/sdlc.md`
- Modify: `plugins/sdlc/.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: everything above. Produces: no code interface.

- [ ] **Step 1: Read the ADR template**

Run: `cat .brain/_templates/adr.md`

Follow its exact frontmatter shape (`adr`, `status`, `date`) and its context / decision / consequences sections. Match the prose style of `.brain/decisions/ADR-0007-overhead-window-authoritative-anchor.md`.

- [ ] **Step 2: Write ADR-0008**

Content requirements — the ADR must state:

- **Context.** Prompt caching bills every token at 0.1× but on every turn, so `cache_read ≈ turns × avg_prefix`. Measured baseline: 6.65M cache-read tokens across 117 subagent turns on a real 7-phase Android run, ~73% of it accumulated context growing to 101k per turn. Agent contracts contradicted each other: `aar-analyst.md` recommended surgical reads while `developer`, `qa-engineer`, `security-analyst`, and `document-writer` instructed re-reads and whole-file reads.
- **Decision.** Read discipline is a **prefix-level contract**, injected once into `=== STABLE PREFIX ===` and enforced by `sdlc-lint read-discipline`, not per-agent prose. The contract explicitly separates "read from the file system rather than trusting the prompt" (kept — correctness) from "read the same file twice" (forbidden — cost). Agent `.md` files defer to it instead of restating it.
- **Consequences.** One place to change; zero per-agent cost; covers every stack including future foundations automatically. No runtime enforcement — the contract is advisory to the model, and non-compliance is detected after the fact via the E5 `cache_pressure` flag. The escape-hatch marker keeps the lint from becoming a tyrant at the cost of one justified comment.
- **Implementing PR:** reference as plain text (e.g. `#68`) once known — **not** a `[[changes/...]]` wikilink.

- [ ] **Step 3: Register the ADR in the MOC**

Add a line for ADR-0008 to `.brain/decisions/_moc-decisions.md`, matching the format of the ADR-0007 line already there.

- [ ] **Step 4: Update the roadmap**

In `.brain/planning/roadmap.md`, replace this paragraph (lines 38-40):

```markdown
**E5 (cache-pressure signal) shipped in #50 (1.8.0):** per-phase `reads/turn` +
`peak_prefix_tokens` in the report and `cache_pressure_phases` in the AAR. Remaining: E2
(surgical reads), E1 (trim floor), E3 (fewer turns), E4 (routing).
```

with:

```markdown
**E5 (cache-pressure signal) shipped in #50 (1.8.0):** per-phase `reads/turn` +
`peak_prefix_tokens` in the report and `cache_pressure_phases` in the AAR.
**E2 (surgical reads) landed in 1.10.0** — read-discipline contract in the orchestrator stable
prefix, four agent contracts de-contradicted, enforced by `sdlc-lint read-discipline`
([[decisions/ADR-0008-read-discipline-contract]]). Its behavioural half is **landed but unmeasured**:
`peak_prefix_tokens` < 60k (from the 101k baseline) is verified on the next real downstream run.
Remaining: E1 (trim floor), E3 (fewer turns), E4 (routing).
```

- [ ] **Step 5: Update the backlog**

In `.brain/planning/backlog.md`, mark the `### E2` heading as done and append a line recording that the behavioural DoD is deferred to the next downstream run, with the 101k / 6.65M / 117-turn baseline stated as the comparison point. Do not delete the E2 section — later tracks reference its analysis.

- [ ] **Step 6: Note the contract in the component note**

`.brain/components/sdlc.md` has no list of `sdlc-lint` verbs (verified — the note has `## Responsibility` and `## Key files` sections only). Do not invent one. Instead append this sentence to the end of the `## Responsibility` paragraph:

```markdown
Its orchestrator prompt template carries a **read-discipline contract** in the cache-stable prefix
(Track E2, [[decisions/ADR-0008-read-discipline-contract]]) — surgical reads, no repeat reads, terse
tool output — enforced at CI time by the `read-discipline` verb of `tools/sdlc-lint` (part of `all`).
```

and add these two entries to `## Key files`:

```markdown
- `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`
- `tools/sdlc-lint/lib/read-discipline.mjs`
```

Skip either entry if it is already listed.

- [ ] **Step 7: Bump the plugin version**

In `plugins/sdlc/.claude-plugin/plugin.json`, change `"version": "1.9.1"` to `"version": "1.10.0"` (feature release).

- [ ] **Step 8: Validate everything**

```bash
node --test tools/sdlc-lint/test/*.test.mjs
node tools/sdlc-lint/cli.mjs all
node tools/brain-sync/cli.mjs check --vault .brain
```

Expected: suite green; `all` exit `0`; brain-sync `check` clean.

- [ ] **Step 9: Commit**

```bash
git add .brain/decisions/ADR-0008-read-discipline-contract.md \
        .brain/decisions/_moc-decisions.md \
        .brain/planning/roadmap.md \
        .brain/planning/backlog.md \
        .brain/components/sdlc.md \
        plugins/sdlc/.claude-plugin/plugin.json
git commit -m "docs(brain): ADR-0008 read-discipline contract + roadmap E2 landed (1.10.0)"
```

---

## Done criteria

**Merge gate (verifiable in this repo):**
- `node --test tools/sdlc-lint/test/*.test.mjs` green.
- `node tools/sdlc-lint/cli.mjs all` exits `0` and its output includes `"command":"read-discipline"`.
- `node tools/brain-sync/cli.mjs check --vault .brain` clean.
- The `Read discipline:` contract sits inside `=== STABLE PREFIX ===` in the orchestrator SKILL.
- No `plugins/*/agents/*.md` matches the anti-patterns without a justified escape-hatch marker.

**Deferred (next real downstream SDLC run):**
- `peak_prefix_tokens` on a comparable run drops below **60k**, from the recorded baseline of **101k peak / 6.65M cache reads / 117 turns** (`change-matches-filter-logic-gender`).
- No quality regression in review/test/qa verdicts.

Until that measurement exists, E2 is reported as **landed, unmeasured**. The roadmap entry says so explicitly rather than claiming the win.
