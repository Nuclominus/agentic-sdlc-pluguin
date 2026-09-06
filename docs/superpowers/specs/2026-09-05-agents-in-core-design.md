# Agents live in the core; foundations carry expertise — design

**Status:** approved 2026-09-05 · **ADR:** `.brain/decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise.md` · **Track:** `.brain/planning/i1-agents-in-core.md`

## Problem

Two plugins ship subagents: `plugins/sdlc/agents/` (7, process-only) and
`plugins/android-foundation/agents/` (11, 1,895 lines, carrying most of the Android expertise).
The winning foundation's `agents_per_phase` replaces the core's agent per phase (ADR-0001). Three
defects follow:

1. **Duplicated process, missing contracts.** `android-security` / `android-aar` copy the core's
   process text verbatim, yet no Android agent carries the core's deliverable templates,
   compact-summary machine contracts or the QA 3-attempt cap. Android runs lose the core's guarantees.
2. **Expertise trapped in agent bodies.** Only developer-phase conventions are skills. Tester, qa,
   security, reviewer, debugger, devops, cicd and docs expertise exists nowhere else.
3. **Cross-plugin path coupling.** Android agents read `rules/` via `${CLAUDE_PLUGIN_ROOT}`, which
   resolves to the plugin that owns the *agent*; moving one breaks 50+ references.

## Decisions (made with the user)

| Question | Decision |
|---|---|
| Roster | Full universal roster in the core: `reviewer`, `tester`, `debugger`, `devops`, `cicd` join the existing seven. Every `android-*` role has a 1:1 core successor. |
| Delivery | Hybrid. Manifest-declared per-role `invariants` + `rules` paths are rendered by the resolver and pasted by the orchestrator into the stable prefix (present by construction). Large checklists become per-role foundation skills invoked as mandatory. |
| Migration | Delete `android-foundation/agents/`. **No aliases anywhere** (amended 2026-09-06 after PR-1's review): a name that matches nothing is reported, never translated. `/sdlc:doctor` migrates a project's `sdlc.local.yaml` and `model.local.json` once, with approval, from the rename data in `config/agent-migrations.json`. |
| On-demand agents | One resolver command — `node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs expertise --role <name>` — prints the same blocks; no "read N files" prose (H1: one-command shapes measure ~100% compliance). |

## Architecture

### Manifest — `role_expertise`

```yaml
role_expertise:                 # keys = core agent names ($defs.coreRole)
  developer:
    invariants: |               # ≤ 1400 chars — rides in every turn's prefix
      Native Android (Kotlin). Compose-first UI …
    rules:                      # relative to this manifest; emitted absolute
      - { path: rules/snippets/non-negotiable.md, note: "forbidden patterns — read before the first edit" }
      - rules/snippets/gradle-commands.md
    skills:                     # same row shape as sdlc.local.yaml extensions.skills
      - { skill: superpowers:test-driven-development, when: "before the first Write/Edit of production Kotlin" }
      - { skill: android-foundation:android-review, policy: mandatory }
```

`phase_injections` stays for frameworks. The Android foundation's three injections fold into the
`developer`, `qa-engineer` and `security-analyst` invariants. `agents_per_phase`,
`on_demand_agents` and `aar_analyst` become core-manifest-only: honored on a foundation with a
deprecation warning for one release (PR-1/2), forbidden by the schema after (PR-3).

### Core manifest — the canonical phase → agent map

`plugins/sdlc/manifest.yaml` binds `business_analysis`, `development`, `review`, `security`,
`remediation`, `test`, `qa`, `debugging`, `documentation` and lists `on_demand_agents:
[debugger, devops, cicd, aar-analyst]`. `mergeProfiles` falls back to it per phase; the flat
`development` binding fans out over the winning foundation's aspects
(`development — android → developer`), so dry-run and telemetry rows keep their shape.

### Resolver

- `profile.mjs` — `mergeRoleExpertise(sources)` (primary first, frameworks alphabetically; rules
  absolute, missing ones dropped with a warning; skills deduped, strictest policy wins, equal
  policies broken by a stated `when` then alphabetically), `renderRoleExpertiseBlock`,
  `renderSkillsBlock` (3b-1a as code), stale-agent-name reporting in `parseExtensionSkills` /
  `parseModelOverrides`, `extra_phases[].agent` honored.
- `plan.mjs` — `resolveProfile` (Steps 0 → 1b-models, shared), `plan.profile.role_expertise`,
  `plan.profile.prompt_blocks[agent] = {expertise, skills}`, `plan.stack.profile_dir`, a WARN for
  any recipe phase with no agent bound, `resolveExpertise({role})`.
- `cli.mjs expertise --role <name> [--json] [--stack=NAME] [--mode tree|installed]` — prints the
  blocks or `no stack expertise for <role> (stack: vanilla)`; exit 2 on an unknown role.

### Orchestrator

3b-1 pastes `prompt_blocks[agent].expertise` after the phase injections and
`prompt_blocks[agent].skills` where the extension block used to be, both inside the stable prefix
and omitted when `null`. 3b-1a shrinks to "paste verbatim"; the on-demand self-read note is replaced
by the `expertise --role` command.

### Agents — the expertise slot (identical section in all 11 role agents)

```markdown
## Stack expertise (how platform knowledge reaches you)

You are platform-neutral. Platform knowledge arrives in exactly one of two ways:

1. **Orchestrated** — your prompt contains a block headed `Stack expertise for <role>`. Treat its
   invariants as hard rules, `Read` the listed rule files (absolute paths) that your task touches,
   and invoke each `MANDATORY` skill from the `Skills for this role` list at the moment it names.
2. **Direct / on-demand** — no such block. Before any other tool call run exactly ONE command and
   treat its output as that block:
   `node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs expertise --role <name>`
   If it prints `no stack expertise for <name>`, proceed with the generic guidance below.
```

`business-analyst` and `security-analyst` hold no `Bash` and say so: orchestrated only, generic
fallback otherwise. `${CLAUDE_PLUGIN_ROOT}` in the slot resolves to the sdlc root, where the
command lives — correct by construction.

### Hook — `enforce-agent-model.sh`

Unchanged in behaviour, and deliberately so: it resolves the name it is given and falls open when no
agent file matches. A direct `${CLAUDE_PLUGIN_ROOT}/agents/<name>.md` probe answers first (every
dispatched agent ships in the core), with `find -print -quit` as the fallback for other layouts.

### Migration — `config/agent-migrations.json` + `tools/migrate/`

`loadRenames` merges the versioned rename entries; `scanConfigs` reports every stale name in
`sdlc.local.yaml` `extensions.skills[].agents` and `model.local.json` `agents{}` with its location;
`applyRenames` rewrites only those tokens (YAML by targeted line replacement so comments and
formatting survive, JSON by re-serialisation). `cli.mjs check` is read-only and exits 2 on findings;
`cli.mjs apply` writes. `/sdlc:doctor` runs `check`, shows the findings, and runs `apply` only on an
explicit yes.

### Lint — `sdlc-lint roster` (part of `all`)

| Check | Invariant |
|---|---|
| agents | every role the core binds (`agents_per_phase` ∪ `on_demand_agents` ∪ `extra_phases[].agent`) ships `plugins/sdlc/agents/<name>.md` with a matching `name:` |
| phases | every phase in every `plugins/*/workflows/*.yaml` is a core-bound phase or an `extra_phases` name |
| expertise | every `role_expertise` key is a core role; every rule path exists; every own-plugin skill exists; every `superpowers:*` skill is declared in that plugin's `runtime-dependencies.json` |
| slot | every core role agent carries the "Stack expertise" section; one holding `Bash` carries `expertise --role <its name>`; one without `Bash` must NOT name that command; the orchestrator's 3b-1 layout carries `Stack expertise for` |

PR-3 adds: only `plugins/sdlc` has an `agents/` dir; no legacy `android-<role>` name under
`plugins/` outside `aliases.mjs`, the hook and CHANGELOG; no `${CLAUDE_PLUGIN_ROOT}` inside a
foundation's `rules/**`.

## Expertise extraction (PR-2)

| Android agent content | Destination |
|---|---|
| android-ba §1–§7 | `android-foundation:android-requirements` |
| android-reviewer dimensions 1–11 | `android-review` |
| android-security MASVS §1–9, MASVS/MASTG map, OWASP map | `android-security-masvs` |
| android-tester stack, patterns, commands + `rules/testing.md` | `android-testing` |
| android-qa Compose UI Test, Maestro, a11y | `android-e2e` |
| android-docs vault canon, testTag index, DoD | `android-docs-vault` |
| android-debugger methodology, bug tables, Logcat | `android-debugging` |
| android-devops variants, signing, R8, distribution | `android-build-release` |
| android-cicd pipeline structure, Actions YAML, caching | `android-ci` |
| `rules/skills.md` mandatory matrix | `manifest.yaml role_expertise.*.skills` |
| verbatim core process copies, "Scope boundaries", self-read sections | dropped (the core carries them) |

`rules/INDEX.md`, `rules/skills.md`, `rules/workflow.md` are rewritten by core role; every
`${CLAUDE_PLUGIN_ROOT}` inside `rules/**` becomes a descriptive reference. A coverage table with one
row per `##` section of each deleted agent lives in `.brain/planning/i1-agents-in-core.md`, and
`tools/sdlc-lint/scripts/expertise-coverage.mjs` asserts every anchor is present at its destination.

## Risks

| Risk | Mitigation |
|---|---|
| Stable-prefix growth | Invariants ≤ 1400 chars/role (schema), rules ≤ 5 lines, skills ≤ 5 rows. Net per-turn context is expected to shrink (an Android agent body was the subagent's system prompt on every turn). Measured in PR-4. |
| Mandatory-skill compliance (H1) | ≤ 3 mandatory skills per role, one machine-rendered list, audited with `sdlc-lint compliance` after the first runs. |
| `${CLAUDE_PLUGIN_ROOT}` cross-plugin | Rule paths emitted absolute; the variable purged from foundation `rules/**` and linted. |
| Users' `sdlc.local.yaml` / `model.local.json` | A stale name is reported on every run (in `prints[]`, and on stderr for `expertise`) and migrated by one approved `/sdlc:doctor` pass. It degrades rather than misbehaves: an extension row injects nothing, a model key leaves the frontmatter tier in force. |
| Old telemetry keyed by agent name | `/sdlc:report` groups by phase and model — unaffected. |

## Verification

1. `node --test tools/sdlc-lint/test/*.test.mjs` — profile, plan, aliases, schema, roster suites.
2. `node tools/sdlc-lint/cli.mjs all --json` — includes `roster`.
3. `bash tests/test-enforce-agent-model.sh` — a stale key is not translated, an unknown dispatch falls open, the plugin-root probe resolves a core agent.
3a. `node plugins/sdlc/tools/migrate/cli.mjs check` on a project with a stale name — exit 2, findings named.
4. `node tools/brain-sync/cli.mjs check --vault .brain`.
5. On a real Android project: `/sdlc:start "…" --dry-run` shows `development — android → developer`
   (PR-2 onward); `cli.mjs expertise --role debugger` prints the block.
