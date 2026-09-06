---
adr: 21
status: proposed
date: 2026-09-06
supersedes: null
---

# ADR-0021 — Agents live in the core; foundations carry expertise

## Context

Two plugins shipped subagents: `plugins/sdlc/agents/` (7 process-only agents) and
`plugins/android-foundation/agents/` (11 agents, 1,895 lines, carrying most of the Android
expertise). [[decisions/ADR-0001-stack-provider-pattern]] made the foundation's `agents_per_phase`
the extension point: the winner's roster replaced the core's, phase by phase. Three defects grew
out of that split and none of them was visible from either plugin alone:

- **Duplicated process, missing contracts.** `android-security` and `android-aar` copied the core
  agents' process text verbatim (the READ-ONLY banner, the `ISSUES_FOUND` machine contract), yet no
  Android agent carried the core's deliverable templates, its compact-summary contracts, or the
  QA 3-attempt cap. An Android run therefore *lost* the guarantees the core provides — the roster
  override replaced the process along with the expertise.
- **Expertise trapped in agent bodies.** Only the developer-phase conventions lived in skills
  (compose-ui, architecture, data, navigation). Everything the tester, qa, security, reviewer,
  debugger, devops, cicd and docs roles knew — MASVS audit sections, Maestro flows, the debugging
  playbook, the GitHub Actions template — existed nowhere else and was unreachable by any agent
  but its owner.
- **Cross-plugin path coupling.** Android agents read their rules through `${CLAUDE_PLUGIN_ROOT}`,
  which resolves to the plugin that owns the *agent*. Any move of an agent broke fifty-odd
  references at once, which is why the roster had never been touched.

Two measured findings bound the design. [[planning/h1-compliance-auditor]] showed that compliance
tracks how many separate things an instruction asks for: one once-per-run command measures 100%,
"read these N files" prose measures far less. And [[decisions/ADR-0008-read-discipline-contract]]
showed that guidance placed once in the orchestrator's stable prefix reaches every agent — current
and future — at ~1.4% of a run's cache reads. The framework plugins already lived by the target
shape ([[decisions/ADR-0002-framework-provider-pattern]]: skill + injections, zero agents), so the
pattern had six working instances before this ADR generalised it.

## Decision

**`sdlc` = process (every agent). Foundation = expertise (skills, rules, hooks, workflows, and a
per-role declaration the core consumes).**

1. **The core ships the whole roster.** `plugins/sdlc/agents/` gains `reviewer`, `tester`,
   `debugger`, `devops` and `cicd` beside the existing seven, and `plugins/sdlc/manifest.yaml`
   binds every phase (`business_analysis`, `development`, `review`, `security`, `remediation`,
   `test`, `qa`, `debugging`, `documentation`) and lists the on-demand agents. It is the only
   manifest that binds agents. A foundation's `agents_per_phase` is honored with a deprecation
   warning for one release, then ignored; frameworks never had it.
2. **Foundations declare `role_expertise`**, keyed by core role: short `invariants` (≤ 1400
   chars — it rides in every turn's prefix), `rules` (paths relative to the manifest, emitted
   absolute by the resolver), and `skills` (the same row shape as `sdlc.local.yaml`
   `extensions.skills`). Large checklists become per-role foundation skills that the agent
   invokes as mandatory. The three Android `phase_injections` fold into the developer, qa-engineer
   and security-analyst invariants; `phase_injections` itself stays for frameworks.
3. **Delivery is one of two shapes, both machine-rendered.** The resolve command merges every
   active manifest's block (foundation first, frameworks alphabetically), renders
   `prompt_blocks[agent] = {expertise, skills}`, and the orchestrator pastes both verbatim into the
   stable prefix (3b-1). An on-demand agent runs exactly one command —
   `node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs expertise --role <name>` — and receives the
   same two blocks. The 3b-1a dedupe (strictest policy wins, mandatory first, alphabetical) moves
   from prose into `profile.mjs` and its tests.
4. **Every core agent carries the same expertise slot** — the two-way rule above — and
   `sdlc-lint roster` holds all four seams: every bound role ships a core `.md`; every recipe
   phase is bound; every `role_expertise` key, rule path and skill resolves (a `superpowers:*`
   skill must be declared by the plugin that mandates it — the h5-d2 rule); every agent carries
   its own bootstrap line and the orchestrator pastes the block.
5. **No aliases. An agent name is never translated, anywhere.** The first implementation kept the
   eleven `android-*` names working by rewriting them in the resolver, in the tier lookup and in
   the model-enforcement hook. Review found six defects in that machinery, every one the same
   shape: one copy of the map keyed on the canonical name while another was keyed on the
   dispatched one. The key in `model.local.json`, the name dispatched, the `role_expertise` key and
   the file on disk are now one string by construction.

   A name that matches nothing is **reported**, not repaired: the resolver warns per site and names
   `/sdlc:doctor`, and the hook falls open exactly as it does for any non-SDLC agent. `/sdlc:doctor`
   owns the migration. It reads `config/agent-migrations.json` (rename data, versioned and
   appendable, never consulted at runtime), reports every stale entry in `sdlc.local.yaml` and
   `model.local.json`, and rewrites those name tokens **only after the user approves**, via
   `tools/migrate/cli.mjs apply`. This is the first time doctor writes anything; diagnosis stays
   read-only and the write is bounded to two files, agent-name tokens only, interactive only. It
   also generalises: the next rename is a data entry plus a doctor run, not another translation
   layer.

## Consequences

- **Android runs keep every core contract** (deliverable templates, compact summaries, the
  QA cap, ADR-0018 tool allowlists) and gain a review, test and debugging phase the core also
  serves on vanilla stacks. A future foundation is a manifest, skills, rules and hooks — no agents
  to write, and no way to lose the process by overriding it.
- **The roster grows from 7 to 12 agents** (5 new + `session-recorder`), each platform-neutral.
  Two of them (`business-analyst`, `security-analyst`) hold no `Bash` and cannot bootstrap on
  demand; their slot says so and they fall back to the generic guidance.
- **Prefix growth is budgeted, not free.** Invariants are capped at ~300 tokens per role and the
  per-turn context is expected to *shrink* — an Android agent body (78–259 lines) was the
  subagent's system prompt on every turn; a core body plus a ~25-line block is smaller. The
  measurement is the follow-up (PR-4 of the plan), not a claim made here.
- **An un-migrated project degrades rather than misbehaves.** An extension row naming a removed
  agent injects nothing; a stale `model.local.json` key leaves the frontmatter tier in force. Both
  are reported on every run and fixed by one doctor pass. This is the deliberate trade for deleting
  the translation layer: silent-and-correct was never on offer, only silent-and-wrong.
- **The skills block is not byte-identical to the extension block it replaces.** It now carries the
  stack's own `role_expertise.<role>.skills` alongside the project's `extensions.skills`, so it has
  a new header and a stated tie-break for two rows of equal policy (a stated `when` beats none, then
  alphabetically first). Prompt-cache stability holds run to run, which is what the cache needs; it
  does not hold across this upgrade, and no claim is made that it does.
- **Three PRs, each CI-green:** PR-1 (this ADR, roster, resolver, orchestrator, lint, doctor
  migration — the foundation still binds its own roster, so an Android run behaves as before),
  PR-2 (Android expertise extracted into nine skills + `role_expertise`, the foundation stops
  binding), PR-3 (delete `android-foundation/agents/`, forbid roster keys on non-core foundations,
  docs, 2.0.0). `expertise-coverage.mjs` asserts every section of every deleted agent has a mapped
  destination. Because the whole track lands on one integration branch, the marketplace never
  publishes a split roster: there is no shipped intermediate state to keep compatible, which is
  what made the alias layer unnecessary as well as harmful.
- **Amends ADR-0001.** "Its own agent roster" is no longer what a foundation plugs in; the
  extension point is `role_expertise` + workflow + skills + hooks. Detection, priority and the
  aspect model are unchanged. Old telemetry rows keep their `android-*` agent names; `/sdlc:report`
  groups by phase and model and is unaffected.

## Related
- Implemented by: #139 (PR-1), then PR-2 and PR-3 of [[planning/i1-agents-in-core]]
- Amends: [[decisions/ADR-0001-stack-provider-pattern]]
- Relates to: [[decisions/ADR-0002-framework-provider-pattern]], [[decisions/ADR-0008-read-discipline-contract]], [[decisions/ADR-0018-reviewers-do-not-write-code]], [[decisions/ADR-0019-the-run-start-is-one-command]], [[planning/h1-compliance-auditor]], [[architecture/stack-provider-pattern]]
