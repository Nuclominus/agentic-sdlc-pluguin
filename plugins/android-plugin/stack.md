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
---

# Android (Kotlin) Stack Profile

Native Android stack provider. Triggers on a Gradle project containing Kotlin.
Aspect: `android` (in a mobile monorepo with an iOS module, both platform
profiles win their aspect and the development/qa phases fan out per platform).

> **Builds are CI-deferred.** `assembleDebug` is slow and needs the full SDK;
> `connectedAndroidTest` needs an emulator/device. In-pipeline verification is
> detekt + JVM unit tests + Kotlin compile-check only.

## Agents per phase

All phases use android-plugin's specialized agents (they override the core defaults
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

- android-plugin:android-compose-ui
- android-plugin:android-architecture
- android-plugin:android-data
- android-plugin:android-navigation

## Extra phases

(none)

## Phase prompts injection

For development phase, inject:
  "Native Android (Kotlin) project. Compose-first UI with Material 3.
   Unidirectional data flow; state hoisting; UI state as StateFlow from a ViewModel.
   DI: match the project's existing framework (Hilt or Koin — DETECT, do not impose).   # TODO: pin house style
   Concurrency: coroutines + Flow; never block the main thread; use viewModelScope.
   New dependencies via the Gradle version catalog (libs.versions.toml), pinned ^x.y.z.
   Respect the existing module structure. Secrets via BuildConfig/local.properties, never source.
   Apply skills: android-plugin:android-compose-ui, android-plugin:android-architecture,
   android-plugin:android-data, android-plugin:android-navigation."

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
