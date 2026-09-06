---
status: in-progress
---

# I1 — Agents in the core, expertise in the foundations

> Track note for [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]].
> The design spec is `docs/superpowers/specs/2026-09-05-agents-in-core-design.md`; this note carries
> the PR ledger and the expertise-coverage table that PR-2 and PR-3 are gated on.

**Amended 2026-09-06, after PR-1's review:** the original design carried a one-release alias layer
(`resolve/aliases.mjs` plus a mirror in the model-enforcement hook). Review found ten defects in
PR-1, six of them inside that layer and all of one shape: one copy of the rename map keyed on the
canonical name while another was keyed on the dispatched one. The layer is deleted. An agent name is
never translated; `/sdlc:doctor` migrates a project's config once, with approval, from the rename
data in `plugins/sdlc/config/agent-migrations.json`. Four of the ten findings vanished with the
code, three collapsed to one-line fixes, and three were ordinary bugs fixed in place.

## Goal

`sdlc` = process (every agent). Foundation = expertise (skills, rules, hooks, workflows, and a
per-role `role_expertise` declaration the core consumes). Every `android-*` role gets a 1:1 core
successor; `android-foundation/agents/` is deleted, and consumers' config is migrated by
`/sdlc:doctor` rather than by a compatibility shim.

## PR ledger

| PR | Scope | State |
|---|---|---|
| PR-1 | Core roster (+reviewer, tester, debugger, devops, cicd), expertise slot in every agent, core manifest binds every phase, `role_expertise` schema, resolver merge + `prompt_blocks` + `expertise --role` command, stale-name reporting, `/sdlc:doctor` config migration (`config/agent-migrations.json` + `tools/migrate/`), orchestrator pastes the blocks, `sdlc-lint roster`, ADR-0021 (proposed). The foundation still binds its own roster (warned as deprecated), so an Android run behaves as before. | #139 (open) |
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

## Review of PR-1 (2026-09-06) — what it changed

Ten confirmed findings, eight verification angles. Disposition:

| Finding | Disposition |
|---|---|
| model override rewritten to a name the tier lookup never used; hook alias one-directional; rename branch dead behind a stale plugin cache; rename never rewrote `subagent_type` | gone with the alias layer |
| `expertise --role` rejected every core role while a foundation bound its own; 3b-3 frontmatter path claimed core-only too early; alias WARN reached no channel a human reads | one-line fixes: the valid role set is dispatched ∪ core, the path wording waits for PR-3, `expertise` echoes warnings to stderr |
| `resolveExpertise` dropped `deps.abort`; equal-policy skill collision resolved by file order; `roster` slot check was a bare substring test satisfied by two false sentences | fixed in place, each with a regression test |

Not carried into PR-1, recorded for later: `resolveExpertise` runs the full dependency preflight
and rewrites the preflight stamp on every on-demand bootstrap, and `resolveStack` re-walks the
project tree once per framework. Both are startup cost on a path that now runs per agent, measured
at roughly 180 ms on a real project. Fold into PR-4 with the prefix measurement.

## Measurements owed

- Per-turn prefix size before/after on an Android run (the ADR predicts a net shrink; PR-4 measures it).
- `sdlc-lint compliance` on the first three runs that dispatch core agents on Android: did the
  mandatory `role_expertise` skills get invoked?
