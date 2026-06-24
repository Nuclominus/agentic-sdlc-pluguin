---
stack: retrofit
additive: true
priority: 150
aspects: []
detect:
  any:
    - file_contains:
        path: gradle/libs.versions.toml
        pattern: "(?i)retrofit"
    - file_contains:
        path: build.gradle.kts
        pattern: "(?i)com\\.squareup\\.retrofit2"
    - file_contains:
        path: build.gradle
        pattern: "(?i)com\\.squareup\\.retrofit2"
---

# Retrofit / OkHttp — Framework Provider (additive)

Additive framework provider for Retrofit/OkHttp networking. Detect-activated: it contributes guidance
to **existing** phases and ships **no agents** — it specializes the foundation's `android-developer`
and `android-security` prompts. `priority` here is documentational only; additive profiles never
compete for or win an aspect.

Activation is automatic when Retrofit is found in the Gradle version catalog or a build script.
Toggle explicitly from a project's `.claude/sdlc.local.yaml`:

```yaml
frameworks:
  enable: [retrofit]    # force-on even if detection missed it
  disable: [retrofit]   # suppress even if detected
```

## Convention skills to apply

- retrofit-plugin:retrofit-conventions

## Extra phases

(none — frameworks enrich existing phases, they do not own one)

## Phase prompts injection

For development phase, inject:
  "Retrofit/OkHttp is present. Service interfaces expose `suspend` functions for one-shot calls and
   `Flow` for streams — never blocking `Call<T>.execute()`. Centralize a single OkHttpClient (timeouts,
   auth interceptor, and a logging interceptor gated on BuildConfig.DEBUG only). Pin a single converter
   (kotlinx-serialization preferred per house style). Map HTTP/transport errors (HttpException, IOException)
   to domain Results at the repository boundary — never leak Response/HttpException above the data layer.
   See the retrofit-plugin:retrofit-conventions skill; layer principles stay in
   android-foundation:android-data (do not restate them)."

For security phase, inject:
  "Retrofit/OkHttp (MASVS-NETWORK): all base URLs MUST be HTTPS — no cleartext traffic; configure
   certificate or public-key pinning where the threat model requires it. The logging interceptor must be
   DEBUG-gated and must never log Authorization headers, cookies, or request/response bodies in release.
   Apply the R8/ProGuard keep rules in retrofit-plugin/rules/snippets/retrofit-proguard.md when the
   project ships R8."

## Pre-phase commands

(none)

## Post-pipeline checks

(none — networking has no standalone Gradle gate beyond the foundation's compile/test/lint)
