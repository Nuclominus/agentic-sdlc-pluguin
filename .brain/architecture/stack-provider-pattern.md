---
source: ARCHITECTURE.md
---

# Stack Provider Pattern

> Migrated from `ARCHITECTURE.md`. See [[architecture/_moc-architecture]].

## 1. Two patterns, one engine

```
┌─────────────────────────────────────────────────────────────┐
│                    sdlc (core plugin)                        │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  pipeline-orchestrator (skill) — DOES NOT CHANGE        │ │
│  │                                                         │ │
│  │  • pick the FOUNDATION  (kind: foundation winner)       │ │
│  │  • DELEGATE framework discovery → to the foundation     │ │
│  │  • merge profiles   (winner agents + ADDITIVE injects)  │ │
│  │  • execute phases   (loops + parallel groups)           │ │
│  │  • dispatch agents_per_phase[phase] (from the winner)   │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ▲                                  │
│        reads manifest.yaml (split by kind) + workflows/      │
└────────────────────────────┼─────────────────────────────────┘
                             │ picks a foundation
                             ▼
              ┌──────────────────────────────────┐
              │ android-foundation               │   LEVEL 2: FOUNDATION
              │ kind: foundation · manifest.yaml  │   owns aspect:android (platform)
              │ priority 300 · 11 agents (winner) │   hosts_aspects: [network,persistence,
              │ pinned house rules                │     di,ui,background,analytics,architecture]
              └────────────────┬─────────────────┘   framework_detection → RESOLVES frameworks
                               │ collects kind: framework where
                               │ enriches_aspect ∈ hosts_aspects (by category, never by name)
              ┌────────────────┼─────────────────┐         LEVEL 3: FRAMEWORKS
       ┌──────▼─────┐   ┌──────▼─────┐   ┌────────▼───┐     additive · NO agents
       │ retrofit-  │   │   room-    │   │  dagger-   │     enriches_aspect:
       │ plugin     │   │  plugin    │   │  plugin    │       network│persistence│di
       │ manifest.yaml│ │ manifest.yaml│ │ manifest.yaml│   dependency · skill · injections
       └────────────┘   └────────────┘   └────────────┘
        no deps between them · none depends on the foundation by name
```

**Stack Provider (the foundation).** Places a `manifest.yaml` (`kind: foundation`) at its root; declares
`detect` rules, `priority`, `aspects`, agents per phase, an optional default workflow, convention skills,
and — if it hosts libraries — a `framework_detection` block (where to look for framework coordinates). The
orchestrator picks the highest-priority profile **per aspect** whose `detect` succeeds, dispatches its
agents, **and then delegates framework discovery to it** (the core executes the foundation's declared
search; it never knows a library name or build system itself). Android Foundation is the only stack
provider here; it wins the `android` aspect, drives every phase, and resolves its own frameworks.

**Framework Provider (additive).** Places a `manifest.yaml` (`kind: framework`) at its root.
It is **excluded** from per-aspect winner resolution and from PRIMARY_PROFILE selection, declares **no**
`agents_per_phase` and **no** `workflow`, and contributes only to the merge: convention skills,
`development`/`security` phase-prompt injections, ProGuard keep rules, and post-checks. It names its
library via `dependency:` and points *up* at a functional category via `enriches_aspect:` (`network`,
`persistence`, `di`, …). The **foundation** whose `hosts_aspects` includes that category resolves it
(LEVEL 3 of the tree above): the foundation's `framework_detection` says where to look, the orchestrator
executes the search, and a match attaches the framework under that foundation. That category — not a named
sibling plugin — is its only contract: a framework declares **no** dependency on `android-foundation` (its
`plugin.json → dependencies` lists only `sdlc`), and is simply never considered if no winning foundation
hosts its category. So frameworks are true peers, swappable under
any provider of the aspect, with **no dependencies between them** and none on the foundation by name —
they never reference another plugin's skill id directly.

**What this marketplace explicitly does NOT do:**

- No web/server/iOS providers. Android only.
- No override mechanism. A plugin **adds itself**; it never edits the core.
- No per-framework agents or phases. Frameworks enrich; they never fan out a specialist or a gate.

---

## 10. Adding a provider (no core changes)

**A stack provider** (e.g. a future KMP foundation) ships `manifest.yaml` (`kind: foundation` — stack,
priority, aspects, detect, workflow) + agents + skills + hooks. On the next `/sdlc:start`, the orchestrator
finds it via Glob, evaluates `detect`, and dispatches its agents.

**A framework provider** ships `manifest.yaml` (`kind: framework`, `enriches_aspect`, `dependency`) +
a convention skill (+ optional ProGuard snippet) and **no agents**. It auto-activates when its library is
detected and enriches the foundation's phases. `retrofit-plugin` is the reference; `room-plugin` and
`dagger-plugin` follow the same shape.
