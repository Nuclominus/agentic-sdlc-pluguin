# AAR extraction contract (`gather.md`)

The analyst distills two sources. **Telemetry-first**, transcript best-effort.

## From the metrics dashboard (authoritative — do not recompute)

`metrics_json` (produced by `tools/aar/metrics.mjs` from
`docs/plans/{slug}/_telemetry.json`) supplies ALL cost/token numbers:

- `totals` — input/output/cached tokens, `cost_usd`, `cost_cap_usd`,
  `cap_status`, `cache_hit_ratio`, `wall_clock_seconds`.
- `by_phase` — per-phase agent, model, status, tokens, cost.
- `by_model` — cost/token aggregation, `unpriced` count.
- `top_consumers` — the 5 heaviest phases by tokens.
- `qa_iterations`, `cap_breach`, `unpriced_phase_count`, `skip_rules_count`,
  `post_check_failures`.

Never re-derive these from the transcript.

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
