# G1 Self-Healing Compiler/Lint Micro-Loops Implementation Plan

> **Amendment (post-implementation, shipped as #77).** This plan is a historical record; the tasks
> below are complete and merged. Review of this plan during implementation found two Critical and
> six Important defects in the design it was built from, and the plan author ruled that the review
> findings govern — so the text actually shipped into
> `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` differs from some of the literal instructions
> below in two load-bearing ways, both marked inline where they occur:
> 1. **A new step `3b-0`** (not in this plan) captures the pre-dispatch `git` snapshot that
>    `heal_touched_files` depends on — Task 5's step 1 below assumed that snapshot already existed
>    without ever specifying where it came from.
> 2. **The aspect-aware heal re-dispatch targets the canonical-LAST aspect's agent**, not
>    canonical-first as written in Task 5 step 6 below.
> 3. **Heal cost does not fold into the phase's `cost_usd` automatically** — Task 5 step 9 below
>    claims "no arithmetic change," which is false; the orchestrator re-enters step `3d-1` after every
>    heal dispatch to append the cost explicitly.
>
> See `.brain/decisions/ADR-0010-self-healing-micro-loop.md` for the authoritative account. Read the
> actual `3b-0` / `3e-heal` steps in `SKILL.md` for the shipped wording; do not treat the code blocks
> below as current.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `heal:` workflow primitive that feeds compiler/lint `stderr` back to the phase's own agent, hard-capped at 2 attempts, then records a blocker and continues the pipeline.

**Architecture:** A new orchestrator step `3e-heal` runs between phase-output validation (`3e`) and checkpoint write (`3d-3`). It executes the stack profile's `heal_checks` commands; on a non-zero exit it re-dispatches the phase's agent with the captured stderr, up to `max_attempts` declared per-phase in the workflow recipe. Outcome is recorded as `heal_attempts_used` / `heal_status` on the checkpoint and flows through the existing AAR → rollup → HTML report chain exactly as `qa_iterations_used` already does.

**Tech Stack:** JSON Schema (draft 2020-12, Ajv), dependency-free ES modules under `plugins/sdlc/tools/`, `node:test` for tests, markdown prompt-engineering in `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`.

**Spec:** `docs/superpowers/specs/2026-07-27-g1-self-healing-design.md`

## Global Constraints

- **Runtime code ships inside the plugin.** Canonical implementations live under `plugins/sdlc/tools/`; `tools/sdlc-lint/lib/*.mjs` are re-export shims only. Never fork logic into the shim.
- **Dependency-free runtime.** `plugins/sdlc/tools/**` may import node builtins only — no `node_modules` on a consumer install.
- **Deterministic.** No `Date.now()`, `new Date()`, or `Math.random()` in `plugins/sdlc/tools/**`. Same telemetry in → byte-identical output.
- **`max_attempts` ceiling is 3**, schema-enforced. Default 2.
- **Heal scope is compile + lint only.** Never unit tests — those stay with `qa-engineer`'s 3-attempt cap.
- **Exhaustion never halts the run** and never escalates to a reviewer.
- **A recipe phase without a `heal:` block must be byte-identical** in prompt and behaviour to today.
- Run tests with `node --test tools/sdlc-lint/test/*.test.mjs` (the trailing-slash directory form does not auto-discover on Node 22).
- Keep `node tools/sdlc-lint/cli.mjs all` green before every commit.

---

### Task 1: Schema surfaces

Adds the three schema contracts the rest of the plan builds on: the `heal` block on a recipe phase, `heal_checks` on a manifest, and the two heal result fields on a checkpoint.

**Files:**
- Modify: `schemas/workflow.schema.json` (phase object properties, beside `loop`)
- Modify: `schemas/manifest.schema.json:177-181` (beside `post_pipeline_checks`)
- Modify: `schemas/checkpoint.schema.json:38-39` (beside `qa_iterations_used`)
- Test: `tools/sdlc-lint/test/schema.test.mjs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: the `heal` recipe block `{max_attempts: integer 1..3}`; the manifest key `heal_checks: string[]`; the checkpoint fields `heal_attempts_used: integer >= 0` and `heal_status: "healed" | "exhausted" | "skipped" | "pre-existing"`.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/schema.test.mjs`:

```javascript
test("workflow.schema accepts a phase with a heal block", () => {
  const v = compile("schemas/workflow.schema.json");
  assert.ok(v({ name: "x", phases: [{ name: "development", heal: { max_attempts: 2 } }] }));
});

test("workflow.schema rejects max_attempts above the ceiling of 3", () => {
  const v = compile("schemas/workflow.schema.json");
  assert.equal(v({ name: "x", phases: [{ name: "development", heal: { max_attempts: 4 } }] }), false);
});

test("workflow.schema rejects a heal block with no max_attempts", () => {
  const v = compile("schemas/workflow.schema.json");
  assert.equal(v({ name: "x", phases: [{ name: "development", heal: {} }] }), false);
});

test("workflow.schema allows heal and loop on the same phase", () => {
  const v = compile("schemas/workflow.schema.json");
  assert.ok(v({
    name: "x",
    phases: [{ name: "development", heal: { max_attempts: 2 }, loop: { return_to: "qa", max_rounds: 3 } }],
  }));
});

test("manifest.schema accepts heal_checks", () => {
  const v = compile("schemas/manifest.schema.json");
  assert.ok(v({
    kind: "foundation", stack: "android", priority: 50,
    detect: { any: ["*"] },
    heal_checks: ["sh -c './gradlew compileDebugKotlin'"],
  }));
});

test("checkpoint.schema accepts heal result fields", () => {
  const v = compile("schemas/checkpoint.schema.json");
  assert.ok(v({
    phase: "development", status: "completed", completed_at: "2026-07-27T10:00:00Z",
    heal_attempts_used: 1, heal_status: "healed",
  }));
});

test("checkpoint.schema rejects an unknown heal_status", () => {
  const v = compile("schemas/checkpoint.schema.json");
  assert.equal(v({
    phase: "development", status: "completed", completed_at: "2026-07-27T10:00:00Z",
    heal_status: "partially-healed",
  }), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/schema.test.mjs`
Expected: FAIL — the `heal` tests fail because `additionalProperties: false` on the phase object rejects the unknown key; the `heal_status` rejection test fails because an unconstrained unknown key is currently allowed.

- [ ] **Step 3: Add `heal` to the workflow schema**

In `schemas/workflow.schema.json`, inside the phase-object `oneOf` branch (the one with `required: ["name"]`), add a sibling to `loop`:

```json
"heal": {
  "type": "object",
  "description": "Self-healing micro-loop for mechanical build failures (Track G1). After this phase runs, the orchestrator executes the merged `heal_checks` commands; on a non-zero exit it re-dispatches THIS phase's agent with the captured stderr, up to `max_attempts`. On exhaustion it records a blocker and CONTINUES the pipeline — it never halts the run and never escalates to a review phase. Scope is compile/lint only; unit-test failures stay with the qa agent's own cap.",
  "required": ["max_attempts"],
  "additionalProperties": false,
  "properties": {
    "max_attempts": {
      "type": "integer",
      "minimum": 1,
      "maximum": 3,
      "default": 2,
      "description": "Hard cap on heal re-dispatches per phase dispatch. Ceiling of 3 is a deliberate backstop against runaway-iteration cost incidents; it resets on each dispatch, so a loop phase gets a fresh budget per round."
    }
  }
}
```

- [ ] **Step 4: Add `heal_checks` to the manifest schema**

In `schemas/manifest.schema.json`, after the `post_pipeline_checks` property (ends line 181):

```json
    "heal_checks": {
      "type": "array",
      "description": "Shell commands the G1 self-healing loop runs after a guarded phase (compile/lint gates ONLY — never unit tests). Merged across profiles as a de-duplicated union, PRIMARY first. Usually a subset of post_pipeline_checks. Empty for most frameworks.",
      "items": { "type": "string", "minLength": 1 }
    }
```

Add a comma after the closing brace of `post_pipeline_checks` so the JSON stays valid.

- [ ] **Step 5: Add heal fields to the checkpoint schema**

In `schemas/checkpoint.schema.json`, after `"qa_status": { "enum": ["completed", "capped"] },` (line 39):

```json
    "heal_attempts_used": { "type": "integer", "minimum": 0 },
    "heal_status": { "enum": ["healed", "exhausted", "skipped", "pre-existing"] },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/schema.test.mjs`
Expected: PASS, all tests including the pre-existing ones.

- [ ] **Step 7: Verify the whole lint stays green**

Run: `node tools/sdlc-lint/cli.mjs all`
Expected: exit 0 — every real plugin file still validates (no recipe declares `heal` yet, so nothing changed on disk).

- [ ] **Step 8: Commit**

```bash
git add schemas/workflow.schema.json schemas/manifest.schema.json schemas/checkpoint.schema.json tools/sdlc-lint/test/schema.test.mjs
git commit -m "feat(schema): heal block, heal_checks, and heal checkpoint fields (G1)"
```

---

### Task 2: AAR metrics — surface heal attempts and exhaustions

Threads the checkpoint fields into the AAR dashboard so `/sdlc:aar` can flag phases that burned their heal budget.

**Files:**
- Modify: `plugins/sdlc/tools/aar/metrics.mjs:26-44` (`by_phase` map), `:77` (aggregate block), `:104` (return object)
- Test: `tools/sdlc-lint/test/aar-metrics.test.mjs`

**Interfaces:**
- Consumes: Task 1's checkpoint fields `heal_attempts_used`, `heal_status`.
- Produces: on each `by_phase[]` entry — `heal_attempts_used: number`, `heal_status: string|null`. On the returned dashboard object — `heal_attempts: number` (sum across phases) and `heal_exhausted_phases: Array<{phase: string, heal_attempts_used: number}>` sorted by phase name ascending.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/aar-metrics.test.mjs`:

```javascript
test("by_phase carries heal fields, defaulting cleanly when absent", () => {
  const d = computeMetrics({
    task_slug: "t",
    phases: [
      { phase: "development", usage_source: "reported", heal_attempts_used: 1, heal_status: "healed" },
      { phase: "security", usage_source: "reported" },
    ],
  });
  const dev = d.by_phase.find((p) => p.phase === "development");
  assert.equal(dev.heal_attempts_used, 1);
  assert.equal(dev.heal_status, "healed");
  const sec = d.by_phase.find((p) => p.phase === "security");
  assert.equal(sec.heal_attempts_used, 0);
  assert.equal(sec.heal_status, null);
});

test("heal_attempts sums across phases", () => {
  const d = computeMetrics({
    task_slug: "t",
    phases: [
      { phase: "development", usage_source: "reported", heal_attempts_used: 2, heal_status: "exhausted" },
      { phase: "qa", usage_source: "reported", heal_attempts_used: 1, heal_status: "healed" },
    ],
  });
  assert.equal(d.heal_attempts, 3);
});

test("heal_exhausted_phases lists only exhausted phases, phase-name ascending", () => {
  const d = computeMetrics({
    task_slug: "t",
    phases: [
      { phase: "security", usage_source: "reported", heal_attempts_used: 2, heal_status: "exhausted" },
      { phase: "development", usage_source: "reported", heal_attempts_used: 2, heal_status: "exhausted" },
      { phase: "qa", usage_source: "reported", heal_attempts_used: 1, heal_status: "healed" },
    ],
  });
  assert.deepEqual(d.heal_exhausted_phases, [
    { phase: "development", heal_attempts_used: 2 },
    { phase: "security", heal_attempts_used: 2 },
  ]);
});

test("a run with no healing reports zero and an empty exhausted list", () => {
  const d = computeMetrics({ task_slug: "t", phases: [{ phase: "qa", usage_source: "reported" }] });
  assert.equal(d.heal_attempts, 0);
  assert.deepEqual(d.heal_exhausted_phases, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/aar-metrics.test.mjs`
Expected: FAIL with `undefined` for `dev.heal_attempts_used`, `d.heal_attempts`, and `d.heal_exhausted_phases`.

- [ ] **Step 3: Add heal fields to `by_phase`**

In `plugins/sdlc/tools/aar/metrics.mjs`, inside the `by_phase` map's returned object, after `cache_pressure: p.cache_pressure === true,` (line 42):

```javascript
      heal_attempts_used: num(p.heal_attempts_used),
      heal_status: p.heal_status ?? null,
```

- [ ] **Step 4: Add the aggregates**

Immediately after the `qa_iterations` line (line 77):

```javascript
  const heal_attempts = phases.reduce((s, p) => s + num(p.heal_attempts_used), 0);
  // Phases that burned their whole heal budget without going green. These are the
  // actionable AAR finding: a mechanical failure the loop could not close.
  const heal_exhausted_phases = by_phase
    .filter((p) => p.heal_status === "exhausted")
    .map((p) => ({ phase: p.phase, heal_attempts_used: p.heal_attempts_used }))
    .sort((a, b) => (a.phase < b.phase ? -1 : a.phase > b.phase ? 1 : 0));
```

- [ ] **Step 5: Add both to the return object**

In the returned object, immediately after `qa_iterations,` (line 104):

```javascript
    heal_attempts,
    heal_exhausted_phases,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/aar-metrics.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/sdlc/tools/aar/metrics.mjs tools/sdlc-lint/test/aar-metrics.test.mjs
git commit -m "feat(aar): surface heal attempts and exhausted phases (G1)"
```

---

### Task 3: Cross-run rollup

Aggregates heal activity across every recorded run so `/sdlc:report` shows whether healing is paying off over time.

**Files:**
- Modify: `plugins/sdlc/tools/rollup/rollup.mjs:44` (row), `:63` (accumulator), `:99` (distribution), `:117` (totals), `:137` (text render), `:212` (HTML tile)
- Test: `tools/sdlc-lint/test/rollup.test.mjs`

**Interfaces:**
- Consumes: Task 2's `heal_attempts` from `computeMetrics`.
- Produces: on each row — `heal_attempts: number`. On the rollup object — `totals.heal_attempts: number` and `heal_distribution: Record<string, number>` (key = attempt count as a string, value = number of runs).

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/rollup.test.mjs`:

`computeRollup` is **already imported** at the top of this file — do not add a second import
statement for it.

```javascript
const runWith = (slug, healByPhase) => ({
  slug,
  telemetry: {
    task_slug: slug,
    started_at: `2026-07-2${slug.length}T10:00:00Z`,
    phases: healByPhase.map((h, i) => ({
      phase: `p${i}`, usage_source: "reported", heal_attempts_used: h, heal_status: h ? "healed" : undefined,
    })),
  },
});

test("rollup totals sum heal attempts across runs", () => {
  const r = computeRollup([runWith("a", [1, 2]), runWith("bb", [0])]);
  assert.equal(r.totals.heal_attempts, 3);
});

test("heal_distribution counts runs by their heal-attempt total", () => {
  const r = computeRollup([runWith("a", [1, 2]), runWith("bb", [3]), runWith("ccc", [0])]);
  assert.equal(r.heal_distribution["3"], 2);  // run "a" (1+2) and run "bb" (3)
  assert.equal(r.heal_distribution["0"], 1);  // run "ccc"
});

test("each run row exposes its own heal_attempts", () => {
  const r = computeRollup([runWith("a", [2])]);
  assert.equal(r.runs[0].heal_attempts, 2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/rollup.test.mjs`
Expected: FAIL — `r.totals.heal_attempts` and `r.heal_distribution` are `undefined`.

- [ ] **Step 3: Add heal to the row**

In `plugins/sdlc/tools/rollup/rollup.mjs`, after `qa_iterations: num(m.qa_iterations),` (line 44):

```javascript
      heal_attempts: num(m.heal_attempts),
```

- [ ] **Step 4: Add the accumulator**

Change the accumulator declaration (line ~55) from:

```javascript
  let capBreaches = 0, skipRules = 0, qaIters = 0, unpricedRuns = 0;
```

to:

```javascript
  let capBreaches = 0, skipRules = 0, qaIters = 0, healAttempts = 0, unpricedRuns = 0;
```

and inside the `for (const r of rows)` loop, after `qaIters += r.qa_iterations;` (line 63):

```javascript
    healAttempts += r.heal_attempts;
```

- [ ] **Step 5: Add the distribution**

After the `qa_distribution` block (line 99):

```javascript
  const heal_distribution = {};
  for (const r of rows) { const k = String(r.heal_attempts); heal_distribution[k] = (heal_distribution[k] ?? 0) + 1; }
```

- [ ] **Step 6: Add to totals and the returned object**

In `totals`, after `qa_iterations: qaIters,` (line 117):

```javascript
      heal_attempts: healAttempts,
```

In the returned object, after `qa_distribution,`:

```javascript
    heal_distribution,
```

- [ ] **Step 7: Render it in both output formats**

In the text renderer (line 137), extend the summary line:

```javascript
    ` · skips ${t.skip_rules} · QA iters ${t.qa_iterations} · heal ${t.heal_attempts}`
```

In the HTML renderer (line 212), after the QA tile:

```javascript
${tile("Heal attempts", t.heal_attempts)}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/rollup.test.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add plugins/sdlc/tools/rollup/rollup.mjs tools/sdlc-lint/test/rollup.test.mjs
git commit -m "feat(rollup): cross-run heal attempt totals and distribution (G1)"
```

---

### Task 4: HTML run report

Puts heal activity on the per-run report a human actually reads.

**Files:**
- Modify: `plugins/sdlc/tools/report/report.mjs:272` (hero meta), `:360` (per-phase token line)
- Test: `tools/sdlc-lint/test/report.test.mjs`

**Interfaces:**
- Consumes: Task 1's checkpoint fields as they appear on `telemetry.phases[]`.
- Produces: rendered HTML only — no new exported functions.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/report.test.mjs`:

```javascript
test("hero shows total heal attempts when any phase healed", () => {
  const html = renderReport({
    task_slug: "t", started_at: "2026-07-27T10:00:00Z",
    phases: [
      { phase: "development", usage_source: "reported", heal_attempts_used: 1, heal_status: "healed" },
      { phase: "qa", usage_source: "reported", heal_attempts_used: 2, heal_status: "exhausted" },
    ],
  });
  assert.match(html, /3 heal attempt\(s\)/);
});

test("hero omits the heal meta entirely when nothing healed", () => {
  const html = renderReport({
    task_slug: "t", started_at: "2026-07-27T10:00:00Z",
    phases: [{ phase: "qa", usage_source: "reported" }],
  });
  assert.doesNotMatch(html, /heal attempt/);
});

test("a healed phase carries a per-phase heal badge", () => {
  const html = renderReport({
    task_slug: "t", started_at: "2026-07-27T10:00:00Z",
    phases: [{
      phase: "development", usage_source: "reported",
      input_tokens: 100, output_tokens: 50, cached_input_tokens: 10, cache_creation_tokens: 5,
      heal_attempts_used: 2, heal_status: "exhausted",
    }],
  });
  assert.match(html, /2 heal attempt\(s\)/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/report.test.mjs`
Expected: FAIL — no `heal attempt(s)` string is rendered anywhere.

- [ ] **Step 3: Add the hero meta line**

In `plugins/sdlc/tools/report/report.mjs`, after the QA-iterations meta push (line 272):

```javascript
  const healTotal = phases.reduce((s, p) => s + (Number(p.heal_attempts_used) || 0), 0);
  if (healTotal > 0) meta.push(`<span>${fmtInt(healTotal)} heal attempt(s)</span>`);
```

Guarding on `> 0` keeps the hero unchanged for runs that never healed — which is every run on a recipe with no `heal:` block.

- [ ] **Step 4: Add the per-phase badge**

After the QA per-phase badge (line 360):

```javascript
  if (p.heal_attempts_used) parts.push(`${fmtInt(p.heal_attempts_used)} heal attempt(s)`);
```

Unlike the QA badge this is not gated on phase name — any guarded phase can heal.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/report.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/sdlc/tools/report/report.mjs tools/sdlc-lint/test/report.test.mjs
git commit -m "feat(report): heal attempt badges in the HTML run report (G1)"
```

---

### Task 5: Orchestrator step 3e-heal

The behavioural core: the prompt-level contract the orchestrator executes. This is markdown, but it is the actual product — the tests assert structural placement, which is the real drift risk.

**Files:**
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` — insert `3e-heal` between `**3e. Validate phase output:**` and `**3d-3. Write the phase checkpoint`; update the cost preview at `:743-744`
- Test: `tools/sdlc-lint/test/all.test.mjs`

**Interfaces:**
- Consumes: `EFFECTIVE_PROFILE.heal_checks` (Task 6 parses it); the recipe `heal` block (Task 1).
- Produces: checkpoint fields `heal_attempts_used` / `heal_status` consumed by Task 2; per-call trailer keys `heal_attempt`, `heal_command`, `heal_touched_files`, `heal_stderr`.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/all.test.mjs`:

```javascript
import { readFileSync } from "node:fs";

const SKILL = resolve(REPO, "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md");

test("the 3e-heal step exists and sits between 3e validation and the 3d-3 checkpoint write", () => {
  const text = readFileSync(SKILL, "utf8");
  const validate = text.indexOf("**3e. Validate phase output:**");
  const heal = text.indexOf("**3e-heal.");
  const checkpoint = text.indexOf("**3d-3. Write the phase checkpoint");
  assert.ok(validate > -1, "3e validation step missing");
  assert.ok(heal > -1, "3e-heal step missing");
  assert.ok(checkpoint > -1, "3d-3 checkpoint step missing");
  assert.ok(validate < heal && heal < checkpoint,
    "3e-heal must run AFTER output validation and BEFORE the checkpoint write — " +
    "otherwise the checkpoint records an unhealed state or heal burns attempts on an invalid phase");
});

test("the heal contract names its capability-gate and continue-on-exhaustion rules", () => {
  const text = readFileSync(SKILL, "utf8");
  const heal = text.indexOf("**3e-heal.");
  const section = text.slice(heal, heal + 4000);
  assert.match(section, /tool unavailable on this host/,
    "heal must reuse Step 4's capability gate, else a host without the toolchain heals to the cap every phase");
  assert.match(section, /continue/i, "heal exhaustion must continue the pipeline, not halt it");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/all.test.mjs`
Expected: FAIL with "3e-heal step missing".

- [ ] **Step 3: Insert the 3e-heal step**

In `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`, between the end of `**3e. Validate phase output:**` (the line `If validation fails, **do not proceed** — ask the user how to handle (retry, skip, abort).`) and `**3d-3. Write the phase checkpoint (resume substrate).**`, insert:

````markdown
**3e-heal. Self-healing micro-loop (Track G1).**

Runs ONLY when the resolved recipe phase carries a `heal: {max_attempts: N}` block. Without one,
skip this step entirely — no commands, no dispatch, no prompt change.

Set `heal_attempts = 0`, `heal_status = "skipped"`.

1. **Capture the touched set.** Before the phase was dispatched you recorded
   `git diff --name-only HEAD` plus `git ls-files --others --exclude-standard`. **[Amended: this
   "before" snapshot needed its own named step — it did not exist implicitly. The shipped design
   adds step `3b-0`, immediately before `3c` spawns the agent, which writes this snapshot to
   `CONTEXT.pre_phase_files`. See `SKILL.md`'s actual `3b-0` step for the aspect-aware /
   loop-round capture rules.]** Run both again now; the union of the two deltas, minus
   `CONTEXT.pre_phase_files`, is `heal_touched_files`. (Derive it from git, NOT from the phase's
   prose report — only `development` is required to list changed files at 3e; `security` reports
   severity counts and `qa` reports pass/fail counts.)

2. **Run the checks.** For each command in `EFFECTIVE_PROFILE.heal_checks`, execute via `Bash` with
   `timeout: 600000` (a Gradle build exceeding the 120000 default would otherwise register as a
   spurious failure and trigger healing against a timeout rather than a compile error).

   A command whose required tool is absent on this host is a **SKIP**, not a failure — record
   `skipped (tool unavailable on this host)` and move to the next command. This is the same rule as
   Step 4; without it a host lacking the toolchain heals to the cap on every guarded phase.

3. **All commands exit 0** → set `heal_status = "healed"` if `heal_attempts > 0`, else leave
   `"skipped"`. Proceed to 3d-3.

4. **A command exits non-zero:**
   - If `heal_attempts == max_attempts` → set `heal_status = "exhausted"`, record the blocker
     `"{phase} heal exhausted ({heal_attempts} attempts) — {command} still failing"` in telemetry,
     **MUST PRINT VERBATIM:**
     ```
     ⚠ Phase {N}/{total}: {phase} heal exhausted after {heal_attempts} attempt(s) — {command} still failing
     ```
     and **CONTINUE to the next phase.** Never halt the run. Never escalate to a review phase.
   - Otherwise `heal_attempts += 1`, **MUST PRINT VERBATIM:**
     ```
     🔧 Phase {N}/{total}: {phase} heal attempt {heal_attempts}/{max_attempts}
     ```
     then re-dispatch (step 5) and return to step 2.

5. **The heal re-dispatch.** Spawn the SAME agent this phase used (3a lookup), with the SAME stable
   prefix — unchanged, so prompt-cache stays warm — and these ADDITIONAL per-call trailer keys:

   ```
   heal_attempt: {heal_attempts}/{max_attempts}
   heal_command: {the command that failed}
   heal_touched_files:
     {the git-derived list from step 1, one per line}
   heal_stderr: |
     {LAST 50 LINES of the failing command's combined output}
   heal_instruction: |
     A mechanical build check failed after your phase. Fix ONLY what the tool named.
     Do not refactor, do not add features, do not touch tests, do not change public APIs.
     If the reported errors name ONLY files outside heal_touched_files, this is PRE-EXISTING
     breakage you did not cause: report that and STOP without editing anything.
     If the failure is not mechanically fixable from this output (it needs a design change),
     say so and STOP — do not guess.
   ```

   `heal_stderr` is capped at 50 lines. An unbounded build log is exactly the
   "never dump a full build/test log into context" case the read-discipline contract forbids
   (ADR-0008).

   If the agent reports **pre-existing breakage**, set `heal_status = "pre-existing"`, record it as
   a blocker, and stop the loop without spending further attempts.
   If the agent reports the failure is **not mechanically fixable**, treat it as exhausted
   immediately — do not spend the remaining attempt.

6. **Aspect-aware phases.** Compilation is global: one aspect's code may legitimately not compile
   until a later aspect lands. So heal runs **ONCE after the whole fan-out completes**, never
   per-aspect. **[Amended: dispatch to the canonical-LAST aspect's agent, not canonical-first as
   originally written here — this was reversed during implementation. The canonical-last unit's
   checkpoint is the only one still unwritten at this point, so recording the heal result there
   keeps "the checkpoint records the healed state" true without reopening an earlier aspect's
   already-completed checkpoint write. See ADR-0010 Consequences.]** OMIT the `aspect_constraint`
   block for heal dispatches only — `heal_instruction` already bounds the edit to what the tool
   named, and routing stderr to aspects by file path is fragile guesswork.

7. **Development's planning gate is NOT re-opened** on a heal re-dispatch — go straight to the
   implement pass, mirroring loop-round behaviour (3-loop step 2).

8. **The 3d-cap cost gate applies to heal dispatches.** A heal attempt is real spend and must not
   tunnel under the cap. Re-evaluate the gate after each heal dispatch's cost is folded in.

9. **Record on the checkpoint** (written next, in 3d-3): `heal_attempts_used = heal_attempts` and
   `heal_status`. **[Amended: "heal dispatch cost folds into this phase's own `cost_usd`... no
   arithmetic change" was false (Important finding I3) — nothing does that automatically. The
   shipped design re-enters step `3d-1` after every heal dispatch: it appends the new `agent_id`,
   adds the dispatch's tokens/`cost_usd` to the unit's running totals, and adds the same delta to
   `CONTEXT.running_cost_usd` before `3d-cap` is re-evaluated. `3d-cap` also gained a carve-out so a
   cap-exceeded heal attempt marks `heal_status: "exhausted"` and proceeds to the checkpoint write
   instead of pausing/aborting the run. See ADR-0010 Consequences.]**

`heal_attempts` resets on **every dispatch**, not once per phase — so a loop phase gets a fresh
budget each round. The checkpoint's `heal_attempts_used` records the SUM across that phase's rounds.

<!-- DRIFT GUARD: the `heal:` block shape (max_attempts 1..3) is defined in
     schemas/workflow.schema.json and `heal_checks` in schemas/manifest.schema.json; the
     result fields are in schemas/checkpoint.schema.json. The ORDERING of this step
     (after 3e validation, before the 3d-3 checkpoint write) is asserted by
     tools/sdlc-lint/test/all.test.mjs — moving it writes an unhealed checkpoint or
     burns attempts on an invalid phase. Reword freely; do not relocate. Track G1. -->
````

- [ ] **Step 4: Update the cost preview**

At `SKILL.md:743-744` the worst-case estimate folds in loop rounds only, so a guarded phase would
under-report the figure the user approves. Replace those two lines:

```
expected_total = base_total + Σ over loop phases 0.5·(est(L)+est(R))
worst_total    = base_total + Σ over loop phases (max_rounds−1)·(est(L)+est(R))
```

with:

```
expected_total = base_total + Σ over loop phases 0.5·(est(L)+est(R))
                            + Σ over healed phases 0.3·est(H)
worst_total    = base_total + Σ over loop phases (max_rounds−1)·(est(L)+est(R))
                            + Σ over healed phases max_attempts·est(H)
```

Directly below that block, add:

```
A phase carrying `heal: {max_attempts: N}` can re-dispatch its own agent up to N times per
dispatch, so `worst_total` folds in `N × est(H)` for each guarded phase H. When a phase is BOTH
looped and guarded the two multiply — a 3-round loop over a 2-attempt guarded phase is up to
9 dispatches — so the guarded-phase term is added per loop round, not once.
```

- [ ] **Step 5: Add the `loops ⇄` row flag for guarded phases**

At `SKILL.md:753` the plan-preview row already flags loops and parallel groups. Extend the row
template so a guarded phase is visible before the user approves:

```
   1. {phase}{ — aspect}    → {agent} ({tier})   ~${est_row}{  loops ⇄ {return_to}, ≤{max_rounds}× | ‖ parallel | 🔧 heals ≤{max_attempts}× — flags if any}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/all.test.mjs`
Expected: PASS.

- [ ] **Step 7: Verify read-discipline did not regress**

The inserted text contains the phrase "re-dispatch", not "re-read", but confirm:

Run: `node tools/sdlc-lint/cli.mjs read-discipline`
Expected: `read-discipline: 19/19 clean`

- [ ] **Step 8: Commit**

```bash
git add plugins/sdlc/skills/pipeline-orchestrator/SKILL.md tools/sdlc-lint/test/all.test.mjs
git commit -m "feat(orchestrator): step 3e-heal self-healing micro-loop (G1)"
```

---

### Task 6: Config plumbing and recipe rollout

Wires `heal_checks` through profile merge and project-local override, gives Android real commands, and turns the loop on across the recipes.

**Files:**
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md:243` (parse list), `:467` (field list), `:476` (merge semantics), `:494` (override table), `:536` (example)
- Modify: `plugins/android-foundation/manifest.yaml` (add `heal_checks`)
- Modify: `plugins/sdlc/workflows/{default,bugfix,hotfix,refactor,debug,testing,analysis}.yaml`
- Modify: `plugins/android-foundation/workflows/android-feature.yaml`
- Test: `tools/sdlc-lint/test/schema.test.mjs`

**[Amended: this file list is incomplete.** The shipped rollout also added `heal:` to
`plugins/android-foundation/workflows/android-bugfix.yaml` (`development`, `qa`) and
`plugins/android-foundation/workflows/android-debug.yaml` (`development`, `test` — its `debugging`
phase is deliberately unguarded, being an investigation phase with no compilable output), extending
the same reasoning `android-feature.yaml` already got. See ADR-0010 Decision for the full guarded
list.]

**Interfaces:**
- Consumes: Task 1's `heal_checks` manifest key and `heal` recipe block; Task 5's `EFFECTIVE_PROFILE.heal_checks` reader.
- Produces: nothing new — this is configuration.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/schema.test.mjs`:

`readFileSync` and `resolve` are already imported at the top of this file. Add only the `yaml`
import, using the same default-import style as `tools/sdlc-lint/lib/load.mjs:3`:

```javascript
import YAML from "yaml";

const recipe = (p) => YAML.parse(readFileSync(resolve(REPO, p), "utf8"));
const healOf = (r, phase) => {
  const p = r.phases.find((x) => (typeof x === "string" ? x : x.name) === phase);
  return typeof p === "string" ? undefined : p?.heal;
};

test("code-writing phases in the core recipes are heal-guarded at 2 attempts", () => {
  for (const [file, phases] of [
    ["plugins/sdlc/workflows/default.yaml", ["development", "security", "qa"]],
    ["plugins/sdlc/workflows/bugfix.yaml", ["development", "security", "qa"]],
    ["plugins/sdlc/workflows/hotfix.yaml", ["development", "security", "qa"]],
    ["plugins/sdlc/workflows/refactor.yaml", ["development", "security", "qa"]],
    ["plugins/sdlc/workflows/debug.yaml", ["development", "qa"]],
    ["plugins/sdlc/workflows/testing.yaml", ["qa"]],
    ["plugins/sdlc/workflows/analysis.yaml", ["security"]],
  ]) {
    const r = recipe(file);
    for (const ph of phases) {
      assert.deepEqual(healOf(r, ph), { max_attempts: 2 }, `${file} phase ${ph}`);
    }
  }
});

test("docs-only declares no heal — documentation writes no compilable source", () => {
  const r = recipe("plugins/sdlc/workflows/docs-only.yaml");
  assert.equal(healOf(r, "documentation"), undefined);
});

test("android-feature guards development and qa", () => {
  const r = recipe("plugins/android-foundation/workflows/android-feature.yaml");
  for (const ph of ["development", "qa"]) {
    assert.deepEqual(healOf(r, ph), { max_attempts: 2 }, `android-feature phase ${ph}`);
  }
});

test("android-feature's parallel security is unguarded — parallel groups take strings only", () => {
  const r = recipe("plugins/android-foundation/workflows/android-feature.yaml");
  const group = r.phases.find((p) => p.parallel);
  assert.deepEqual(group.parallel, ["security", "test"]);
  assert.equal(healOf(r, "security"), undefined);
});

test("android heal_checks exclude unit tests", () => {
  const m = YAML.parse(readFileSync(resolve(REPO, "plugins/android-foundation/manifest.yaml"), "utf8"));
  assert.ok(Array.isArray(m.heal_checks) && m.heal_checks.length > 0);
  for (const c of m.heal_checks) {
    assert.doesNotMatch(c, /testDebugUnitTest/,
      "heal scope is compile+lint only — unit tests stay with the qa agent's own cap");
  }
});
```

Note: `security` and `qa` appear inside a `parallel:` group in `android-feature.yaml`. Handle that in
Step 4 before this test can pass — see the note there.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/schema.test.mjs`
Expected: FAIL — `healOf` returns `undefined` for every phase (all are bare strings today).

- [ ] **Step 3: Add `heal_checks` to the Android manifest**

In `plugins/android-foundation/manifest.yaml`, directly above the `post_pipeline_checks` block:

```yaml
# G1 self-healing: compile + lint ONLY. Deliberately a subset of post_pipeline_checks —
# testDebugUnitTest is excluded because a failing unit test is a logic problem that belongs
# to the qa agent's own 3-attempt cap, not to the mechanical heal loop.
heal_checks:
  - sh -c './gradlew compileDebugKotlin'
  - sh -c './gradlew detekt 2>/dev/null || ./gradlew ktlintCheck 2>/dev/null || true'
```

- [ ] **Step 4: Convert guarded phases to objects in every recipe**

Each guarded phase changes from a bare string to an object. For `plugins/sdlc/workflows/default.yaml`:

```yaml
name: default
description: Canonical 5-phase SDLC pipeline — business analysis through documentation.

phases:
  - business_analysis
  - name: development
    heal:
      max_attempts: 2
  - name: qa
    heal:
      max_attempts: 2
  - name: security
    heal:
      max_attempts: 2
  - documentation
```

Apply the same shape to `bugfix.yaml`, `hotfix.yaml`, `refactor.yaml` (all three guard
`development`, `qa`, `security`), `debug.yaml` (`development`, `qa`), `testing.yaml` (`qa` only),
and `analysis.yaml` (`security` only — it has no `development` phase, but its security agent still
fixes Critical/High directly). Leave `docs-only.yaml` untouched.

**`android-feature.yaml` needs a structural change.** Its `security` and `qa` sit inside a
`parallel:` group, whose schema branch accepts an array of **strings only** — so a heal block cannot
be attached there. `qa` is already a standalone phase, so only `security` is affected. Guard
`development` and `qa` directly, and leave the parallel group's `security` unguarded:

```yaml
phases:
  - business_analysis
  - name: development
    heal:
      max_attempts: 2
  - name: review
    loop:
      return_to: development
      max_rounds: 3
  - parallel: [security, test]
  - name: qa
    heal:
      max_attempts: 2
  - documentation
```

The two Step 1 tests covering `android-feature.yaml` already encode this — they expect `heal` on
`development` and `qa` only, and assert `security` inside the parallel group stays unguarded.

Extending the parallel branch to accept phase objects is a real follow-up, but it widens the schema
well beyond G1 and is deliberately out of scope — it is recorded in the spec's follow-ups.

- [ ] **Step 5: Document the merge semantics**

In `SKILL.md:243`, add `heal_checks` to the parsed-field list, immediately after
`post_pipeline_checks`.

In `SKILL.md:467` (the field list under 1a), after the `post_pipeline_checks` bullet:

```markdown
- `heal_checks`: shell commands the G1 self-healing loop runs after a guarded phase (compile/lint only).
```

In `SKILL.md:476` (merge rules), after the `post_pipeline_checks` union line:

```markdown
- `heal_checks`: union (de-duplicated, preserving order: PRIMARY first, stack profiles next, additive profiles last) — same rule as `post_pipeline_checks`.
```

In the `sdlc.local.yaml` override table at `SKILL.md:494`, add a row directly under
`post_pipeline_checks`:

```markdown
| `heal_checks` | array of strings | **REPLACES** plugin's value entirely (set to `[]` to disable the G1 self-healing loop project-wide without editing any recipe). |
```

In the example `sdlc.local.yaml` at `SKILL.md:536`, after the `post_pipeline_checks` block:

```yaml
heal_checks:                          # compile/lint only — never unit tests
  - ./gradlew compileDebugKotlin
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/schema.test.mjs`
Expected: PASS.

- [ ] **Step 7: Verify every recipe still validates and no cycles appeared**

Run: `node tools/sdlc-lint/cli.mjs all`
Expected: exit 0, including `"command":"schema"` and `"command":"cycles"` green.

- [ ] **Step 8: Run the full test suite**

Run: `node --test tools/sdlc-lint/test/*.test.mjs`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add plugins/sdlc/skills/pipeline-orchestrator/SKILL.md plugins/android-foundation/manifest.yaml plugins/sdlc/workflows plugins/android-foundation/workflows tools/sdlc-lint/test/schema.test.mjs
git commit -m "feat(config): heal_checks merge semantics and recipe rollout (G1)"
```

---

### Task 7: ADR and vault sync

Per `.claude/rules/second-brain.md` §3, this changes the orchestrator↔subagent contract and needs an ADR.

**Files:**
- Create: `.brain/decisions/ADR-0010-self-healing-micro-loop.md`
- Modify: `.brain/decisions/_moc-decisions.md`, `.brain/planning/roadmap.md`, `.brain/planning/backlog.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code-facing.

- [ ] **Step 1: Write the ADR**

Create `.brain/decisions/ADR-0010-self-healing-micro-loop.md` following the shape in
`.brain/_templates/adr.md` (frontmatter `adr`, `status`, `date`, then context / decision /
consequences). Content:

- **Context** — a mechanical build break costs a full follow-up run; `developer.md:49` forbids
  iterating, `post_pipeline_checks` run last and never iterate, and the existing `loop:` primitive is
  driven by an agent's prose verdict rather than an exit code.
- **Decision** — a `heal:` primitive keyed off a command exit code, at step `3e-heal`, capped at 2
  (schema ceiling 3), exhaustion records a blocker and continues.
- **Consequences** — heal dispatches drop `aspect_constraint`; worst case on a looped+guarded phase
  is 9 dispatches, folded into the cost preview; `heal_status` gives a binary per-run success metric,
  so unlike Track E this needs no `bench/` campaign. Reference implementing PR as plain text
  (e.g. `#77`), **not** a `[[changes/...]]` wikilink.

- [ ] **Step 2: Register it in the decisions MOC**

Add the ADR-0010 row to `.brain/decisions/_moc-decisions.md`, matching the existing row format.

- [ ] **Step 3: Update roadmap and backlog**

In `.brain/planning/roadmap.md`, change the G1 row's status from `planned` to `done` with the PR
number, and update the "Highest-ROI next steps" paragraph so only E8 remains listed.

In `.brain/planning/backlog.md`, mark the Track G "G1" section done and link
`[[decisions/ADR-0010-self-healing-micro-loop]]`.

- [ ] **Step 4: Verify vault structure and links**

Run: `node tools/brain-sync/cli.mjs check --vault .brain`
Expected: clean — no broken wikilinks, no structural errors.

- [ ] **Step 5: Commit**

```bash
git add .brain/decisions/ADR-0010-self-healing-micro-loop.md .brain/decisions/_moc-decisions.md .brain/planning/roadmap.md .brain/planning/backlog.md
git commit -m "docs(brain): ADR-0010 self-healing micro-loop, roadmap G1 done"
```

---

## Verification

After all tasks:

- [ ] `node --test tools/sdlc-lint/test/*.test.mjs` — all pass
- [ ] `node tools/sdlc-lint/cli.mjs all` — exit 0
- [ ] `node tools/sdlc-lint/cli.mjs read-discipline` — 19/19 clean
- [ ] `node tools/brain-sync/cli.mjs check --vault .brain` — clean
- [ ] A recipe with no `heal:` block produces a byte-identical prompt to `develop` (diff the assembled stable prefix for `docs-only.yaml`)

**Seeded end-to-end validation** (manual, on a real Android project — not `bench/`):

1. Introduce a known compile error (an unresolved reference) mid-phase; run the pipeline. Assert the
   checkpoint shows `heal_status: "healed"`, `heal_attempts_used: 1`, and that the Step 4 post-check
   passes.
2. Introduce a failure that compiler output alone cannot fix. Assert `heal_status: "exhausted"`, a
   recorded blocker, and that **the pipeline continued** to the following phase.
