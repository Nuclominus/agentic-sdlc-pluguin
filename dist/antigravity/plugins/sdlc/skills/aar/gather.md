# AAR extraction contract (`gather.md`)

The analyst distills two sources. **Telemetry-first**, transcript best-effort.

## From the metrics dashboard (authoritative — do not recompute)

`metrics_json` (produced by `tools/aar/metrics.mjs` from
`docs/plans/{slug}/_telemetry.json`) supplies ALL cost/token numbers:

- `totals` — input/output/cached tokens, `cost_usd`, `cost_cap_usd`,
  `cap_status`, `cache_hit_ratio`, `wall_clock_seconds`.
- `by_phase` — per-phase agent, model, status, tokens, cost.
- `cache_pressure_phases` — phases whose worst-case per-turn prompt-cache read
  (`peak_prefix_tokens`) tripped the cache-pressure threshold (~80k), each with
  `reads_per_turn`. These are the top targets for cache-read reduction.
- `by_model` — cost/token aggregation, `unpriced` count.
- `top_consumers` — the 5 heaviest phases by tokens.
- `qa_iterations`, `cap_breach`, `unpriced_phase_count`, `skip_rules_count`,
  `post_check_failures`.

Never re-derive these from the transcript.

## Cost-shape heuristic (apply before drafting findings)

Dispatch cost is not linear in phase count — a phase's own cost grows with the context it
carries (prior phase summaries, tool output, its own turns), so the SAME dollar saving is
available two ways with very different leverage:

- **Cutting a phase** (a skip-rule, merging two phases, or a workflow recipe with fewer
  steps for this task shape) removes that phase's entire cost AND the marginal cost every
  later phase paid to carry its context forward.
- **Re-tiering one phase's model** (e.g. opus → sonnet) saves only that phase's own
  cost delta; every later phase still pays to carry the (unchanged) context forward.

When `by_phase` shows one phase as the dominant cost driver AND that phase's presence in
this run was optional (a skip-rule that did not fire, or a workflow variant that omits it
for this task shape), prefer recommending the phase-level cut over a model-tier downgrade
for the same phase — name both options if genuinely unsure which the operator would want,
but rank the cut first with the reason ("saves the phase's own cost and what later phases
paid to carry it, not just this phase's marginal cost").

## From the session transcript (best-effort, honestly labeled)

Parse with a small Bash + Python script; distill — never load raw JSONL into
reasoning context. Extract cooperation signals that live nowhere else:

- **Review-loop rounds** — count Reviewer⇄Developer (or the workflow's loop
  phase) round-trips; compare to the workflow's `max_rounds` cap. Flag thrash
  (hit the cap) or churn.
- **Parallelism** — were phases declared parallel (`[security ‖ test]`) actually
  dispatched in a SINGLE assistant message? Flag serialized "parallel" groups.
- **Redundant work** — the same file `Read` by multiple agents across phases;
  repeated identical tool calls.
- **Verification gaps** — phases that claimed completion without running the
  verification the workflow expects.
- **Escalations / blockers** — `blockers: [...]` envelopes, loop-cap escalations.
- **Mandatory-skill adherence** — did agents invoke the skills their profile
  marks mandatory?

Attribute sidechain turns (`isSidechain: true`) to their spawning `Task`
(`subagent_type`) via `parentUuid`. Best-effort; state assumptions, never
fabricate splits.

## Grounding

Before proposing any edit, `Read` the current target file so the recommendation
quotes real text and a real line range.
