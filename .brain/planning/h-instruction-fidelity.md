---
status: planned
---

# Track H — instruction fidelity

> Design spec for [[planning/roadmap]] **Track H**. Goal: make the orchestrator's own procedure
> execute as written, instead of as paraphrased. Motivated by a measured incident, not a
> hypothesis. See [[planning/_moc-planning]].

## The problem, as measured

`pipeline-orchestrator/SKILL.md` is 2453 lines of prose that an LLM reads and executes. Prose read
by a model is a **probabilistic** instruction: better wording raises the odds of compliance but
never reaches 1. On the Android run `native-chat-engine-s2-thread-list` (2026-07-28) four separate
mandated steps were silently not executed, all in the same run:

| Mandated step | What happened | Cost of the miss |
|---|---|---|
| 3d-1b — price each phase in-run | never invoked | cap gate blind on all 6 phases |
| 5b-0 — enrich cost from transcripts | never invoked | run reported `$—` against a real $15.38 |
| 5b(c) — `WARN: cost enrichment incomplete` | never printed | the two misses above stayed invisible |
| 5 — render timestamps from `.checkpoint/_started_at` via `date -u -r` | hand-transcribed local clock stamped `Z` | run window off by 3h20m |

Ground truth: across 42 `Bash` calls in that session, `tools/usage/cli.mjs` appears **zero** times.
Nothing failed — the steps simply did not run, and the run reported success. **ADR-0012** (landing
with #92) records the incident and the mitigations already shipped, which make these misses *loud*
but do not make them *impossible*.

This is the same lesson as
[[decisions/ADR-0008-read-discipline-contract]] and the "machine contracts cannot live in prose"
finding from the G1 validation runs, generalised: **the failure is not that the prose was unclear.
It is that prose is the wrong medium for a procedure.**

## The principle

Four levels of reliability. The work of this track is moving load-bearing steps *down* the table.

| Level | Form | Reliability |
|---|---|---|
| 1 | prose in `SKILL.md` ("do X") | probabilistic — what broke |
| 2 | prose + machine verification after the fact | deviation becomes visible, but only afterwards |
| 3 | one command replacing N prose steps | far smaller surface to skip |
| 4 | code (deterministic runner / tool) | total — but only where no judgement is needed |

Corollary: **the instruction that cannot be executed wrongly is the one that does not exist.** The
target is not a more emphatic `SKILL.md`; it is a smaller one.

## Phases

### H1 — Transcript compliance auditor (do first)

A new `sdlc-lint compliance <session.jsonl> --run <slug>` verb: check a machine-readable manifest of
required steps against what the session transcript shows the orchestrator actually did. The
transcript is the only ground truth for "was the instruction followed" — this is precisely the
manual analysis that found the incident (grep for `usage/cli.mjs` across the run's Bash calls),
turned into a tool.

Manifest entries are observable facts, not intentions — e.g. `usage/cli.mjs phase-cost` invoked once
per phase; `usage/cli.mjs enrich` invoked once per run; `report/cli.mjs` invoked; a `date` call
between reading `_started_at` and writing telemetry.

**DoD:** run over every historical run in `docs/plans/` and `bench/results*` that still has a
transcript, and publish a **compliance rate per step**. That number decides H4's scope — right now
we do not know whether this run was an outlier or whether the orchestrator routinely skips ~20% of
its own procedure. Diagnostic value first; CI gating second.

### H2 — Collapse multi-step prose into single commands

Step 5b is currently four separate prose sub-steps (enrich → verify → cap reconcile → render). One
`cli.mjs finish <slug>` doing all of it end-to-end leaves the model one chance to deviate instead of
four. Same treatment for any other multi-call sequence the audit in H1 flags as frequently partial.

**DoD:** the count of *mandated tool invocations* in `SKILL.md` drops measurably; H1's compliance
rate for the collapsed steps rises.

### H3 — The machine-value invariant

A rule with lint teeth: **the model never transcribes a value a machine already holds.** Timestamps,
costs, token counts, agent ids, iteration counters. Three of the four defects above are instances of
this. Where a value exists on disk, the contract must pass the *path*, never the number.

**DoD:** an audit of `SKILL.md` for every place it asks the model to produce a machine-known value,
each one either removed or justified in writing; a `sdlc-lint` check that fails on new ones.

### H4 — Deterministic control flow

The largest lever and the largest cost. Today "the orchestrator" is an LLM reading 2453 lines and
deciding phase sequencing, gates, checkpoints and telemetry assembly for itself. The alternative is a
real runner: control flow in code, LLM agents only for the phases that need judgement. Then
compliance stops being a property to measure and becomes a property of the program.

**Gated on H1's numbers.** If compliance is ~95%, H2 + H3 + H6 are enough and this is not worth the
rewrite. If it is ~80%, this is the only real fix. Do not start it before that data exists.

### H5 — Prompt surface reduction

2453 lines is itself a compliance risk: adherence degrades with volume, and with the distance
between where a rule is written and the moment it applies. Just-in-time loading of procedure
fragments beats any amount of emphasis inside a monolith. Overlaps with Track E's cost goals — a
smaller stable prefix is also cheaper — so measure both effects together.

### H6 — Hooks as the deterministic tail

A `Stop` hook (`plugins/sdlc/hooks/seal-run.sh`) that runs `enrich` + report rendering itself, so
the sealing of a run is not a step the model owns at all. Idempotent via a `.checkpoint/_sealed`
marker, scoped by recency, failing open. Only possible *because* the enricher became self-sufficient
in #92 (agent-id-anchored session lookup — it needs no argument the model would have had to supply).

Explicit limits, so this is not oversold: a hook enforces **state**, never intent; it cannot fire if
the session is killed before `Stop`; and it repairs after the fact, so it can do nothing for a value
consumed *during* the run (the 3d-1b cap gate stays the orchestrator's responsibility).

## Order and dependencies

```
H1 (diagnose) ──► decides scope of H4
   │
   ├─► H2 (collapse)   ─┐
   ├─► H3 (invariant)   ├─► re-measure with H1
   └─► H6 (hook tail)  ─┘
H5 runs alongside, shared with Track E
```

H1 is deliberately first and cheap. Everything after it is sized by its output rather than by
intuition.

## Out of scope — what this track cannot deliver

Steps requiring judgement stay probabilistic: writing an honest summary, choosing the right ADR,
noticing the fail-open defect the reviewer missed in the same run. For those, detection after the
fact is the only instrument. The guarantee this track offers extends exactly as far as the part of
the procedure a machine can perform or verify — and not one step further.

## Related

- Incident and the shipped mitigations: `decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict`
  (#92). Deliberately plain text, not a wikilink — the note lands with that PR, and a wikilink to a
  note that does not exist yet fails `brain-sync check`. Upgrade it after the merge.
- Same medium/message failure, earlier instance: [[decisions/ADR-0008-read-discipline-contract]]
- Machine anchor over model prose: [[decisions/ADR-0007-overhead-window-authoritative-anchor]]
- Shares the prompt-size goal with Track E in [[planning/backlog]]
