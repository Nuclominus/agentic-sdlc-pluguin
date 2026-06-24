---
loaded_by: [security-scanner, devops]
load_when: "ProGuard/R8 rules review or edit."
---

# ProGuard / R8 Keep Rules — Foundation baseline

Adapt package names to `:feature:<name>` (replace `com.somepackage` with your package).

This file holds the **pinned/foundation** keep rules only. Keep rules for **detect-don't-impose
libraries** live in their respective additive framework plugins and are surfaced by the security
phase injection **only when that library is detected**:

| Library | Keep rules live in |
|---------|--------------------|
| Retrofit / OkHttp | `retrofit-plugin/rules/snippets/retrofit-proguard.md` |
| Room | `room-plugin/rules/snippets/room-proguard.md` |
| Dagger / Hilt | `dagger-plugin/rules/snippets/hilt-proguard.md` |

```proguard
# kotlinx.serialization
-keep class com.somepackage.**$$serializer { *; }
-keepclassmembers class com.somepackage.** {
    *** Companion;
}
-keepclasseswithmembers class com.somepackage.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# Play Billing
-keep class com.android.billingclient.** { *; }

# Firebase
-keep class com.google.firebase.** { *; }
```
