---
adr: 2
status: accepted
date: 2026-06-24
supersedes: null
---

# ADR-0002 — Framework Provider Pattern

## Context

Beyond the platform foundation itself (ADR-0001), most projects also pull in specific libraries
for cross-cutting concerns — networking (Retrofit), persistence (Room), dependency injection
(Dagger/Hilt), deferrable background work (WorkManager). These libraries must be able to
**enrich** a hosting foundation (contribute convention skills and phase-prompt injections for
their concern) without ever overriding the foundation's own agents, priority, or pipeline shape.
Unlike foundations, frameworks never compete to "win" a project — several can be active at once,
each covering a different functional aspect.

## Decision

A library attaches as a **framework** by shipping a `manifest.yaml` with `kind: framework`, an
`enriches_aspect` (the functional category it contributes to, e.g. `network`, `persistence`,
`di`, `background`), and a `dependency` coordinate (e.g. `com.squareup.retrofit2`,
`androidx.room`, `com.google.dagger`, `androidx.work`) that the hosting foundation's
`framework_detection` search (version catalog, then `build.gradle(.kts)`) uses to decide whether
the framework is actually present in the project. When detected, the framework's
`convention_skills` and `development`/`security` phase-prompt injections are merged additively
into the pipeline for the aspect it declares; the foundation that hosts that aspect is otherwise
unchanged. A framework carries a `priority` field for documentation only — frameworks never win
an aspect the way foundations win a platform.

## Consequences

- Auto-detected: no manual registration step: presence of the dependency coordinate is enough to
  activate the framework's conventions.
- Additive: multiple frameworks can be active simultaneously (Retrofit + Room + Dagger +
  WorkManager all enrich the same `android` foundation on different aspects) with no conflict.
- Ships no agents of its own — a framework only specializes the existing phase prompts
  (development, security) via `phase_injections` and adds a `convention_skills` entry.
- Reference contract for every framework component note (`retrofit-plugin`, `room-plugin`,
  `dagger-plugin`, `workmanager-plugin`), each of which links back to this ADR.

## Related
- Implemented by #12, #14, #29
