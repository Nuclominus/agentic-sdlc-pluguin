---
status: planned
---

# Backlog

> Open items to promote to a [[planning/roadmap]] track when scheduled.

## Track E — pipeline cache/cost efficiency

Grounded in a real 7-phase Android run (`change-matches-filter-logic-gender`), measured with the
transcript-derived usage tool after the #48 over-count fix. **Baseline: 6.65M cache-read tokens
across 117 subagent turns**, plus ~2.19M more on the orchestrator main-loop. Cost is dominated by
cache reads because prompt caching bills every token at 0.1× **but on every turn** — each subagent
turn re-reads its entire accumulated prompt prefix, so `cache_read ≈ turns × avg_prefix`.

Measured anatomy of the 6.65M (deduped, per `message.id`):

| Component | Share | What it is | Per-turn size |
|-----------|-------|-----------|---------------|
| Fixed floor | ~27% (1.77M) | Boilerplate re-read every turn: harness system prompt + tool schemas + agent `.md` + injected `_brief`/prior-phase context | sonnet ~12k, opus ~14k, docs ~21k |
| Growth | ~73% (4.88M) | Accumulated file reads, tool outputs, thinking, Edit/Write bodies — re-read on every later turn; prefix grows to 100k+ (dev) | rises 15k → 101k |

Only part of the floor is addressable by the plugin (agent `.md` + what the orchestrator injects
into each Task prompt); the harness system prompt + tool schemas are fixed. Growth is fully
addressable via agent behavior guidance.

Ordered by leverage (measure first, then the two cheap high-impact guidance items, then structural):

### E5 — Cache-pressure signal in report + AAR *(enabler, low effort)*
Add a per-phase **reads-per-turn** and **peak-prefix** signal to `tools/report` and surface it in
the `sdlc:aar` findings, so cache regressions are visible and heavy phases get flagged. The report
already carries the billed split (#46); this adds `cache_read / turns` and `max(cache_read per turn)`.
Turns E1–E3 from guesswork into a tracked, regression-testable metric. Connects Track C1 (AAR) + D
(report). **DoD:** report shows reads/turn + peak-prefix per phase; AAR flags any phase whose
reads/turn exceeds a threshold. No ADR needed.

### E2 — Surgical reads + terse tool output *(guidance, targets the 73% growth)*
Instruct pipeline agents (in their `.md` and/or the orchestrator brief) to: read with `offset/limit`
and grep-first instead of whole large files; never re-read a file already in context; keep Bash/
verification output terse. Growth is 73% of reads and the prefix balloons to 100k+ when agents pull
whole files; flattening growth is the single biggest lever. **DoD:** peak-prefix on a comparable run
drops (target <60k from 101k); no quality regression in review/test/qa verdicts. Guidance-only, no
code. May warrant an ADR if it changes agent contracts materially.

### E1 — Trim the addressable fixed prefix (floor) *(structural)*
Shrink what rides in **every** subagent turn: agent `.md` verbosity, and the `_brief`/prior-phase
context the orchestrator injects into each Task prompt (pass a compact digest, not full prior
outputs). Every 1k shaved off the floor saves ~turn-count reads per phase (117 turns/run). `docs`
is the worst offender — 21k floor, 50% of its reads. **DoD:** floor per turn ≤10k avg (from
12–21k); est. ~0.5M reads/run saved. Likely needs an ADR (touches the orchestrator↔subagent
contract) — see [[decisions/_moc-decisions]].

### E3 — Reduce turn count *(multiplier on both floor and growth; quality-risky)*
Fewer tool round-trips per phase: batch parallel reads, collapse edit→re-verify loops, avoid
redundant tool calls. `development` (39 turns) and `documentation` (23) are the outliers. Turn count
multiplies both the floor and the growth, so cuts compound. Highest risk of hurting output quality —
schedule after E5 gives a safety metric. **DoD:** turns/phase down on the outliers with review/test/
qa verdicts unchanged.

### E4 — Model routing for cache-heavy context *(low leverage; note only)*
Cache-read costs 0.5 (opus) / 0.2 (sonnet) / 0.1 (haiku) per MTok — 5× spread. Most phases are
already tiered sensibly (docs=haiku, most=sonnet, BA=opus). Residual: the **orchestrator main-loop**
runs on opus and its own context re-reads cost ~$1.10/run; and confirm no opus is placed on a
cache-heavy, low-reasoning phase. Low expected savings vs. E1–E3 — track but do not over-invest.
Depends on the `config/models.json` pricing SSOT in [[components/sdlc]].

---

_All other `CORE-TODO.md` sections are `DONE`/`DROPPED` — no legacy remainder to carry forward._
