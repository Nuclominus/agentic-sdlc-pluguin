---
loaded_by: [security-analyst, devops]
load_when: "ProGuard/R8 rules review or edit on a project that uses Proto DataStore."
---

# ProGuard / R8 Keep Rules — Proto DataStore

Contributed by `datastore-proto-plugin` (additive). Applied **only when Proto DataStore is
detected**; surfaced to the security/devops agents via the framework's security phase injection.
The rules below depend on which `Serializer<T>` backing you use — keep only the block that applies
(adapt the package to your `:feature:<name>` layout).

```proguard
# --- If using kotlinx-serialization as the DataStore Serializer<T> (house style) ---
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class * {
    @kotlinx.serialization.Serializable <methods>;
}
# Keep your @Serializable state classes (adapt the package to your :feature:<name> layout)
-keep,includedescriptorclasses class com.somepackage.**$$serializer { *; }

# --- If using protobuf-javalite generated messages instead ---
-keep class com.google.protobuf.** { *; }
-keep class * extends com.google.protobuf.GeneratedMessageLite { *; }
-dontwarn com.google.protobuf.**
```
