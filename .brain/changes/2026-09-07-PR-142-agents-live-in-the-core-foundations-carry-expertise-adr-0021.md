---
pr: 142
date: 2026-09-07
author: Nuclominus
type: feat
plugins: [android-foundation, dagger-plugin, retrofit-plugin, room-plugin, sdlc]
roadmap: null
files_changed: 100
---

# PR #142 — agents live in the core; foundations carry expertise (ADR-0021)

> `feat` · merged 2026-09-07 · by @Nuclominus

## Summary

Integration branch for **ADR-0021** — agents live in the core; foundations carry expertise. Three
PRs merged here first (#139, #140, #141); this one takes the finished track to `develop` as a unit.

## Changed areas

- [[components/android-foundation]]
- [[components/dagger-plugin]]
- [[components/retrofit-plugin]]
- [[components/room-plugin]]
- [[components/sdlc]]

The marketplace now splits along the line the framework plugins already drew. `sdlc` is **process**:
it owns the whole 12-agent roster and the only phase→agent binding anywhere in the marketplace.
`android-foundation` is **expertise**: `role_expertise` for all 11 core roles, 13 skills, rules and
hooks — and no `agents/` directory at all. `plugins/sdlc/agents/` is the only one left, and
`sdlc-lint roster` fails any plugin that adds another.

The coupling that made this move hard was `${CLAUDE_PLUGIN_ROOT}`: it resolves to the plugin owning
the **agent**, so a foundation rule read by a core agent would have resolved against the wrong
plugin. The variable is purged from `rules/**` and the resolver emits rule paths absolute.

## Breaking

A foundation manifest could bind `agents_per_phase` / `on_demand_agents` / `aar_analyst`. The schema
now rejects those keys on any foundation but the core's own `stack: vanilla` profile, and
`mergeProfiles` ignores a roster that reaches it anyway, printing one WARN naming `role_expertise`
as the replacement. The carve-out keys on `stack: vanilla` rather than a third `kind: core`, which
would have rippled through `classify()` and every kind guard for no gain.

The core carries the major because the broken contract is the core's, not Android's:
`sdlc` 1.16.0 → **2.0.0**, `android-foundation` 1.7.0 → **2.0.0**, marketplace 1.13.0 → **1.14.0**.
A project that merely uses the marketplace sees no breakage beyond the agent names in its own
`.claude/sdlc.local.yaml` and `.claude/model.local.json`, which `/sdlc:doctor` migrates on approval.

## Validated on a real run, before the merge

The branch was installed from its own ref and run end to end on a real modular Compose app with all
five framework plugins attaching. One full `android-feature` run — 8 phases, review loop, parallel
`[security ‖ test]`, gated remediation — recorded `plugin_version: 2.0.0`, dispatched only core
agents, and produced **zero** mentions of a retired `android-*` name across the main transcript and
all 11 subagent transcripts. `sdlc-lint compliance` 100% on all five live contracts;
`model_enforcement_corrections: 0`; the three post-pipeline checks green.

The expertise arrived and was acted on: the developer used `collectAsStateWithLifecycle` and created
the project's first central `TestTag` object rather than inlining literals; `tester` wrote JVM tests
only while `qa-engineer` wrote the Compose UI test; the security analyst cited 8 MASVS control
groups and 4 MASTG test IDs; the reviewer edited nothing and drove two loop rounds.

`cache_hit_ratio: 1.0` — the prefix stayed byte-stable with the new blocks in it, so the blocks cost
no cache misses. Their effect on prefix *size*, which is the half of
[[decisions/ADR-0008-read-discipline-contract]]'s `cache_read ≈ turns × avg_prefix` that actually
bills, is still unmeasured and is PR-4's job.

Two behavioural findings, neither a code defect: the `documentation` dispatch carried no expertise
block (nine of the ten dispatches in scope did — the resolver returns one, so the orchestrator
dropped it; the eleventh dispatch, `session-recorder`, is out of scope because no role_expertise
names it), and a re-dispatched
`developer` edited production Kotlin with three MANDATORY rows in its prompt and zero `Skill` calls.
Neither has a gate: `sdlc-lint compliance` can match a dispatch only by `subagent_type` or a Bash
command, and `transcript-facts.mjs` does not capture dispatch prompts at all. Closing that is PR-4.

## Decisions & rationale

- Implements [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]] in full;
  the ADR is now `accepted`. It amends the roster clause of
  [[decisions/ADR-0001-stack-provider-pattern]] and is bounded by
  [[decisions/ADR-0008-read-discipline-contract]] (the 1400-char cap on per-role invariants, since
  they ride in every turn's prefix) and [[decisions/ADR-0018-reviewers-do-not-write-code]]
  (reviewer and debugger hold no `Edit`).
- The alias layer the original design carried was deleted after PR-1's review — an agent name is
  never translated at runtime; `/sdlc:doctor` migrates a project's config once, with approval.

## Planning

- Completes track **I1** on [[planning/roadmap]]; the ledger and the expertise-coverage table are in
  [[planning/i1-agents-in-core]]. Merged as three PRs into an integration branch (#139, #140, #141)
  and landed here as one.
- Owed next (PR-4): a compliance contract for block delivery and mandatory-skill invocation, and the
  core `debug.yaml` gaining the `debugging` phase — its description still claims "vanilla ships no
  dedicated debugger agent", which PR-1 made false.

---
_Auto-generated by `tools/brain-sync`. Frontmatter is machine-owned; prose below "Summary" is safe to enrich._
