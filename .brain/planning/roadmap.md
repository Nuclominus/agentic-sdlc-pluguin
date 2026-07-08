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
| C2 | WorkManager provider (background) | in-progress | #29 |
| D  | HTML run-report artifact          | done        | #26 |
| E  | pipeline cache/cost efficiency    | in-progress | #50 |

_Remaining: complete C2 (Koin / Ktor / kotlinx.serialization / DataStore-Proto), then B3._

**Track E — pipeline cache/cost efficiency.** Now that per-run cost is measured accurately
(transcript-derived, #46; over-count fixed in #48), reduce the dominant cost driver: prompt-cache
reads. On a real 7-phase run, cache-read is **6.65M tokens across 117 subagent turns** — each turn
re-reads its whole accumulated prefix, so `cache_read ≈ turns × avg_prefix`. Split: **~27% fixed
boilerplate floor** re-read every turn, **~73% accumulated context**. Sub-items E1–E5 specced in
[[planning/backlog]]; promote here when scheduled.

**E5 (cache-pressure signal) shipped in #50 (1.8.0):** per-phase `reads/turn` +
`peak_prefix_tokens` in the report and `cache_pressure_phases` in the AAR. Remaining: E2
(surgical reads), E1 (trim floor), E3 (fewer turns), E4 (routing).
