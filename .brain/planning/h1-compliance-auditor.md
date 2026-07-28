---
status: planned
---

# H1 — Transcript compliance auditor

> Implementation spec for [[planning/h-instruction-fidelity]] **H1**, the first and gating item of
> Track H. Goal: measure, from transcripts already on disk, how often the orchestrator executes its
> own mandated steps — so H4's scope is decided by data instead of by one incident.
> See [[planning/_moc-planning]].

## Why this shape

Track H's premise is that prose read by a model is a probabilistic instruction. H1 does not try to
fix that; it **measures** it. The deliverable is a number per mandated step, not a guardrail —
gating in CI is explicitly out of scope for v1 (see *Out of scope*).

The design follows one constraint above all: the auditor must not become a second place where the
procedure is described. A manifest living apart from `SKILL.md` drifts the moment a step is
renumbered, and a drifted manifest either fails forever or silently audits nothing. Therefore the
contract lives **inside** `SKILL.md`, adjacent to the prose it describes, so that changing a step
without changing its contract shows up in the same diff.

## Measured corpus — and its limits

The marketplace repo has no pipeline runs of its own (`bench/` holds zero `_telemetry.json`). The
audit corpus is the downstream Android project, `~/parlor-android/docs/plans/`:

| | runs |
|---|---|
| total run directories with `_telemetry.json` | 18 |
| with at least one `agent_id` (anchor to resolve a transcript) | **12** |
| without any `agent_id` → unauditable | 6 |
| without `started_at` → run date inferred from mtime | 6 |
| date range | 2026-07-06 … 2026-07-28 |

`native-chat-engine-s2-thread-list` (the ADR-0012 incident run) carries
`cost_basis: "subagent_aggregate"` and is the corpus's **known-positive fixture**: the auditor is
wrong if that run does not fail `5b-0-enrich`.

**The steps are younger than the corpus.** `git log -S` over `SKILL.md` dates each mandated step:

| step | mandatory in `SKILL.md` since |
|---|---|
| `report/cli.mjs report` | 2026-07-03 |
| `_started_at` anchor | 2026-07-06 |
| `session-recorder` dispatch | 2026-07-06 |
| `usage/cli.mjs enrich` | 2026-07-07 |
| `usage/cli.mjs phase-cost` (3d-1b) | **2026-07-28 06:56 UTC** |

The incident run started 2026-07-28 14:24 UTC — roughly 7.5 hours after 3d-1b landed. So
`3d-1b-phase-cost` will have a denominator of ~2–3 runs and **will not yield a usable rate**; one of
the four cells in the incident table is simply not measurable yet. The steps with real history are
`enrich`, `report`, `_started_at` and `session-recorder` (~12 runs each). The published result must
say this rather than quietly report `100%` over three runs.

## Measured result (2026-07-28)

`sdlc-lint compliance --runs "$HOME/parlor-android/docs/plans/*"` over 19 run directories:
**15 auditable, 4 excluded** (`no-agent-ids`).

| rate | contract | pass | fail | na | denominator | notes |
|---|---|---|---|---|---|---|
| **100%** | `2-4-anchor` | 15 | 0 | 0 | 15 | provisional |
| **87%** | `5b-2-report` | 13 | 2 | 0 | 15 | provisional; confounded by `--no-report` |
| **87%** | `6-journal` | 13 | 2 | 0 | 15 | provisional |
| **80%** | `5b-0-enrich` | 12 | 3 | 0 | 15 | provisional |
| **67%** | `5-clock` | 10 | 5 | 0 | 15 | provisional |
| — | `3d-1b-phase-cost` | 2 | 2 | 11 | 4 | **no usable rate (n=4)** — 11 runs predate it |

**Overall 82.3%** (65/79 applicable contract-runs); 84.0% excluding the thin
`3d-1b-phase-cost` row. Eight of the fifteen runs are fully compliant; three carry most of
the damage (`replace-acceptmatch-sendmatchrequest` 1/5, `fix-ingestmatches-during-pagination`
2/5, `native-chat-engine-s2-thread-list` 3/6 — the ADR-0012 incident).

Every rate is **provisional**: no run in this corpus carries `plugin_version`, so
step availability is dated from `SKILL.md` commits — an upper bound, not evidence.

### The finding that matters

Compliance tracks the **mechanical complexity of the step**, not the emphasis of its prose:

- `2-4-anchor` — one `Bash` line — **100%**.
- `5b-2-report`, `6-journal` — one call, one dispatch — **87%**.
- `5b-0-enrich` — one call, but gated behind a session-resolution sub-procedure — **80%**.
- `5-clock` — read the anchor, compute, render with a BSD/GNU fallback — **67%**, the worst
  rate in the set, while carrying the most emphatic prose in the entire file: *"Do **not**
  hand-transcribe these from your own sense of the time."*

That inversion is the track's premise measured rather than asserted. The step that shouts
loudest is the step most often skipped, because what predicts compliance is how many
separate things the instruction asks for. **This is evidence for H2 (collapse multi-step
prose into single commands) ahead of H4** — the fix is fewer steps, not firmer wording.

### Two instrument defects the audit caught first

Both would have been published as findings had the plan not made known-positive
verification a hard stop:

1. `6-journal` scored a flat **0%** across all 15 runs. Transcripts carry
   `sdlc:session-recorder`; the contract named the bare agent. The instrument was
   measuring the install namespace.
2. `5b-0-enrich` failed a run whose telemetry read `cost_basis: "transcript"`. The pattern
   required `SKILL.md`'s quoted spelling; that run invoked the CLI with an unquoted path.

A third apparent contradiction turned out to be a real finding, not a defect:
`change-matches-filter-logic-gender` reads `cost_basis: "transcript"`, yet its own session
contains **zero** `usage/cli.mjs` calls — the value was repaired later, from another
session. Telemetry says priced; the transcript says the orchestrator never priced it. That
distinction is the whole reason this tool reads transcripts instead of telemetry.

## Architecture

Four units, each with a single responsibility. The boundary that matters: `compliance.mjs` parses
neither JSONL nor Markdown, and `cli.mjs` computes no verdicts.

### `tools/sdlc-lint/lib/transcript-facts.mjs` (new)

The only unit that knows the session `.jsonl` format. Input: a transcript path. Output: a flat,
ordered array of facts, one per `tool_use` block found in `assistant` messages:

```js
{ seq, tool, command, subagent_type, path }
```

`command` is set for `Bash` (from `input.command`), `subagent_type` for `Agent`, `path` for
`Read`/`Write`/`Edit`. Knows nothing about SDLC, steps or contracts — this is the reusable extractor
H4 and a future G2 would inherit unchanged. Malformed lines are skipped, not thrown on: a transcript
is an append-only log and may end mid-write.

### `tools/sdlc-lint/lib/contracts.mjs` (new)

The only unit that knows the `sdlc-contract` format. Input: a `SKILL.md` path. Output:
`{ contracts, errors }`. Validation errors (duplicate `id`, unknown `requires`, uncompilable
`pattern`, malformed `since`, unknown `applies_when` operator) are returned, never thrown — the CLI
decides whether they are fatal. Reads no transcripts.

### `tools/sdlc-lint/lib/compliance.mjs` (new)

Pure evaluation: `auditRun(runDir, contracts, { configDir })` → a run result. Resolves the run's
transcripts, obtains facts, evaluates each contract, returns verdicts. No stdout.

### `tools/sdlc-lint/cli.mjs` (extended)

New verb. The only unit that prints.

```
node tools/sdlc-lint/cli.mjs compliance [--runs <glob>] [--config-dir <path>] [--json]
```

`--runs` defaults to `docs/plans/*` relative to cwd; for the real audit it is pointed at the
downstream project. `--config-dir` defaults to the resolved Claude config dir
(`claudeConfigDir()` from `lib/usage.mjs`).

Reuses, rather than reimplements, the existing run→session machinery re-exported by
`tools/sdlc-lint/lib/usage.mjs`: `knownRunAgentIds`, `findAgentTranscript`, `sessionSubagentsDir`,
`sessionOwnsRun`, `claudeConfigDir`.

## The contract block

A fenced block with the info string `sdlc-contract`, placed **immediately before** the prose of the
step it describes. Body is YAML (the `yaml` dependency is already present in `sdlc-lint`).

````markdown
```sdlc-contract
id: 5b-0-enrich
requires: bash_match
pattern: usage/cli\.mjs enrich
cardinality: once-per-run
since: 2026-07-07
```
````

| field | required | meaning |
|---|---|---|
| `id` | yes | unique; mirrors the step numbering used in the prose |
| `requires` | yes | `bash_match` \| `agent_dispatch` |
| `pattern` | yes | JS regex source for `bash_match`; a literal `subagent_type` for `agent_dispatch` |
| `cardinality` | yes | `once-per-run` \| `once-per-phase` |
| `since` | yes | `YYYY-MM-DD`; the date the step became mandatory in `SKILL.md` |
| `applies_when` | no | list of conditions, AND-joined |

An `applies_when` condition is deliberately not an expression language:
`telemetry.<dotted.path> <op> <value>`, where `op` ∈ `==`, `!=`, `exists`, `absent`. No parentheses,
no `OR`. The moment the grammar becomes interesting it needs its own test suite, which is a cost
this item does not need to carry.

**The block must not read as an instruction.** It sits inside a fenced code block with a non-shell
info string, so the orchestrator has no reason to execute it; the prose immediately below remains
the instruction. This is the one risk the format carries and it is the reason the block is terse —
it describes the step's observable trace, never restates what to do.

### The v1 contract set

| id | step | predicate | cardinality | since |
|---|---|---|---|---|
| `2-4-anchor` | Step 2.4 | bash: writes `.checkpoint/_started_at` | once-per-run | 2026-07-06 |
| `3d-1b-phase-cost` | Step 3d-1b | bash: `usage/cli\.mjs phase-cost` | once-per-phase | 2026-07-28 |
| `5-clock` | Step 5 | bash: `date -u (-r\|-d @)` | once-per-run | 2026-07-06 |
| `5b-0-enrich` | Step 5b.0 | bash: `usage/cli\.mjs enrich` | once-per-run | 2026-07-07 |
| `5b-2-report` | Step 5b.2 | bash: `report/cli\.mjs report` | once-per-run | 2026-07-03 |
| `6-journal` | Step 6 | agent: `session-recorder` | once-per-run | 2026-07-06 |

Three of the six (`3d-1b-phase-cost`, `5b-0-enrich`, `5-clock`) are exactly the incident's misses.
The other three widen the base and exercise the remaining predicate kinds.

**Known imprecision, accepted:** `5b-2-report` carries no `applies_when`, because report suppression
(`--no-report`, profile `report: false`) is recorded nowhere. Making the condition "`report.html`
exists" would be circular — the artifact's absence is precisely what a miss looks like. The contract
is therefore unconditional and the CLI annotates it `confounded by --no-report (not recorded)`.
Recording suppression in telemetry is a follow-up, not part of this item.

## Semantics

### Resolving a run to its transcripts

Collect every `agent_id` for the run from `_telemetry.json` and `.checkpoint/<phase>.json`
(`knownRunAgentIds`). For each, locate `…/projects/*/*/subagents/agent-<id>.jsonl`
(`findAgentTranscript`) and derive the owning session transcript
(`…/<session-id>/subagents/…` → `…/<session-id>.jsonl`).

Take the **union of every session** that owns at least one of the run's agents, not a single
session. A `--resume` run spans sessions, and an `enrich` invoked in the second one must not read as
a miss. Facts are concatenated in a stable order: sessions by mtime, then `seq` within each.

Never derive the session from the cwd. The harness files a session under the directory it *started*
in, so a worktree-isolated run resolves to an unrelated session — the same trap `SKILL.md` Step 5b(a)
documents.

### Verdicts

| verdict | meaning |
|---|---|
| `pass` | applicable, matched at the required cardinality |
| `partial` | `once-per-phase` only: matched fewer times than there are candidate phases (printed `4/7`) |
| `fail` | applicable, no match |
| `na` | not applicable, with a mandatory reason |

`na` reasons: `predates` (`since` later than the run's date), `not-applicable` (`applies_when` false),
`phase-skipped`.

`partial` is a separate state rather than a flavour of `fail` because for `3d-1b-phase-cost` partial
execution *is* the interesting signal — the cap gate goes blind on exactly the phases that were
missed — and collapsing it into `fail` discards that. It does **not** count as success in the rate.

The candidate denominator for `once-per-phase` is the set of phases that actually dispatched an
agent (have an `agent_id`); phases removed by skip rules yield `na: phase-skipped`.

### Unauditable runs

A run with no resolvable `agent_id` gets run-level status `unauditable(no-agent-ids)`. It enters
**no** contract's denominator and is printed on its own line. Folding such runs into the rate would
silently dilute it — 6 of the 18 corpus runs are in this state.

### Temporal validity, and the honest caveat

The run's date is `telemetry.started_at`; when absent, the mtime of `_telemetry.json`, flagged
`date-inferred` in the output. A contract whose `since` is later than the run date yields
`na: predates`.

`since` is a commit date in **this** repository — an upper bound on when the step could have reached
a downstream install, not evidence that it did. Until `plugin_version` appears in telemetry (added by
this item, but only populating on new runs), every published rate is **provisional**, and the CLI
prints that word. This matters directly to H4's gate: the decision to rewrite the orchestrator must
not rest on a number that silently assumes all 12 runs ran today's `SKILL.md`.

## Telemetry addition — `plugin_version`

`_telemetry.json` gains one field: `plugin_version`, so a future audit can tell whether a mandated
step had actually reached the install that produced the run, instead of inferring it from a commit
date in this repository.

**Written by `usage/cli.mjs enrich`, not by the orchestrator.** Per H3's machine-value invariant the
model must never transcribe a value a machine already holds: the enricher already rewrites telemetry
and already lives inside the plugin, so it reads `../../.claude-plugin/plugin.json` relative to its
own module URL and writes the `version` verbatim. Asking Step 5 to `cat` the manifest and copy the
number into JSON would add exactly the class of instruction this whole track exists to remove.

Two consequences, both accepted:

- `_telemetry.json` has **no schema** (`schemas/run.schema.json` validates `.checkpoint/_run.json`;
  telemetry is unvalidated). So there is no schema to extend — the field is additive and nothing
  rejects it. Giving telemetry a schema is a worthwhile but separate change.
- When `enrich` is skipped, `plugin_version` is absent — the very case the audit cares about. That
  is not circular, merely uninformative: such a run already fails `5b-0-enrich`, and its date-based
  `since` comparison stays `provisional`, exactly as for every pre-existing run.

## Output

Human-readable by default, `--json` for machine use. The default output has three parts:

1. **Per-contract aggregate** — the headline. For each contract: `pass / partial / fail / na`
   counts, the resulting rate, the denominator, and any annotation
   (`provisional`, `confounded by --no-report`, `thin denominator (n=3)`).
2. **Per-run detail** — one line per run, its date (marked `date-inferred` where applicable), and
   the non-`pass` verdicts.
3. **Excluded** — unauditable runs with their reason.

A denominator below 5 is annotated `thin denominator (n=N)` and its rate is printed but must not be
read as a measurement — this is what stops `3d-1b-phase-cost` from being reported as a clean number.

Exit code is `0` regardless of findings in v1: this is an instrument, not a gate.

## Testing

Fixture-based, following the existing `tools/sdlc-lint/fixtures/` + `test/*.test.mjs` convention.

- `transcript-facts.test.mjs` — a small synthetic session `.jsonl` fixture: `Bash`, `Agent`, `Write`
  and `Skill` blocks, plus a truncated final line, asserting extraction and ordering.
- `contracts.test.mjs` — parses a fixture `SKILL.md` with a valid set plus each error class
  (duplicate `id`, unknown `requires`, uncompilable `pattern`, bad `since`); asserts errors are
  returned, not thrown. Also asserts the **real** `SKILL.md` parses with zero errors, which is what
  keeps the shipped contracts honest.
- `compliance.test.mjs` — fixture run dirs under `fixtures/compliance-*`: one fully compliant, one
  reproducing the incident (`enrich` absent → `fail`), one `--resume`-shaped run whose match lives in
  the second session (asserts the union, not the newest-session, behaviour), one with no `agent_id`
  (`unauditable`), one predating a contract (`na: predates`), one with a skipped phase
  (`partial` with the right fraction).
- `compliance-report.test.mjs` — aggregation: the rate counts `pass` only (never `partial`),
  unauditable runs enter no denominator, a zero denominator yields `null` rather than `NaN`, and the
  `provisional` / `thin denominator` / confounder annotations appear where they should.

The verb is deliberately **not** added to `sdlc-lint all`. `all` is the CI gate and exits non-zero on
findings; `compliance` is diagnostic and reads transcripts that exist only on a developer's machine,
so wiring it into the gate would fail CI everywhere for reasons unrelated to the code under review.

## Definition of Done

1. Six `sdlc-contract` blocks in `SKILL.md`; `contracts.mjs` parses them with zero errors.
2. `plugin_version` written into `_telemetry.json` by `usage/cli.mjs enrich`.
3. `node tools/sdlc-lint/cli.mjs compliance --runs "$HOME/parlor-android/docs/plans/*"` runs clean
   and produces the three-part report.
4. The incident run is reported `fail` on `5b-0-enrich`. If it is not, the auditor is wrong.
5. **A published per-step compliance rate** — written into this note and summarised in
   [[planning/h-instruction-fidelity]] — carrying its denominators and the `provisional` caveat.
6. `node --test` green in `tools/sdlc-lint/`.

## What this decided

H1's only real product is the input to the H4 gate, which
[[planning/h-instruction-fidelity]] already fixed: ~95% compliance means H2 + H3 + H6 suffice and the
deterministic-runner rewrite is not worth it; ~80% means the rewrite is the only real fix.

**Measured: 82.3%.** That lands in neither pole cleanly, and this note's own added condition
applies — with `n=15`, a `provisional` qualifier, and one contract measuring nothing, a
near-boundary aggregate is not by itself a decision.

But the aggregate is the least informative number here. The **spread** decides: single-command
steps score 87–100%, the one multi-step procedure scores 67%. Rewriting the orchestrator as a
deterministic runner (H4) would fix the 67% — and so would collapsing that step into one command
(H2), at a fraction of the cost. So the ordering stands: **H2 and H3 first, then re-measure**;
H4 stays gated, now on evidence rather than on intuition.

The condition that would settle it: re-run this audit once **10 runs carry `plugin_version`**.
That removes the `provisional` qualifier, dates step availability exactly instead of by an upper
bound, and by then `3d-1b-phase-cost` will have a real denominator too. If compliance has not
moved above ~90% after H2 and H3 have landed, H4 is the answer.

## Out of scope

- **CI gating.** Diagnostic value first (`h-instruction-fidelity` H1); a check that fails a build
  needs a rate we do not yet have.
- **`text_match` on assistant output.** It would cover the fourth incident miss (the unprinted
  `WARN: cost enrichment incomplete`) but measures wording rather than action: a reworded warning
  reads as a false fail, a copied line as a false pass.
- **Live self-checking during a run.** That is H6's deterministic tail. Implementing it as prose
  instructing the orchestrator to audit itself would be self-refuting — a compliance check that is
  itself a probabilistic instruction.
- **Shipping the auditor in the plugin payload.** It stays a dev/CI tool in `tools/sdlc-lint/`,
  consistent with `PLUGIN-PATHS.md`.

## Follow-ups (not part of H1)

- **`SKILL.md` Step 3d-1b contradicts Step 5b(a) on session resolution.** 3d-1b instructs
  "encode the project cwd `/`→`-`, take the newest", while 5b(a) explicitly forbids exactly that
  ("Never encode the cwd to find it") and documents that it resolves to an unrelated session on
  worktree-isolated runs — under-reporting the run's largest cost bucket. Two steps of one file give
  opposite instructions for one operation; 3d-1b should adopt the agent-id anchor. Fix separately,
  with its own change note.
- **Record report suppression** (`--no-report` / `report: false`) in telemetry, so `5b-2-report`
  can carry a real `applies_when` instead of a confounding annotation.

## Related

- Parent track and the H4 gate this feeds: [[planning/h-instruction-fidelity]]
- The incident and its shipped mitigations: [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]] (#92)
- Same medium/message failure, earlier instance: [[decisions/ADR-0008-read-discipline-contract]]
- Machine anchor over model prose: [[decisions/ADR-0007-overhead-window-authoritative-anchor]]
- Roadmap entry: [[planning/roadmap]] (H1)
