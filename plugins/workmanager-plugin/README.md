# workmanager-plugin

Additive **framework provider** for Android **WorkManager** background work. It enriches the `background`
aspect (`enriches_aspect: background`) without owning any phase or depending on any sibling plugin: it
ships **no agents**, only guidance that any foundation hosting `background` — [Android
Foundation](../android-foundation/README.md) today — consumes through its existing development and
security phase agents.

For the pattern itself, see the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

---

## How it attaches

`manifest.yaml` declares `kind: framework`, `enriches_aspect: background`. The orchestrator collects it
into `ADDITIVE_PROFILES` and merges its contributions into the run **only when** a winning foundation
hosts `background` AND WorkManager is detected (or it is force-enabled):

| Contribution | Where it lands |
|--------------|----------------|
| `workmanager-plugin:workmanager-conventions` skill | the development phase "convention skills" list |
| development phase injection | the foundation's development phase prompt |
| security phase injection | the foundation's security phase prompt |
| R8/ProGuard keep rules (`rules/snippets/workmanager-proguard.md`) | referenced by the security injection |

It declares **no** `agents_per_phase` and **no** `workflow` — the orchestrator rejects framework
manifests that try to.

## Detection

The plugin only **names** the library and the functional category it enriches — it ships no search rules:

```yaml
enriches_aspect: background
dependency: androidx.work
```

The hosting **foundation** owns where and in what order to look (it declares `framework_detection`; the
orchestrator executes the search on its behalf) — for Android Foundation:

1. **Version catalog first** — `gradle/libs.versions.toml`. When the catalog declares WorkManager,
   detection resolves from that one authoritative file and build files are never scanned.
2. **Module build files (fallback)** — `**/build.gradle.kts` / `**/build.gradle` (gitignore-aware), so a
   dependency declared in a module build file (e.g. `app/build.gradle`) is still detected on projects
   without a version catalog.

Override per project in `.claude/sdlc.local.yaml`:

```yaml
frameworks:
  enable: [workmanager]    # force-on
  disable: [workmanager]   # suppress
```

## Boundary with the hosting foundation

- **Concurrency & layer principles** (coroutine/dispatcher discipline, repository ownership, module
  placement) and **DI wiring** (the `WorkerFactory` seam) stay with the hosting foundation's conventions
  — this plugin **defers**, never restates, and never hard-references another plugin's skill id.
- **WorkManager keep rules** live here, gated by detection, and matter only for the default
  `WorkerFactory` (reflective Worker instantiation) — `androidx.work` bundles its own consumer rules.

## Status

Framework plugin following the `retrofit-plugin` / `room-plugin` / `dagger-plugin` shape. First provider
of the `background` aspect (Roadmap C2).
