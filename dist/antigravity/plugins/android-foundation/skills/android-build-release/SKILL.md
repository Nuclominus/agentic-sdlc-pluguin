---
name: android-build-release
description: Android build and release engineering — Gradle convention plugins, the version catalog, flavors and build types, signing configuration, ProGuard/R8, gradle.properties performance flags, and store/app distribution. Invoke before changing build configuration, signing, minification, or release distribution on an Android project.
---

# android-build-release

Build configuration, signing, minification, and distribution for an Android project. The generic
release discipline — never commit secrets, verify a build after a config edit — belongs to the core
`devops` agent; this skill supplies the Gradle and Android specifics.

GitHub Actions workflow YAML is **not** in scope — see `android-ci`.

## Authoritative references

- `CLAUDE.md` — canonical Gradle commands, flavors, `config/*.properties`
- `gradle/libs.versions.toml` — the version source of truth (never hardcode versions elsewhere)
- `build-logic/convention/src/main/kotlin/conf/AppConfig.kt` — SDK / JVM target source of truth
- `build-logic/README.md` — convention plugin inventory
- `.obsidian-vault/stack/overview.md` — stack overview
- `.obsidian-vault/modules/` — per-feature module references

## Infrastructure overview

| Concern | Source |
|---------|--------|
| Kotlin / Gradle / AGP / library versions | `gradle/libs.versions.toml` |
| minSdk / targetSdk / compileSdk / JVM target | `build-logic/convention/src/main/kotlin/conf/AppConfig.kt` |
| Build flavors + types | `app/build.gradle.kts` + convention plugins in `build-logic/` |
| Annotation processing | KSP preferred over KAPT |
| DI | the project's DI framework (detect from `libs.versions.toml`) |
| Crash / analytics | the project's crash / analytics tools, if any |
| Distribution | the project's distribution channel(s) |

## Build variants

The flavor × type matrix comes from the project's build variants (see `CLAUDE.md` and the
foundation's `rules/snippets/gradle-commands.md`). Confirm flavors and build types from
`app/build.gradle.kts` plus the convention plugins in `build-logic/` before scripting.

Conventions to verify per project:
- The release/store artifact has R8 on and signing on.
- Any `nonMinifiedRelease`-style type is R8 off by design (profiling / diagnostics).
- Crash/analytics tooling is often disabled in `debug` — confirm from the build config.

## Project file locations

```
app/build.gradle.kts            — App module build config
build.gradle.kts                — Root build config
build-logic/                    — Convention plugins + AppConfig.kt
gradle/libs.versions.toml       — Version catalog
gradle.properties               — Gradle / JVM properties
app/proguard-rules.pro          — ProGuard / R8 rules
config/keystore.properties      — Signing config (NOT in repo)
config/<service>.properties     — Per-service config → injected into BuildConfig (NOT in repo)
config/feature.properties       — Feature flags → BuildConfig
config/encryption.properties    — Keystore aliases + crypto params → secure-storage module
app/<analytics-config>.json     — Analytics/crash config, if any (NOT in repo)
app/src/main/kotlin/<root-package>/ — App sources (Kotlin, not java/)
app/src/<flavor>/               — Per-flavor source sets
```

All `config/*.properties` files are injected into `BuildConfig` at compile time (see `CLAUDE.md`).

## Signing configuration

```kotlin
// app/build.gradle.kts
val keystoreProperties = Properties().apply {
    rootProject.file("config/keystore.properties")
        .takeIf { it.exists() }
        ?.inputStream()
        ?.use { load(it) }
}

android {
    signingConfigs {
        create("release") {
            storeFile = file(keystoreProperties["storeFile"] as String)
            storePassword = keystoreProperties["storePassword"] as String
            keyAlias = keystoreProperties["keyAlias"] as String
            keyPassword = keystoreProperties["keyPassword"] as String
        }
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}
```

```properties
# config/keystore.properties (never commit this file)
storeFile=release.jks
storePassword=...
keyAlias=...
keyPassword=...
```

## ProGuard / R8 rules

The reusable serialization / database / DI keep rules live in the foundation's
`rules/snippets/proguard-keep.md`; the orchestrated prompt lists its absolute path. Add keep rules
for the project's own third-party SDKs — detect them from `gradle/libs.versions.toml`. Never write a
blanket `-keep class **`.

## Gradle commands

The current command set is the foundation's `rules/snippets/gradle-commands.md`. Substitute the
project's flavor for `<Flavor>`.

## Gradle performance

```properties
# gradle.properties
org.gradle.jvmargs=-Xmx4g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8
org.gradle.parallel=true
org.gradle.caching=true
org.gradle.configuration-cache=true
kotlin.incremental=true
android.enableR8.fullMode=true
```

With the configuration cache on, validate build-script changes locally before committing.

## App distribution

> Illustrative example (Firebase App Distribution). Adapt to the project's channel.

```bash
# Substitute the project's debug flavor for <flavor>/<Flavor>:
./gradlew assemble<Flavor>Debug
firebase appdistribution:distribute \
  app/build/outputs/apk/<flavor>/debug/app-<flavor>-debug.apk \
  --app <FIREBASE_APP_ID> \
  --groups "internal-testers" \
  --release-notes "Build $(git rev-parse --short HEAD)"
```

## Android build quality checklist

- [ ] `config/keystore.properties` is in `.gitignore`
- [ ] `config/*.properties` holding secrets are in `.gitignore`
- [ ] Analytics/crash config files (e.g. `google-services.json`) are in `.gitignore`
- [ ] ProGuard rules cover serialization, database entities, and the project's third-party SDKs
- [ ] Debug assemble succeeds for every flavor
- [ ] Release assemble succeeds (signing exercised) and the release bundle succeeds
- [ ] No secrets hardcoded in `build.gradle.kts`, convention plugins, or properties in VCS
- [ ] KSP only — never KAPT
- [ ] JVM target sourced from `AppConfig.kt`; library versions from `libs.versions.toml`
