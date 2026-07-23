---
status: in-progress
---

# Roadmap

> Program tracks. Change notes link here via their `roadmap:` tag. See [[planning/_moc-planning]].

| Track | Item | Status | Landed in |
|-------|------|--------|-----------|
| A  | (foundation retune)              | done        | #23 |
| B1 | `--resume` checkpoints            | done        | #25 |
| B2 | cross-run rollup `/sdlc:report`   | done        | #28 |
| B3 | (planned)                         | planned     | — |
| B4 | `session-recorder` run journal + measured run clock | done | #35 |
| C1 | AAR learning cycle `/sdlc:aar`    | done        | #27 |
| C2 | framework providers (WorkManager, Koin, Ktor, DataStore-Proto) | done | #29, #64 |
| D  | HTML run-report artifact          | done        | #26 |
| E  | pipeline cache/cost efficiency    | in-progress | #50 |
| E6 | deterministic prefix ordering (prompt-cache) | planned | — |
| E7 | dynamic context pruning (review loops) | planned | — |
| E8 | micro-task batching (3–5 bugfixes) | planned | — |
| F1 | speculative TDD (QA ∥ Dev)        | planned     | — |
| F2 | fast-track bugfix DAG (LOC-gated) | planned     | — |
| G1 | self-healing compiler/lint micro-loops | planned | — |
| G2 | contextual AAR lesson classification | planned  | — |

_Remaining: B3. (`kotlinx.serialization` deferred — needs a `serialization` aspect decision before
it can land as a provider.)_

**Track E — pipeline cache/cost efficiency.** Now that per-run cost is measured accurately
(transcript-derived, #46; over-count fixed in #48), reduce the dominant cost driver: prompt-cache
reads. On a real 7-phase run, cache-read is **6.65M tokens across 117 subagent turns** — each turn
re-reads its whole accumulated prefix, so `cache_read ≈ turns × avg_prefix`. Split: **~27% fixed
boilerplate floor** re-read every turn, **~73% accumulated context**. Sub-items E1–E5 specced in
[[planning/backlog]]; promote here when scheduled.

**E5 (cache-pressure signal) shipped in #50 (1.8.0):** per-phase `reads/turn` +
`peak_prefix_tokens` in the report and `cache_pressure_phases` in the AAR. Remaining: E2
(surgical reads), E1 (trim floor), E3 (fewer turns), E4 (routing).

**Next evolutionary phase — from the Roadmap Development Plan (repo-root `Roadmap Development
Plan.md`).** Goal: scale complex-task completion from ~70% → 90%, with cost/throughput wins on
micro-tasks. Three themes, mapped onto tracks; all items specced in [[planning/backlog]], promote
here when scheduled.

- **Track E (cost, extended)** — E6 deterministic prefix ordering for max cache hits (plan §1.1);
  E7 dynamic Haiku context pruning inside review loops (§1.2); E8 micro-task batching that
  amortizes init cost across 3–5 bugfixes via `/sdlc:batch` (§1.3).
- **Track F — time optimization & parallelism.** F1 speculative TDD running QA ∥ Dev after BA
  approval (§2.1); F2 LOC-gated fast-track DAG (`Dev → QA → Docs` when `LOC_TOUCHED < 20 AND
  NO_ARCHITECTURE_CHANGES`) (§2.2). Builds on the shipped `[security ‖ test]` group.
- **Track G — quality & autonomy.** G1 self-healing compiler/lint micro-loops feeding `stderr` back
  to Dev, hard-capped at 2 attempts before escalating to Reviewer (§3.1); G2 semantic tagging of AAR
  lessons so phases load only domain-relevant lessons, extending Track C1 (§3.2).

**Highest-ROI next steps (per plan summary): G1 (self-healing) + E8 (micro-task batching)** — they
eliminate trivial blockers and cut cost-per-ticket most directly.
