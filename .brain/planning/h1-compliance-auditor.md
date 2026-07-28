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

## Architecture

Four units, each with a single responsibility. The boundary that matters: `compliance.mjs` parses
neither JSONL nor Markdown, and `cli.mjs` computes no verdicts.

### `tools/sdlc-lint/lib/transcript-facts.mjs` (new)

The only unit that knows the session `.jsonl` format. Input: a transcript path. Output: a flat,
ordered array of facts, one per `tool_use` block found in `assistant` messages:

```js
{ seq, tool, command, subagent_type, path, raw }
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

`SKILL.md` Step 5 gains one field in `_telemetry.json`: `plugin_version`, read from the installed
plugin's manifest rather than transcribed by the model (per H3's machine-value invariant — the
contract passes the path, never the number). `schemas/run.schema.json` gains the optional property.
It is optional, so every historical run stays schema-valid, and the auditor treats its absence as
"fall back to `since`-by-date, mark provisional".

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
- `negative.test.mjs` / `all.test.mjs` — extended so the new verb participates in the existing
  aggregate run.

## Definition of Done

1. Six `sdlc-contract` blocks in `SKILL.md`; `contracts.mjs` parses them with zero errors.
2. `plugin_version` written by Step 5, present in `run.schema.json` as optional.
3. `node tools/sdlc-lint/cli.mjs compliance --runs "$HOME/parlor-android/docs/plans/*"` runs clean
   and produces the three-part report.
4. The incident run is reported `fail` on `5b-0-enrich`. If it is not, the auditor is wrong.
5. **A published per-step compliance rate** — written into this note and summarised in
   [[planning/h-instruction-fidelity]] — carrying its denominators and the `provisional` caveat.
6. `node --test` green in `tools/sdlc-lint/`.

## What this decides

H1's only real product is the input to the H4 gate, which
[[planning/h-instruction-fidelity]] already fixed: ~95% compliance means H2 + H3 + H6 suffice and the
deterministic-runner rewrite is not worth it; ~80% means the rewrite is the only real fix. This note
adds one condition to that rule: with `n=12`, a `provisional` qualifier, and one contract measuring
nothing, a result near the boundary is not a decision — it is a reason to keep measuring on new runs
until `plugin_version` makes the denominator exact.

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
