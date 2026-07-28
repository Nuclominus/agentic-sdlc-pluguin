---
adr: 15
status: accepted
date: 2026-07-29
supersedes: null
---

# ADR-0015 — The model never computes a value a machine already writes

## Context

Three of the four defects in the incident that opened [[planning/h-instruction-fidelity]] were the
same defect wearing different clothes: the orchestrator was asked to produce a value that already
existed on disk. [[decisions/ADR-0014-the-run-tail-is-one-command]] fixed the worst instance — the
run clock — by making `run/cli.mjs finish` its sole writer. It did not state the underlying rule,
and so did nothing to stop the next instance being written.

What remained in `pipeline-orchestrator/SKILL.md` after H2 was not a small residue. Six separate
places asked the model to perform arithmetic:

| site | what the model was told to compute |
|---|---|
| 3d-1 | `cost_usd`, via a five-term floating-point formula over registry pricing |
| Step 5 | `total_input_tokens`, `total_output_tokens`, `total_cached_input_tokens` as sums over `phases[]` |
| Step 5 | `total_cost_usd` as the phase sum plus orchestration overhead |
| Step 5 | `cache_hit_ratio` |

Plus two envelope-capture branches that were dead or dishonest: a split `input/output/cached`
triple this harness's Agent envelope never exposes, and a fallback that *estimated* tokens from
`len(text) / 4` — inventing a number for a quantity a machine holds exactly.

Every one of these is overwritten later in the same run: `tools/usage/usage.mjs:621–628` assigns
each total unconditionally, and 3d-1b prices each phase from its transcript before the cap gate
sees it. The prose asked for arithmetic whose result is discarded. A step like that cannot be
executed *usefully* — only correctly-but-pointlessly, or wrongly.

That it drifts is not a hypothesis. The two definitions of `cache_hit_ratio` had **already**
diverged, and nobody noticed:

```
SKILL.md:2036 (prose)        cached / max(input, 1)
usage.mjs:628 (the tool)     cached / (input + cached)
```

Same key, two denominators, no symptom — because the tool overwrites the model's answer before any
reader sees it. A divergence that survived human review for as long as both spellings existed is
not repaired by wording the prose more firmly. This is the same lesson as
[[decisions/ADR-0008-read-discipline-contract]], applied to numbers instead of reads.

## Decision

State the invariant once, ship it with the plugin, and enforce it.

> **The model never transcribes or computes a value a machine already holds. Where the value exists
> on disk, the contract passes the path — never the number.**

1. **`plugins/sdlc/MACHINE-VALUES.md`** is the contract, the written audit, and the lint's own
   input, in one document. It carries a fenced ` ```machine-values ` registry of `key: owner` lines
   — the same machine-readable-block-inside-prose shape as the ` ```sdlc-contract ` blocks
   `lib/contracts.mjs` already parses. A document the check *reads* cannot drift from the check.
2. **`sdlc-lint machine-values`** parses that registry and fails any shipped prose
   (`plugins/**/*.md`) that puts a registry key on the **left-hand side** of a computation — `=`,
   `sum of`, `computed from`, `derived from` — unless the line carries
   `<!-- machine-values: ok — reason -->` with a stated reason. It joins `all`, which CI already
   runs.
3. **The six formulas are removed** from `SKILL.md`. 3d-1 now records only what nothing on disk can
   give back; Step 5 writes the totals as `null` and lets `finish` fill them.

Anchoring on the assigned key is the whole design. `SKILL.md` legitimately *discusses* these keys
dozens of times, and a check that fired on discussion would need so many exemptions it would become
noise. The word boundary also disposes of `max_total_cost_usd=0.60` and
`CONTEXT.running_cost_usd = 0` without a special case.

### What deliberately stays with the model

The invariant reaches exactly as far as the machine does, and no further:

- `agent_id` — exists only in the Agent result envelope; no file records it. It is the one number
  3d-1 still transcribes, and the prose now says why.
- `subagent_tokens` / `total_subagent_tokens` — the envelope's aggregate. `finish` sums only
  `usage_source: "transcript"` phases and never writes this key, so removing the model's sum would
  **delete** the value rather than relocate it. The registry deliberately omits it, and the lint is
  therefore silent on its Step 5 sum — the machine-owned/model-owned split declared in the contract
  and the split the check enforces are the same split.
- `qa_iterations_used`, `compact_summary_chars`, `model`, `cap_status`,
  `CONTEXT.running_cost_usd` — context-only, a registry lookup, or a decision the run made.
- `touched_files` (git holds it) and the cap gate's running-total accumulation are genuine
  instances, **deferred**: both need tool changes rather than deletions, and H3 is a subtraction.
  Recorded in the contract so the next person finds them already reasoned about.

## Consequences

**Measured on landing:**

| | before | after |
|---|---|---|
| formulas over machine-owned keys in `SKILL.md` | 6 | **0** |
| machine-owned telemetry keys the model computes | 21 | **0** |
| escape-hatch exemptions in the tree | — | **0** |
| `SKILL.md` lines | 2436 | 2441 |

The line count **rose by five**, against the spec's own prediction that it would fall. The
prediction was the wrong measure and is recorded here as wrong rather than quietly dropped: what
H3 removes is arithmetic, and the text replacing it explains *why* a value is not the model's — the
`agent_id` justification, the placeholder note on the telemetry example. H3's real metric is the
first two rows. It adds **no** new mandated step and so produces no compliance rate of its own; its
effect is a smaller surface under the rates [[planning/h1-compliance-auditor]] already tracks.

**The lint's limits are real and stated.** It is lexical, not semantic — and that showed up on the
first use, not in theory: a stale summary paragraph in Step 5 survived the check and still
described all three retired envelope shapes, char/4 estimation included. It was found by reading,
not by the tool, because it contained neither `=` nor `sum of`. The check raises the cost of adding
a new transcription; it does not make one impossible. Left-hand anchoring means
`foo = cost_usd + bar` also escapes, and a machine value never added to the registry is never
checked.

**Downstream, a real defect surfaced.** With totals now `null` on an unenriched run, the HTML
report rendered *Output tokens* and *Aggregate tokens* as `0` — asserting a measurement nobody
took, which is precisely what
[[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]] exists to prevent. Fixed with a
null-aware formatter kept deliberately separate from the plain one, so phase count, files touched
and model corrections still render an honest `0`. `rollup` and `aar-metrics` were checked and
needed no change.

**H4's gate is unchanged.** Both H2 and H3 have now landed, so what remains before revisiting
deterministic control flow is only the re-measurement: ~10 runs carrying `plugin_version` on the
new tail, then `sdlc-lint compliance` again. The gate is decided by a number, not by how the prose
reads.

## Related
- Implemented by: #104
- Relates to: [[decisions/ADR-0014-the-run-tail-is-one-command]]
- Relates to: [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]]
- Relates to: [[decisions/ADR-0008-read-discipline-contract]]
- Relates to: [[decisions/ADR-0005-transcript-derived-cost]]
- Relates to: [[planning/h-instruction-fidelity]]
