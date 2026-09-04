---
plugin: sdlc
kind: core
enriches_aspect: null
dependency: null
---

# sdlc

## Responsibility

Universal SDLC orchestrator with stack provider auto-discovery. Owns the pipeline; plugins
register themselves via `manifest.yaml` profiles (`kind: foundation | framework`). Includes 5
cost-tiered default agents (BA Opus, Dev Sonnet, QA Sonnet with iteration cap, Sec Opus, Docs
Haiku). Slash command: `/sdlc:start "<feature>"`. Ships its own vanilla `manifest.yaml`
(`kind: foundation`, `priority: 0`) as the always-matching fallback profile when no specialized
foundation claims the project, but the core pipeline logic itself never forks per stack — it
reads whichever foundation manifest wins. Beyond the five phase agents it ships `session-recorder`,
a built-in run closer dispatched at orchestrator Step 6 that appends a short entry to the cumulative
run journal `docs/plans/_journal.md` (elapsed time measured via a real Step 2 clock, not estimated).
Its orchestrator prompt template carries a **read-discipline contract** in the cache-stable prefix
(Track E2, [[decisions/ADR-0008-read-discipline-contract]]) — surgical reads, no repeat reads, terse
tool output — enforced at CI time by the `read-discipline` verb of `tools/sdlc-lint` (part of `all`).
Every runtime path it reads resolves from the **running install** — the three roots
(`SDLC_PLUGIN_ROOT` / `PLUGIN_CACHE_ROOT` / `CONFIG_DIR`) defined in `plugins/sdlc/PLUGIN-PATHS.md`
and computed in orchestrator Step 0, never a literal `~`
([[decisions/ADR-0009-plugin-root-resolution]], issue #70) — guarded by the `plugin-paths` lint verb.
Guarded phases run a **self-healing micro-loop** (Track G1,
[[decisions/ADR-0010-self-healing-micro-loop]]): after the phase, the active profile's compile/lint
`heal_checks` run; a failure re-dispatches the phase's own agent with the tool output (≤2 attempts),
with an orchestrator-side pre-existing-breakage guard that classifies out-of-scope failures at zero
attempt cost. Heal outcomes (`heal_attempts_used`/`heal_status`) land in checkpoints, telemetry, AAR
metrics, and the HTML report. Headless automation gates on `_telemetry.json` state
(`aborted_at_phase`), never on printed output or the exit code — the SKILL.md is a prompt and can
control neither, a constraint stated in Step 0a-1 and enforced doc-wide by sdlc-lint.

## Key files
- `plugins/sdlc/manifest.yaml`
- `plugins/sdlc/.claude-plugin/plugin.json`
- `plugins/sdlc/agents/session-recorder.md`
- `plugins/sdlc/PLUGIN-PATHS.md` (path-resolution contract; orchestrator Step 0 resolves it)
- `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (Step 0 roots, Step 2 clock, Step 5 timing, Step 6 close)
- `plugins/sdlc/config/models.json` (model registry — the single source of truth for `tag → model_id`
  and per-MTok pricing; bare tag = current generation, suffixed tag = superseded pin)
- `plugins/sdlc/tools/usage/` (transcript-derived pricing; `enrich` is the authoritative cost path,
  and it self-recovers the session from the run's `agent_id`s — never from the cwd)
- `plugins/sdlc/tools/report/` (HTML run report; refuses to render a cap verdict on an unpriced run)
- `plugins/sdlc/tools/run/` (`finish` — seals a run in one call: machine clock, enrichment, report;
  the orchestrator's whole Step 5b, see [[decisions/ADR-0014-the-run-tail-is-one-command]])
- `tools/sdlc-lint/lib/read-discipline.mjs`
- `tools/sdlc-lint/lib/plugin-paths.mjs`

## Cost record — what the artifacts promise

`_telemetry.json` is the run's machine record, and two of its fields carry a trust condition worth
knowing before reading any report:

- `cap_status` is written by the in-run gate, which prices an unresolvable phase at `$0` and flags it
  `cap_gate_blind`. It only becomes a **verdict** once Step 5b's transcript enrichment has re-priced
  the phases (`cost_basis: "transcript"`). Until then the report shows `unverified — run unpriced`
  rather than `within` — see [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]].
- `started_at` / `completed_at` are reconciled at enrichment against the machine anchor
  `.checkpoint/_started_at`; `wall_clock_seconds` is the anchor's own arithmetic and is authoritative
  ([[decisions/ADR-0007-overhead-window-authoritative-anchor]]).
- `cost_usd` is only as current as `config/models.json`. A tier whose `model_id` lags the model
  actually serving sessions prices every phase on that tier to `null` — silently, because enrichment
  reports it as a missing transcript (open follow-up from #137). When a new model generation ships,
  repoint the tier in the registry first; twice now (#137, and the July `opus` repoint) that was the
  whole fix.

## Decisions
- [[decisions/ADR-0001-stack-provider-pattern]]
- [[decisions/ADR-0003-session-recorder-run-journal]]
- [[decisions/ADR-0009-plugin-root-resolution]]
- [[decisions/ADR-0010-self-healing-micro-loop]]
- [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]]

## Change history
_Backlinks from `changes/` accumulate here._
