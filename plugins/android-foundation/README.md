# android-foundation

Android Foundation — the centerpiece Android (Kotlin + Gradle) stack provider for the Agentic SDLC marketplace. Its `manifest.yaml` (`kind: foundation`) registers the `android` profile (platform aspect `android`, priority 300) and contributes the Android **expertise** the core roster consumes: a per-role `role_expertise` block, nine extracted skills, house rules and hooks (ADR-0021 — the agents themselves live in `sdlc`). It carries the pinned house rules and **hosts** detect-don't-impose libraries (Retrofit→`network`, Room→`persistence`, Dagger/Hilt→`di`) via `hosts_aspects: all` + `framework_detection`; those attach as **additive framework plugins**. For the Stack Provider Pattern, the Framework Provider Pattern, and shared mechanisms, see the [root README](../../README.md).

---

## Detection

```yaml
detect:
  all:
    - any: [ {file_exists: settings.gradle.kts}, {file_exists: settings.gradle} ]
    - file_glob: "**/*.kt"            # a Gradle project that actually has Kotlin
```

Matches a Gradle project that genuinely contains Kotlin (not a pure-Java/Groovy build).

---

## Pipeline

The profile declares `workflow: android-feature`, so this DAG **auto-selects** on Android projects — `/sdlc:start "<feature>"` (no `--workflow=`; override with `--workflow=NAME`).

```
business_analysis → development → review ──approved──→ [ security ‖ test ] → remediation? → qa → documentation
                         ▲           │
                         └──changes──┘  (loop, max 3 rounds)
```

- **review** is a loop phase: changes-requested → re-run `development` (implement pass only, findings injected), up to 3 rounds, then escalate.
- **[security ‖ test]** is a parallel group (one message, two Agent calls).
- **remediation** is a gated phase — see "Who may write code" below. It dispatches `developer` with the security report, and only when `security-analyst` reported a Critical or High finding; otherwise it is skipped at zero cost.
- `android-bugfix` is the same minus BA: `development → review(⇄dev) → [security ‖ test] → remediation? → qa`.

See the rendered diagram + a full end-to-end run in [`docs/WORKFLOW.md`](../../docs/WORKFLOW.md) and [`docs/WALKTHROUGH.md`](../../docs/WALKTHROUGH.md).

---

## Expertise per role

This plugin ships **no agents**. The roster is the core's (`plugins/sdlc/agents/`); what the manifest
contributes is `role_expertise`, keyed by core role name. For each role the resolver merges the
`invariants` (always-on rules, capped at 1400 characters because they ride in every turn's stable
prefix), the `rules` file paths (emitted absolute, since the reading agent lives in another plugin),
and the `skills` rows (deduped with the project's own `sdlc.local.yaml` extensions, strictest policy
winning). The orchestrator pastes the rendered blocks into the phase prompt; an on-demand role gets
the same from `node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs expertise --role <name>`.

| Core role | Phase | Android skill it must invoke | Invariants cover |
| --------- | ----- | ---------------------------- | ---------------- |
| `business-analyst` | business_analysis | `android-requirements` | Module placement / bounded contexts, the layering rule, Android non-functional requirements |
| `developer` | development, remediation | (convention skills) + TDD, `frontend-design` | Compose + UDF, DI, coroutines, version catalog, testTags, logging, the compile check |
| `reviewer` | review | `android-review` | The Kotlin/Compose/layering reject list; vault freshness as part of the diff |
| `security-analyst` | security | `android-security-masvs` | MASVS/MASTG authority, release-variant audit, the Android security non-negotiables |
| `tester` | test | `android-testing` | JVM-only scope, MockK/Turbine/coroutines-test discipline, what to cover |
| `qa-engineer` | qa | `android-e2e` | Compose UI Test + Maestro, testTag selectors, accessibility, no `Thread.sleep` |
| `document-writer` | documentation | `android-docs-vault` | Vault-as-SSOT, typed edges, generated artifacts, no version pinning in notes |
| `debugger` | debugging + on-demand | `android-debugging` | Evidence order and the common Android causes; what a prescribed fix may not introduce |
| `devops` | on-demand | `android-build-release` | Gradle/`build-logic`/version catalog, signing hygiene, KSP over KAPT |
| `cicd` | on-demand | `android-ci` | CI stage order, caching, secrets from the CI store, pinned versions |
| `aar-analyst` | `/sdlc:aar` | — | What to audit an Android run against; workflow scope only |

Convention skills (`android-compose-ui`, `android-architecture`, `android-data`, `android-navigation`)
are declared separately under `convention_skills` and reach the development phase as before; framework
plugins (Hilt, Retrofit, Room, …) add their own `phase_injections` on top.

### Who may write code

Every core agent declares an explicit `tools:` allowlist in its frontmatter. An agent with no
`tools:` key inherits **every** tool, which is how a read-only reviewer ends up silently editing the
code it is reviewing — so the allowlist is mandatory, not optional (ADR-0018).

The reviewing roles (`reviewer`, `security-analyst`, `debugger`, `aar-analyst`) have **no `Edit` tool
by design**. `Write` is still granted to the first three for exactly one purpose: their own report
under `docs/plans/{task_slug}/`. This is what keeps the review loop meaningful — a reviewer that
repairs the code it reviews leaves no independent verifier behind, and its edits land outside the
loop that guards every other change. Their findings reach the codebase through `developer`, either
via the review loop or via the gated `remediation` phase.

---

## Conventions (`rules/`)

Plugin-resident, reached by **absolute path**: the manifest lists each role's rules under
`role_expertise.<role>.rules` and the resolver emits them absolute, because the agent that reads them
lives in `sdlc` — where the plugin-root variable would resolve to the wrong plugin. The files:
`non-negotiable` (forbidden patterns), `gradle-commands`, `logging`, `documentation` (vault SDLC plus
the per-role reading map), `git-operations`, `enforcement`, `skills` (the optional `android` CLI
capability bindings), `workflow` (what Android adds to each pipeline step), `INDEX`. `testing` was
folded into the `android-testing` skill; the `handoff` rule is intentionally omitted — the
orchestrator passes phase context.

---

## Security — MASVS / MASTG

The `security-analyst` audits against **MASVS** control groups (STORAGE / CRYPTO / AUTH / NETWORK / PLATFORM / CODE / RESILIENCE / PRIVACY) using **MASTG** test procedures. Each audit section is tagged with its MASVS group(s); every finding cites the MASVS control + MASTG test ID. OWASP Mobile Top 10 is kept only as a secondary risk cross-map. `role_expertise.security-analyst.invariants` makes MASVS/MASTG authoritative over the core's platform-neutral baseline, and the full audit lives in the mandatory `android-security-masvs` skill.

---

## Optional Obsidian Vault — `manage-vault`

Roles treat `.obsidian-vault/` as the single source of project knowledge **when present**, falling back to the codebase + `docs/plans/` when absent. The `manage-vault` skill owns the whole vault lifecycle in one idempotent, content-safe flow:

1. **Detect** state — vault absent / skeleton incomplete / empty / has content.
2. **Scaffold** the skeleton + Node scripts (from `vault/`) if absent.
3. **Repair** — add only MISSING plugin-owned files; DIVERGED → report with a diff, never blind-overwrite.
4. **(Re)populate** — STUB-aware: create/refresh `<!-- STUB -->` notes from the codebase (Gradle modules, `@Composable *Screen`, `@Serializable` routes, ViewModel/Store flows), regenerate the dependency graph, flag drift. Filled notes are never touched.
5. **Archive** the vault (timestamped zip, last 5 kept) before any regeneration.

`vault/` bundles the scaffold template + Node tooling (`gen-mermaid`, `validate-docs`, `migrate-edges`) + the docs-sync hook. The `<!-- STUB -->` marker is the touch/no-touch boundary.

---

## Optional Android CLI

Google's `android` binary (project scaffolding, emulator/device, SDK, docs, Studio bridge) is an **optional** capability. `hooks/android-cli-check.sh` advises (non-blocking, SessionStart, Android projects only) if it is absent. No agent requires it; binding specific commands to agents is a future step.

---

## Hooks

| Hook | Event | Effect |
| ---- | ----- | ------ |
| `kotlin-guard` → `validate-kotlin.sh` | PostToolUse (Edit/Write) | **Blocking** — enforces non-negotiable patterns (`!!`, `runBlocking`, `println`, `android.util.Log.*`) in production Kotlin |
| `format-on-stop` | Stop | ktlint/detekt formatting |
| `guard-paths` | PreToolUse | block writes to `build/`, `.gradle/` |
| `android-cli-check` | SessionStart | optional Android CLI advisory |

---

## Project specifics — no template substitution

Agents detect the project's stack at runtime (module pattern, applicationId, build variants) via Architecture Detection. Project-level tuning uses the **generic** `.claude/sdlc.local.yaml` overrides — there is intentionally no Android-specific block in the core (that would break core platform-agnosticism).

**Status:** complete — agents, rules, MASVS security, vault lifecycle (`manage-vault`), and hooks are in place; the orchestrator executes the full DAG (review-loop + parallel) generically.
