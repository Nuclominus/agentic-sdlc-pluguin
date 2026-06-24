# Restructure Plan — Android Foundation + Framework Provider Pattern

> Branch: `worktree-android-foundation-restructure`
> Status: **Planning complete — ready to execute**
> Scope of this worktree: **Phase 1 (restructure + extension point) + `retrofit-plugin` reference**

## Context

The current marketplace models platforms as stack-provider plugins: `sdlc` (generic orchestrator) +
`android-plugin` + `ios-plugin`. This is too generic for the intended direction. We are **inverting the
topology**:

- **Android becomes the foundation/centerpiece** of the repo (`android-foundation`), the place where the
  Android CLI and the current Android agents live.
- **Framework libraries become attachable plugins** (`retrofit-plugin`, `dagger-plugin`, `room-plugin`, …)
  that *enrich* the Android flow without owning it.
- **iOS is dropped** — this becomes an Android-only tool.
- The whole thing rests on an extended **Stack Provider Pattern**: the orchestrator already merges/unions
  multiple matched profiles (convention skills, phase-prompt injections, ProGuard snippets, post-checks).
  We add an **additive profile** concept so framework plugins can contribute to that merge *without*
  competing to "win" the `android` aspect.

### Why this works with minimal risk
The orchestrator (`plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`, Step 1a) **already unions**
`convention_skills`, `phase_prompts_injection` (per-phase concat), `extra_phases`, and
`post_pipeline_checks` across every active profile. The **only** mechanical gap: the merge input is
`ACTIVE_PROFILES.values() + PRIMARY_PROFILE`, and a profile only enters `ACTIVE_PROFILES` by *winning* an
aspect. A framework that claims no aspect is silently dropped. We close that gap with one new collection
bucket (`ADDITIVE_PROFILES`) fed into the same merge.

## Locked design decisions

| Decision | Choice |
|---|---|
| Flow engine | `sdlc` stays its **own generic plugin** (untouched logic except additive support) |
| Repo layout | **Flat** — `android-foundation` and all framework plugins are peers under `plugins/` |
| Framework activation | **Auto-detect** from `gradle/libs.versions.toml` / build files + `sdlc.local.yaml` `frameworks.enable/disable` override |
| Framework capability | **Enrich-only** — convention skill + phase-prompt injection + ProGuard keep rules + post-checks. **No agents, no new phases.** |
| Pinned vs plugin | Only **detect-don't-impose** libs become plugins (Retrofit, Room, Hilt/Koin, Ktor…). Pinned house rules stay in the foundation (Coil3, Kermit, KSP, `@Serializable` routes, DataStore, Play Billing 8) |
| Profile format | **Reuse** `stack.md` schema + `additive: true` flag; framework file named `framework.md` |
| Stack id | Keep internal stack id `android` (avoid breaking existing config); rename **plugin** `android-plugin → android-foundation` |
| Marketplace | Keep name `agentic-sdlc`; **rebrand description** to Android-centric; remove iOS |

---

## Workstream A — Delete iOS

1. `git rm -r plugins/ios-plugin/`.
2. `.claude-plugin/marketplace.json` — remove the `ios-plugin` entry; trim "iOS/Swift" from the top-level
   `description`.
3. `schemas/stack.schema.json` — remove `ios` (and `shared`) from the `aspects` enum.
4. Scrub iOS references (text only, no logic) in: `README.md`, `ARCHITECTURE.md`, `CONTRIBUTING.md`,
   `CHANGELOG.md`, `CORE-TODO.md`, `docs/WORKFLOW.md`, and the iOS *examples* embedded in generic
   agents/commands: `plugins/sdlc/agents/{developer,business-analyst,qa-engineer}.md`,
   `plugins/sdlc/commands/{security-init,list-stacks,doctor}.md`,
   `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (the `ios → ios-architect` fan-out example).
5. Remove the iOS-monorepo note in `plugins/android-foundation/stack.md` (lines ~17–18) and
   `plugins/android-foundation/README.md` (~line 16).

## Workstream B — Rename `android-plugin → android-foundation`

1. `git mv plugins/android-plugin plugins/android-foundation`.
2. `plugins/android-foundation/.claude-plugin/plugin.json` → `"name": "android-foundation"`; refresh
   description (foundation/centerpiece language).
3. `.claude-plugin/marketplace.json` → update the entry `name` + `source` (`./plugins/android-foundation`).
4. **Skill namespace** (functionally load-bearing): in `plugins/android-foundation/stack.md`, change the 4
   convention-skill refs `android-plugin:<skill>` → `android-foundation:<skill>`
   (architecture, compose-ui, data, navigation — referenced in the "Convention skills" + "extension" blocks).
5. **No change needed:** agent dispatch uses bare names (`enforce-agent-model.sh` strips namespace); hooks
   use `${CLAUDE_PLUGIN_ROOT}` so the rename relocates them automatically.
6. Find-and-replace `android-plugin` doc strings → `android-foundation` in: `README.md`, `ARCHITECTURE.md`,
   `CORE-TODO.md`, `CHANGELOG.md`, `docs/WALKTHROUGH.md`, `docs/WORKFLOW.md`, and the sdlc cross-references
   in `plugins/sdlc/agents/{developer,security-analyst}.md`,
   `plugins/sdlc/commands/{list-stacks,security-init,doctor}.md` (illustrative only).
7. Keep `stack: android` in `stack.md` unchanged (id stability).

**Verification gate after B:** grep the repo for `android-plugin` — only intentional historical
references (e.g. CHANGELOG past entries) should remain. Confirm no `android-plugin:` skill namespace
survives outside CHANGELOG.

## Workstream C — Additive-profile support in the engine

1. **Schema** (`schemas/stack.schema.json`): add optional `additive: { type: boolean, default: false }`.
   Add an `if additive===true then` guard forbidding `agents_per_phase`/`workflow` (frameworks enrich only).
   Update the `priority` description to note additive profiles never win aspects. Document `aspects: []`
   as the additive norm.
2. **Orchestrator** (`plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`):
   - **Step 0b** — when parsing matched profiles, route `additive: true` matches into a new
     `ADDITIVE_PROFILES` set; exclude them from per-aspect winner resolution (Step 0b-aspects) and from
     `PRIMARY_PROFILE` selection.
   - **Parse guard** — if an additive profile declares `agents_per_phase`, HALT with a clear error.
   - **Step 1a** — change merge input from `ACTIVE_PROFILES.values() + PRIMARY_PROFILE` to
     `… + ADDITIVE_PROFILES` (deterministic alphabetical-by-source order preserved). Unions are unchanged.
   - **Print line** (the "🎯 Active stack profiles" banner) — add `additive: [retrofit, …]` so users can
     verify activation.
3. **Step 1b override** — parse optional `frameworks.enable: []` / `frameworks.disable: []` from
   `.claude/sdlc.local.yaml`: `enable` force-activates a framework regardless of `detect`; `disable`
   suppresses an auto-detected one. Mirror the existing `skip_phases` handling.
4. Update `docs/WORKFLOW.md` Stack-Provider diagram to show additive framework providers feeding the merge.

## Workstream D — `retrofit-plugin` reference (proves the pattern end-to-end)

New flat peer `plugins/retrofit-plugin/`:

```
plugins/retrofit-plugin/
  .claude-plugin/plugin.json      # name retrofit-plugin; deps: [sdlc, android-foundation]; no agents
  framework.md                    # additive: true, aspects: [], detect{} on retrofit coordinate
  runtime-dependencies.json       # { "dependencies": [] }
  skills/retrofit-conventions/SKILL.md
  rules/snippets/retrofit-proguard.md
```

- `framework.md`: `additive: true`; `detect.any` → `file_contains` on `gradle/libs.versions.toml`
  `(?i)retrofit` and `**/build.gradle*` `(?i)com\.squareup\.retrofit2`. Contributes:
  - `## Convention skills to apply` → `retrofit-plugin:retrofit-conventions`
  - `## Phase prompts injection` → **development** (suspend/Flow service APIs, centralized OkHttpClient,
    DEBUG-gated logging interceptor, map transport errors to domain Results at the repo boundary) and
    **security** (HTTPS-only/no cleartext, cert/public-key pinning per MASVS-NETWORK, never log
    Authorization/bodies in release, apply the framework's ProGuard snippet).
- `retrofit-conventions/SKILL.md`: **library-specific idioms only** — `@GET/@POST` suspend signatures,
  interceptor ordering, converter setup, `Result` mapping. Cross-links to the foundation's `android-data`
  skill for layer principles (no restatement).
- `retrofit-proguard.md`: the Retrofit/OkHttp keep slice.

**De-duplication (critical):** the foundation's `android-data` skill is already principle-only — keep as
is; `retrofit-conventions` is its Retrofit specialization. **Extract** the Retrofit-interface keep + OkHttp
`-dontwarn` blocks out of `plugins/android-foundation/rules/snippets/proguard-keep.md` into
`retrofit-plugin/rules/snippets/retrofit-proguard.md`, leaving only pinned/foundation keeps
(kotlinx.serialization, Play Billing, Firebase, Hilt-until-dagger-plugin-exists) behind. Each keep rule
lives in exactly one place, gated by detection.

5. Register `retrofit-plugin` in `.claude-plugin/marketplace.json`.

## Workstream E — Docs & changelog

1. `ARCHITECTURE.md`: new section "Framework Provider Pattern (additive profiles)" — what additive means,
   the detect/override flow, the enrich-only contract, the pinned-vs-plugin line.
2. `README.md`: update plugin roster, quickstart (drop iOS, add android-foundation + retrofit-plugin),
   stack-priority table.
3. `CHANGELOG.md`: new unreleased section documenting the rename, iOS removal, additive profiles,
   retrofit-plugin.
4. `CONTRIBUTING.md`: retarget "native mobile (Android+iOS)" → "Android-centric"; add a short "how to write
   a framework plugin" pointer.

---

## Execution order & gates

1. **C-schema first** is optional; safe order is **A → B → C → D → E** so each gate is verifiable:
   - Gate A: repo has no `ios-plugin` dir; `grep -ri "ios" --include=*.md --include=*.json` returns only
     intentional/historical hits.
   - Gate B: `grep -rn "android-plugin" .` returns only CHANGELOG history; `stack.md` skill namespaces are
     `android-foundation:`.
   - Gate C: validate `stack.schema.json` parses; orchestrator skill describes `ADDITIVE_PROFILES`.
   - Gate D: `retrofit-plugin/framework.md` validates against the (additive-aware) schema; ProGuard slice
     no longer duplicated in foundation.
2. Keep changes as logically-scoped commits (A, B, C, D, E) for reviewability.

## Verification (end-to-end, no Android project required here)

Since this repo ships configuration (not runnable code), verification is **static**:

- **Schema validation:** validate every `stack.md`/`framework.md`/`plugin.json` against the JSON schemas
  in `schemas/` (use a JSON-schema validator, e.g. `ajv` or a small Node script, against the additive-aware
  `stack.schema.json`).
- **Reference-integrity grep:** no dangling `android-plugin:` skill refs; no `ios`/`ios-plugin` outside
  CHANGELOG history; every `convention skill` named in a profile resolves to a real `skills/<name>/SKILL.md`.
- **Orchestrator dry-read:** confirm the `pipeline-orchestrator` SKILL.md text now (a) collects
  `ADDITIVE_PROFILES`, (b) merges them in Step 1a, (c) guards against framework `agents_per_phase`,
  (d) prints the additive line.
- **Optional live smoke test (follow-up, needs a real Android+Retrofit project):** run
  `/sdlc:list-stacks` → foundation wins `android`, retrofit shows as additive; dry `/sdlc:start` →
  confirm the dev + security prompts receive the Retrofit injections and that an *existing* foundation
  agent (android-developer / android-security), not a new agent, consumes them.

## Out of scope (later phases)

- `room-plugin`, `dagger-plugin` (and the Hilt/Koin "detect, don't impose" resolution), Ktor, etc.
- Any live CI integration or runnable test harness.
