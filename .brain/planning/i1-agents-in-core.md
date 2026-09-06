---
status: in-progress
---

# I1 — Agents in the core, expertise in the foundations

> Track note for [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]].
> The design spec is `docs/superpowers/specs/2026-09-05-agents-in-core-design.md`; this note carries
> the PR ledger and the expertise-coverage table that PR-2 and PR-3 are gated on.

## Goal

`sdlc` = process (every agent). Foundation = expertise (skills, rules, hooks, workflows, and a
per-role `role_expertise` declaration the core consumes). Every `android-*` role gets a 1:1 core
successor; `android-foundation/agents/` is deleted in one release with an alias map.

## PR ledger

| PR | Scope | State |
|---|---|---|
| PR-1 | Core roster (+reviewer, tester, debugger, devops, cicd), expertise slot in every agent, core manifest binds every phase, `role_expertise` schema, resolver merge + `prompt_blocks` + `expertise --role` command, legacy aliases (resolver + hook), orchestrator pastes the blocks, `sdlc-lint roster`, ADR-0021 (proposed). Android runs byte-identical — the foundation still binds its roster, warned as deprecated. | #139 (open) |
| PR-2 | Nine Android skills extracted from the agent bodies; `role_expertise` in the Android manifest; foundation stops binding agents and drops its `phase_injections`; `rules/` rewritten by core role; `${CLAUDE_PLUGIN_ROOT}` purged from `rules/**`; `aar` skill switches to the core analyst; coverage table below + `expertise-coverage.mjs`; docs. Android agent files stay on disk one more PR for side-by-side review. | planned |
| PR-3 | `git rm plugins/android-foundation/agents/`; schema forbids roster keys on non-core foundations; resolver ignores + warns; roster checks 1, 2, 7; create-pluguin, CONTRIBUTING, README, marketplace, CHANGELOG; commands; android-foundation 2.0.0; ADR-0021 → accepted. | planned |
| PR-4 | Core `debug.yaml` gains the `debugging` phase; prefix growth measured with `sdlc-lint compliance` on 3 real runs; alias-sunset ticket. | optional |

Brain-sync ordering ([[planning/roadmap]] discipline): merge each `brain-sync/pr-<n>` before the
next feature PR opens.

## Expertise-coverage table (filled in PR-2)

One row per `##` section of each deleted Android agent, with the destination and an anchor phrase
`tools/sdlc-lint/scripts/expertise-coverage.mjs` asserts is present there. Empty until PR-2.

| Agent | Section | Destination | Anchor |
|---|---|---|---|
| _(PR-2)_ | | | |

## Measurements owed

- Per-turn prefix size before/after on an Android run (the ADR predicts a net shrink; PR-4 measures it).
- `sdlc-lint compliance` on the first three runs that dispatch core agents on Android: did the
  mandatory `role_expertise` skills get invoked?
