# retrofit-plugin

Additive **framework provider** for Retrofit/OkHttp networking — the reference implementation of the
**Framework Provider Pattern**. It enriches the `network` aspect (`enriches_aspect: network`) without
owning any phase or depending on any sibling plugin: it ships **no agents**, only guidance that any
foundation hosting `network` — [Android Foundation](../android-foundation/README.md) today — consumes
through its existing development and security phase agents.

For the pattern itself, see the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

---

## How it attaches

`framework.md` is a profile with `additive: true`. The orchestrator collects it into `ADDITIVE_PROFILES`
and merges its contributions into the run **only when Retrofit is detected** (or force-enabled):

| Contribution | Where it lands |
|--------------|----------------|
| `retrofit-plugin:retrofit-conventions` skill | the development phase "convention skills" list |
| development phase injection | the `android-developer` prompt |
| security phase injection | the `android-security` prompt |
| R8/ProGuard keep rules (`rules/snippets/retrofit-proguard.md`) | referenced by the security injection |

It declares **no** `agents per phase` and **no** `workflow` — the orchestrator rejects additive profiles
that try to.

## Detection

The plugin only **names** the library — it ships no search rules:

```yaml
dependency: com.squareup.retrofit2
```

The **orchestrator** owns where and in what order to look (this logic lives once, in the
pipeline-orchestrator skill, not in each plugin):

1. **Version catalog first** — `gradle/libs.versions.toml`. When the catalog declares Retrofit,
   detection resolves from that one authoritative file and build files are never scanned.
2. **Module build files (fallback)** — `**/build.gradle.kts` / `**/build.gradle` (gitignore-aware), so a
   dependency declared in a module build file (e.g. `app/build.gradle`) is still detected on projects
   without a version catalog.

Override per project in `.claude/sdlc.local.yaml`:

```yaml
frameworks:
  enable: [retrofit]    # force-on
  disable: [retrofit]   # suppress
```

## Boundary with the hosting foundation

- **Layer principles** (repository ownership, DTO↔domain mapping, dispatcher discipline, suspend/Flow
  contract) stay with the hosting foundation's data-layer conventions — this plugin **defers**, never
  restates, and never hard-references another plugin's skill id.
- **Retrofit/OkHttp keep rules** were extracted out of the foundation's
  `rules/snippets/proguard-keep.md` into this plugin, so each keep rule lives in exactly one place,
  gated by detection.

## Status

Reference framework plugin (Phase 2). `room-plugin` and `dagger-plugin` follow the same shape (Phase 3).
