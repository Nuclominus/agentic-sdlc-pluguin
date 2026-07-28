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
| G1 | self-healing compiler/lint micro-loops | done | #77 |
| G2 | contextual AAR lesson classification | planned  | — |
| H1 | transcript compliance auditor (`sdlc-lint compliance`) | planned | — |
| H2 | collapse multi-step prose into single commands | planned | — |
| H3 | machine-value invariant + lint | planned | — |
| H4 | deterministic control flow (gated on H1) | planned | — |
| H5 | prompt surface reduction / JIT procedure loading | planned | — |
| H6 | `Stop` hook sealing the run (deterministic tail) | planned | — |

_Remaining: B3. (`kotlinx.serialization` deferred — needs a `serialization` aspect decision before
it can land as a provider.)_

**Track E — pipeline cache/cost efficiency.** Now that per-run cost is measured accurately
(transcript-derived, #46; over-count fixed in #48), reduce the dominant cost driver: prompt-cache
reads. On a real 7-phase run, cache-read is **6.65M tokens across 117 subagent turns** — each turn
re-reads its whole accumulated prefix, so `cache_read ≈ turns × avg_prefix`. Split: **~27% fixed
boilerplate floor** re-read every turn, **~73% accumulated context**. Sub-items E1–E5 specced in
[[planning/backlog]]; promote here when scheduled.

**E5 (cache-pressure signal) shipped in #50 (1.8.0):** per-phase `reads/turn` +
`peak_prefix_tokens` in the report and `cache_pressure_phases` in the AAR.
**E2 (surgical reads) landed in 1.10.0** — read-discipline contract in the orchestrator stable
prefix, four agent contracts de-contradicted, enforced by `sdlc-lint read-discipline`
([[decisions/ADR-0008-read-discipline-contract]]). Its behavioural half is **landed but unmeasured**:
`peak_prefix_tokens` < 60k (from the 101k baseline) is verified on the next real downstream run.
Remaining: E1 (trim floor), E3 (fewer turns), E4 (routing).

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
  to the phase's own agent, hard-capped at 2 attempts before recording a blocker and continuing
  (§3.1) — **done in #77**, see [[decisions/ADR-0010-self-healing-micro-loop]]; G2 semantic tagging
  of AAR lessons so phases load only domain-relevant lessons, extending Track C1 (§3.2).

**Track H — instruction fidelity. PRIORITY track; spec in [[planning/h-instruction-fidelity]].**
On the Android run `native-chat-engine-s2-thread-list` (2026-07-28) four mandated `SKILL.md` steps
were silently not executed in a single run — including both cost-pricing calls, which is why a
$15.38 run reported `$— · $16.50 cap · within`. Ground truth: `tools/usage/cli.mjs` appears **zero**
times across that session's 42 `Bash` calls. #92 made those misses loud
([[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]]); it did not make them
impossible. The track's premise is that prose read by a model is a
probabilistic instruction, so the fix is to move load-bearing steps out of prose (H2, H3, H4, H6)
rather than to word it more firmly — and to **measure compliance first** (H1) so the scope of the
expensive item (H4, deterministic control flow) is decided by data instead of by this one incident.

**Highest-ROI next step: H1 (transcript compliance auditor)**, then H2 and H3 — cheap, purely
diagnostic, and it sizes everything after it. We currently cannot tell whether the incident was an
outlier or whether the orchestrator routinely skips part of its own procedure; H1 answers that from
transcripts we already have on disk. H2 and H3 need no such data and can run alongside. It displaces
the previously flagged **E8 (micro-task batching)**, which stays
the top item on the cost track: a cost optimisation is worth less while the cost record itself is
unreliable. The plan summary's other flagged item, G1 (self-healing), already shipped in #77 (see
[[decisions/ADR-0010-self-healing-micro-loop]]), which is why it no longer appears here as a next
step.
