---
loaded_by: [android-security, android-devops]
load_when: "ProGuard/R8 rules review or edit on a project that uses Dagger/Hilt."
---

# ProGuard / R8 Keep Rules — Dagger / Hilt

Contributed by `dagger-plugin` (additive). Applied **only when Dagger/Hilt is detected**; surfaced to the
security/devops agents via the framework's security phase injection.

> Modern Hilt ships consumer R8 rules with its Gradle plugin, so most keeps are automatic. Add these only
> if you hit R8 stripping of generated components or annotated members.

```proguard
# Hilt / Dagger generated code
-keep class dagger.hilt.** { *; }
-keep class * extends dagger.hilt.internal.GeneratedComponent { *; }
-keepclassmembers class * { @dagger.hilt.* *; }
-keep,allowobfuscation @interface dagger.hilt.android.lifecycle.HiltViewModel
-dontwarn dagger.hilt.**

# Members annotated for injection
-keepclassmembers,allowobfuscation class * {
    @javax.inject.Inject <init>(...);
    @javax.inject.Inject <fields>;
}
```
