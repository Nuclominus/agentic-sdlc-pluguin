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

## Clean

```bash
./gradlew clean assembleDevDebug
```

## Dependency report

```bash
./gradlew :app:dependencies
```
