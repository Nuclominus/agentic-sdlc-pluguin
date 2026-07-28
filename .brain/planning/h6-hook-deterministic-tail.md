---
status: shipped
---

# H6 — Hooks as the deterministic tail

> Implementation spec for [[planning/h-instruction-fidelity]] **H6**. Goal: make the sealing of a
> finished run a property of the harness rather than a step the model owns — without pretending a
> hook can enforce anything but state. See [[planning/_moc-planning]].

## Why this shape

H1 measured the orchestrator at **82.3%** on its own mandated steps, and the spread carried the
finding: what predicts compliance is how many separate things an instruction asks for, not how
firmly it asks. H2 acted on that by collapsing the run tail into one command
([[decisions/ADR-0014-the-run-tail-is-one-command]]); H3 removed the arithmetic around it
([[decisions/ADR-0015-the-machine-value-invariant]]). Both moved the tail *down* the reliability
table — from level 1 (prose) to level 3 (one command). Neither can reach level 4, because a single
command is still a command someone has to type.

H6 is the level-4 move for exactly one step, and only for that step. ADR-0014 already named the
shape it should take:

> H6's `Stop` hook becomes a call to one idempotent command rather than a re-implementation of the
> sequence in bash.

That constraint is the spec's spine. The hook contributes no procedure of its own: it decides
*whether* to seal and delegates *how* to `finishRun`, which is already fail-open per stage.

## The gate, measured

The hook must not seal a run that is still running. The gate chosen is completeness — **every phase
in the resolved DAG has a terminal checkpoint** — not recency, because recency cannot tell a paused
run from a finished one.

Run over the 19 runs in the downstream corpus (`~/parlor-android/docs/plans/`) with the real
`computeReentry` logic:

| outcome | runs | meaning |
|---|---|---|
| **PASS** — gate open, hook would seal | **10** | all phases terminal |
| **GATED** — hook does not touch it | 3 | `replace-acceptmatch-sendmatchrequest` (stopped at `development`), `crf-54-clear-matches-on-background` (no `qa`), `change-matches-filter-logic-gender` (no `documentation`) |
| **ERR** — no `.checkpoint/_run.json` | 6 | all predate `3-checkpoint-init` |

Two things make this more than a sanity check.

`native-chat-engine-s2-thread-list` — the ADR-0012 incident run, the reason Track H exists — **is in
the PASS set**. It is H6's known-positive fixture: a hook that does not seal that run has failed at
the only case it was built for.

And the three GATED runs are the same three H1 named as carrying most of the damage
(`replace-acceptmatch-sendmatchrequest` 1/5, `fix-ingestmatches-during-pagination` 2/5,
`native-chat-engine-s2-thread-list` 3/6). The gate discriminates on evidence, not on intuition: it
opens for the run that was merely unsealed and stays shut for the runs that were genuinely partial.

The 6 `ERR` runs are permanently outside the hook's reach. `_run.json` is written by
`3-checkpoint-init` before any phase is dispatched, so every run from that point forward carries it;
the six that do not are historical. **The gate fails closed** — completeness that cannot be proven is
not assumed — and those runs stay the manual `finish` path. A forward-looking net does not need to
cover the past.

## Architecture

Four units. The boundary that matters: `seal.mjs` decides *which* runs and *when*, and computes
nothing about *how* a run is sealed; the hook script parses no run state.

### `plugins/sdlc/tools/run/reentry.mjs` (moved)

`loadCheckpoints`, `computeReentry`, `resolveWorkspace` — moved verbatim from
`tools/sdlc-lint/lib/resume.mjs`, which becomes a re-export shim. This is not a refactor for
tidiness: the completeness rule is subtle (plain, aspect-aware, two-pass development, loop, parallel
group — `SKILL.md` 1109–1122), and re-deriving a simplified copy inside `seal.mjs` would create a
second place the procedure is described. H1's spec named that failure mode directly — *a manifest
living apart from `SKILL.md` drifts the moment a step is renumbered* — and the same applies here.

The move is also forced by packaging. `resume.mjs` lives in the repo-root dev tool and does **not**
ship; the hook runs on a consumer's machine through `${CLAUDE_PLUGIN_ROOT}` and cannot reach it. The
established pattern is already in the tree: `tools/sdlc-lint/lib/run.mjs` and `lib/usage.mjs` are
both one-line re-export shims over shipped plugin code, so the test-suite exercises exactly what
ships. `resume.mjs` joins them. `resume.test.mjs` and its eight fixtures are untouched.

### `plugins/sdlc/tools/run/seal.mjs` (new)

The only unit that knows what makes a run sealable.

```js
findSealable(projectsRoot, { now, maxAgeMs }) → [{ runDir, lastActivityMs }]
sealStale(projectsRoot, opts)                 → { sealed: [...], skipped: [...] }
```

`findSealable` scans `<projectsRoot>/*/`, keeps a directory when **all three** hold, and records why
it dropped each of the others:

1. `_telemetry.json` exists — otherwise there is nothing to seal;
2. `.checkpoint/_sealed` is absent — the idempotency gate;
3. `resolveWorkspace(dir).reenter_at === null` — the completeness gate. A throw (no `_run.json`,
   unparseable) is caught and recorded as `skipped: "unprovable"`, never propagated.

`sealStale` seals **every** candidate the gate admits, not just the newest: parallel pipelines
(`/sdlc:batch`) can leave more than one run unsealed in a single project, each is independently
gated, and a failure on one must not skip the rest. In practice the list is almost always empty or a
single entry.

`lastActivityMs` is the newest mtime across `_telemetry.json` and `.checkpoint/*`. It becomes
`opts.now` for `finishRun`, and this is the whole reason the hook can be late without lying:
`sealRunClock` computes `wall_clock_seconds = now - anchor` (`clock.mjs:67`), so passing the wall
clock's own `Date.now()` would charge the run for every minute the user spent chatting afterwards.
ADR-0014 measured that damage on a real run — 3522s became 11144s, $12.81 became $13.71, because the
inflated window drags the overhead cost with it. `opts.now` is an **existing** seam (`clock.mjs:44`),
introduced for tests; H6 supplies a machine value through it rather than widening the interface.

`maxAgeMs` (default 24 h, measured from `lastActivityMs`) is deliberately **not** a correctness
guard — the gate and the mtime clock already hold correctness. It bounds blast radius: a complete
but long-abandoned run should not be sealed at an unrelated `Stop` weeks later, and a run that old
has usually lost the transcripts `enrich` needs anyway.

### `plugins/sdlc/tools/run/finish.mjs` (extended)

Gains `opts.sealedBy` (default `"orchestrator"`). After all three stages, and only then, it records
the seal in two places:

- `_telemetry.json` → `sealed_by: "orchestrator" | "stop-hook"`
- `.checkpoint/_sealed` → `{ sealed_at, by, wall_clock_seconds }`

**Order is load-bearing.** `enrich` rewrites the whole telemetry file, so `sealed_by` is written
last, by a read-modify-write after the enrich stage. Writing the marker last also makes a crash
mid-seal safe: an interrupted seal leaves the run unmarked and therefore retryable, which is the
correct default for a net.

`finishRun` does **not** refuse to run when the marker is present. Re-sealing is the *hook's*
concern, not the tool's; a maintainer re-running `finish` by hand still gets the old behaviour.

### `plugins/sdlc/tools/run/cli.mjs` (extended) and `hooks/seal-run.sh` (new)

```
node ${CLAUDE_PLUGIN_ROOT}/tools/run/cli.mjs seal-stale [--max-age-hours 24] [--json]
```

The hook script is a wrapper and nothing more:

```
Stop → seal-run.sh
        ├─ [ -d "$project_root/docs/plans" ]        || exit 0   # ~free in every other project
        ├─ any run dir lacking .checkpoint/_sealed? || exit 0   # POSIX loop, no date math
        ├─ command -v node                          || exit 0
        └─ node …/cli.mjs seal-stale --json         || true
             └─ on success: {"systemMessage": "…"} on stdout
```

`project_root` resolves as `${CLAUDE_PROJECT_DIR:-<payload .cwd>:-$(pwd)}`, matching
`hooks/enforce-agent-model.sh`. The second guard is a plain shell loop on purpose: `find -newermt` is
a GNU/BSD portability trap, and removing exactly that class of hazard is what ADR-0014 bought.

`hooks.json` gains a `Stop` entry. The `matcher` field is ignored for `Stop` — it fires on every
occurrence — which is why the cheap guards come first.

## Failure model

**The hook exits 0. Always.** For `Stop`, exit code 2 is not "error", it is *block the agent from
stopping* and feed stderr back as an instruction. A sealing net that can trap the user in a loop is
worse than no net. The script therefore runs without `set -e`, wraps the node call in `|| true`, and
bounds it with a timeout. Missing `node`, missing plugin files, unparseable JSON — every one is a
silent no-op.

Inside `finishRun`, fail-open is already per stage, so a partial failure (no transcript resolved)
still yields a sealed run reporting an honest `$—` rather than an unsealed one reporting nothing.

One consequence needs stating, because it would otherwise quietly undo ADR-0012. On the hook path
the `WARN:` lines `finish` emits have no reader: the model is not there to echo them. The hook
therefore forwards them in `systemMessage`, so a run sealed by the net is as loud about its cap
breaches and unpriced phases as one sealed by hand. A silent net that hides a $15.38 run reporting
`$—` would reproduce the original incident with better hygiene.

## Measurement

`sealed_by` goes into `MACHINE-VALUES.md` as machine-owned (`sealed_by: tools/run/cli.mjs finish`),
which both documents the ownership and gives H3's lint teeth over it — the model must never write
this key, since the whole point is that it records who did.

**The compliance contract `5b-finish` does not change.** The auditor reads transcripts, and a hook
leaves no `tool_use` block, so the hook's action is invisible to it. That is the correct outcome:
the contract measures the *model*, and H6 must not be able to flatter it. `sealed_by` is the
orthogonal signal — how often the net had to fire — and the two are read together. A rising
`5b-finish` with a falling `stop-hook` share means the collapse worked; a flat `5b-finish` with a
high `stop-hook` share means the tail is now reliable but still not the model's doing.

Neither number exists yet. H6 ships into the same measurement gap H2 and H3 did: no run in the
corpus carries `plugin_version`, and the re-measurement that decides H4 needs ~10 runs on the new
tail. H6 does not close that gap and must not be credited before it.

## Tests

`tools/sdlc-lint/test/seal.test.mjs`, `node --test`, alongside the existing suite:

- the marker blocks a second seal; a run with no marker is sealed exactly once;
- the clock comes from `lastActivityMs`, not `Date.now()` — asserted on a fixture whose mtimes are
  set explicitly, since this is the defect ADR-0014 priced;
- a run whose gate is shut (`reenter_at != null`) is skipped, with the reason recorded;
- a run with no `_run.json` is skipped as `unprovable`, and `findSealable` does not throw;
- `maxAgeMs` excludes a complete-but-stale run;
- a `finishRun` that throws leaves the run unsealed and does not abort the remaining candidates;
- both `sealed_by` values round-trip into telemetry and the marker.

The known-positive verification H1 made a hard stop applies here too: the fixture set includes a
copy of the incident run's checkpoint shape, and the instrument is wrong if the gate does not open
for it.

## Out of scope — what a hook cannot do

Stated plainly, because this is the item most likely to be oversold. From
[[planning/h-instruction-fidelity]]: a hook enforces **state, never intent**; it cannot fire if the
session is killed before `Stop`; and it repairs after the fact, so it does nothing for a value
consumed *during* the run — the 3d-1b cap gate stays the orchestrator's responsibility.

To which this spec's design adds one more, found while sizing the gate: if every phase completes but
the model dies **before assembling `_telemetry.json`**, the hook is powerless. There is nothing to
seal, and authoring the envelope would mean inventing exactly the judgement — which phases ran, what
the cap was, what the run decided — that the machine does not hold. The net catches a run the model
forgot to seal; it cannot catch a run the model never finished recording.

## Related

- Makes the tail one idempotent command, which this item calls: [[decisions/ADR-0014-the-run-tail-is-one-command]]
- Registers `sealed_by` under the invariant from: [[decisions/ADR-0015-the-machine-value-invariant]]
- The incident that must stay loud on the hook path: [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]]
- The measurement this item feeds and must not flatter: [[planning/h1-compliance-auditor]]
- Track spec and the reliability table: [[planning/h-instruction-fidelity]]
- Touched components: [[architecture/pipeline-orchestrator]] / [[components/sdlc]]
