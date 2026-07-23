# datastore-proto-plugin

Additive **framework provider** for Proto DataStore persistence. It enriches the `persistence` aspect
(`enriches_aspect: persistence`) without owning any phase or depending on any sibling plugin: it ships
**no agents**, only guidance that any foundation hosting `persistence` — [Android
Foundation](../android-foundation/README.md) today — consumes through its existing development and
security phase agents.

For the pattern itself, see the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

---

## How it attaches

`manifest.yaml` declares `kind: framework`, `enriches_aspect: persistence`. The orchestrator collects it
into `ADDITIVE_PROFILES` and merges its contributions into the run **only when** a winning foundation
hosts `persistence` AND Proto DataStore is detected (or it is force-enabled):

| Contribution | Where it lands |
|--------------|----------------|
| `datastore-proto-plugin:datastore-conventions` skill | the development phase "convention skills" list |
| development phase injection | the foundation's development phase prompt |
| security phase injection | the foundation's security phase prompt |
| R8/ProGuard keep rules (`rules/snippets/datastore-proguard.md`) | referenced by the security injection |

It declares **no** `agents_per_phase` and **no** `workflow` — the orchestrator rejects framework manifests
that try to.

## Detection

The plugin only **names** the library and the functional category it enriches — it ships no search rules:

```yaml
enriches_aspect: persistence
dependency: androidx.datastore
```

The hosting **foundation** owns where and in what order to look (it declares `framework_detection`; the
orchestrator executes the search on its behalf) — for Android Foundation:

1. **Version catalog first** — `gradle/libs.versions.toml`. When the catalog declares DataStore,
   detection resolves from that one authoritative file and build files are never scanned.
2. **Module build files (fallback)** — `**/build.gradle.kts` / `**/build.gradle` (gitignore-aware), so a
   dependency declared in a module build file (e.g. `app/build.gradle`) is still detected on projects
   without a version catalog.

Override per project in `.claude/sdlc.local.yaml`:

```yaml
frameworks:
  enable: [datastore-proto]    # force-on
  disable: [datastore-proto]   # suppress
```

## Boundary with the hosting foundation

- **Layer principles** (repository ownership, DTO↔domain mapping, dispatcher discipline, suspend/Flow
  contract) stay with the hosting foundation's data-layer conventions — this plugin **defers**, never
  restates, and never hard-references another plugin's skill id.
- **DataStore keep rules** live in this plugin's own `rules/snippets/datastore-proguard.md`, gated by
  detection, the same way `room-plugin` owns its keep rules instead of the foundation carrying them.

## Coexistence with room-plugin

Both `room-plugin` and `datastore-proto-plugin` enrich the same `persistence` aspect. The orchestrator
does not perform single-winner conflict resolution per aspect — if both dependencies (`androidx.room` and
`androidx.datastore`) were detected in the same project, both would activate and inject their phase
prompts. In practice a project uses one or the other (Room for relational/queryable data, Proto DataStore
for small typed app state/settings), so only the detected one activates.

## Status

Additive framework provider. Mirrors `room-plugin`.
