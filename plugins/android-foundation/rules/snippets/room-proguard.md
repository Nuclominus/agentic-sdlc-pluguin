---
loaded_by: [security-analyst, devops]
load_when: "ProGuard/R8 rules review or edit on a project that uses Room."
---

# ProGuard / R8 Keep Rules — Room

Contributed by `room-plugin` (additive). Applied **only when Room is detected**; surfaced to the
security/devops agents via the framework's security phase injection. Adapt the entity package to your
`:feature:<name>` layout (replace `com.somepackage`).

```proguard
# Room database + entities (kept so generated implementations and schema reflection survive R8)
-keep class * extends androidx.room.RoomDatabase { *; }
-keep @androidx.room.Entity class * { *; }
-keep class com.somepackage.**.db.entity.** { *; }
-dontwarn androidx.room.**
-dontwarn androidx.room.paging.**
```
