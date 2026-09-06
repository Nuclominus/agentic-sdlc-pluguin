---
loaded_by: [security-analyst, devops]
load_when: "ProGuard/R8 rules review or edit on a project that uses Retrofit/OkHttp."
---

# ProGuard / R8 Keep Rules — Retrofit / OkHttp

Contributed by `retrofit-plugin` (additive). Applied **only when Retrofit is detected**; surfaced to the
security/devops agents via the framework's security phase injection. Adapt the API package to your
`:feature:<name>` layout (replace `com.somepackage`).

```proguard
# Retrofit API interfaces (kept so reflection-based method annotations survive R8)
-keep interface com.somepackage.**.api.** { *; }
-keepclassmembers,allowshrinking,allowobfuscation interface * {
    @retrofit2.http.* <methods>;
}

# OkHttp / Okio
-dontwarn okhttp3.**
-dontwarn okio.**
```
