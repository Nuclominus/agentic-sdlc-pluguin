---
loaded_by: [security-scanner, devops]
load_when: "ProGuard/R8 rules review or edit."
---

# ProGuard / R8 Keep Rules

Adapt package names to `:feature:<name>` (replace `com.somepackage` with your package).

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

# Retrofit API interfaces
-keep interface com.somepackage.**.api.** { *; }

# Room entities
-keep class com.somepackage.**.db.entity.** { *; }

# Play Billing
-keep class com.android.billingclient.** { *; }

# Hilt
-keep class dagger.hilt.** { *; }
-keepclassmembers class * {
    @dagger.hilt.* *;
}

# Firebase
-keep class com.google.firebase.** { *; }

# OkHttp / Okio
-dontwarn okhttp3.**
-dontwarn okio.**
```
