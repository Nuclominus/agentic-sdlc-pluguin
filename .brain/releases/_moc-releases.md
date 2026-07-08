# Releases

> Thin list mirroring the repo-root `../CHANGELOG.md`. Tags only; detail lives in `changes/`.

- **v1.7.1** — 2026-07-07 — Fix `tools/usage` over-count: dedup `message.usage` on `message.id` (one API call was counted once per content block, inflating cache/cost ~2.4×) (`sdlc` 1.7.1).
- **v1.7.0** — 2026-07-07 — Transcript-derived per-phase cost + real billed-token split; cache-write pricing; report/metrics show real usage (`sdlc` 1.7.0); ADR-0005.
- **v1.6.0** — 2026-07-07 — AAR remediation: aggregate `subagent_tokens` telemetry + crash-recovery policy (`sdlc` 1.6.0, `android-foundation` 1.3.0); ADR-0004.
- **v1.5.0** — 2026-07-06 — `session-recorder` closing agent + measured run clock; catch-up release of `sdlc` work since v1.2.0.
- **v1.2.0** — 2026-07-01 — model registry pricing SSOT.
- **v1.1.0** — 2026-06-24 — plugin version alignment.
- **v1.0.0** — 2026-06-24 — Android Foundation + Framework Provider Pattern.
- **v0.4.0** — 2026-06-23 — early baseline.
