---
adr: 1
status: accepted
date: 2026-06-24
supersedes: null
---

# ADR-0001 — Stack Provider Pattern

## Context

`sdlc` is a single, platform-agnostic pipeline orchestrator (BA → Dev → QA → Security → Docs).
It must be able to host many technology stacks (Android, and future platforms) without the core
ever forking per-platform logic, and without every new stack requiring a change to
`plugins/sdlc/*`. The orchestrator needs a stable extension point: a way for a stack (e.g.
`android-foundation`) to plug in its own agent roster, convention skills, and phase-prompt
injections while the core stays generic.

## Decision

A stack declares itself as a **foundation** by shipping a `manifest.yaml` with `kind: foundation`,
a `priority`, and a `detect` block (e.g. `settings.gradle.kts` + `**/*.kt` for Android). The
`sdlc` orchestrator auto-discovers every installed foundation, evaluates `detect` against the
project, and lets the highest-`priority` match win the pipeline for that project. The vanilla
`sdlc` manifest itself registers as `kind: foundation`, `priority: 0` — the always-matching
fallback when no specialized foundation claims the project. `agents_per_phase` on the winning
foundation overrides the default agent for each phase (e.g. `android-developer` replaces
`developer`). The core orchestrator (`plugins/sdlc`) never branches on stack identity — it only
reads whichever foundation manifest won.

## Consequences

- Additive: adding a new platform means adding a new plugin with a `manifest.yaml`, not editing
  `plugins/sdlc`.
- No slot registries or hardcoded stack lists in the core — discovery is manifest-driven.
- No copy-paste of the pipeline per stack; foundations only override what they need to
  (`agents_per_phase`, `convention_skills`, `phase_injections`).
- Establishes the `kind: foundation` contract that `android-foundation` (and any future platform
  foundation) must satisfy, and the priority-based conflict resolution used when multiple
  foundations could match the same project.

## Related
- Implemented by #12, #13, #14
