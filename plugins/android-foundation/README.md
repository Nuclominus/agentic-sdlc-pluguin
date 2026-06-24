# android-foundation

Android Foundation — the centerpiece Android (Kotlin + Gradle) stack provider for the Agentic SDLC marketplace. Its `manifest.yaml` (`kind: foundation`) registers the `android` profile (platform aspect `android`, priority 300) and contributes a full specialized agent roster adapted from the Nuclominus `android-workflow` system. It carries the pinned house rules and **hosts** detect-don't-impose libraries (Retrofit→`network`, Room→`persistence`, Dagger/Hilt→`di`) via `hosts_aspects: all` + `framework_detection`; those attach as **additive framework plugins**. For the Stack Provider Pattern, the Framework Provider Pattern, and shared mechanisms, see the [root README](../../README.md).

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
business_analysis → development → review ──approved──→ [ security ‖ test ] → qa → documentation
                         ▲           │
                         └──changes──┘  (loop, max 3 rounds)
```

- **review** is a loop phase: changes-requested → re-run `development` (implement pass only, findings injected), up to 3 rounds, then escalate.
- **[security ‖ test]** is a parallel group (one message, two Agent calls).
- `android-bugfix` is the same minus BA: `development → review(⇄dev) → [security ‖ test] → qa`.

See the rendered diagram + a full end-to-end run in [`docs/WORKFLOW.md`](../../docs/WORKFLOW.md) and [`docs/WALKTHROUGH.md`](../../docs/WALKTHROUGH.md).

---

## Agent roster

| Phase | Agent | model | effort | Notes |
| ----- | ----- | ----- | ------ | ----- |
| business_analysis | `android-ba` | `opus` | `high` | BA + embedded DDD / module placement |
| development | `android-developer` | `sonnet` | `medium` | Architecture Detection — no imposed stack |
| review | `android-reviewer` | `sonnet` | `medium` | Read-only; drives the ⇄developer loop |
| security | `android-security` | `opus` | `high` | MASVS/MASTG; runs ‖ test |
| test | `android-tester` | `sonnet` | `medium` | Unit/integration: MockK, Turbine, Kover |
| qa | `android-qa` | `sonnet` | `medium` | E2E/UI: Compose UI Test, Maestro, a11y |
| documentation | `android-docs` | `haiku` | `low` | Docs + optional Obsidian vault stubs |

### On-demand agents (not in the pipeline — invoke directly)

| Agent | model | effort | Purpose |
| ----- | ----- | ------ | ------- |
| `android-debugger` | `sonnet` | `high` | Root-cause analysis |
| `android-devops` | `sonnet` | `medium` | Build/release tooling |
| `android-cicd` | `sonnet` | `medium` | CI/CD pipelines (GitHub Actions) |
| `android-aar` | `sonnet` | `medium` | Library/AAR publishing |

---

## Conventions (`rules/`)

Plugin-resident, referenced by agents via `${CLAUDE_PLUGIN_ROOT}/rules/`:
`non-negotiable` (forbidden patterns), `gradle-commands`, `testing`, `logging`, `documentation` (vault SDLC), `git-operations`, `enforcement`, `skills` (mandatory-skill matrix), `workflow`, `INDEX`. The `handoff` rule is intentionally omitted — the orchestrator passes phase context.

---

## Security — MASVS / MASTG

`android-security` audits against **MASVS** control groups (STORAGE / CRYPTO / AUTH / NETWORK / PLATFORM / CODE / RESILIENCE / PRIVACY) using **MASTG** test procedures. Each audit section is tagged with its MASVS group(s); every finding cites the MASVS control + MASTG test ID. OWASP Mobile Top 10 is kept only as a secondary risk cross-map. The `android` security injection in `manifest.yaml` (`phase_injections.security`) makes MASVS/MASTG authoritative over the core's platform-neutral baseline.

---

## Optional Obsidian Vault — `manage-vault`

Agents treat `.obsidian-vault/` as the single source of project knowledge **when present**, falling back to the codebase + `docs/plans/` when absent. The `manage-vault` skill owns the whole vault lifecycle in one idempotent, content-safe flow:

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
