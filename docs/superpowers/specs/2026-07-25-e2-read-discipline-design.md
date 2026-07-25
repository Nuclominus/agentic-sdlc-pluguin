# E2 — Surgical reads + terse tool output (design)

- **Date:** 2026-07-25
- **Status:** approved
- **Track:** E — pipeline cache/cost efficiency (see `.brain/planning/backlog.md`)
- **Target release:** `sdlc` 1.10.0
- **Follows:** E5 — cache-pressure signal (`2026-07-08-e5-cache-pressure-signal-design.md`, shipped #50)

## Context

Prompt caching bills every token at 0.1× **but on every turn**: each subagent turn re-reads its
whole accumulated prompt prefix, so `cache_read ≈ turns × avg_prefix`. Measured on a real 7-phase
Android run (`change-matches-filter-logic-gender`), after the #48 over-count fix:

| Component | Share | Per-turn size |
|-----------|-------|---------------|
| Fixed floor (harness prompt, tool schemas, agent `.md`, injected context) | ~27% (1.77M) | 12k–21k |
| **Growth** (accumulated file reads, tool output, thinking, Edit/Write bodies) | **~73% (4.88M)** | rises 15k → 101k |

E5 turned this into a tracked metric (`turns`, `peak_prefix_tokens`, `reads_per_turn`,
`cache_pressure`). **E2 is the first item that acts on it**, and it targets the larger half: the 73%
growth. Growth is fully addressable through agent behavior — an agent that greps to a region and
reads 40 lines pays for 40 lines on every later turn; one that reads the file whole pays for the
whole file on every later turn.

### The contradiction this fixes

The repo currently tells agents opposite things. `aar-analyst.md:36-37` recommends *"surgical reads
(`offset/limit`, grep-first, no re-reads)"* — but only in retrospect, to the analyst, after the run
is over. The dispatched agents themselves are instructed the other way:

```
plugins/sdlc/agents/document-writer.md:36    "Read all prior phase outputs"
plugins/sdlc/agents/developer.md:47          "re-read changed files"
plugins/sdlc/agents/security-analyst.md:36   "don't rely on prompt content — re-read"
plugins/sdlc/agents/security-analyst.md:58   "re-read the file"
plugins/sdlc/agents/qa-engineer.md:59        "don't rely on having them in your prompt — re-read them"
```

Those instructions are **not** careless. They encode a real correctness requirement: between phases
the files on disk change, so an agent must not review content pasted into its prompt. Two distinct
ideas have collapsed into one word:

| Idea | Verdict |
|------|---------|
| "Do not trust prompt content — take it from the file system" | **Keep.** This is correctness. |
| "Read the same file a second time when it is already in your context" | **Forbid.** This is the 73%. |

The fix is to separate them in one rule, not to delete the word.

`plugins/android-foundation/agents/*.md` was scanned and is **clean** — the only near-match,
`android-debugger.md:34` ("Read the full stack trace"), is correct guidance and is not matched by
the lint patterns below.

### Definition of Done (from backlog, split per the validation decision)

- **In-repo (merge gate):** the read-discipline contract is present in the orchestrator stable
  prefix, the four contradicting agent contracts are reworded, `sdlc-lint all` enforces both, and
  the cache-pressure budget is pinned by test.
- **Deferred (next real downstream run):** `peak_prefix_tokens` drops on a comparable run —
  target **<60k**, from the recorded baseline of **101k peak / 6.65M reads / 117 turns**. No
  quality regression in review/test/qa verdicts.

The baseline telemetry lives in a downstream Android project, not in this repository; this repo
holds only synthetic fixtures (`report-basic`, `rollup-multi`). The behavioral half of the DoD is
therefore explicitly deferred and tracked, not silently dropped.

## Goals / Non-goals

**Goals**
- Put one read-discipline contract in the orchestrator's cache-stable prefix, so it reaches every
  dispatched agent of every stack at zero per-agent cost.
- Resolve the re-read contradiction in the four `plugins/sdlc/agents/*.md` files.
- Add a deterministic `sdlc-lint` rule so neither the contract nor the resolution can rot.
- Pin `CACHE_PRESSURE_PEAK_TOKENS` as a documented budget rather than an untested constant.

**Non-goals**
- Trimming the fixed floor (that is **E1**) or reducing turn count (that is **E3**).
- Any in-run enforcement — the orchestrator does not inspect or trim context mid-run. That would
  change the orchestrator↔subagent control flow and belongs to E1/E3.
- Touching `usage.mjs` / `metrics.mjs` / `report.mjs` measurement logic. E5 already produces the
  numbers; E2 only reads them.
- Rewording `plugins/android-foundation/agents/*.md` — verified clean.

## Architecture

Three artifacts, three files, no duplication.

### 1. The contract — `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`

A new paragraph inside the `=== STABLE PREFIX ===` template (Step 3b-1), placed immediately after
the existing "Compact handoff contract" line (currently line 947).

It goes in the stable prefix, not the per-call trailer, for the same reason
`project_extension_skills_block` and `sdlc_lessons_block` do: the prefix is byte-identical across
runs and qualifies for prompt caching. One paragraph then multiplies across every dispatched agent
of every active stack — `sdlc`, `android-foundation`, and any future foundation — with zero
per-agent edits.

Contract text:

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

The second bullet is the contradiction resolution, stated as one rule instead of two mutually
exclusive ones.

A `<!-- DRIFT GUARD -->` comment is placed outside the fenced block, following the convention
already used at `SKILL.md:907` for resume semantics, pointing at the lint rule.

### 2. Contract resolution — `plugins/sdlc/agents/*.md`

| File | Line | Change |
|------|------|--------|
| `qa-engineer.md` | 59 | Read changed files from the file system (not from the prompt); do not read the same file twice. Defer to the read-discipline contract rather than restating it. |
| `security-analyst.md` | 36 | Same treatment as `qa-engineer.md:59`. |
| `security-analyst.md` | 58 | The `Edit` result confirms the change landed; then grep for other uses of the same tainted value or sink, so a second call site is not missed. |
| `developer.md` | 47 | The `Edit` result confirms the change landed; then grep the file for the touched imports/types/signatures to confirm they still line up. |
| `document-writer.md` | 36 | Read prior phase outputs with `offset/limit` / grep to the needed sections instead of reading all of them whole. |

`document-writer` is the highest-value single edit: the `documentation` phase carries a ~21k floor,
~50% of its own reads, and 23 turns — the second-worst turn count after `development` (39).

### 3. The guard — `tools/sdlc-lint/lib/read-discipline.mjs`

A new `read-discipline` verb, **included in `runAll()`**. This differs from `report` and `rollup`,
which stay out of `all` because they need run data; `read-discipline` checks the source tree, like
`schema`, `cycles`, `detect`, and `resume`.

It is dev-tooling only — no mirrored copy under `plugins/sdlc/tools/`. The SSOT re-export pattern
used by `report`/`rollup`/`aar-metrics` exists because those tools also run at pipeline runtime from
inside the plugin payload. This one never does.

**Check 1 — anchor.** The token `Read discipline:` must appear in `SKILL.md` **between** the
`=== STABLE PREFIX ===` and `=== PER-CALL CONTEXT ===` lines. Missing → fail. Present but outside
that range → fail (it would land in the per-call trailer and lose cache stability). The body of the
paragraph is free to be reworded; it cannot be deleted or displaced.

**Check 2 — anti-pattern scan** over `plugins/*/agents/*.md`:

```js
/\bre-?read\b/i
/\bread (the )?(entire|whole|full) files?\b/i
/\bread all\b/i
```

Verified against the live tree: these match exactly the five lines listed above and nothing else.
`android-debugger.md:34` ("Read the full stack trace") does not match — the second pattern requires
`file`/`files` after the adjective. The patterns are deliberately narrow; a broad `/full/` or
`/all/` would be noise.

Escape hatch: a marker `<!-- read-discipline: ok — <reason> -->` on the matching line or the line
immediately above suppresses that match. A legitimate exception costs one comment with a stated
reason and leaves a trace in history.

**Check 3 — budget.** `CACHE_PRESSURE_PEAK_TOKENS` (`plugins/sdlc/tools/usage/usage.mjs:57`,
currently `80_000`) is pinned by unit test, with a boundary assertion: `79_999 → cache_pressure
false`, `80_001 → true`. Changing the threshold becomes a deliberate act that updates a test rather
than a silent drift.

## Data flow

```
SKILL.md stable prefix ──► every Task prompt ──► every dispatched agent (all stacks)
                                                        │
                                                 fewer / narrower reads
                                                        │
                                                        ▼
                              transcript ──► usage.mjs ──► _telemetry.json
                                             (peak_prefix_tokens, turns)
                                                        │
                                    ┌───────────────────┴───────────────────┐
                                    ▼                                       ▼
                        report.mjs "high cache pressure"        metrics.mjs cache_pressure_phases
                                                                        └─► /sdlc:aar findings
```

E2 adds nothing to this pipeline. It changes the input (agent behavior) and lets the E5 machinery,
unmodified, report the result.

## Error handling

- **Lint failures** follow the existing `sdlc-lint` convention: `0` clean, `1` violations found,
  `2` tool error (unreadable file, missing `SKILL.md`). `runAll()` already takes `Math.max` of all
  verb codes, so a tool error propagates correctly.
- **Violation output** names file, line, matched pattern, and the escape-hatch marker syntax, so a
  contributor can either fix the phrasing or justify it without reading this spec.
- **Missing `SKILL.md`** is a tool error (`2`), not a violation (`1`) — an absent orchestrator is a
  broken checkout, not a style problem.
- **Agent behavior is advisory.** The contract is a prompt instruction; a model can ignore it. This
  is accepted — E2 is guidance plus a source-tree guard, not runtime enforcement. Detection of
  non-compliance is the E5 `cache_pressure` flag, surfaced per-phase in the report and AAR.

## Testing

- `tools/sdlc-lint/test/read-discipline.test.mjs` — new fixture directory
  `tools/sdlc-lint/fixtures/read-discipline/` with: a clean agent `.md`; one file per anti-pattern;
  a file whose match is suppressed by the escape-hatch marker on the same line; one suppressed by a
  marker on the preceding line; a `SKILL.md` with the anchor correctly placed; one with the anchor
  missing; one with the anchor present but in the per-call trailer.
- `tools/sdlc-lint/test/usage.test.mjs` — extend with the `CACHE_PRESSURE_PEAK_TOKENS` pin and the
  `79_999` / `80_001` boundary assertions.
- `tools/sdlc-lint/test/all.test.mjs` — assert `read-discipline` participates in `runAll()`.
- Run the whole suite: `node --test tools/sdlc-lint/test/*.test.mjs` (the trailing-slash directory
  form does not auto-discover on Node 22).
- Repo-level gate: `node tools/sdlc-lint/cli.mjs all` clean, and
  `node tools/brain-sync/cli.mjs check --vault .brain` clean before merging vault changes.

## Decision record

**ADR-0008** (short) — the orchestrator↔subagent prompt contract gains a mandatory stable-prefix
block, and four agent contracts change their read semantics. The backlog flags E2 as *"may warrant
an ADR if it changes agent contracts materially"*; it does. Context: cache reads are billed
per-turn. Decision: read discipline is a prefix-level contract enforced by lint, not per-agent
prose. Consequences: one place to change, zero per-agent cost, no runtime enforcement.

## Vault updates

- `.brain/planning/roadmap.md` — Track E line notes E2 landed; remaining E1/E3/E4.
- `.brain/planning/backlog.md` — E2 marked done with the deferred measurement noted.
- `.brain/decisions/ADR-0008-read-discipline-contract.md` — new.
- `.brain/components/sdlc.md` — note the new lint verb.
- Change note for the merged PR is machine-generated by `tools/brain-sync`, then enriched.

## Open items

- The behavioral half of the DoD (`peak_prefix_tokens` < 60k) is measured on the next real
  downstream SDLC run and reported back against the 101k baseline. Until then E2 is "landed,
  unmeasured" — the roadmap entry says so explicitly rather than claiming the win.
