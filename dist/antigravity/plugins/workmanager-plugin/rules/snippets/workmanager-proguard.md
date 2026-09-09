---
loaded_by: [security-analyst, devops]
load_when: "ProGuard/R8 rules review or edit on a project that uses WorkManager with the default WorkerFactory."
---

# ProGuard / R8 Keep Rules — WorkManager

Contributed by `workmanager-plugin` (additive). Applied **only when WorkManager is detected**; surfaced
to the security/devops agents via the framework's security phase injection.

`androidx.work` bundles its own consumer R8 rules, so most projects need nothing extra. These keep rules
matter **only** when the project relies on the **default `WorkerFactory`**, which instantiates
`ListenableWorker` subclasses reflectively — R8 can otherwise strip or rename them. Projects using a
custom/Hilt `WorkerFactory` (no reflection) can omit this. Adapt the package to your `:feature:<name>`
layout (replace `com.somepackage`).

```proguard
# Worker subclasses instantiated reflectively by the default WorkerFactory
-keep class * extends androidx.work.ListenableWorker {
    <init>(android.content.Context, androidx.work.WorkerParameters);
}
-keep class com.somepackage.**.*Worker { *; }
```
