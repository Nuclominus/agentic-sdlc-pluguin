# H6 — Hook as the Deterministic Tail: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Stop` hook seals an SDLC run the orchestrator finished but did not seal, so the run tail stops being a step the model can silently skip.

**Architecture:** The hook contributes no procedure of its own. A new shipped module `seal.mjs` decides *which* runs are sealable (telemetry exists, no `_sealed` marker, every phase in the resolved DAG terminal) and delegates *how* to the existing `finishRun`, which is already fail-open per stage. The completeness rule moves out of the repo-root dev tool into the plugin, because the hook runs on a consumer's machine through `${CLAUDE_PLUGIN_ROOT}`.

**Tech Stack:** Node ≥18 ESM, node builtins only (no dependencies in shipped code), `node:test` for tests, Bash for the hook script, Claude Code plugin `hooks/hooks.json`.

**Spec:** `.brain/planning/h6-hook-deterministic-tail.md`

## Global Constraints

- **Shipped code is dependency-free.** Everything under `plugins/sdlc/tools/` imports node builtins and sibling plugin modules only. Never import from `tools/sdlc-lint/`.
- **Shipped code is reached via `${CLAUDE_PLUGIN_ROOT}`, never a repo-root path.** Repo-root `tools/sdlc-lint/lib/*.mjs` files that mirror shipped modules are one-line re-export shims so the test-suite exercises exactly what ships (existing examples: `lib/run.mjs`, `lib/usage.mjs`).
- **The hook exits 0 unconditionally.** For `Stop`, exit code 2 blocks the agent from stopping and feeds stderr back as an instruction. No `set -e`; every external call guarded.
- **Machine values are machine-owned.** Any new telemetry key a tool writes must be added to the ` ```machine-values ` registry in `plugins/sdlc/MACHINE-VALUES.md`, and shipped prose must never show that key on the left-hand side of a computation (`sdlc-lint machine-values` fails on it).
- **Every `.brain/` content note must be listed in some `_moc-*` index in the same commit.** `node tools/brain-sync/cli.mjs check --vault .brain` must print `check: clean`.
- **Full test command:** `node --test tools/sdlc-lint/test/*.test.mjs` (the trailing-slash directory form does not auto-discover on Node 22).
- **Lint command:** `node tools/sdlc-lint/cli.mjs all --json`.
- **Commit trailers** on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
  ```
- **Staging:** stage explicit paths (`git add <path> …`). Never `git add -A` — the user edits files concurrently.

## File Structure

| File | Responsibility |
|---|---|
| `plugins/sdlc/tools/run/reentry.mjs` | **create (move)** — the completeness rule: `loadCheckpoints`, `computeReentry`, `resolveWorkspace`. Moved verbatim from `tools/sdlc-lint/lib/resume.mjs`. |
| `tools/sdlc-lint/lib/resume.mjs` | **replace** — becomes a re-export shim over the plugin module. |
| `plugins/sdlc/tools/run/clock.mjs` | **modify** — export the existing private `isoSeconds` so `finish.mjs` stops at one timestamp formatter. |
| `plugins/sdlc/tools/run/finish.mjs` | **modify** — accept `opts.sealedBy`; write `sealed_by` into telemetry and `.checkpoint/_sealed`, last. |
| `plugins/sdlc/tools/run/seal.mjs` | **create** — `findSealable` (which runs, and when) and `sealStale` (seal them all). |
| `plugins/sdlc/tools/run/cli.mjs` | **modify** — new `seal-stale` verb. |
| `plugins/sdlc/hooks/seal-run.sh` | **create** — the `Stop` hook: cheap guards, one node call, `systemMessage`. |
| `plugins/sdlc/hooks/hooks.json` | **modify** — register the `Stop` event. |
| `plugins/sdlc/MACHINE-VALUES.md` | **modify** — register `sealed_by`. |
| `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` | **modify** — one short Step 5b paragraph: the net exists, and it is not a substitute. |
| `tools/sdlc-lint/test/seal.test.mjs` | **create** — gate, clock, staleness, fail-open, hook end-to-end. |
| `tools/sdlc-lint/test/run.test.mjs` | **modify** — `sealed_by` and the marker round-trip through `finishRun`. |
| `.brain/decisions/ADR-0017-the-tail-has-a-net.md` | **create** — the decision. |
| `.brain/decisions/_moc-decisions.md` | **modify** — index the ADR (same commit). |
| `.brain/planning/h-instruction-fidelity.md` | **modify** — mark H6 shipped, record measurements. |

---

### Task 1: Move the completeness rule into the plugin

The Stop hook must evaluate "are all phases done?" on a consumer's machine. That rule lives in `tools/sdlc-lint/lib/resume.mjs`, which is a repo-root dev tool and does not ship. Move it; leave a shim. `resume.test.mjs` and its eight fixtures are the regression net and must stay green untouched.

**Files:**
- Create: `plugins/sdlc/tools/run/reentry.mjs`
- Modify: `tools/sdlc-lint/lib/resume.mjs` (whole file → shim)
- Test: `tools/sdlc-lint/test/seal.test.mjs` (new file, first test)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `plugins/sdlc/tools/run/reentry.mjs` exporting
  - `loadCheckpoints(checkpointDir) → { units: Map<string, {status: string}>, warnings: string[] }`
  - `computeReentry(resolvedPhases, units) → { completed: string[], reenter_at: string|null, remaining: string[] }`
  - `resolveWorkspace(workspaceDir) → { completed, reenter_at, remaining, warnings }`, **throws** when `.checkpoint/_run.json` is absent or has no `resolved_phases` array.

- [ ] **Step 1: Write the failing test**

Create `tools/sdlc-lint/test/seal.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { resolveWorkspace } from "../../../plugins/sdlc/tools/run/reentry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");

test("the completeness rule ships inside the plugin, where the Stop hook can reach it", () => {
  const dir = mkdtempSync(join(tmpdir(), "reentry-"));
  const cp = join(dir, ".checkpoint");
  mkdirSync(cp, { recursive: true });
  writeFileSync(join(cp, "_run.json"),
    JSON.stringify({ resolved_phases: [{ name: "development" }, { name: "qa" }] }));
  writeFileSync(join(cp, "development.json"), JSON.stringify({ status: "completed" }));

  assert.equal(resolveWorkspace(dir).reenter_at, "qa");

  writeFileSync(join(cp, "qa.json"), JSON.stringify({ status: "completed" }));
  assert.equal(resolveWorkspace(dir).reenter_at, null,
    "a run whose every resolved phase is terminal is what the seal gate calls complete");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/sdlc-lint/test/seal.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND: Cannot find module .../plugins/sdlc/tools/run/reentry.mjs`

- [ ] **Step 3: Create the plugin module**

This is a **verbatim** move. The eight `resume-*` fixtures pin the behaviour, and any edit here is a behaviour change disguised as a move — so build the new file mechanically rather than retyping it. `tools/sdlc-lint/lib/resume.mjs` currently begins directly with its `import` line (no header), so prepending the header and appending the whole file is exactly right:

```bash
{ cat <<'HEADER'
// Where a run has got to: which units are terminal, and which phase it would re-enter at.
// Shipped inside the sdlc plugin; node builtins only.
//
// This module ships (rather than living in the repo-root dev tool, where it started)
// because the H6 `Stop` hook evaluates the same rule on a consumer's machine through
// ${CLAUDE_PLUGIN_ROOT} to decide whether a run is finished enough to seal. Re-deriving
// a simplified copy there would put the procedure in two places — the drift H1's spec
// was written to avoid. `--resume` and the seal gate now share one definition of "done".
HEADER
  cat tools/sdlc-lint/lib/resume.mjs
} > plugins/sdlc/tools/run/reentry.mjs
```

Confirm the move carried every symbol — `unitId`, `loadCheckpoints`, `DONE`, `isDone`, `plainDone`, `phaseDone`, `completedUnits`, `computeReentry`, `resolveWorkspace`:

```bash
grep -c "^function\|^const\|^export function" plugins/sdlc/tools/run/reentry.mjs
```

Expected: `9`

- [ ] **Step 4: Replace the repo-root file with a shim**

Replace the **whole** contents of `tools/sdlc-lint/lib/resume.mjs` with:

```js
// Dev/CI re-export shim. The canonical, dependency-free implementation is SHIPPED
// with the sdlc plugin at plugins/sdlc/tools/run/reentry.mjs (so marketplace consumers
// get it via ${CLAUDE_PLUGIN_ROOT} — the H6 Stop hook evaluates the same completeness
// rule). This file keeps the resume test-suite pointed at that single source of truth,
// so it exercises the exact code that ships.
export { loadCheckpoints, computeReentry, resolveWorkspace }
  from "../../../plugins/sdlc/tools/run/reentry.mjs";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/seal.test.mjs tools/sdlc-lint/test/resume.test.mjs tools/sdlc-lint/test/all.test.mjs`
Expected: PASS — including all eight `resume-*` fixtures and `all.test.mjs`'s `resume` assertions, which now travel through the shim.

- [ ] **Step 6: Verify the lint still passes**

Run: `node tools/sdlc-lint/cli.mjs all --json`
Expected: output contains `"command":"all","ok":true`

- [ ] **Step 7: Commit**

```bash
git add plugins/sdlc/tools/run/reentry.mjs tools/sdlc-lint/lib/resume.mjs tools/sdlc-lint/test/seal.test.mjs
git commit -F - <<'EOF'
refactor(sdlc): ship the completeness rule with the plugin

The H6 Stop hook decides whether a run is finished by asking whether every
phase in the resolved DAG carries a terminal checkpoint. That rule lived in
the repo-root sdlc-lint, which does not ship, while the hook runs on a
consumer's machine through CLAUDE_PLUGIN_ROOT.

Moved verbatim to plugins/sdlc/tools/run/reentry.mjs; lib/resume.mjs becomes
a re-export shim, the pattern lib/run.mjs and lib/usage.mjs already follow.
The eight resume-* fixtures pin the behaviour and stay green, so --resume and
the seal gate share one definition of "done" instead of two that can drift.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
```

---

### Task 2: `finish` records who sealed the run

The marker is what makes the hook idempotent, and it must be written by *both* paths — otherwise a hand-sealed run has no marker and the hook re-seals it, which `clock.mjs` prices at real money (ADR-0014 measured $12.81 → $13.71 on one re-seal).

**Files:**
- Modify: `plugins/sdlc/tools/run/clock.mjs` (export `isoSeconds`)
- Modify: `plugins/sdlc/tools/run/finish.mjs`
- Modify: `plugins/sdlc/MACHINE-VALUES.md`
- Test: `tools/sdlc-lint/test/run.test.mjs`

**Interfaces:**
- Consumes: `sealRunClock(runDir, {now})`, `finishRun(runDir, opts)` — both already exist.
- Produces:
  - `isoSeconds(ms: number) → string` exported from `clock.mjs` (`YYYY-MM-DDTHH:MM:SSZ`, no milliseconds).
  - `finishRun(runDir, opts)` accepts `opts.sealedBy?: "orchestrator" | "stop-hook"` (default `"orchestrator"`) and returns an extra field `sealed: { by: string, at: string } | null`.
  - Side effects: `_telemetry.json` gains `sealed_by`; `<runDir>/.checkpoint/_sealed` is written as `{ sealed_at, by, wall_clock_seconds }`.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/run.test.mjs`:

```js
test("finishRun marks the run sealed, defaulting to the orchestrator", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = finishRun(dir, { now: (ANCHOR + 60) * 1000, noReport: true,
    enrich: () => ({ skipped_all: true }) });

  assert.equal(r.sealed.by, "orchestrator");
  assert.equal(r.sealed.at, "2026-07-28T11:01:00Z");
  assert.equal(tel(dir).sealed_by, "orchestrator");

  const marker = JSON.parse(readFileSync(join(dir, ".checkpoint", "_sealed"), "utf8"));
  assert.equal(marker.by, "orchestrator");
  assert.equal(marker.sealed_at, "2026-07-28T11:01:00Z");
  assert.equal(marker.wall_clock_seconds, 60);
});

test("finishRun attributes the seal to the hook when the hook is the caller", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  const r = finishRun(dir, { now: (ANCHOR + 60) * 1000, noReport: true, sealedBy: "stop-hook",
    enrich: () => ({ skipped_all: true }) });

  assert.equal(r.sealed.by, "stop-hook");
  assert.equal(tel(dir).sealed_by, "stop-hook");
  assert.equal(JSON.parse(readFileSync(join(dir, ".checkpoint", "_sealed"), "utf8")).by, "stop-hook");
});

test("the seal marker is written AFTER enrich, which rewrites the whole telemetry file", () => {
  const dir = makeRun({ task_slug: "x", phases: [] }, ANCHOR);
  // A realistic enricher: it re-reads and rewrites _telemetry.json wholesale. If the
  // marker were written before this, enrich would erase sealed_by and the hook would
  // re-seal a sealed run — the failure ADR-0014 priced at $12.81 -> $13.71.
  finishRun(dir, { now: (ANCHOR + 60) * 1000, noReport: true, enrich: (d) => {
    const p = join(d, "_telemetry.json");
    const t = JSON.parse(readFileSync(p, "utf8"));
    writeFileSync(p, JSON.stringify({ ...t, cost_basis: "transcript" }, null, 2) + "\n");
    return { total_cost_usd: 1.23 };
  } });

  const t = tel(dir);
  assert.equal(t.cost_basis, "transcript", "enrich's own write must survive");
  assert.equal(t.sealed_by, "orchestrator", "sealed_by must survive enrich's rewrite");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/run.test.mjs`
Expected: FAIL — `Cannot read properties of null (reading 'by')` on `r.sealed.by` (the field does not exist yet).

- [ ] **Step 3: Export the timestamp formatter from `clock.mjs`**

In `plugins/sdlc/tools/run/clock.mjs`, change the declaration of `isoSeconds` (currently a private function) to an export, leaving the body and the comment above it untouched:

```js
export function isoSeconds(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
```

- [ ] **Step 4: Write the seal into `finish.mjs`**

In `plugins/sdlc/tools/run/finish.mjs`, widen the imports:

```js
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sealRunClock, isoSeconds } from "./clock.mjs";
```

Extend the JSDoc block with one line, next to the other options:

```js
 * @param {"orchestrator"|"stop-hook"} [opts.sealedBy]  who is sealing; default "orchestrator"
```

Then insert this stage between the report stage and the `return`, and add `sealed` to the returned object:

```js
  // 4. The seal marker — LAST, and after enrich, which rewrites the whole telemetry
  //    file. Writing it earlier would let enrich erase `sealed_by`, and a run that
  //    reads as unsealed gets sealed twice: `wall_clock_seconds` is `now - anchor`, so
  //    the second pass inflates the duration and, through the overhead window, the cost
  //    (ADR-0014 measured 3522s -> 11144s, $12.81 -> $13.71 on a real run).
  //    Writing it last is also why an interrupted seal is safe: no marker, so retryable.
  const sealedBy = opts.sealedBy || "orchestrator";
  const sealedAt = isoSeconds(Number.isFinite(opts.now) ? opts.now : Date.now());
  let sealed = null;
  try {
    const tel = JSON.parse(readFileSync(telPath, "utf8"));
    tel.sealed_by = sealedBy;
    writeFileSync(telPath, JSON.stringify(tel, null, 2) + "\n");
    mkdirSync(join(runDir, ".checkpoint"), { recursive: true });
    writeFileSync(join(runDir, ".checkpoint", "_sealed"),
      JSON.stringify({ sealed_at: sealedAt, by: sealedBy,
        wall_clock_seconds: clock.wall_clock_seconds ?? null }, null, 2) + "\n");
    sealed = { by: sealedBy, at: sealedAt };
  } catch (e) {
    warnings.push(`WARN: could not record the seal marker — ${e.message}; ` +
      "this run may be sealed a second time and its duration inflated");
  }

  return { runDir, telPath, clock, enrich, report, sealed, warnings };
```

Delete the old `return { runDir, telPath, clock, enrich, report, warnings };` line it replaces.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/run.test.mjs`
Expected: PASS (all tests, including the pre-existing ones)

- [ ] **Step 6: Register `sealed_by` as machine-owned**

In `plugins/sdlc/MACHINE-VALUES.md`, add one line at the end of the ` ```machine-values ` fenced registry, after `wall_clock_seconds`:

```
sealed_by: tools/run/cli.mjs finish
```

A bare registry line is not enough — the document doubles as the audit. Add this row to the end of the audit table, the one headed `| value | site | disposition |`:

```
| `sealed_by` | — | **new in H6** — records which path sealed the run (orchestrator or `Stop` hook); the model must never write it, since the whole point is that it says who did |
```

- [ ] **Step 7: Verify the machine-values lint accepts the addition**

Run: `node tools/sdlc-lint/cli.mjs machine-values --json`
Expected: output contains `"ok":true`. If it reports a violation in `SKILL.md`, that means the file already shows `sealed_by` as the subject of a computation — it does not yet, so a failure here means a typo in the registry line.

- [ ] **Step 8: Run the full suite**

Run: `node --test tools/sdlc-lint/test/*.test.mjs`
Expected: PASS, 0 failing

- [ ] **Step 9: Commit**

```bash
git add plugins/sdlc/tools/run/clock.mjs plugins/sdlc/tools/run/finish.mjs plugins/sdlc/MACHINE-VALUES.md tools/sdlc-lint/test/run.test.mjs
git commit -F - <<'EOF'
feat(sdlc): finish records who sealed the run

Adds .checkpoint/_sealed and telemetry's sealed_by, written by finish on both
paths — by hand and, from the next commit, by the Stop hook. The marker is
what makes re-sealing detectable: wall_clock_seconds is now - anchor, so a
second pass inflates the duration and drags the overhead cost with it
(ADR-0014 measured 3522s -> 11144s, $12.81 -> $13.71 on a real run).

Written last, after enrich, because enrich rewrites the whole telemetry file
and would otherwise erase sealed_by. Writing it last also makes an interrupted
seal safe: no marker, so the run stays retryable.

sealed_by joins the MACHINE-VALUES registry — the key exists to say who sealed
the run, so a model that could write it would defeat its only purpose.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
```

---

### Task 3: `seal.mjs` — which runs are sealable, and when

**Files:**
- Create: `plugins/sdlc/tools/run/seal.mjs`
- Test: `tools/sdlc-lint/test/seal.test.mjs`

**Interfaces:**
- Consumes: `resolveWorkspace` (Task 1), `finishRun(runDir, {now, sealedBy, noReport, registryPath, projectsRoot})` (Task 2).
- Produces:
  - `findSealable(plansRoot: string, opts?: {now?: number, maxAgeMs?: number}) → { sealable: Array<{run: string, runDir: string, lastActivityMs: number}>, skipped: Array<{run: string, reason: "sealed"|"unprovable"|"incomplete"|"stale", reenter_at?: string}> }`
  - `sealStale(plansRoot: string, opts?: {now?, maxAgeMs?, noReport?, registryPath?, transcriptsRoot?, finish?}) → { sealed: Array<{run, runDir, warnings: string[], wall_clock_seconds: number|null, total_cost_usd: number|null}>, skipped, failed: Array<{run, error}> }`
  - `DEFAULT_MAX_AGE_MS: number` (24 hours in ms)

  Note the parameter is `plansRoot` (a `docs/plans` directory), deliberately **not** named `projectsRoot` — `finishRun` already has an `opts.projectsRoot` meaning the *transcripts* root, and the two must not be confused. `sealStale` forwards its `transcriptsRoot` to that option.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/seal.test.mjs` (the file created in Task 1). Add these imports at the top, merging with what is already there:

```js
import { readFileSync, readdirSync, utimesSync, existsSync } from "node:fs";
import { findSealable, sealStale } from "../../../plugins/sdlc/tools/run/seal.mjs";
```

Then the helper and tests:

```js
// 2026-07-28T11:00:00Z. Verified: node -e 'console.log(new Date(1785236400000).toISOString())'
const ANCHOR = 1785236400;
const ANCHOR_MS = ANCHOR * 1000;

// A docs/plans-shaped root holding one run. `phases` is the resolved DAG, `done` the
// unit ids with a terminal checkpoint, `activityMs` the mtime stamped on every file.
function makePlans({ slug = "r", phases = ["development", "qa"], done = ["development", "qa"],
                     runJson = true, sealed = false, activityMs = (ANCHOR + 600) * 1000 } = {}) {
  const plansRoot = mkdtempSync(join(tmpdir(), "plans-"));
  const runDir = join(plansRoot, slug);
  const cp = join(runDir, ".checkpoint");
  mkdirSync(cp, { recursive: true });
  writeFileSync(join(runDir, "_telemetry.json"),
    JSON.stringify({ task_slug: slug, phases: [] }, null, 2) + "\n");
  writeFileSync(join(cp, "_started_at"), `${ANCHOR}\n`);
  if (runJson) {
    // A phase may be given as a bare name or as a full resolved entry (aspects, parallel
    // members) — the realistic-shape test below needs the latter.
    writeFileSync(join(cp, "_run.json"), JSON.stringify({
      resolved_phases: phases.map(p => (typeof p === "string" ? { name: p } : p)),
    }, null, 2) + "\n");
  }
  for (const u of done) writeFileSync(join(cp, `${u}.json`), JSON.stringify({ status: "completed" }));
  if (sealed) writeFileSync(join(cp, "_sealed"), JSON.stringify({ by: "orchestrator" }));

  const secs = activityMs / 1000;
  utimesSync(join(runDir, "_telemetry.json"), secs, secs);
  for (const f of readdirSync(cp)) utimesSync(join(cp, f), secs, secs);
  return { plansRoot, runDir, slug };
}

const NOW = (ANCHOR + 900) * 1000;   // 5 min after the fixture's last activity

test("a complete, unsealed, recent run is sealable", () => {
  const { plansRoot } = makePlans();
  const { sealable, skipped } = findSealable(plansRoot, { now: NOW });
  assert.equal(sealable.length, 1);
  assert.equal(sealable[0].run, "r");
  assert.equal(sealable[0].lastActivityMs, (ANCHOR + 600) * 1000);
  assert.deepEqual(skipped, []);
});

test("the marker gates a second seal", () => {
  const { plansRoot } = makePlans({ sealed: true });
  const { sealable, skipped } = findSealable(plansRoot, { now: NOW });
  assert.deepEqual(sealable, []);
  assert.equal(skipped[0].reason, "sealed");
});

test("an incomplete run is left alone, and says which phase it would re-enter at", () => {
  const { plansRoot } = makePlans({ done: ["development"] });
  const { sealable, skipped } = findSealable(plansRoot, { now: NOW });
  assert.deepEqual(sealable, []);
  assert.equal(skipped[0].reason, "incomplete");
  assert.equal(skipped[0].reenter_at, "qa");
});

test("a run with no _run.json is unprovable, not sealable, and does not throw", () => {
  const { plansRoot } = makePlans({ runJson: false });
  const { sealable, skipped } = findSealable(plansRoot, { now: NOW });
  assert.deepEqual(sealable, []);
  assert.equal(skipped[0].reason, "unprovable",
    "completeness that cannot be proven is not assumed — the gate fails closed");
});

test("a complete but long-abandoned run falls outside the age window", () => {
  const { plansRoot } = makePlans();
  const { sealable, skipped } = findSealable(plansRoot, { now: NOW + 48 * 3600 * 1000 });
  assert.deepEqual(sealable, []);
  assert.equal(skipped[0].reason, "stale");
});

test("a missing plans root is a silent no-op, not a throw", () => {
  const { sealable, skipped } = findSealable(join(tmpdir(), "does-not-exist-h6"), { now: NOW });
  assert.deepEqual(sealable, []);
  assert.deepEqual(skipped, []);
});

test("the clock comes from the run's last activity, never from the wall clock", () => {
  const { plansRoot } = makePlans();
  let seen = null;
  sealStale(plansRoot, { now: NOW, finish: (dir, o) => { seen = o; return { warnings: [] }; } });
  assert.equal(seen.now, (ANCHOR + 600) * 1000,
    "passing the real now would charge the run for every minute the user spent chatting " +
    "afterwards — ADR-0014 priced that at 3522s -> 11144s, $12.81 -> $13.71");
  assert.equal(seen.sealedBy, "stop-hook");
});

test("end to end: the run is sealed, and its duration is anchor-to-last-activity", () => {
  const { plansRoot, runDir } = makePlans();
  const r = sealStale(plansRoot, { now: NOW, noReport: true });
  assert.equal(r.sealed.length, 1);
  const t = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  assert.equal(t.wall_clock_seconds, 600);
  assert.equal(t.started_at, "2026-07-28T11:00:00Z");
  assert.equal(t.completed_at, "2026-07-28T11:10:00Z");
  assert.equal(t.sealed_by, "stop-hook");
  assert.ok(existsSync(join(runDir, ".checkpoint", "_sealed")));

  // Idempotent from here on: the marker it just wrote closes the gate.
  assert.deepEqual(findSealable(plansRoot, { now: NOW }).sealable, []);
});

// The known-positive. H1's plan made this a hard stop, and it caught two instrument
// defects before they were published as findings. The shape below is a real pipeline —
// an aspect-aware development phase and a parallel group — which is where a gate that
// only understood flat phases would wrongly report complete.
const PIPELINE = [
  { name: "business-analysis" },
  { name: "development", aspects: ["ui", "data"] },
  { name: "review" },
  { name: "parallel:security+test", kind: "parallel", members: [{ name: "security" }, { name: "test" }] },
  { name: "qa" },
  { name: "documentation" },
];
const PIPELINE_UNITS = ["business-analysis", "development-ui", "development-data",
  "review", "security", "test", "qa", "documentation"];

test("the gate opens for a full real pipeline shape — aspects and a parallel group", () => {
  const { plansRoot } = makePlans({ phases: PIPELINE, done: PIPELINE_UNITS });
  const { sealable } = findSealable(plansRoot, { now: NOW });
  assert.equal(sealable.length, 1,
    "this is the ADR-0012 incident run's shape: eight terminal units across an " +
    "aspect-aware phase and a parallel group. A hook that does not seal this has " +
    "failed at the only case it was built for");
});

test("the gate shuts when one aspect of an aspect-aware phase is missing", () => {
  const { plansRoot } = makePlans({
    phases: PIPELINE,
    done: PIPELINE_UNITS.filter(u => u !== "development-data"),
  });
  const { sealable, skipped } = findSealable(plansRoot, { now: NOW });
  assert.deepEqual(sealable, [],
    "one unfinished aspect means the phase is unfinished — a gate that counted phases " +
    "rather than units would seal a run mid-development");
  assert.equal(skipped[0].reenter_at, "development");
});

test("one failing run does not abort the others", () => {
  const { plansRoot } = makePlans({ slug: "a" });
  // A second run in the same plans root — /sdlc:batch can leave more than one unsealed.
  const b = join(plansRoot, "b");
  mkdirSync(join(b, ".checkpoint"), { recursive: true });
  writeFileSync(join(b, "_telemetry.json"), JSON.stringify({ task_slug: "b", phases: [] }));
  writeFileSync(join(b, ".checkpoint", "_started_at"), `${ANCHOR}\n`);
  writeFileSync(join(b, ".checkpoint", "_run.json"),
    JSON.stringify({ resolved_phases: [{ name: "development" }] }));
  writeFileSync(join(b, ".checkpoint", "development.json"), JSON.stringify({ status: "completed" }));
  const secs = ((ANCHOR + 600) * 1000) / 1000;
  for (const f of readdirSync(join(b, ".checkpoint"))) utimesSync(join(b, ".checkpoint", f), secs, secs);
  utimesSync(join(b, "_telemetry.json"), secs, secs);

  const r = sealStale(plansRoot, { now: NOW, finish: (dir) => {
    if (dir.endsWith("a")) throw new Error("boom");
    return { warnings: [] };
  } });
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].run, "a");
  assert.equal(r.sealed.length, 1);
  assert.equal(r.sealed[0].run, "b");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/seal.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND: Cannot find module .../plugins/sdlc/tools/run/seal.mjs`

- [ ] **Step 3: Write `seal.mjs`**

Create `plugins/sdlc/tools/run/seal.mjs`:

```js
// Which finished runs still need sealing. The only unit that knows what makes a run
// sealable; it decides WHICH and WHEN and delegates HOW to finishRun, which is already
// fail-open per stage. Shipped inside the sdlc plugin; node builtins plus two siblings.
//
// The gate is completeness, not recency: recency cannot tell a paused run from a
// finished one. Measured over the 19-run downstream corpus, this gate opens for 10
// runs — including the ADR-0012 incident run, the case the hook exists for — and stays
// shut for the three H1 named as carrying most of the compliance damage.
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspace } from "./reentry.mjs";
import { finishRun } from "./finish.mjs";

export const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Newest mtime across the telemetry and every checkpoint: when the run last did anything. */
function lastActivity(runDir) {
  let newest = 0;
  const bump = (p) => { try { newest = Math.max(newest, statSync(p).mtimeMs); } catch { /* gone */ } };
  bump(join(runDir, "_telemetry.json"));
  const cp = join(runDir, ".checkpoint");
  try { for (const f of readdirSync(cp)) bump(join(cp, f)); } catch { /* no checkpoints */ }
  return newest;
}

/**
 * Partition a docs/plans root into runs the hook may seal and runs it must not.
 *
 * @param {string} plansRoot  a docs/plans directory (NOT finishRun's transcripts root)
 * @param {object} [opts]
 * @param {number} [opts.now]        epoch ms; injected by tests
 * @param {number} [opts.maxAgeMs]   age window, measured from the run's last activity
 *
 * Every rejection is recorded with a reason rather than dropped, so `seal-stale --json`
 * can say why it did nothing — a net that is silent about not firing is indistinguishable
 * from a net that is broken.
 */
export function findSealable(plansRoot, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : DEFAULT_MAX_AGE_MS;
  const sealable = [];
  const skipped = [];

  let entries;
  try { entries = readdirSync(plansRoot, { withFileTypes: true }); }
  catch { return { sealable, skipped }; }   // no docs/plans here: not this project's concern

  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith("_")) continue;
    const runDir = join(plansRoot, e.name);

    // 1. Something to seal at all.
    if (!existsSync(join(runDir, "_telemetry.json"))) continue;

    // 2. Idempotency gate.
    if (existsSync(join(runDir, ".checkpoint", "_sealed"))) {
      skipped.push({ run: e.name, reason: "sealed" });
      continue;
    }

    // 3. Completeness gate. A throw means the run cannot prove it finished (no
    //    _run.json, or an unreadable one) — fail closed, and never propagate.
    let reenterAt;
    try { reenterAt = resolveWorkspace(runDir).reenter_at; }
    catch { skipped.push({ run: e.name, reason: "unprovable" }); continue; }
    if (reenterAt !== null) {
      skipped.push({ run: e.name, reason: "incomplete", reenter_at: reenterAt });
      continue;
    }

    // 4. Blast radius, not correctness — the gate and the mtime clock already hold
    //    correctness. A run this old has usually lost the transcripts enrich needs.
    const lastActivityMs = lastActivity(runDir);
    if (now - lastActivityMs > maxAgeMs) {
      skipped.push({ run: e.name, reason: "stale" });
      continue;
    }

    sealable.push({ run: e.name, runDir, lastActivityMs });
  }
  return { sealable, skipped };
}

/**
 * Seal every run the gate admits.
 *
 * All of them, not just the newest: /sdlc:batch can leave more than one run unsealed in
 * a project, each is independently gated, and a failure on one must not skip the rest.
 *
 * @param {string} plansRoot
 * @param {object} [opts]
 * @param {number}  [opts.now]
 * @param {number}  [opts.maxAgeMs]
 * @param {boolean} [opts.noReport]
 * @param {string}  [opts.registryPath]     models.json override
 * @param {string}  [opts.transcriptsRoot]  forwarded as finishRun's `projectsRoot`
 * @param {Function}[opts.finish]           TEST SEAM — replaces finishRun
 */
export function sealStale(plansRoot, opts = {}) {
  const { sealable, skipped } = findSealable(plansRoot, opts);
  const finish = opts.finish || finishRun;
  const sealed = [];
  const failed = [];

  for (const c of sealable) {
    try {
      // `now` is the run's last activity, never the wall clock: sealRunClock computes
      // wall_clock_seconds as now - anchor, so a late hook using the real clock would
      // charge the run for the time that passed after it finished.
      const r = finish(c.runDir, {
        now: c.lastActivityMs,
        sealedBy: "stop-hook",
        noReport: opts.noReport,
        registryPath: opts.registryPath,
        projectsRoot: opts.transcriptsRoot,
      });
      sealed.push({
        run: c.run,
        runDir: c.runDir,
        warnings: r?.warnings ?? [],
        wall_clock_seconds: r?.clock?.wall_clock_seconds ?? null,
        total_cost_usd: r?.enrich?.total_cost_usd ?? null,
      });
    } catch (e) {
      failed.push({ run: c.run, error: e.message });
    }
  }
  return { sealed, skipped, failed };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/seal.test.mjs`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add plugins/sdlc/tools/run/seal.mjs tools/sdlc-lint/test/seal.test.mjs
git commit -F - <<'EOF'
feat(sdlc): seal.mjs decides which finished runs still need sealing

The gate is completeness — every phase in the resolved DAG carries a terminal
checkpoint — not recency, because recency cannot tell a paused run from a
finished one. Over the 19-run downstream corpus it opens for 10 runs including
the ADR-0012 incident run, and stays shut for the three H1 named as carrying
most of the compliance damage.

The clock comes from the run's newest mtime, not Date.now(): sealing is late by
construction, and now - anchor would bill the run for the time the user spent
chatting afterwards. A run that cannot prove it finished (no _run.json) is not
sealed — the gate fails closed — and every rejection carries a reason, because
a net that is silent about not firing looks exactly like a broken one.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
```

---

### Task 4: The `seal-stale` CLI verb

**Files:**
- Modify: `plugins/sdlc/tools/run/cli.mjs`
- Test: `tools/sdlc-lint/test/seal.test.mjs`

**Interfaces:**
- Consumes: `sealStale` (Task 3).
- Produces: `node plugins/sdlc/tools/run/cli.mjs seal-stale [--max-age-hours <n>] [--plans-root <dir>] [--registry <models.json>] [--no-report] [--json]`, exit 0 on success. With `--json`, one line on stdout: `{"command":"seal-stale","ok":true,"sealed":[…],"skipped":[…],"failed":[…]}`.

- [ ] **Step 1: Write the failing test**

Append to `tools/sdlc-lint/test/seal.test.mjs`. Add `import { spawnSync } from "node:child_process";` to the imports at the top.

```js
const RUN_CLI = resolve(REPO, "plugins/sdlc/tools/run/cli.mjs");

test("`seal-stale --json` seals from the CLI and reports what it did", () => {
  const { plansRoot, runDir } = makePlans();
  const r = spawnSync("node", [RUN_CLI, "seal-stale", "--plans-root", plansRoot,
    "--no-report", "--json"], { encoding: "utf8" });

  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.equal(out.command, "seal-stale");
  assert.equal(out.ok, true);
  assert.equal(out.sealed.length, 1);
  assert.equal(out.sealed[0].run, "r");
  assert.equal(JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8")).sealed_by, "stop-hook");
});

test("`seal-stale --json` on a plans root with nothing to do exits 0 and seals nothing", () => {
  const { plansRoot } = makePlans({ sealed: true });
  const r = spawnSync("node", [RUN_CLI, "seal-stale", "--plans-root", plansRoot, "--json"],
    { encoding: "utf8" });

  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  assert.deepEqual(out.sealed, []);
  assert.equal(out.skipped[0].reason, "sealed");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/sdlc-lint/test/seal.test.mjs`
Expected: FAIL — the CLI prints the usage line and exits 2, so `assert.equal(r.status, 0)` fails.

- [ ] **Step 3: Add the verb to `cli.mjs`**

In `plugins/sdlc/tools/run/cli.mjs`:

1. Extend the import line:

```js
import { finishRun } from "./finish.mjs";
import { sealStale } from "./seal.mjs";
```

2. Replace the `usage()` body's message with both verbs:

```js
function usage() {
  console.error("usage: finish <slug-or-dir> [--no-report] [--registry <models.json>] [--projects-root <dir>] [--json]");
  console.error("       seal-stale [--max-age-hours <n>] [--plans-root <dir>] [--registry <models.json>] [--no-report] [--json]");
  return 2;
}
```

3. Invert the dispatch head. Replace these four lines:

```js
if (cmd !== "finish") {
  code = usage();
} else {
  const target = args[1] && !args[1].startsWith("--") ? args[1] : null;
```

with these two:

```js
if (cmd === "finish") {
  const target = args[1] && !args[1].startsWith("--") ? args[1] : null;
```

The body that follows (`if (!target) { code = usage(); } else { … try/catch … }`) is unchanged, but it now sits one level shallower — re-indent it by two spaces so the file stays consistent.

4. The `finish` branch ends with a lone `}` on the line immediately before `process.exit(code);`. Replace that single closing brace with:

```js
} else if (cmd === "seal-stale") {
  // The deterministic tail's net (H6). Invoked by hooks/seal-run.sh on `Stop`, and by
  // hand when a run was left unsealed. Sealing is idempotent through .checkpoint/_sealed,
  // so running this twice is a no-op rather than a second, inflated clock.
  const hours = Number(opt("--max-age-hours"));
  const plansRoot = opt("--plans-root") || join(root, "docs", "plans");
  const r = sealStale(plansRoot, {
    maxAgeMs: Number.isFinite(hours) && hours > 0 ? hours * 3600 * 1000 : undefined,
    registryPath: opt("--registry") || undefined,
    noReport: args.includes("--no-report"),
  });
  if (jsonOut) {
    console.log(JSON.stringify({ command: "seal-stale", ok: true, plans_root: plansRoot, ...r }));
  } else if (r.sealed.length === 0) {
    console.log(`seal-stale: nothing to seal (${r.skipped.length} skipped)`);
  } else {
    for (const s of r.sealed) {
      console.log(`seal-stale: ${s.run}` +
        `  (${s.wall_clock_seconds == null ? "—" : `${s.wall_clock_seconds}s`}, ` +
        `${s.total_cost_usd == null ? "$—" : `$${s.total_cost_usd.toFixed(2)}`})`);
    }
  }
  // Warnings to stderr on both paths: under --json they also ride inside the JSON, so a
  // headless consumer parses stdout while a human reads the log. Same split as `finish`.
  for (const s of r.sealed) for (const w of s.warnings) console.error(w);
  for (const f of r.failed) console.error(`WARN: could not seal ${f.run} — ${f.error}`);
} else {
  code = usage();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/seal.test.mjs`
Expected: PASS, all tests

- [ ] **Step 5: Verify `finish` still works from the CLI**

Run: `node --test tools/sdlc-lint/test/run.test.mjs`
Expected: PASS — the existing CLI-level `finish` tests must be untouched by the dispatch change.

- [ ] **Step 6: Commit**

```bash
git add plugins/sdlc/tools/run/cli.mjs tools/sdlc-lint/test/seal.test.mjs
git commit -F - <<'EOF'
feat(sdlc): add the seal-stale verb to the run CLI

One entry point for the Stop hook, and a hand-usable repair for a run left
unsealed. Idempotent through .checkpoint/_sealed, so a second invocation is a
no-op rather than a second, inflated clock. Warnings go to stderr on both
paths and ride inside the JSON as well — the same split finish already uses.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
```

---

### Task 5: The `Stop` hook

**Files:**
- Create: `plugins/sdlc/hooks/seal-run.sh`
- Modify: `plugins/sdlc/hooks/hooks.json`
- Test: `tools/sdlc-lint/test/seal.test.mjs`

**Interfaces:**
- Consumes: `seal-stale --json` (Task 4).
- Produces: an executable `plugins/sdlc/hooks/seal-run.sh` that reads a `Stop` payload on stdin, always exits 0, and prints `{"systemMessage":"…"}` on stdout when (and only when) it sealed something.

- [ ] **Step 1: Write the failing tests**

Append to `tools/sdlc-lint/test/seal.test.mjs`:

```js
const HOOK = resolve(REPO, "plugins/sdlc/hooks/seal-run.sh");
const PLUGIN_ROOT = resolve(REPO, "plugins/sdlc");

// Run the hook as Claude Code would: payload on stdin, CLAUDE_PROJECT_DIR in the env.
function runHook(projectDir) {
  return spawnSync("bash", [HOOK], {
    input: JSON.stringify({ session_id: "s1", hook_event_name: "Stop", cwd: projectDir }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    encoding: "utf8",
  });
}

// A project directory whose docs/plans is the given plans root.
function makeProject(opts) {
  const projectDir = mkdtempSync(join(tmpdir(), "proj-"));
  mkdirSync(join(projectDir, "docs"), { recursive: true });
  const { plansRoot, slug } = makePlans(opts);
  renameSync(plansRoot, join(projectDir, "docs", "plans"));
  return { projectDir, runDir: join(projectDir, "docs", "plans", slug), slug };
}

test("the hook is a silent no-op in a project with no docs/plans", () => {
  const projectDir = mkdtempSync(join(tmpdir(), "proj-"));
  const r = runHook(projectDir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "", "a project that never ran a pipeline must see nothing");
});

test("the hook is a silent no-op when every run is already sealed", () => {
  const { projectDir } = makeProject({ sealed: true });
  const r = runHook(projectDir);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "");
});

test("the hook seals a finished run the orchestrator forgot, and says so", () => {
  const { projectDir, runDir } = makeProject({ slug: "forgotten-run" });
  const r = runHook(projectDir);

  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.match(out.systemMessage, /sealed by Stop hook/);
  assert.match(out.systemMessage, /forgotten-run/, "the message must name the run it sealed");

  const t = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  assert.equal(t.sealed_by, "stop-hook");
});

test("the hook never exits 2 — for Stop that would block the agent from stopping", () => {
  const { projectDir } = makeProject({ runJson: false });   // gate shut: unprovable
  const r = runHook(projectDir);
  assert.notEqual(r.status, 2,
    "exit 2 on Stop means 'do not stop' and feeds stderr back as an instruction — a " +
    "sealing net that can trap the user in a loop is worse than no net");
  assert.equal(r.status, 0);
});
```

Add `renameSync` to the `node:fs` import list at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tools/sdlc-lint/test/seal.test.mjs`
Expected: FAIL — `bash: .../plugins/sdlc/hooks/seal-run.sh: No such file or directory`, status 127.

- [ ] **Step 3: Write the hook script**

Create `plugins/sdlc/hooks/seal-run.sh`:

```bash
#!/usr/bin/env bash
# Stop hook: seal a finished SDLC run that the orchestrator did not seal itself.
#
# Track H6. H1 measured the orchestrator at 82.3% on its own mandated steps; H2 collapsed
# the run tail into one command, which makes it one chance to deviate instead of three,
# but a command is still a command someone has to type. This is the net under that.
#
# EXIT 0, ALWAYS. For `Stop`, exit code 2 does not mean "error" — it BLOCKS the agent from
# stopping and feeds stderr back as an instruction. A sealing net that can trap a user in a
# loop is worse than no net. Hence: no `set -e`, and every external call guarded.
#
# The hook contains no procedure of its own: it decides only whether to call `seal-stale`,
# which is idempotent through .checkpoint/_sealed (ADR-0014, ADR-0016).
set -uo pipefail

payload=$(cat 2>/dev/null || true)

# Project root: the env var Claude Code sets, else the payload's cwd, else here.
project_root="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$project_root" ] && command -v jq >/dev/null 2>&1; then
    project_root=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)
fi
[ -n "$project_root" ] || project_root=$(pwd)

plans="${project_root}/docs/plans"
[ -d "$plans" ] || exit 0

# Cheap pre-filter, so the overwhelmingly common case costs no process spawn: is there any
# run directory that is not already sealed? A plain shell loop on purpose — `find -newermt`
# is a GNU/BSD portability trap, and removing that class of hazard is what ADR-0014 bought.
candidate=0
for d in "$plans"/*/; do
    [ -f "${d}_telemetry.json" ]   || continue
    [ -f "${d}.checkpoint/_sealed" ] && continue
    candidate=1
    break
done
[ "$candidate" -eq 1 ] || exit 0

command -v node >/dev/null 2>&1 || exit 0
cli="${CLAUDE_PLUGIN_ROOT:-}/tools/run/cli.mjs"
[ -f "$cli" ] || exit 0

out=$(cd "$project_root" && node "$cli" seal-stale --json 2>/dev/null) || exit 0
[ -n "$out" ] || exit 0

# Surface what happened. On this path the WARN: lines `finish` emits have no reader — the
# orchestrator is not here to echo them — so a silent net would hide exactly the unpriced
# run and the undetected cap breach that ADR-0012 exists to make loud.
if command -v jq >/dev/null 2>&1; then
    msg=$(printf '%s' "$out" | jq -r '
        if (.sealed | length) == 0 then empty
        else "[sdlc] sealed by Stop hook: " + ((.sealed | map(.run)) | join(", "))
             + ((.sealed | map(.warnings[]?))
                | if length == 0 then "" else "\n" + join("\n") end)
        end' 2>/dev/null)
    [ -n "$msg" ] && jq -n --arg m "$msg" '{"systemMessage":$m}'
fi
exit 0
```

- [ ] **Step 4: Make it executable**

```bash
chmod +x plugins/sdlc/hooks/seal-run.sh
```

- [ ] **Step 5: Register the `Stop` event**

Replace the contents of `plugins/sdlc/hooks/hooks.json` with:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Agent",
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/enforce-agent-model.sh\"",
            "description": "Enforce declared model tier for SDLC pipeline agents. Reads model: from agent frontmatter and injects the correct model ID via updatedInput before the Agent tool fires. Fails open for unknown agents."
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash \"${CLAUDE_PLUGIN_ROOT}/hooks/seal-run.sh\"",
            "description": "Seal an SDLC run whose phases are all complete but which was never sealed (Track H6). Calls run/cli.mjs seal-stale, which is idempotent via .checkpoint/_sealed. Exits 0 unconditionally — for Stop, exit 2 would block the agent from stopping."
          }
        ]
      }
    ]
  }
}
```

No `matcher` on the `Stop` entry: `Stop` does not support matchers and fires on every occurrence, which is why the script's own guards come first.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test tools/sdlc-lint/test/seal.test.mjs`
Expected: PASS, all tests

- [ ] **Step 7: Run the full suite and the lint**

Run: `node --test tools/sdlc-lint/test/*.test.mjs && node tools/sdlc-lint/cli.mjs all --json`
Expected: 0 failing tests; lint output contains `"command":"all","ok":true`

- [ ] **Step 8: Commit**

```bash
git add plugins/sdlc/hooks/seal-run.sh plugins/sdlc/hooks/hooks.json tools/sdlc-lint/test/seal.test.mjs
git commit -F - <<'EOF'
feat(sdlc): a Stop hook seals a run the orchestrator forgot

The net under H2's one-command tail. Cheap guards first — no docs/plans, or
nothing unsealed, and the hook costs no process spawn — then one call to
seal-stale, which carries the gate and the idempotency.

It exits 0 unconditionally and by design: for Stop, exit 2 does not mean
"error", it blocks the agent from stopping and feeds stderr back as an
instruction. A sealing net that can trap the user in a loop is worse than no
net. The pre-filter is a plain shell loop rather than find -newermt, which is
the GNU/BSD portability trap ADR-0014 removed from the prose.

WARN: lines are forwarded through systemMessage: on this path the orchestrator
is not there to echo them, and a silent net would hide the unpriced run and the
undetected cap breach that ADR-0012 exists to make loud.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
```

---

### Task 6: Document the decision and close the item

**Files:**
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`
- Create: `.brain/decisions/ADR-0017-the-tail-has-a-net.md`
- Modify: `.brain/decisions/_moc-decisions.md`
- Modify: `.brain/planning/h-instruction-fidelity.md`
- Modify: `.brain/planning/h6-hook-deterministic-tail.md` (frontmatter `status`)

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Add the Step 5b paragraph to `SKILL.md`**

In `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`, find the Step 5b paragraph beginning `**Your one obligation: echo what it prints.**` and insert this **after** that paragraph ends:

```markdown
**A `Stop` hook seals a run you did not.** `hooks/seal-run.sh` runs this same command when a run's
phases are all complete and `.checkpoint/_sealed` is absent, so a forgotten seal is repaired rather
than lost. It is a net, not a substitute: it fires only after your turn ends, so nothing it does is
available to you during the run; it cannot assemble a `_telemetry.json` you never wrote; and it does
nothing for the cost gate, which spends its numbers while the run is still going. Which path sealed
a run is recorded in `sealed_by` — machine-owned, never yours to write.
```

Note the wording deliberately keeps `sealed_by` out of any `X = …` construction: `sdlc-lint machine-values` fails on a registered key appearing as the subject of a computation in shipped prose.

- [ ] **Step 2: Verify the lint accepts the prose**

Run: `node tools/sdlc-lint/cli.mjs machine-values --json && node --test tools/sdlc-lint/test/all.test.mjs`
Expected: `"ok":true`, and `all.test.mjs` still passes — several of its tests slice `SKILL.md` by anchor strings around Step 5, so an insertion in the wrong place surfaces here.

- [ ] **Step 3: Write the ADR**

Create `.brain/decisions/ADR-0017-the-tail-has-a-net.md`:

```markdown
---
adr: 16
status: accepted
date: 2026-07-29
supersedes: null
---

# ADR-0016 — The run tail has a net, and the net enforces state rather than intent

## Context

[[decisions/ADR-0014-the-run-tail-is-one-command]] collapsed the end of a run from three mandated
invocations into one, on H1's finding that compliance tracks how many separate things an instruction
asks for. That moved the tail from level 1 of Track H's reliability table (prose) to level 3 (one
command). It could not reach level 4, because a single command is still a command someone has to
type — and H1 measured the previous version of that step at 67%, the worst rate in the audited set.

## Decision

A `Stop` hook (`plugins/sdlc/hooks/seal-run.sh`) seals a run the orchestrator finished but did not
seal. Three commitments make it safe to have always on.

**1. The gate is completeness, not recency.** A run is sealable only when every phase in the
resolved DAG carries a terminal checkpoint, `_telemetry.json` exists, and `.checkpoint/_sealed` does
not. Recency cannot tell a paused run from a finished one. Measured over the 19-run downstream
corpus, this gate opens for 10 runs — including `native-chat-engine-s2-thread-list`, the ADR-0012
incident run and the case the hook exists for — and stays shut for the three runs H1 named as
carrying most of the compliance damage. A run that cannot prove it finished (no `.checkpoint/_run.json`)
is never sealed: the gate fails closed.

**2. The clock comes from the run's last activity.** `wall_clock_seconds` is `now - anchor`, and the
hook is late by construction, so passing the wall clock would bill a run for the time the user spent
chatting afterwards — ADR-0014 measured that at 3522s → 11144s and $12.81 → $13.71. `finishRun`
receives the newest mtime across `_telemetry.json` and `.checkpoint/*` through `opts.now`, a seam
that already existed for tests.

**3. The hook exits 0 unconditionally.** For `Stop`, exit code 2 is not "error" — it blocks the
agent from stopping and feeds stderr back as an instruction. A sealing net that can trap a user in a
loop is worse than no net.

The completeness rule moves from `tools/sdlc-lint/lib/resume.mjs` into
`plugins/sdlc/tools/run/reentry.mjs`, which ships; the repo-root file becomes a re-export shim, the
pattern `lib/run.mjs` and `lib/usage.mjs` already follow. `--resume` and the seal gate now share one
definition of "done" rather than two that can drift.

## Consequences

- A forgotten seal is repaired instead of lost, and `sealed_by` records which path did it — so the
  rate at which the net fires is measurable beside H1's compliance rate rather than hidden behind it.
- **The compliance contract `5b-finish` is unchanged, deliberately.** The auditor reads transcripts
  and a hook leaves no `tool_use` block, so the hook is invisible to it. That is the correct
  outcome: the contract measures the *model*, and H6 must not be able to flatter it.
- `WARN:` lines reach the user through `systemMessage`. On the hook path the orchestrator is not
  there to echo them, and a silent net would reproduce ADR-0012's incident with better hygiene.
- The pre-filter is a plain shell loop rather than `find -newermt`: the same BSD-vs-GNU hazard
  ADR-0014 removed from the prose must not re-enter through the hook.
- **What a hook cannot do.** It enforces state, never intent. It cannot fire if the session is killed
  before `Stop`. It repairs after the fact, so it does nothing for a value consumed *during* the run
  — the 3d-1b cap gate stays the orchestrator's responsibility. And if every phase completes but the
  model dies before assembling `_telemetry.json`, there is nothing to seal: authoring that envelope
  would mean inventing the judgement the machine does not hold.
- **No credit yet.** Like H2 and H3, this ships into a measurement gap: no run in the corpus carries
  `plugin_version`, and the re-measurement that decides H4 still needs ~10 runs on the new tail.

## Related
- Implemented by: `plugins/sdlc/tools/run/` (`reentry.mjs`, `seal.mjs`, `finish.mjs`, `clock.mjs`,
  `cli.mjs`), `plugins/sdlc/hooks/seal-run.sh`, `plugins/sdlc/hooks/hooks.json`,
  `plugins/sdlc/MACHINE-VALUES.md`, `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`
- Makes the tail one idempotent command, which this calls: [[decisions/ADR-0014-the-run-tail-is-one-command]]
- Registers `sealed_by` under: [[decisions/ADR-0015-the-machine-value-invariant]]
- The incident this must keep loud: [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]]
- The measurement it must not flatter: [[planning/h1-compliance-auditor]]
- Spec and track: [[planning/h6-hook-deterministic-tail]] / [[planning/h-instruction-fidelity]]
- Relates to: [[architecture/pipeline-orchestrator]] / [[components/sdlc]]
```

- [ ] **Step 4: Index the ADR in the decisions MOC**

`.brain/decisions/_moc-decisions.md` is ordered newest first, so the new row goes at the **top** of the list. Insert it directly above the ADR-0015 line:

```markdown
- [[decisions/ADR-0017-the-tail-has-a-net]]
- [[decisions/ADR-0015-the-machine-value-invariant]]
```

Adding an ADR means adding its MOC row **in the same commit** — `brain-sync check` fails on a note no index links to, which is how ADR-0014 and ADR-0015 both shipped unlisted while `check` reported clean.

- [ ] **Step 5: Mark H6 shipped in the track spec**

In `.brain/planning/h-instruction-fidelity.md`:

1. Change the heading `### H6 — Hooks as the deterministic tail` to `### H6 — Hooks as the deterministic tail ✅`
2. Append to that section, after the implementation-spec paragraph:

```markdown
**Shipped.** [[decisions/ADR-0017-the-tail-has-a-net]]. The gate turned out to be the whole design
question, and it is settled by measurement rather than by a timeout: completeness (every phase in
the resolved DAG terminal) opens for 10 of the 19 corpus runs including the ADR-0012 incident run,
and stays shut for the three H1 named as carrying most of the damage. Two things fell out of sizing
it — the completeness rule had to **ship** (it lived in the repo-root `sdlc-lint`, which the hook
cannot reach), and the clock had to come from the run's newest mtime, since a hook is late by
construction and `now - anchor` would bill the run for the time after it finished.

H6 adds no mandated step, so like H3 it produces no compliance rate of its own. What it adds is
`sealed_by`, an orthogonal signal: how often the net had to fire. `5b-finish` is deliberately
untouched — a hook leaves no `tool_use` block, so it cannot flatter the number that decides H4.
```

3. Update the dependency diagram: change `└─► H6 (hook tail)  ─┘` to `└─► H6 (hook tail) ✅ ─┘`

- [ ] **Step 6: Flip the spec's frontmatter**

In `.brain/planning/h6-hook-deterministic-tail.md`, change `status: planned` to `status: shipped`.

- [ ] **Step 7: Verify the vault**

Run: `node tools/brain-sync/cli.mjs check --vault .brain`
Expected: `check: clean`

- [ ] **Step 8: Run everything one last time**

Run: `node --test tools/sdlc-lint/test/*.test.mjs && node tools/sdlc-lint/cli.mjs all --json && node tools/brain-sync/cli.mjs check --vault .brain`
Expected: 0 failing tests; `"command":"all","ok":true`; `check: clean`

- [ ] **Step 9: Commit**

```bash
git add plugins/sdlc/skills/pipeline-orchestrator/SKILL.md .brain/decisions/ADR-0017-the-tail-has-a-net.md .brain/decisions/_moc-decisions.md .brain/planning/h-instruction-fidelity.md .brain/planning/h6-hook-deterministic-tail.md
git commit -F - <<'EOF'
docs(brain): record ADR-0016 and mark H6 landed

The gate was the whole design question, and it is settled by measurement:
completeness opens for 10 of the 19 corpus runs including the ADR-0012
incident run, and stays shut for the three H1 named as carrying most of the
damage. Sizing it forced two things — the completeness rule had to ship, and
the clock had to come from the run's newest mtime.

SKILL.md gains one paragraph: the net exists, and it is not a substitute. It
fires after the turn ends, it cannot assemble telemetry the model never wrote,
and it does nothing for the cost gate, which spends its numbers mid-run.

5b-finish stays untouched on purpose. A hook leaves no tool_use block, so it
cannot flatter the compliance number that decides H4.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016cxFGFFhgVS7GmCQQmK9qQ
EOF
```

---

## Verification Checklist

Before opening a PR:

- [ ] `node --test tools/sdlc-lint/test/*.test.mjs` — 0 failing
- [ ] `node tools/sdlc-lint/cli.mjs all --json` — `"ok":true`
- [ ] `node tools/brain-sync/cli.mjs check --vault .brain` — `check: clean`
- [ ] `plugins/sdlc/hooks/seal-run.sh` is executable (`git ls-files -s plugins/sdlc/hooks/seal-run.sh` shows mode `100755`)
- [ ] `grep -rn "sdlc-lint" plugins/sdlc/tools/` returns nothing — shipped code must not reach into the repo-root dev tool
- [ ] The eight `resume-*` fixtures still pass through the shim (covered by `resume.test.mjs`)
