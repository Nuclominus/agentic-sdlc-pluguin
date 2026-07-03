# Spec: Complete the AAR learning cycle (Roadmap C1) — 2026-07-03

> Status: **design, awaiting user approval.** Four scoping decisions confirmed interactively with the
> user before drafting (namespace/home, gather source, lessons injection, apply loop). Two follow-up
> extensions (deterministic `metrics.mjs`, generic-analyst-with-android-override) confirmed after the
> design walkthrough. Every locked decision below is annotated so the user can veto individual points
> before `writing-plans`.
>
> Parent: `docs/superpowers/specs/2026-07-03-plugin-improvements-roadmap-design.md` → Напрямок C,
> bullet **C1** ("Завершити AAR-цикл (полагодити осиротілість)").

## Problem

The After Action Review (AAR) loop was designed on paper but never ported to the repository. The
`android-aar` agent (`plugins/android-foundation/agents/android-aar.md`) references a skill
`android-workflow:aar` with three contracts — `gather.md`, `report.md`, `apply.md` — **none of which
exist**, in a plugin namespace (`android-workflow`) that **does not exist** either. Nine files carry
the dangling reference:

- `plugins/android-foundation/agents/android-aar.md` (agent body + `Authoritative References`)
- `plugins/android-foundation/agents/android-docs.md`
- `plugins/android-foundation/rules/workflow.md` (Step 7)
- `plugins/android-foundation/rules/skills.md`
- `plugins/android-foundation/rules/INDEX.md`
- `plugins/android-foundation/README.md`
- `plugins/android-foundation/vault/obsidian-vault-template/README.md`
- `README.md`, `CHANGELOG.md`, `docs/WORKFLOW.md` (root)

The consequence: the retrospective / self-improvement half of the marketplace is a hanging command.
A user who types "run an AAR" gets an agent that points at a skill that isn't there. The learning
loop — *observe a run → propose improvements → persist lessons that feed the next run* — is broken at
every link.

Two enabling substrates now exist that make C1 cheap and honest:

- **Telemetry (from earlier releases).** The orchestrator already writes real per-phase
  `input/output/cached` tokens + `cost_usd` (registry pricing) to `docs/plans/{slug}/_telemetry.json`.
  AAR no longer has to re-derive costs from the transcript.
- **Checkpoint/report substrate (B1/D).** `docs/plans/{slug}/` is a durable, structured record of a
  run's phases and outputs.

## Goal

Build the missing, **platform-neutral** `sdlc:aar` skill that closes the loop:

1. **Gather** — read the deterministic `_telemetry.json` for cost/token/phase accounting; distill the
   session transcript JSONL for cooperation signals that live nowhere else.
2. **Report** — a read-only analyst subagent returns structured findings bucketed into
   `agents / rules / settings / vault-docs`, each citing evidence, plus a metrics dashboard and a
   single highest-leverage summary.
3. **Apply** — the skill (in the main session) presents findings, the user multi-selects, and
   approved items are applied under a two-tier approval gate. Nothing is ever auto-applied.
4. **Persist** — approved lessons append to `.claude/sdlc-lessons.md`, which the orchestrator injects
   into the stable prompt prefix of every future phase, so the next `/sdlc:start` runs a little wiser.

Works for **any** stack: vanilla projects get AAR via a generic analyst; Android projects override the
analyst slot with the existing `android-aar` agent (same provider-override pattern as
`developer → android-developer`).

### Non-goals (explicitly out for C1)

- **Cross-run rollup / trends** — that is **B2 `/sdlc:report`**, a later spec. C1 analyzes ONE run.
- **Auto-running AAR** — it stays user-triggered, never automatic (matches the existing rule text).
- **Editing product code or code-derived vault content** — workflow scope only (agents, rules,
  settings, process docs, provider vault process notes).
- **A vault requirement in the generic core** — the `vault-docs` finding bucket is provider-specific;
  the neutral `sdlc` core never assumes a vault exists.

## Locked decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| C1-1 | Skill home + namespace | **Generic `sdlc:aar`** in `plugins/sdlc/skills/aar/` | The learning machinery (`.claude/sdlc-lessons.md`, orchestrator prompt injection) is squarely neutral-core territory. Matches the marketplace's neutral-core + provider architecture. Kills the non-existent `android-workflow` namespace. |
| C1-2 | Analyst agent | **Generic `sdlc:aar-analyst`** (READ-ONLY) shipped in `sdlc`, **overridden** by `android-aar` for Android projects via manifest | Same slot-override pattern as `developer → android-developer`. Vanilla projects get AAR; Android keeps its richer, vault-aware analyst. |
| C1-3 | Gather source | **Telemetry-first + transcript best-effort** | Cost/token/phase from deterministic `_telemetry.json` (no re-parse, accurate). Cooperation signals (review-loop rounds vs cap, real parallelism, redundant re-reads, skill adherence, blockers) from a distilled transcript pass — the only place they live. |
| C1-4 | Deterministic metrics | **`plugins/sdlc/tools/aar/metrics.mjs`** (dep-free Node ESM) computes the metrics dashboard from `_telemetry.json`; `tools/sdlc-lint` re-exports it (SSOT) for tests | Same discipline as D's report renderer (memory: ship runtime tools in-plugin under `${CLAUDE_PLUGIN_ROOT}`). Numbers stay testable and out of the LLM's hands; the analyst only reasons about cooperation. |
| C1-5 | Lessons persistence | **`.claude/sdlc-lessons.md`** — project lessons file, curated one-liners appended on approval | "Both" model from the roadmap: a durable injected file + proposed edits. Project-scoped, human-readable, deterministically ordered as written. |
| C1-6 | Lessons injection | **Whole file, into the STABLE PREFIX of every phase prompt** (Step 3b-1); omitted entirely when the file is absent/empty | Byte-identical across all phases → one cache entry, cache-safe. No per-phase parsing in the hot path. Preserves the existing byte-stable-prefix invariant when there are no lessons. |
| C1-7 | Apply loop ownership | **The `sdlc:aar` skill applies in the main session** (it has Edit/Write); the analyst subagent stays READ-ONLY | Two-tier gate (below). Keeps self-modification confirmation in the main context where the user is, per global CLAUDE.md. |
| C1-8 | Apply gate tiers | (1) append to `.claude/sdlc-lessons.md` = low-risk, always offered; (2) edit agents/rules = **per-item diff-approved**; (3) edit `settings.json` = **extra explicit confirm** (this tier may be deferred — see Open questions). **No auto-apply.** | Escalating friction matched to blast radius; settings edits honor the global "ask before self-modifying settings" rule. |
| C1-9 | Trigger surface | **`/sdlc:aar [slug]` command** (`plugins/sdlc/commands/aar.md`) mirroring `start`/`doctor`, plus the agent trigger words | User-triggered only. `[slug]` optional → defaults to the most recent `docs/plans/*/` run. |

## Architecture

### New skill: `plugins/sdlc/skills/aar/`

Four files, mirroring the contract the `android-aar` agent already assumes:

- **`SKILL.md`** — the driver, run in the main session. Responsibilities:
  1. **Resolve target run.** If a slug arg is given, use `docs/plans/{slug}/`; else pick the most
     recently modified `docs/plans/*/` directory. HALT with a clear message if none exists.
  2. **Resolve transcript path.** The current session transcript
     `~/.claude/projects/<encoded-cwd>/<session>.jsonl` (the only durable record of cooperation, since
     handoff envelopes are not persisted). Document the encoding and a fallback if it can't be found
     (degrade to telemetry-only, state the degradation in the report).
  3. **Compute deterministic metrics.** Invoke `node ${CLAUDE_PLUGIN_ROOT}/tools/aar/metrics.mjs {slug}`
     → the metrics dashboard JSON (never recomputed by the LLM).
  4. **Dispatch the analyst.** Resolve the analyst agent for the active profile (generic
     `sdlc:aar-analyst`, or the profile's override e.g. `android-aar`), passing the transcript path,
     the slug, and the metrics JSON. Analyst returns the `report.md`-shaped findings.
  5. **Present + approve + apply** per `apply.md`.
- **`gather.md`** — the extraction contract (C1-3). Telemetry-first accounting; transcript
  cooperation signals with honest, best-effort attribution (never fabricated splits). Sidechain turns
  (`isSidechain: true`) attributed to their spawning `Task` (`subagent_type`) via `parentUuid`.
- **`report.md`** — the exact report format the analyst MUST return: metrics dashboard (from the
  deterministic JSON), top token consumers, findings bucketed `agents / rules / settings / vault-docs`
  (each: target file, evidence, proposed change, expected benefit, severity), a "what went well"
  section, and a one-line highest-leverage summary. Compact; every finding cites evidence or it is
  dropped.
- **`apply.md`** — the two-tier approval + apply contract (C1-7, C1-8), including grounding
  (`Read` the current target before quoting a change) and the settings-confirm rule.

### New agent: `plugins/sdlc/agents/aar-analyst.md`

Generic, READ-ONLY analyst. Body is the platform-neutral distillation of the current `android-aar`
agent, minus Android/vault specifics: reads telemetry + transcript, audits against
`rules/workflow.md`-equivalent (the active workflow DAG) and the orchestrator's loop/escalation cap,
proposes edits to `agents / rules / settings`. Emits `report.md` shape. Never edits.

### Provider override: `android-aar`

`android-aar` stays as the Android analyst, but its `android-workflow:aar` references are repointed to
`sdlc:aar` (it is now the provider's override of the generic analyst slot). `android-foundation`'s
`manifest.yaml` registers it as the `aar` analyst for Android runs — the mechanism the orchestrator
already uses for phase-agent overrides.

### Deterministic helper: `plugins/sdlc/tools/aar/metrics.mjs`

Dep-free Node ESM. Input: `docs/plans/{slug}/_telemetry.json`. Output (stdout JSON): total cost,
cost-by-phase, cost-by-model, cache-hit ratio, cap-breach incidents, QA-iteration count, top token
consumers. No `Date.now()`/`new Date()` (stable/snapshot-testable). `tools/sdlc-lint/lib/aar-metrics.mjs`
re-exports this plugin copy (SSOT) so CI/tests exercise the same code the runtime ships.

### Orchestrator change: lessons injection (Step 3b-1)

In `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`, Step 3b-1 (the cache-friendly two-section
prompt layout):

- **Once at session start**, read `.claude/sdlc-lessons.md` if it exists.
- If non-empty, add a new block to the **STABLE PREFIX** (before `=== PER-CALL CONTEXT ===`), after
  `phase_prompts_injection` and before/around the `project_extension_skills_block`:

  ```
  Lessons learned (from prior AAR cycles, project-curated):
  {verbatim contents of .claude/sdlc-lessons.md}
  ```

- If the file is **absent or empty**, the block is **omitted entirely** (no header) so the stable
  prefix stays byte-identical for projects without lessons.
- Add an invariant to the anti-drift list (SKILL.md ~line 1540): "The lessons block is verbatim
  `.claude/sdlc-lessons.md`, read once at session start, identical across all phases; omitted when the
  file is absent/empty. It is invalidated only by edits to that file — acceptable."

### Command: `plugins/sdlc/commands/aar.md`

Thin command mirroring `start.md`/`doctor.md`: parses an optional `[slug]`, invokes the `sdlc:aar`
skill.

### Reference cleanup

Repoint every dangling `android-workflow:aar` → `sdlc:aar` across the nine files listed in *Problem*.
Update the two READMEs + CHANGELOG + `docs/WORKFLOW.md` prose to describe the real, shipped skill.

## Data flow

```
/sdlc:aar [slug]
  └─ SKILL.md (main session)
       ├─ resolve run dir  (docs/plans/{slug}/ or latest)
       ├─ resolve transcript path (~/.claude/projects/<enc-cwd>/<session>.jsonl)
       ├─ node tools/aar/metrics.mjs {slug}  →  metrics dashboard JSON
       ├─ dispatch analyst (sdlc:aar-analyst | android-aar override)  [READ-ONLY]
       │     gather.md: telemetry + transcript  →  report.md findings
       ├─ present dashboard + bucketed findings
       ├─ user multi-selects approved findings
       └─ apply.md two-tier gate:
             ├─ lessons  → append to .claude/sdlc-lessons.md
             ├─ agent/rule → show diff → apply on per-item approval
             └─ settings.json → extra explicit confirm → apply
next /sdlc:start
  └─ orchestrator Step 3b-1 injects .claude/sdlc-lessons.md into every phase's stable prefix
```

## Testing

- **`metrics.mjs`** — Node unit test against a fixture `_telemetry.json` asserting the dashboard
  numbers (deterministic; snapshot-friendly). Wired into the existing `tools/sdlc-lint` test surface /
  CI.
- **Stable-prefix omission** — a sdlc-lint / fixture assertion that the lessons block is omitted when
  `.claude/sdlc-lessons.md` is absent, and present verbatim when it exists (guards the cache
  invariant).
- **Link-integrity guard** — a CI grep asserting **zero** remaining `android-workflow:aar` references
  and that `sdlc:aar` + its four contract files resolve (no new dangling references introduced).
- Skill/agent/command markdown bodies are LLM-executed and not unit-testable; their determinism is
  covered by the deterministic `metrics.mjs` + the link-integrity guard.

## Cross-references / dependencies

- Consumes **telemetry** (existing) and the **`docs/plans/{slug}/` substrate** (B1/D).
- Independent of **B2** (`/sdlc:report`) — B2 is cross-run rollup; C1 is single-run analysis. They may
  later share `metrics.mjs`.
- Follows the packaging lesson from D: runtime `node` invocations use `${CLAUDE_PLUGIN_ROOT}` and ship
  under `plugins/sdlc/tools/`; dev/CI re-exports for SSOT.

## Open questions (to resolve in `writing-plans`, none blocking)

- Exact stdout schema of `metrics.mjs` (field names) — pin during planning; mirror `_telemetry.json`
  keys where possible.
- Whether the `settings.json` finding bucket is enabled in C1 or deferred (the two safer buckets —
  lessons + agent/rule edits — deliver most of the value; settings edits are the riskiest).
