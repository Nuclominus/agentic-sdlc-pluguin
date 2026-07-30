---
status: measured
---

# H5 — Prompt surface reduction

> Implementation spec for [[planning/h-instruction-fidelity]] **H5**. Goal: decide whether
> decomposing `pipeline-orchestrator/SKILL.md` — converting prose into commands, moving fragments
> out of the stable prefix — is worth doing, and on what grounds. **Measured 2026-07-29; the
> decision is deliberately deferred.** See [[planning/_moc-planning]].

## Status: measured, not decided

This note exists because the measurement **inverted the item's own premise**. H5 was written to
reduce prompt volume for cost. The arithmetic says cost is not the argument, and a second
measurement — taken alongside it — says something else is. Nothing has been cut. The resume point
and the data needed to close it are at the bottom.

## Why this shape

H5 as written in Track H ran together two claims and asked for both to be measured:

- **Volume** — adherence degrades as the file grows.
- **Distance** — adherence degrades with the gap between where a rule is written and where it applies.

It also carried an instruction that turned out to be exactly right: for the cost half, **compute the
saving, do not benchmark it**. The mechanism is deterministic — a token removed from the stable
prefix is not billed on every turn — so the saving is arithmetic, and the run-to-run noise floor
(55.6–64.2% spread on total cache-read, [[planning/backlog]]) would swallow any A/B. That
instruction is what made this measurement cheap enough to take before committing to any design.

## Measurement 1 — what prose actually costs

Method: `removed_prefix_tokens × main_loop_turns × cached_input_price`. Token counts are a
`chars/4` estimate — no machine holds the real number for a prompt file, and the estimate is stated
as one rather than dressed up. Prices from `plugins/sdlc/config/models.json` (opus `cached_input`
$0.50/MTok). Turn counts and run totals from `orchestration_overhead.main_loop` in each run's
`_telemetry.json`.

`SKILL.md` at measurement time: **2449 lines, 156,080 chars, ~38.7k tokens**.

Two runs, both `plugin_version 1.15.0`, both 7 phases:

| run | turns | main-loop cache-read | run total |
|---|---:|---:|---:|
| `native-chat-engine-s5-presence` | 41 | 6,443,007 | $9.50 |
| `native-chat-engine-s4-unread` | 49 | 8,246,972 | $13.29 |

| scenario | ~tokens removed | s5 | s4 | % of run |
|---|---:|---:|---:|---:|
| delete the entire file (upper bound) | 38,681 | $0.79 | $0.95 | 7.1–8.3% |
| Steps 0→1d (resolution) → one command | 14,124 | $0.29 | $0.35 | **2.6–3.0%** |
| + base prompts moved out | 16,018 | $0.33 | $0.39 | 3.0–3.5% |

**The finding: prompt-surface reduction does not pay for itself in cost.** Deleting the file
outright lands at 7–8% of run cost, an order of magnitude under the noise floor; the largest
*realistic* cut is ~3%. This confirms the track's own prediction, now on real runs rather than in
principle. **Text volume is not the lever.**

(Cross-check: the ~38.7k-token file is 24.8% of s5's average per-turn prefix of ~157k, against the
~23% the track estimated from an earlier run. The two agree.)

### Correction — this measurement counted the wrong axis

Measurement 1 prices **bytes removed from the prefix** and stops there. It is arithmetically
correct and materially incomplete: the same formula has a second factor, `turns`, and collapsing
prose into a command reduces **both**. The `×3%` figure above is the byte term alone.

Measured on the same corpus: the orchestrator's overhead is **72% cache read, 20% output, 8% cache
write** (`s5-presence`, $4.67 of a $9.50 run). Cache read dominates because the prefix is re-billed
in full on every turn, and it grows all run:

| turn | 1 | 9 | 17 | 33 | 49 | 65 |
|---|---:|---:|---:|---:|---:|---:|
| prefix (tokens) | 47,453 | 53,388 | 123,961 | 136,717 | 147,142 | 154,770 |

Of the $4.08 cache-read on that session, **$1.54 is the harness baseline** (system prompt, tool
schemas, `CLAUDE.md` — 47k re-read 65 times, none of it ours) and **$2.54 is what the run itself
accumulated**.

**The turn term, measured over 24 orchestrator sessions** — the window from the
`pipeline-orchestrator` skill invocation to the first `Agent` dispatch, i.e. Steps 0→2, before any
phase work exists:

| | median | range |
|---|---:|---:|
| turns before the first dispatch | **27** | 6 – 47 |
| cache-read billed in that window | **$1.42** | $0.18 – $2.84 |

`s5-presence`: **34 turns, $2.21 — 23% of the whole run**, spent on 18 tool calls that are `ls`,
`cat`, `Read` of manifests and one `git merge-base`. A single `node` process performs the same
resolution in one turn.

**Revised estimate for direction 2:** not `$0.29` but roughly **$1.1–1.4 per run** (27 turns → an
expected 4–6, since the skill invocation, workspace creation and git setup remain), i.e. **~12–15%
of run cost** — about **5× the byte-term estimate**. Still below the 55.6–64.2% A/B noise floor,
which is exactly why the track's instruction to *compute rather than benchmark* holds: the saving is
deterministic and does not need to be detected.

This does not overturn Measurement 1's conclusion — it relocates it. **Cutting text is worth ~3%;
cutting the model's turns is worth ~15%.** Both point away from "shrink the prompt" and toward
"remove remembered steps", which is the same direction Measurement 2 arrives at independently.
Any future revision of this note must price a change on **both** terms.

## Measurement 2 — cardinality predicts compliance

`sdlc-lint compliance --runs "$HOME/parlor-android/docs/plans/*"`, 2026-07-29, **16 auditable runs**
of 20 directories (4 excluded, `no-agent-ids`):

| rate | contract | shape of the instruction | cardinality | n |
|---:|---|---|---|---:|
| **100%** | `2-4-anchor` | one Bash line | once-per-run | 16 |
| **100%** | `5b-finish` | one command | once-per-run | 1 |
| **88%** | `6-journal` | one dispatch | once-per-run | 16 |
| **87%** | `5b-2-report` | one call | once-per-run | 15 · retired |
| **80%** | `5b-0-enrich` | one call behind a sub-procedure | once-per-run | 15 · retired |
| **67%** | `5-clock` | read + compute + render | once-per-run | 15 · retired |
| **40%** | `3d-1b-phase-cost` | **one Bash line** | **once-per-phase** | **5** |

`3d-1b-phase-cost` is `usage/cli.mjs phase-cost` — the *same shape* as `2-4-anchor`, which scores
100%. It is not longer, not vaguer, not less emphatic. The only variable is how many times it must
be remembered within one run. The newest run, `native-chat-engine-s5-presence` (2026-07-29, on the
new tail), scores `partial 6/7`: it remembered six phases and forgot the seventh — the decay
signature rather than a clean miss.

H1's finding was *"compliance tracks how many separate things an instruction asks for, not how
firmly it asks"* ([[planning/h1-compliance-auditor]]). This sharpens it along a second axis:
**not only how many things one instruction asks for, but how many times the same instruction must
be re-remembered.** `5-clock` at 67% was one step asking for three things; `3d-1b` at 40% is one
thing asked for seven times.

**Honest limits.** `n=5` (2 pass, 1 partial, 2 fail, 11 `na: predates`) — this is thin and
`provisional`, not established. It is the *only live contract currently failing*, and it is
directionally consistent with the rest of the spread, but a single additional run moves it by 20
points. `5b-finish` — H2's own contract, and the number that decides H4 — is still `n=1`.
Five of the twenty corpus runs carry `plugin_version`; the gate wants ~10.

`seal:stop-hook` (H6, not a contract): orchestrator 1, stop-hook 4, unrecorded 11. The net fired
on four of five recorded runs.

## Measurement 3 — where the prose is

Mechanical classification of `SKILL.md` by line type (fenced blocks, tables, blockquotes, prose),
per top-level step:

| band | lines | chars | ~tokens | % of file |
|---|---:|---:|---:|---:|
| Step 3 — execute each phase | 838 | 60,634 | 15,159 | **39.2%** |
| Steps 0 → 1d — resolution | 926 | 56,494 | 14,124 | **36.5%** |
| Steps 4/5/5b/6 — the tail | 329 | 20,172 | 5,043 | 13.0% |
| Base prompts per phase | 196 | 7,579 | 1,895 | 4.9% |
| Hard rules + failure modes | 53 | 3,690 | 923 | 2.4% |
| Step 2 — workspace | 55 | 3,407 | 852 | 2.2% |

By line type across all `###` sections (2398 lines): prose 1257, fenced 641, blank 408, table 45,
blockquote 27.

Two things fall out:

- **Steps 0→1d are 926 lines carrying no judgement at all** — plugin-root resolution, dependency
  preflight, foundation/framework detection, profile merge, `sdlc.local.yaml` parsing, workflow
  resolution, cost-cap resolution, dry-run estimation. Every one is a deterministic function of
  files on disk.
- **That logic already exists twice.** `tools/sdlc-lint/lib/detect.mjs` implements the detection and
  framework-attachment semantics in **62 lines of tested code**, against ~340 lines of prose in
  `SKILL.md` describing the same rules for the model to execute. `SKILL.md:234` says so in a comment.
  The same duplication existed for resume and was resolved the right way: `lib/resume.mjs` is now a
  shim re-exporting the **shipped** `plugins/sdlc/tools/run/reentry.mjs`. That is the available
  template — the canonical implementation ships with the plugin, the lint re-exports it.

## The trap this measurement caught

The most obvious JIT candidate is the **base prompts per phase**: 196 lines that are ~90% static
fenced payload, needed only at the moment of dispatch. Moving them to on-demand fragments looks free.

It is not. Loading them on demand makes reading them a **once-per-phase** obligation — precisely the
shape that just measured **40%**. The trade would be 4.9% of the prefix (worth ~$0.04/run) against a
new contract with the worst observed rate in the corpus.

This is the risk Track H already named for H5 — *"it can lower compliance while lowering cost, which
would invert the track's purpose"* — now with a number attached. **Any H5 design must forbid moving
per-dispatch payload out of the prefix**, and cite this measurement as the reason. The same
reasoning protects the read contract that [[decisions/ADR-0008-read-discipline-contract]] pins
inside `=== STABLE PREFIX ===`.

## Candidate directions (none chosen)

| # | direction | justified by | prose removed | invocation delta |
|---|---|---|---|---|
| 1 | **Cardinality collapse** — `3d-1b` stops being once-per-phase. Strongest variant: the cost-cap gate calls one command that prices *everything not yet priced*, so a miss on phase 3 self-heals on phase 4 — idempotent and convergent. | compliance (40% → the 88–100% band) | little | 7 → 1 per run |
| 2 | **Resolution → one shipped command** — Steps 0→1d become `tools/resolve/cli.mjs`, emitting a JSON plan plus the verbatim print blocks; the orchestrator echoes and continues. | **cost (~$1.1–1.4/run, 12–15%)** + determinism + removing the `detect.mjs` double implementation | ~926 lines (36.5%) | 27 turns → 4–6; +1 command, of the 100% shape |
| 3 | **Rationale extraction** — the "why this step exists" prose, historical justification and worked examples move to a companion document never loaded at runtime. | none needed — it is free | modest | 0 |

Direction 2 is **not** the H4 gate: H4 is about phase sequencing, gates and telemetry assembly
being model-owned. Profile resolution is a separate lever and was never what the gate waited on.
That reading should be confirmed before acting on it, not assumed.

Direction 1 is the one the data currently points at. Direction 3 carries no risk and no argument
against it. Neither is committed here.

## Resume point — what closes this

Return when the corpus can answer the two open numbers:

1. **~10 runs carrying `plugin_version` on the new tail** (5 of 20 today) → re-run
   `node tools/sdlc-lint/cli.mjs compliance --runs "$HOME/parlor-android/docs/plans/*"`.
   `5b-finish` gets a real denominator, and H2's own effect becomes measurable for the first time.
2. **`3d-1b-phase-cost` past `n≈10`** → is 40% the real rate for a once-per-phase step, or an
   artefact of five runs? The whole cardinality finding rests on this cell.

Before trusting any rerun, verify the known-positive first
(`native-chat-engine-s2-thread-list` must fail `5b-0-enrich`) — the first real runs of this auditor
surfaced instrument bugs rather than findings.

Re-derive Measurement 1 with `plugins/sdlc/config/models.json` prices and the newest run's
`main_loop.turns` — **both terms**, bytes *and* turns; the turn term is the larger one and pricing
only the bytes is the mistake this note already made once. Re-derive Measurement 3 by re-classifying
`SKILL.md` if it has moved substantially from 2449 lines.

Direction 2 now has a cost argument as well as a determinism one, which changes its standing but not
its gate: whether Steps 0→1d fall inside H4's scope is still a reading to confirm, not an assumption.

## Related

- Parent track: [[planning/h-instruction-fidelity]]
- The compliance instrument and its corpus: [[planning/h1-compliance-auditor]]
- What a one-command collapse looked like: [[decisions/ADR-0014-the-run-tail-is-one-command]]
- The invariant that removed the arithmetic: [[decisions/ADR-0015-the-machine-value-invariant]]
- What must stay in the prefix: [[decisions/ADR-0008-read-discipline-contract]]
- The net under the tail: [[decisions/ADR-0017-the-tail-has-a-net]] / [[planning/h6-hook-deterministic-tail]]
- Noise floor and Track E overlap: [[planning/backlog]] / [[architecture/benchmark-e2-read-discipline]]
- Subject of the measurement: [[architecture/pipeline-orchestrator]] / [[components/sdlc]]
