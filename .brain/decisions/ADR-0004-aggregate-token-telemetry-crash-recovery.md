---
adr: 4
status: accepted
date: 2026-07-07
supersedes: null
---

# ADR-0004 — Aggregate subagent-token telemetry + crash-recovery policy

## Context

An After Action Review of run `brain-rudderstack-phase-b` surfaced two systemic gaps in how the
pipeline orchestrator (`plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`) records a run, plus a
cluster of smaller workflow-doc drift. The two that warrant a decision:

1. **Per-phase telemetry silently zeroed all tokens.** Step 3d-1 was written to read a split
   `input_tokens` / `output_tokens` / `cached_input_tokens` triple from the Agent result envelope.
   The actual harness envelope exposes only a single aggregate — `<usage>subagent_tokens: N,
   tool_uses, duration_ms</usage>` — with no split. So the "otherwise estimate (char/4)" branch
   always fired, cached tokens were always 0, and the AAR dashboard (`tools/aar/metrics.mjs`, which
   coerces missing token fields to 0) reported all-zero usage and a misleading `cache_hit_ratio: 0`.
2. **Crash recovery was unspecified and mis-recorded.** When a dev agent died mid-response, the run
   spawned a *fresh* `Agent` that re-`Read` most of the task (~2× tokens), yet `_telemetry.json`
   labelled it a same-session resume. There was no rule preferring an in-session resume, and no
   field distinguishing the two recovery mechanisms (the existing `origin: resumed|fresh` describes
   cross-session checkpoint resume — a different concept).

## Decision

**Telemetry — capture the aggregate verbatim instead of estimating.** Step 3d-1 now recognizes
three envelope shapes in priority order: (1) a split triple → `usage_source: "reported"`; (2)
aggregate-only → record `subagent_tokens` **verbatim**, `usage_source: "subagent_aggregate"`, and
`cost_usd: null` (an aggregate can't be priced without a split); (3) no usage → char/4 estimate,
`usage_source: "estimated"`. Step 5 sums `total_subagent_tokens` and sets `cache_hit_ratio: null`
(honest "unknown") when no phase reported a real cached subset, rather than a 0 that reads as "zero
cache hits". `metrics.mjs` surfaces `subagent_tokens` at the top level, per phase, and in
`top_consumers`. New checkpoint fields (`subagent_tokens`, `tool_uses`, `duration_ms`, the
`usage_source` enum value, and `recovery`) are registered in `schemas/checkpoint.schema.json` (it is
`additionalProperties:false`, and the checkpoint *is* the `phases[]` element).

**Crash recovery — resume first, and record which mechanism ran.** On a mid-response server-error
crash of any dispatched agent, attempt `SendMessage` resume of the same `agentId` FIRST; fall back
to a fresh `Agent` only if resume fails. The phase records a `recovery` field
(`sendmessage-resume` | `fresh-restart`) so cost attribution and future AARs are not misled. Codified
in `android-foundation/rules/workflow.md` Step 2, consumed by orchestrator Step 5.

Accompanying (non-decision) AAR remediation shipped in the same change: worktree-first workspace
resolution in orchestrator Step 2 (run `git worktree list` before any stash/checkout when the brief
names an explicit worktree path); point-of-use Skill self-checks + a `row: Developer`→`row:
android-developer` label fix in the android agents; a documented `haiku→sonnet` docs-phase escalation
for outward `gh pr create` + submodule commits; and de-hardcoding Kermit to "the project's logger
(Kermit if present)" in the logging rules.

Rejected alternatives: **fabricating an input/output split** from the aggregate (invents cache/cost
numbers that look authoritative but are fiction); **keeping the char/4 estimate** (discards real
measured usage the harness *does* provide); **overloading `origin`** to also mean crash-recovery
(conflates cross-session checkpoint resume with in-run crash recovery — two orthogonal axes).

## Consequences

- The AAR dashboard shows real usage (e.g. 211,907 tokens) instead of all-zero; `cache_hit_ratio`
  is `null` when genuinely unknown, so consumers can distinguish "no cache" from "not measured".
- Cost is `null` for aggregate-only phases (excluded from `total_cost_usd`) — accurate but partial;
  precise per-phase cost returns automatically on any harness that exposes a split triple.
  **Superseded by [[decisions/ADR-0005-transcript-derived-cost]]:** cost no longer stays `null` —
  it is recovered from each phase's subagent transcript (which carries the real split the envelope
  omits) and priced deterministically at report time. The "never fabricate a split" principle here
  is preserved; only the "leave cost null" outcome changed.
- Crash recovery now has a defined policy and an auditable `recovery` label; the honest caveat
  stands — resume replays context, so the saving is the avoided redundant re-reads, not a dramatic
  token cut.
- Schema/metrics/SKILL field names are kept in lockstep; the sdlc-lint suite (82 tests) and
  `schemas/checkpoint.schema.json` validation both cover the new fields.
- These fixes live in **plugin source**; the AAR originally targeted the plugin *cache*
  (`~/.claude/plugins/cache/…`), whose edits are clobbered on update.

## Related
- Implemented by: #44
- Relates to: [[architecture/pipeline-orchestrator]] / [[components/sdlc]] / [[components/android-foundation]]
