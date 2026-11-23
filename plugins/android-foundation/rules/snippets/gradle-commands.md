---
loaded_by: [developer, qa-engineer, tester, devops, cicd]
load_when: "When running Gradle. Gradle Task Probe rule lives here (do not retry on 'task not found')."
---

# Gradle Commands

Replace `Dev`/`Production` with your flavor names from `the project's build variants`.

## Build

```bash
./gradlew assembleDevDebug
./gradlew installDevDebug
./gradlew assembleProductionRelease
./gradlew bundleProductionRelease
```

## Test

```bash
./gradlew testDevDebugUnitTest
./gradlew koverReport
```

## Static analysis

```bash
./gradlew ktlintCheck
./gradlew ktlintFormat
./gradlew detekt
```

> If `detekt` or `ktlintCheck` returns "task not found" on the first attempt, skip and continue. Do not retry.

## Before calling a failure pre-existing

Before recording a lint, ktlint or test failure as pre-existing, re-run the task once with the cache
bypassed — always in a git worktree, where error paths may point into another checkout:

```bash
./gradlew ktlintCheck --rerun-tasks --no-build-cache
```

`--rerun` re-runs only the named reporting task. Build-cache and UP-TO-DATE outputs can carry
absolute paths from another checkout, so a baseline or an error list from them does not describe
this tree. Only a failure that survives the clean re-run is pre-existing.

## Clean

```bash
./gradlew clean assembleDevDebug
```

## Dependency report

```bash
./gradlew :app:dependencies
```
