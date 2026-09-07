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
| B4 | `session-recorder` run journal + measured run clock | done | #35 |
| C1 | AAR learning cycle `/sdlc:aar`    | done        | #27 |
| C2 | framework providers (WorkManager, Koin, Ktor, DataStore-Proto) | done | #29, #64 |
| D  | HTML run-report artifact          | done        | #26 |
| E  | pipeline cache/cost efficiency    | in-progress | #50 |
| E6 | deterministic prefix ordering (prompt-cache) | done — goal met, nothing to build | measured #142 |
| E7 | dynamic context pruning (review loops) | planned | — |
| E8 | micro-task batching — throughput half shipped as `/sdlc:batch`; init-cost amortization still open | in-progress | — |
| F1 | speculative TDD (QA ∥ Dev)        | planned     | — |
| F2 | fast-track bugfix DAG (LOC-gated) | planned     | — |
| G1 | self-healing compiler/lint micro-loops | done | #77 |
| G2 | contextual AAR lesson classification | planned  | — |
| H1 | transcript compliance auditor (`sdlc-lint compliance`) | done | #101, re-measured #117 |
| H2 | collapse multi-step prose into single commands (`run/cli.mjs finish`) | done | #103 |
| H3 | machine-value invariant + lint (`sdlc-lint machine-values`) | done | #104 |
| H4 | deterministic control flow (gated on H1) | gated, leaning against | — |
| H5 | prompt surface reduction / JIT procedure loading | measured, not decided | #110, #117 |
| H5-D2 | the run start is one command (`resolve/cli.mjs plan`, ADR-0019) | landed, DoD unmeasured | #119, #121, #125 |
| H6 | `Stop` hook sealing the run (deterministic tail) | done | #107 |
| I1 | agents in the core, expertise in the foundations (`role_expertise`, ADR-0021) | done, validated on a real run | #139, #140, #141, #142 |

_Open: E1, E3, E4, E7, E8, F1, F2, G2, and the two Track H re-measurements. (`kotlinx.serialization`
stays deferred under C2 — it needs a `serialization` aspect decision before it can land as a
provider.)_

_**B3 was dropped on 2026-09-07.** It sat as `(planned)` with the description "next Track B item —
scope TBD" for the life of the board: a placeholder that never acquired a scope, while everything it
might have covered was absorbed by tracks E through I. A row that reads as queued work but names
none is worse than no row._

**Track I — plugin topology.** I1 splits the marketplace along the line the framework plugins
already drew: the core owns every agent (process), a foundation owns expertise (skills, rules,
hooks, workflows, and a per-role `role_expertise` block the resolver renders into each agent's
stable prefix). Three PRs onto an integration branch, landed as #142; see
[[planning/i1-agents-in-core]] and
[[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]]. A real Android run on
the merged branch dispatched only core agents and mentioned no retired name anywhere, but it also
showed the cost of the move: expertise that used to be structurally guaranteed (an agent's own body)
now depends on the orchestrator pasting a block, and nothing gates that. PR-4 adds the gate.

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
([[decisions/ADR-0008-read-discipline-contract]]).

**E2's behavioural half is now measured on its first real downstream run, and it misses.** The DoD
was `peak_prefix_tokens` under 60k, down from a 101k baseline. The I1 validation run
(2026-09-06, a modular Compose app, 8 dispatches) records, per phase: documentation 44k,
security 53k, business_analysis 60k, review 77k, qa 80k, **development 121k**, **test 200k**. Five
of seven phases are over the threshold and two are above the baseline the contract was meant to pull
down. One run is not a verdict on the contract — a different project and a larger task both move
these numbers — but it is the measurement the DoD asked for, and it did not come back clean. Read it
next to the A/B result already recorded in [[planning/backlog]], where **both** arms met `<60k` and
the threshold was judged not to discriminate: taken together the honest reading is that
`peak_prefix_tokens < 60k` measures task size at least as much as read discipline, and E2's DoD
needs replacing before it can be passed or failed.

**E6 is closed as achieved rather than built.** Its goal was a byte-identical stable prefix for
maximum prompt-cache hits. The same validation run reports `cache_hit_ratio: 1.0` — 17.5M cached
input tokens against 577 uncached — across 11 dispatches, *with* the new `role_expertise` blocks
sitting in the prefix. There is no cache-hit headroom left to build for, so the item is done by
measurement.

Remaining on the track: E1 (trim the fixed floor), E3 (fewer turns), E4 (routing), E7 (prune context
inside review loops — the 200k `test` peak above is exactly its target), and the open half of E8.

**E8, precisely.** `/sdlc:batch` ships and covers the *throughput* half: it decomposes scope,
detects file conflicts, and dispatches worktree-isolated pipelines in parallel. It does **not**
deliver what E8 was specced for — amortizing initialization cost across 3–5 bugfixes — because each
dispatched pipeline still pays its own start window. That half stays open, and the I1 run put a
number on the prize: $8.75 of a $16.06 run was main-loop orchestration, more than all eight agents
combined ($7.31).

**Next evolutionary phase.** Goal: scale complex-task completion from ~70% → 90%, with
cost/throughput wins on micro-tasks. Three themes, mapped onto tracks; all items are specced in
[[planning/backlog]] — promote them here when scheduled. (The `§` references below point at the
repo-root `Roadmap Development Plan.md` that seeded these themes; **that file no longer exists**,
absorbed into [[planning/backlog]] when the vault became the SSOT. The section numbers are kept only
because the backlog entries still carry them.)

- **Track E (cost, extended)** — E6 deterministic prefix ordering (§1.1) is **closed as achieved**,
  see above; E7 dynamic Haiku context pruning inside review loops (§1.2); E8's remaining half —
  amortizing init cost across 3–5 bugfixes (§1.3), the parallel dispatch itself having shipped as
  `/sdlc:batch`.
- **Track F — time optimization & parallelism.** F1 speculative TDD running QA ∥ Dev after BA
  approval (§2.1); F2 LOC-gated fast-track DAG (`Dev → QA → Docs` when `LOC_TOUCHED < 20 AND
  NO_ARCHITECTURE_CHANGES`) (§2.2). Builds on the shipped `[security ‖ test]` group. F2's *mechanism*
  already exists — the skip-rules engine (#119) gates phases on `LOC_TOUCHED` and fired on the I1
  validation project's dry run — so what remains is the recipe, not the machinery.
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

**H1 landed 2026-07-28 and answered the question it was built for: the incident was not an outlier.**
Over 15 auditable runs the orchestrator executes its own mandated steps **82.3%** of the time
([[planning/h1-compliance-auditor]]). The useful signal is not the aggregate but its spread —
single-command steps score 87–100%, the one multi-step procedure (`5-clock`) scores 67% while
carrying the file's most emphatic prose. Compliance tracks how many separate things an instruction
asks for, not how firmly it asks.

**H2 and H3 both landed on 2026-07-29** (#103, #104) — the measurement pointed straight at them,
and both were far cheaper than H4. **The next step on this track is therefore the re-measurement,
not more building**: H4 stays gated until ~10 runs carry `plugin_version` on the new tail and
`sdlc-lint compliance` runs again. Neither shipped item can be credited before then — H2's own
contract still reports `n=0` and H3 adds no contract at all. This displaces
the previously flagged **E8 (micro-task batching)**, which stays
the top item on the cost track: a cost optimisation is worth less while the cost record itself is
unreliable. The plan summary's other flagged item, G1 (self-healing), already shipped in #77 (see
[[decisions/ADR-0010-self-healing-micro-loop]]), which is why it no longer appears here as a next
step.

**Track H, state on 2026-09-04.** H6 shipped in #107. H5 was measured in #110 and re-measured on a
doubled corpus in #117 (28 auditable runs, live-contract compliance 92.9%); the broad H5 decision
stays deferred, but its Direction 2 — the run start as one command,
[[decisions/ADR-0019-the-run-start-is-one-command]] — landed: the resolve command in #119, the
−808-line prose removal in #121, and the `sdlc-lint start-window` instrument its DoD depends on in
#125 (with #128 fixing the run-date chain that instrument reads). **The track's next step is still
the re-measurement**: ADR-0019's DoD is a before/after on the start window in API calls
(median 9 → 2–3) that needs real downstream runs on the new version, and H4 stays gated on ~10 runs
carrying the new tail (5 exist, all 5/5 on `5b-finish`).

**Track H, state on 2026-09-07 — the first post-2.0.0 run, and why it does not count.** The I1
validation run carries `plugin_version: 2.0.0` and scores 100% on all five live contracts, so the
H4 gate advances by one run. Its start-window number does **not** advance the H5-D2 DoD:
`sdlc-lint start-window` reports 9 API calls for Steps 0→1d, which looks like no movement against
the 9-call baseline — but the operator ran `/sdlc:start --dry-run` and the real `/sdlc:start` in the
**same session**, so both resolve invocations fall inside the window the tool measures. The number
is an artefact of the session shape, not a measurement of the collapsed start. Whoever measures next
must use a clean session, one `/sdlc:start`, no dry run. See [[planning/h-instruction-fidelity]],
[[planning/h5-prompt-surface]], [[planning/h5-d2-start-resolution-command]],
[[planning/h6-hook-deterministic-tail]].
