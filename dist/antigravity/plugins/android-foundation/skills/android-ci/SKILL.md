---
name: android-ci
description: Android CI pipelines — GitHub Actions job structure (lint → test → assemble → bundle → distribute), Gradle caching, submodule checkout, release signing from secrets, and the CI/DevOps boundary. Invoke before writing or changing CI workflow YAML for an Android project.
---

# android-ci

Continuous integration for an Android (Kotlin + Gradle) project. Stage ordering, caching strategy,
and the "secrets come from the CI store" rule belong to the core `cicd` agent; this skill supplies
the Android-specific job shapes and Gradle tasks.

Signing-key infrastructure, keystore management, and store console setup are **not** in scope — see
`android-build-release`.

## Authoritative references

- `CLAUDE.md` — canonical Gradle commands, variants, `config/*.properties`
- `gradle/libs.versions.toml` — the version source of truth
- `build-logic/convention/src/main/kotlin/conf/AppConfig.kt` — SDK / JVM target source of truth
- `build-logic/README.md` — convention plugin list
- `.obsidian-vault/stack/overview.md` — stack overview

Never hardcode Kotlin / Gradle / AGP / DI versions in CI docs — link to the files above.

## Build variants

The flavor × type matrix comes from the project's build variants (see `CLAUDE.md` and the
foundation's `rules/snippets/gradle-commands.md`). Confirm flavors and build types from
`app/build.gradle.kts` plus the convention plugins in `build-logic/` before writing pipeline steps.
Note any tooling the project disables per build type (e.g. analytics/crash in `debug`).

## Project file locations

```
.github/workflows/              — CI/CD workflows
app/build.gradle.kts            — App module build config
build.gradle.kts                — Root build config
build-logic/                    — Convention plugins + AppConfig.kt
gradle/libs.versions.toml       — Version catalog
gradle.properties               — Gradle properties
app/proguard-rules.pro          — ProGuard rules
config/keystore.properties      — Signing config (NOT in repo)
config/<service>.properties     — Per-service config (NOT in repo)
config/feature.properties       — Feature flags
config/encryption.properties    — Keystore aliases + crypto params
app/<analytics-config>.json     — Analytics/crash config, if any (NOT in repo)
```

## CI pipeline structure

```
lint (parallel: detekt, ktlintCheck)
  ↓
unit-tests (debug unit-test task for the project's flavor)
  ↓
assemble-debug (debug assemble task)
  ↓ (release branch only)
bundle-release (release bundle task)
  ↓
distribute (the project's distribution channel)
```

Substitute the actual task names from the project's Gradle tasks / the foundation's
`rules/snippets/gradle-commands.md`.

## Gradle commands

Substitute the project's flavor for `<Flavor>`:

```bash
./gradlew ktlintCheck
./gradlew detekt

./gradlew test<Flavor>DebugUnitTest
./gradlew test<Flavor>DebugUnitTest --tests "<applicationId>.ui.SampleTest"
./gradlew connected<Flavor>DebugAndroidTest

./gradlew assemble<Flavor>Debug
./gradlew assemble<Flavor>Release
./gradlew bundle<Flavor>Release
```

## GitHub Actions workflow example

> Illustrative workflow. Substitute the project's flavor into the Gradle tasks.

```yaml
name: CI

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop, main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
      - uses: gradle/actions/setup-gradle@v3
      - run: ./gradlew ktlintCheck detekt

  test:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
      - uses: gradle/actions/setup-gradle@v3
      - run: ./gradlew test<Flavor>DebugUnitTest
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: test-results
          path: '**/build/reports/tests/'

  build:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
      - uses: gradle/actions/setup-gradle@v3
      - run: ./gradlew assemble<Flavor>Debug
      - uses: actions/upload-artifact@v4
        with:
          name: debug-apk
          path: app/build/outputs/apk/<flavor>/debug/*.apk
```

## Caching

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.gradle/caches
      ~/.gradle/wrapper
    key: gradle-${{ hashFiles('**/*.gradle.kts', '**/libs.versions.toml', '**/gradle-wrapper.properties') }}
    restore-keys: gradle-
```

## Signing for release

Secrets required in the repository: `KEYSTORE_BASE64` (base64-encoded keystore), `KEY_ALIAS`,
`KEY_PASSWORD`, `STORE_PASSWORD`.

```yaml
- name: Decode keystore
  run: echo "${{ secrets.KEYSTORE_BASE64 }}" | base64 -d > config/release.jks

- name: Create keystore.properties
  run: |
    {
      echo "storeFile=release.jks"
      echo "storePassword=${{ secrets.STORE_PASSWORD }}"
      echo "keyAlias=${{ secrets.KEY_ALIAS }}"
      echo "keyPassword=${{ secrets.KEY_PASSWORD }}"
    } > config/keystore.properties
```

## Best practices

- Separate `lint` / `test` / `build` jobs; wire them with `needs:` for fast-fail.
- Run `ktlintCheck` + `detekt` in parallel before tests.
- Check out with `submodules: recursive` when the project uses submodules.
- Pin action versions to commit SHAs for supply-chain safety.
- Use the CI secret store for the keystore and `config/*.properties` values — never commit them.
- Java 17 (or whatever `AppConfig.kt` declares), pinned in the workflow.
- With the Gradle configuration cache on, test workflow changes locally before pushing.

## Scope boundary

| CI (this skill) | Build & release (`android-build-release`) |
|---|---|
| GitHub Actions workflows | Signing infrastructure, keystore management |
| Gradle CI optimization | Store console / distribution projects |
| Caching strategy | Variant / product configuration |
| Pipeline orchestration, deployment automation | Environment setup |

## Android CI quality checklist

- [ ] Workflow YAML is valid
- [ ] Gradle caching configured
- [ ] `submodules: recursive` on checkout when the project uses submodules
- [ ] Secrets via the CI secret store — never inlined
- [ ] JVM version pinned to what `AppConfig.kt` declares
- [ ] `ktlintCheck` + `detekt` before tests; tests before build
- [ ] Failure artifacts uploaded (test reports, mapping files)
- [ ] `config/keystore.properties`, `config/*.properties`, analytics config not in VCS
- [ ] No hardcoded version numbers — `libs.versions.toml` + `AppConfig.kt` are the source
