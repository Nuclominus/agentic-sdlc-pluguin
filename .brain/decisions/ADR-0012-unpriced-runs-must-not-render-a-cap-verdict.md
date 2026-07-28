---
adr: 12
status: accepted
date: 2026-07-28
supersedes: null
---

# ADR-0012 — An unpriced run must not render a cap verdict

## Context

A real run (`native-chat-engine-s2-thread-list`, an Android S2 slice) finished and produced an HTML
report whose cost KPI read `— · $16.50 cap · within`. Every phase carried `cap_gate_blind: true`,
`cost_basis` was `"subagent_aggregate"`, and `total_cost_usd` was `null`.

Re-running `usage/cli.mjs enrich` afterwards, against transcripts that were on disk the whole time,
priced the run at **$15.38 — 93% of its cap**. Nothing had exceeded the cap, but nothing had checked
either, and the report said `within` in the same typeface it uses for a verdict that was actually
computed.

The session transcript shows the cause: across 42 `Bash` calls, `tools/report/cli.mjs` was invoked
once and `tools/usage/cli.mjs` **never**. Neither Step 3d-1b (the in-run cap gate's pricing call,
[[decisions/ADR-0011-in-run-transcript-pricing-for-the-cost-cap]]) nor Step 5b-0 (end-of-run
enrichment, [[decisions/ADR-0005-transcript-derived-cost]]) ran. Both live as prose instructions in
`pipeline-orchestrator/SKILL.md`, so skipping them costs nothing and leaves no trace — including
Step 5b(c)'s `WARN: cost enrichment incomplete`, which is part of the same prose that went missing.
This is the failure mode already recorded as "machine contracts cannot live in prose": the only
consumers that can enforce a contract are the tools that read the state file.

`cap_status` is written by the in-run gate, which prices an unresolvable phase at `$0`. Enrichment
is what promotes it from a provisional record to a verdict — it holds the real per-phase prices and
rewrites a contradicted `"within"` to `"exceeded-undetected"` (Step 5b(d)). Before enrichment runs,
`"within"` does not mean "the run stayed under cap"; it means "nothing ever checked".

A second defect sat behind the first. Step 5b(a) told the orchestrator to locate its own session
transcript by encoding the **current cwd** and taking the newest `*.jsonl` there. The harness files
a session under the directory it **started** in, so any run that moves into a git worktree — every
`/sdlc:batch` task by construction, and this run, whose main loop spent 196 of 247 events inside the
worktree — has its transcript filed under the original project dir while the cwd now encodes to the
worktree's. Measured on this run: a cwd-derived `--session` resolves to an unrelated session, phase
costs still survive (`findAgentTranscript` globs the whole projects root) but orchestration overhead
is priced against a stranger's main loop, reporting **$0.55 instead of $5.21** — a third of the run's
true cost — while the output still reads as a successful enrichment.

## Decision

**A cost verdict must attest to the pricing behind it.** `cap_status` is rendered as a verdict only
when `total_cost_usd != null` **and** `cost_basis == "transcript"`. Otherwise the report prints
`unverified — run unpriced`, flags the cost tile, and emits a `Cost: unpriced` signal naming the
`cap_gate_blind` phases. `tools/report/cli.mjs` additionally writes a stderr `WARN` so the condition
reaches the run log without anyone opening the HTML. `total_cost_usd` alone is not sufficient: an
`estimated` or `subagent_aggregate` basis carries a number that never went through transcript
pricing.

**Session transcripts are located by agent id, never by cwd.** Step 5b(a) now anchors on an
`agent_id` the run actually dispatched (`{CONFIG_DIR}/projects/*/*/subagents/agent-<id>.jsonl` → the
session dir + `.jsonl`), and omits `--session` when that lookup fails, since `enrichTelemetry`
recovers the session from a resolved phase transcript on its own. `enrichTelemetry` enforces this
independently: a `--session` whose subagents dir contains none of the run's known agent ids
(`sessionOwnsRun`) is discarded, reported as `session_mismatch`, and replaced by self-recovery. A
run with no known agent ids anywhere (a backfill) still trusts the session it is handed — there the
dispatch map is the only source, and nothing exists to check it against.

## Consequences

- A skipped enrichment is now visible in three machine-written places (report KPI, report signal,
  CLI stderr) instead of zero. None depends on the orchestrator remembering anything.
- `cap_status: "within"` on an unpriced run is no longer readable as assurance. The remedy is to run
  the enrich command; hand-editing `cost_basis` / `cap_status` / `total_cost_usd` to silence the
  warning is explicitly called out in SKILL.md Step 5b(c) as the thing not to do.
- Worktree-isolated pipelines price their orchestration overhead correctly. On the observed run the
  guard alone (with the wrong `--session` still passed) recovers $15.38 / $4.82 overhead against
  $11.11 / $0.55 before.
- `renderReportFile` returns `cap_unverified`; `enrichTelemetry` returns `session_mismatch`. Both
  are additive.
- The report fixture gained `cost_basis: "transcript"` — it models a normally enriched run, and
  without the field every test using it would have exercised the warning path.
- Not addressed here: the orchestrator can still skip the enrich call entirely. This ADR makes that
  skip *loud*, not impossible. Making it structurally unskippable is a separate change.

## Related
- Implemented by: `plugins/sdlc/tools/report/report.mjs` (`capVerified`, `kpiSection`, `signalsSection`, `renderReportFile`), `plugins/sdlc/tools/report/cli.mjs`, `plugins/sdlc/tools/usage/usage.mjs` (`sessionOwnsRun`, `knownRunAgentIds`, `enrichTelemetry`), `plugins/sdlc/tools/usage/cli.mjs`, `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (Step 5b(a), 5b(c)); PR pending.
- Guards the record written by: [[decisions/ADR-0011-in-run-transcript-pricing-for-the-cost-cap]]
- Depends on the pricing path of: [[decisions/ADR-0005-transcript-derived-cost]]
- Same failure shape as: [[decisions/ADR-0007-overhead-window-authoritative-anchor]] (a cost silently reading as zero/`null` instead of unknown)
- Relates to: [[architecture/pipeline-orchestrator]] / [[components/sdlc]]
