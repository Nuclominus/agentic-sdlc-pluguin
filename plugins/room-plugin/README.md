# room-plugin

Additive **framework provider** for Room persistence — the second Framework-Provider-Pattern plugin
(after `retrofit-plugin`). It enriches the `persistence` aspect (`enriches_aspect: persistence`) without
owning any phase or depending on any sibling plugin: it ships **no agents**, only guidance that any
foundation hosting `persistence` — [Android Foundation](../android-foundation/README.md) today — consumes
through its existing development and security phase agents.

For the pattern itself, see the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

---

## How it attaches

`manifest.yaml` declares `kind: framework`, `enriches_aspect: persistence`. The orchestrator collects it
into `ADDITIVE_PROFILES` and merges its contributions into the run **only when** a winning foundation
hosts `persistence` AND Room is detected (or it is force-enabled):

| Contribution | Where it lands |
|--------------|----------------|
| `room-plugin:room-conventions` skill | the development phase "convention skills" list |
| development phase injection | the foundation's development phase prompt |
| security phase injection | the foundation's security phase prompt |
| R8/ProGuard keep rules (`rules/snippets/room-proguard.md`) | referenced by the security injection |

It declares **no** `agents_per_phase` and **no** `workflow` — the orchestrator rejects framework manifests
that try to.

## Detection

The plugin only **names** the library and the functional category it enriches — it ships no search rules:

```yaml
enriches_aspect: persistence
dependency: androidx.room
```

The hosting **foundation** owns where and in what order to look (it declares `framework_detection`; the
orchestrator executes the search on its behalf) — for Android Foundation:

1. **Version catalog first** — `gradle/libs.versions.toml`. When the catalog declares Room, detection
   resolves from that one authoritative file and build files are never scanned.
2. **Module build files (fallback)** — `**/build.gradle.kts` / `**/build.gradle` (gitignore-aware), so a
   dependency declared in a module build file (e.g. `app/build.gradle`) is still detected on projects
   without a version catalog.

Override per project in `.claude/sdlc.local.yaml`:

```yaml
frameworks:
  enable: [room]    # force-on
  disable: [room]   # suppress
```

## Boundary with the hosting foundation

- **Layer principles** (repository ownership, DTO↔domain mapping, dispatcher discipline, suspend/Flow
  contract) stay with the hosting foundation's data-layer conventions — this plugin **defers**, never
  restates, and never hard-references another plugin's skill id.
- **Room keep rules** were extracted out of the foundation's `rules/snippets/proguard-keep.md` into this
  plugin, so each keep rule lives in exactly one place, gated by detection.

## Status

Phase 3 framework provider. Mirrors `retrofit-plugin`; `dagger-plugin` follows the same shape.
