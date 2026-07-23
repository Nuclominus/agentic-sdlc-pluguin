---
loaded_by: [android-security, android-devops]
load_when: "ProGuard/R8 rules review or edit on a project that uses Koin."
---

# ProGuard / R8 Keep Rules — Koin

Contributed by `koin-plugin` (additive). Applied **only when Koin is detected**; surfaced to the
security/devops agents via the framework's security phase injection.

Koin **core** is a runtime DI container that resolves constructor injection at runtime without generated
code, so it needs **no keep rules** — the default R8 config is sufficient.

The exception is **Koin Annotations** (the `koin-ksp-compiler` processing `@Module`/`@Single`/`@Factory`),
which generates classes at build time. If the project uses it, keep the generated modules:

```proguard
# Koin Annotations (KSP) — keep generated module classes if using koin-annotations
-keep class org.koin.ksp.generated.** { *; }
```

Plain runtime Koin (no annotation processor) requires nothing here.
