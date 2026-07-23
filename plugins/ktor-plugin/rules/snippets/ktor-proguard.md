---
loaded_by: [android-security, android-devops]
load_when: "ProGuard/R8 rules review or edit on a project that uses Ktor client."
---

# ProGuard / R8 Keep Rules — Ktor Client

Contributed by `ktor-plugin` (additive). Applied **only when Ktor is detected**; surfaced to the
security/devops agents via the framework's security phase injection. Adapt the model package to your
`:feature:<name>` layout (replace `com.somepackage`).

```proguard
# Ktor client
-keep class io.ktor.** { *; }
-keepclassmembers class io.ktor.** { *; }
-dontwarn io.ktor.**

# kotlinx.serialization (Ktor's ContentNegotiation JSON converter)
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class * {
    @kotlinx.serialization.Serializable <methods>;
}
# Keep @Serializable model classes (adapt the package to your :feature:<name> layout)
-keep,includedescriptorclasses class com.somepackage.**$$serializer { *; }
-keepclassmembers class com.somepackage.** {
    *** Companion;
}
```
