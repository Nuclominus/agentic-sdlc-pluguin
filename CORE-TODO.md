# CORE-TODO — Mobile Retune of the `sdlc` Core

The core `sdlc` plugin was copied verbatim from claude-sdlc. Its orchestrator algorithm,
aspect resolution, skip-rules, model tiering, and cost model are platform-agnostic and kept as-is.
The following deltas adapt the web-flavored defaults to native mobile.

## 1. `file_glob` detection rule  *(DONE)*
- **Schema:** `schemas/stack.schema.json` `$defs/detectRule` gained a `file_glob` variant **and** nested
  `any`/`all` (recursive) so a profile can express "(.kts OR .gradle) AND has Kotlin".
- **Orchestrator:** Step 0b evaluates `file_glob` via the `Glob` tool (≥1 match) and recurses into nested
  `any`/`all`, alongside `file_exists`/`file_contains`.
- **Profiles restored:** `android` → `all: [ any:[settings.gradle(.kts)], file_glob:"**/*.kt" ]`;
  `ios` → `any: [ file_glob:"**/*.xcodeproj", file_glob:"**/*.xcworkspace", file_exists:Package.swift ]`
  (app-target + monorepo now auto-detected; the old --stack=ios workaround comment removed).

## 1b. validate-kotlin reference cleanup  *(DONE)*
Rules pointed at `.claude/scripts/validate-kotlin.sh`, but validate-kotlin is now a plugin hook
(`${CLAUDE_PLUGIN_ROOT}/hooks/validate-kotlin.sh`, invoked by `kotlin-guard.sh`). Path refs in
`snippets/non-negotiable.md` and `enforcement.md` updated; no project-install of validate-kotlin.


## 2. Security standard — MASVS/MASTG (mobile) vs platform-neutral core  *(DONE)*
- **Core `security-analyst`** genericized: web-OWASP Top 10 removed; now a platform-neutral baseline
  (secrets, auth, injection, data protection, access control, misconfig, deps, logging) that treats the
  standard injected by the active profile as authoritative. Core agent + orchestrator security base
  prompt + document-writer + README no longer mention OWASP-web.
- **`android-security`** re-anchored to **MASVS** control groups (STORAGE/CRYPTO/AUTH/NETWORK/PLATFORM/
  CODE/RESILIENCE/PRIVACY) with **MASTG** test procedures; each audit section tagged with its MASVS
  group; findings cite MASVS control + MASTG test ID. OWASP Mobile Top 10 kept only as a secondary
  risk cross-map. android/ios stack.md security injections already say MASVS/MASTG.

## 3. QA phase + post-pipeline → builds are CI-deferred  *(DONE)*
- `qa` base prompt: in-pipeline = lint + unit (JVM/SPM) + compile-check only; instrumentation/UI tests
  (Espresso/XCUITest) and full builds are CI-only.
- Confirm the orchestrator's post-pipeline runner tolerates capability-gated no-ops (iOS off macOS).

## 4. Model IDs  *(DONE — verified)*
- `enforce-agent-model.sh` tier→model-ID: opus→claude-opus-4-8, sonnet→claude-sonnet-4-6, haiku→claude-haiku-4-5-20251001. Matches the current target models.

## 5. Commands  *(DONE)*
- DONE: `/sdlc:init` added (`commands/init.md`) — detect platform(s), scaffold `.claude/sdlc.local.yaml`
  (idempotent, never overwrite), optionally seed `CLAUDE.md` (managed block).
- DONE: `/sdlc:doctor` extended with a host-capability probe (uname + node/java/gradlew/swift/xcodebuild/android), human + JSON.

## 6. Orchestrator support for the rich Android pipeline  *(PARTLY DONE)*
Generic, platform-agnostic control flow added to the core so the android-feature DAG runs:
- **DONE — arbitrary phases** `review` / `test`: already generic (orchestrator looks up the agent per
  phase from the profile; single-agent phases run as aspect-agnostic). No hardcoded phase set.
- **DONE — Reviewer⇄Developer loop**: generic `loop: {return_to, max_rounds}` workflow item +
  orchestrator §3-loop (re-runs return_to with `loop_findings`, caps rounds, escalates). Multi-pass
  return_to phases skip the planning gate on re-runs.
- **DONE — `security ‖ test` parallel**: generic `{parallel:[...]}` workflow item + orchestrator
  §3-parallel (single message, one Agent call per phase).
- **DONE — schema + RESOLVER**: workflow.schema.json gained loop + parallel; RESOLVER preserves the
  shapes and validates loop back-edges. Workflows `android-feature` / `android-bugfix` use them.
- **DONE — workflow discovery across plugins**: recipes are globbed from `**/workflows/` (core + every
  plugin), so platform workflows live in their own plugin. `android-feature`/`android-bugfix` moved to
  `android-plugin/workflows/`. Core ships only generic recipes (default/bugfix/hotfix/refactor/docs-only).
- **DONE — profile default workflow**: generic `workflow:` field in stack.schema.json; orchestrator
  reads `PRIMARY_PROFILE.workflow → CONTEXT.profile_default_workflow` with precedence
  `--workflow=NAME` → sdlc.local.yaml `active_workflow` → profile `workflow:` → `"default"`.
  android/stack.md declares `workflow: android-feature` → auto-selected on Android projects.
- **DONE — vault lifecycle** (plugin-owned, NOT core): `android-plugin/skills/manage-vault/` — a single
  phased, idempotent skill merging the old setup + fill-vault + update flows. Phase 0 detect → 1 scaffold
  (`${CLAUDE_PLUGIN_ROOT}/vault/` → project `.obsidian-vault/` + `.claude/scripts/`) → 2 classify
  plugin-owned (MISSING/IDENTICAL/DIVERGED) → 3 add MISSING (DIVERGED never blind-overwritten; content
  never touched) → 4 optional STUB-aware regenerate/populate (scan.md/apply.md/audit.md, Node tooling) →
  5 archive before regenerate (archive.md: timestamped zip, keep last 5). `<!-- STUB -->` marker is the
  content boundary. Core has zero vault knowledge.
- **DROPPED — `android:` block in sdlc.local.yaml**: would put platform knowledge in the core.
  Instead, android agents detect project specifics at runtime (Architecture Detection) and projects
  use the existing GENERIC `sdlc.local.yaml` overrides. Core stays platform-agnostic.

## 7. Android CLI — OPTIONAL, fully inside android-plugin  *(DONE — no core change)*
Android CLI is Google's official `android` BINARY (https://developer.android.com/tools/agents/android-cli),
not a marketplace plugin. It is detected and advised **entirely within android-plugin** by
`hooks/android-cli-check.sh` (SessionStart, Android-projects only, non-blocking). The core orchestrator
and `runtime-dependencies.json` (which the core reads) contain ZERO Android-CLI knowledge — the plugin
owns it end-to-end. Setup (optional): download → `android update` → `android init`.
- **Agent binding — DONE.** Capability menu bound in `rules/skills.md` ("Android CLI Capability
  Bindings (OPTIONAL)" section), advisory affordances gated on the CLI being present:
  - `create` / `describe` → android-ba / android-developer
  - `emulator *`, `run`, `screen capture/resolve`, `layout` → android-qa
  - `sdk *`, `studio version-lookup` → android-devops / android-developer
  - `docs search/fetch` (Android Knowledge Base) → any agent (grounding)
  - `studio analyze-file/find-declaration/find-usages/render-compose-preview` → android-developer / android-reviewer
  - `skills add/find/list` → setup / android-devops

## 8. Project Extension Manifest — per-project skills / commands / hooks  *(DEFERRED — own step)*
Let each project optionally extend the SDLC process without editing the plugin. Recommended design:
- **One file**: extend the existing `.claude/sdlc.local.yaml` with an `extensions:` section (no new config file).
- **Skills** (the genuinely new capability):
  ```yaml
  extensions:
    skills:
      - skill: "<plugin>:<skill>"
        agents: [android-developer, android-reviewer]   # or "all"
        when: "before implementing Compose UI"
        policy: recommended | mandatory
  ```
  Read-level (hybrid): the ORCHESTRATOR merges skills.md + extensions and injects per-agent skill
  instructions when building each pipeline phase's prompt; ON-DEMAND agents (debugger/devops/cicd/aar)
  self-read `extensions.skills` rows naming them (they bypass the orchestrator). Mirrors the existing
  "agents read skills.md at use-time" single-source pattern.
- **Commands / hooks**: lean on Claude Code's NATIVE project mechanisms — project `.claude/commands/`
  and project `.claude/settings.json` hooks already load automatically and merge with plugin hooks.
  For phase-bound execution, the existing sdlc.local.yaml `post_pipeline_checks` / `phase_command_overrides`
  already cover it. So extensions only need to ADD the per-agent SKILL mapping; commands/hooks reuse what exists.
- **Why deferred**: depends on the orchestrator surgery (§6) being done first (it's the injector), and is
  orthogonal to agent adaptation. Best as a focused step once §6 lands.
