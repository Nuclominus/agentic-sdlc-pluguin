---
stack: android
priority: 300
aspects: [android]
workflow: android-feature
detect:
  all:
    - any:
        - file_exists: settings.gradle.kts
        - file_exists: settings.gradle
    - file_glob: "**/*.kt"            # Gradle project that actually has Kotlin (not pure-Java/Groovy)
# Functional categories of frameworks this foundation accepts (the WHICH). A framework attaches when
# its `enriches_aspect` is in this list AND its coordinate is found via framework_detection below.
# Adding a plugin in an already-listed category (e.g. koin → di) needs ZERO edits here.
hosts_aspects: [network, persistence, di, ui, background, analytics, architecture]
# WHERE to look for a framework's `dependency` coordinate; the core only executes this search
# (orchestrator 0b-frameworks). Order matters — version catalog is authoritative, build files fallback.
framework_detection:
  - gradle/libs.versions.toml
  - "**/build.gradle.kts"
  - "**/build.gradle"
---

# Android Foundation — Stack Profile

The centerpiece Android stack provider. Triggers on a Gradle project containing Kotlin.
Aspect: `android`. This profile wins the `android` aspect and drives the pipeline.
Detect-don't-impose libraries (Retrofit, Room, Dagger/Hilt, …) attach as **additive
framework plugins** that enrich the development/security phases without owning them
(see the Framework Provider Pattern in `ARCHITECTURE.md`).

## Framework resolution (this foundation owns it)

The core picks this foundation, then **delegates** framework discovery to it — the core never knows
Retrofit/Room/Dagger by name, nor that Android uses Gradle. This profile owns both halves of the contract:

- **Which** frameworks may attach: any `framework.md` whose `enriches_aspect` is one of this foundation's
  `hosts_aspects` (`network`, `persistence`, `di`, `ui`, `background`, `analytics`, `architecture`).
  Frameworks point *up* to a functional category; this foundation never lists them by name.
- **Where** to detect them: the `framework_detection` locations in the frontmatter — version catalog first,
  then module build files. The orchestrator (0b-frameworks) executes that search on this profile's behalf
  and merges every matched framework's guidance into this profile's `development` / `security` phases.

A new Android library plugin joins the tree by shipping `framework.md` with an `enriches_aspect` already
in `hosts_aspects` (e.g. `koin-plugin` → `di`, an image loader → `ui`) — nothing in this file changes.
Only a brand-new category would add one entry to `hosts_aspects` here.

> **Builds are CI-deferred.** `assembleDebug` is slow and needs the full SDK;
> `connectedAndroidTest` needs an emulator/device. In-pipeline verification is
> detekt + JVM unit tests + Kotlin compile-check only.

## Agents per phase

All phases use android-foundation's specialized agents (they override the core defaults
for the `android` aspect). Pipeline DAG:
`business_analysis → development → review (⇄development ×3) → [security ‖ test] → qa → documentation`

- business_analysis: android-ba              # Opus/high — BA + embedded DDD (module placement)
- development: android-developer             # Sonnet/medium — implementer (Architecture Detection)
- review: android-reviewer                   # Sonnet/medium — read-only review; ⇄developer loop (max 3)
- security: android-security                 # Opus/high — MASVS/MASTG; runs ‖ test
- test: android-tester                       # Sonnet/medium — unit/integration (MockK/Turbine/Kover)
- qa: android-qa                             # Sonnet/medium — E2E/UI (Compose UI Test, Maestro, a11y)
- documentation: android-docs                # Haiku/low — docs + (optional) Obsidian vault

## On-demand agents (NOT in the pipeline — invoke directly)

- android-debugger   # root-cause analysis (Logcat, coroutines/Flow, recomposition, leaks)
- android-devops     # Gradle/signing/variants/R8/Play Store
- android-cicd       # GitHub Actions, Gradle CI, lint/test pipelines
- android-aar        # read-only After Action Review of a workflow run

> The `review` phase, the Reviewer⇄Developer loop, and the `security ‖ test` parallelism
> are executed by the orchestrator's generic control flow (workflow `android-feature`).
> This profile declares `workflow: android-feature`, so it is auto-selected on Android
> projects — just `/sdlc:start "<feature>"`. Override anytime with `--workflow=NAME`.

## Convention skills to apply

- android-foundation:android-compose-ui
- android-foundation:android-architecture
- android-foundation:android-data
- android-foundation:android-navigation

## Extra phases

(none)

## Phase prompts injection

For development phase, inject:
  "Native Android (Kotlin) project. Compose-first UI with Material 3.
   Unidirectional data flow; state hoisting; UI state as StateFlow from a ViewModel.
   DI: use the project's existing DI framework via constructor injection; scope bindings deliberately.
   Framework-specific guidance (Hilt/Dagger, Koin) is added by the matching framework plugin when detected.
   Concurrency: coroutines + Flow; never block the main thread; use viewModelScope.
   New dependencies via the Gradle version catalog (libs.versions.toml), pinned ^x.y.z.
   Respect the existing module structure. Secrets via BuildConfig/local.properties, never source.
   Apply skills: android-foundation:android-compose-ui, android-foundation:android-architecture,
   android-foundation:android-data, android-foundation:android-navigation."

For qa phase, inject:
  "Android testing: JUnit5 (or JUnit4 if that's the project baseline), MockK, Turbine for Flow,
   kotlinx-coroutines-test for dispatchers. Unit tests run on the JVM (testDebugUnitTest).
   Instrumentation/UI tests (Espresso/Compose UI test) are CI-only — do NOT run in pipeline."

For security phase, inject:
  "Android-specific (MASVS/MASTG): secrets in Keystore not SharedPreferences; no cleartext traffic;
   certificate pinning where required; validate incoming Intents/deep links; biometric (BiometricPrompt)
   as step-up not primary; R8/ProGuard enabled for release; no secrets in source/VCS."

## Pre-phase commands

(none)

## Post-pipeline checks

The plugin auto-detects the Gradle wrapper. NO assembleDebug (full SDK), NO connectedAndroidTest (emulator).

- sh -c './gradlew detekt 2>/dev/null || ./gradlew ktlintCheck 2>/dev/null || true'
- sh -c './gradlew testDebugUnitTest'
- sh -c './gradlew compileDebugKotlin'
