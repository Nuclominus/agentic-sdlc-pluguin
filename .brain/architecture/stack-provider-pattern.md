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
│  │  • merge role_expertise + ADDITIVE injects              │ │
│  │  • execute phases   (loops + parallel groups)           │ │
│  │  • dispatch agents_per_phase[phase] (CORE manifest)     │ │
│  └────────────────────────────────────────────────────────┘ │
│                            ▲                                  │
│        reads manifest.yaml (split by kind) + workflows/      │
└────────────────────────────┼─────────────────────────────────┘
                             │ picks a foundation
                             ▼
              ┌──────────────────────────────────┐
              │ android-foundation               │   LEVEL 2: FOUNDATION
              │ kind: foundation · manifest.yaml  │   owns aspect:android (platform)
              │ priority 300 · NO agents (winner) │   hosts_aspects: [network,persistence,
              │ role_expertise + house rules      │     di,ui,background,analytics,architecture]
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
`detect` rules, `priority`, `aspects`, per-role expertise (`role_expertise`), an optional default workflow,
convention skills, and — if it hosts libraries — a `framework_detection` block (where to look for framework
coordinates). The orchestrator picks the highest-priority profile **per aspect** whose `detect` succeeds,
**and then delegates framework discovery to it** (the core executes the foundation's declared search; it
never knows a library name or build system itself). Android Foundation is the only stack provider here; it
wins the `android` aspect, supplies the expertise for every phase, and resolves its own frameworks.

Since [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]] a foundation ships **no
agents**. `plugins/sdlc/manifest.yaml` is the only manifest that binds a phase to an agent; a foundation
declares `role_expertise` keyed by core role name, and the resolver merges it into the pre-rendered
`profile.prompt_blocks[agent]` the orchestrator pastes into the prompt. The split is process (core) versus
expertise (foundation), and it is what let the coupling go: an agent that lived in the foundation resolved
its rule paths through the plugin root of *its own* plugin, so the agent could not move without breaking
every path it read. Rule paths are now emitted absolute by the resolver instead.

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
priority, aspects, detect, workflow, `role_expertise`) + skills + rules + hooks, and **no agents**. On the
next `/sdlc:start`, the orchestrator finds it via Glob, evaluates `detect`, and dispatches the CORE roster
carrying that foundation's expertise blocks.

**A framework provider** ships `manifest.yaml` (`kind: framework`, `enriches_aspect`, `dependency`) +
a convention skill (+ optional ProGuard snippet) and **no agents**. It auto-activates when its library is
detected and enriches the foundation's phases. `retrofit-plugin` is the reference; `room-plugin` and
`dagger-plugin` follow the same shape.
