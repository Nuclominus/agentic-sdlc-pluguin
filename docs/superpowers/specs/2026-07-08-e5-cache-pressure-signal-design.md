# E5 — Cache-pressure signal (design)

- **Date:** 2026-07-08
- **Status:** approved
- **Track:** E — pipeline cache/cost efficiency (see `.brain/planning/backlog.md`)
- **Target release:** `sdlc` 1.8.0

## Context

Track E targets the dominant per-run cost driver: prompt-cache reads. Prompt caching bills every
token at 0.1× **but on every turn**, because each subagent turn re-reads its whole accumulated
prompt prefix, so `cache_read ≈ turns × avg_prefix`. Measured on a real 7-phase run: **6.65M
cache-read tokens across 117 subagent turns** — ~27% a fixed boilerplate floor re-read every turn,
~73% accumulated context that grows to 100k+ per turn on the heavy phases.

E5 is the **enabler** for the rest of Track E: it turns that finding into a tracked, per-phase
metric so later work (E2 surgical reads, E1 trim floor) has a measurable baseline instead of
guesswork, and the AAR can flag heavy phases automatically.

### Definition of Done (from backlog)

- The HTML report shows **reads/turn** and **peak-prefix** per phase.
- The AAR flags any phase whose cache pressure exceeds a threshold.

## Goals / Non-goals

**Goals**
- Compute and persist per-phase cache-pressure facts (`turns`, `peak_prefix_tokens`).
- Render them in the HTML report and flag heavy phases.
- Surface flagged phases to the AAR analyst as authoritative `metrics_json` signal.

**Non-goals (YAGNI — deferred to later Track E items)**
- Changing actual cache usage / reducing reads (E2 surgical reads, E1 prefix trim, E3 fewer turns).
- Making the threshold user-configurable via CLI/flags — it is one documented constant this pass.
- Any new ADR — this is an observability addition, not an architectural decision.

## Metric definitions

Per phase, computed at enrich time from the phase's subagent transcript(s):

- **`turns`** — count of distinct API responses (deduped on `message.id`, matching the #48 fix).
  For a multi-agent phase (e.g. `development` = plan + implement), the **sum** across its
  transcripts.
- **`peak_prefix_tokens`** — the largest single-turn `cache_read_input_tokens` seen across the
  phase's turns (the worst-case prefix re-read). For a multi-agent phase, the **max** across its
  transcripts. This is the cache-pressure indicator.
- **`cache_pressure`** — derived boolean: `peak_prefix_tokens > CACHE_PRESSURE_PEAK_TOKENS`.
- **reads/turn** — derived at render time only, **not stored**: `cached_input_tokens / turns`
  (average cache-read prefix per turn).

**Threshold:** `CACHE_PRESSURE_PEAK_TOKENS = 80_000`, a single documented constant defined in
`tools/usage/usage.mjs` (the one place the flag is computed). Rationale: on the measured run this
flags only the genuinely large-context phase (development, peak 101k) without flagging every phase
(test 74k, BA 64k, docs 48k stay clear). Easy to tune in one place; changing it requires a cheap
re-enrich, and the report/metrics still render the raw `peak_prefix_tokens` so a reader sees why.

## Design

Single source of truth: the **enrich step** computes the facts + flag once and writes them to
`_telemetry.json`; both consumers (report, metrics) read them. No threshold logic is duplicated in
the renderers.

### 1. `plugins/sdlc/tools/usage/usage.mjs`

- `extractUsage` already accumulates a deduped `turns` count per model; additionally track
  `peak_prefix_tokens = max(cache_read_input_tokens)` over the deduped turns (per model and in the
  `combined` roll-up).
- `priceTranscripts` combines a phase's transcript(s): `turns` summed, `peak_prefix_tokens` taken as
  the **max** across transcripts.
- `enrichTelemetry` writes three new per-phase fields: `turns`, `peak_prefix_tokens`, and the derived
  `cache_pressure` boolean (using the `CACHE_PRESSURE_PEAK_TOKENS` constant defined in this module).
- Telemetry stays factual: `reads/turn` is not stored (derivable).

### 2. `schemas/checkpoint.schema.json`

Register `turns` (int ≥0), `peak_prefix_tokens` (int ≥0), `cache_pressure` (boolean), each with a
short description tying them to `usage_source: "transcript"`.

### 3. `plugins/sdlc/tools/report/report.mjs`

- Timeline token cell: for `hasSplit` phases with `turns > 0`, append a subline
  `cache <reads/turn> /turn · peak <peak_prefix>` (formatted via the existing `fmtTok`), with a
  trailing `⚠` when `p.cache_pressure`.
- `signalsSection`: for each phase with `cache_pressure`, add
  `High cache-pressure: <phase> (peak <peak> > 80k)`.
- Reads `p.cache_pressure` / `p.peak_prefix_tokens` / `p.turns` directly — no threshold constant in
  the report.

### 4. `plugins/sdlc/tools/aar/metrics.mjs` + analyst prose

- `by_phase` entries gain `turns`, `peak_prefix_tokens`, `reads_per_turn` (rounded int), and
  `cache_pressure`.
- New top-level `cache_pressure_phases`: array of `{ phase, peak_prefix_tokens, reads_per_turn }`
  for flagged phases, ordered by `peak_prefix_tokens` desc, for the analyst to cite.
- `plugins/sdlc/agents/aar-analyst.md` and `plugins/sdlc/skills/aar/gather.md`: document the new
  `cache_pressure_phases` signal; instruct the analyst to flag high-cache phases and point at the
  E2/E1 remedies (surgical reads / prefix trim). No new recompute — the metric is authoritative from
  `metrics_json`.

### 5. Tests (each shipped file is mirrored into `tools/sdlc-lint/lib/`, exercised by the suite)

- `tools/sdlc-lint/test/usage.test.mjs` — `peak_prefix_tokens` = max and `turns` = deduped count
  are recorded; `cache_pressure` true above 80k, false below; multi-transcript phase combines
  max/sum correctly.
- `tools/sdlc-lint/test/report.test.mjs` — the cache subline renders for a split phase; the Signals
  flag appears when `cache_pressure` is set and is absent otherwise.
- `tools/sdlc-lint/test/metrics.test.mjs` — `by_phase` carries the new fields;
  `cache_pressure_phases` is populated and ordered.

### 6. Release & vault

- Bump `sdlc` 1.7.1 → **1.8.0** in `plugins/sdlc/.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json`; add a `[1.8.0]` `CHANGELOG.md` section; add a
  `.brain/releases/_moc-releases.md` entry.
- `.brain/planning/roadmap.md`: mark **E5 → done** with the landing PR; update the Track E note.
- No ADR. The auto brain-sync change note is enriched post-merge per the vault heartbeat.

## Data flow

```
subagent transcript(s)
  → extractUsage        (turns [dedup], peak_prefix_tokens [max])
  → priceTranscripts    (turns summed, peak max across transcripts)
  → enrichTelemetry     (writes turns, peak_prefix_tokens, cache_pressure per phase)
  → _telemetry.json  ──┬─→ report.mjs   (timeline subline + Signals flag)
                       └─→ metrics.mjs  (by_phase fields + cache_pressure_phases → aar-analyst)
```

## Risks / edge cases

- **Aggregate-only phases** (`usage_source: "subagent_aggregate"`, no transcript located): no
  `turns` → no subline, no flag. Renderers already guard on `hasSplit` / `turns > 0`.
- **`turns == 0`**: guard against divide-by-zero for reads/turn (render `—`).
- **Threshold churn:** changing the constant needs a re-enrich to update the stored boolean; raw
  `peak_prefix_tokens` is always shown so the judgment is transparent.
- **Backward compatibility:** old telemetry without the fields renders exactly as today (fields
  absent → no subline/flag).
