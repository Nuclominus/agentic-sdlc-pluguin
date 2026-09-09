# koin-plugin

Additive **framework provider** for Koin dependency injection — a Framework-Provider-Pattern plugin
alongside `dagger-plugin`, `retrofit-plugin`, and `room-plugin`. It enriches the `di` aspect
(`enriches_aspect: di`) without owning any phase or depending on any sibling plugin: it ships **no
agents**, only guidance that any foundation hosting `di` —
[Android Foundation](../android-foundation/README.md) today — consumes through its existing development
and security phase agents.

For the pattern itself, see the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

---

## How it attaches

`manifest.yaml` declares `kind: framework`, `enriches_aspect: di`. The orchestrator collects it into
`ADDITIVE_PROFILES` and merges its contributions into the run **only when** a winning foundation hosts
`di` AND Koin is detected (or it is force-enabled):

| Contribution | Where it lands |
|--------------|----------------|
| `koin-plugin:koin-conventions` skill | the development phase "convention skills" list |
| development phase injection | the foundation's development phase prompt |
| security phase injection | the foundation's security phase prompt |
| R8/ProGuard notes (`rules/snippets/koin-proguard.md`) | referenced by the security injection |

It declares **no** `agents_per_phase` and **no** `workflow`.

## Detection

The plugin only **names** the library and the functional category it enriches — it ships no search rules:

```yaml
enriches_aspect: di
dependency: io.insert-koin        # covers koin-core, koin-android, koin-androidx-compose
```

The hosting **foundation** owns where and in what order to look (it declares `framework_detection`; the
orchestrator executes the search) — **version catalog first** (`gradle/libs.versions.toml`), then module
build files (`**/build.gradle*`, gitignore-aware) as a fallback. Override per project in
`.claude/sdlc.local.yaml`:

```yaml
frameworks:
  enable: [koin]    # force-on
  disable: [koin]   # suppress
```

## The "detect, don't impose" resolution

The foundation states only the **generic** DI principle (use the project's DI framework, constructor
injection, deliberate scoping). The **Koin-specific** guidance lives here and activates only when
`io.insert-koin` is detected. A project on a different DI framework (e.g. Dagger/Hilt) simply does not
activate this plugin — `koin-plugin` and `dagger-plugin` coexist on the `di` aspect and only the one
whose dependency is actually detected activates. This is how the marketplace avoids imposing a single DI
framework.

## Boundary with the hosting foundation

- **Dispatcher qualifiers & layer principles** stay with the hosting foundation's data-layer conventions —
  this plugin **defers**, never restates, and never hard-references another plugin's skill id.
- **Koin's proguard notes are intentionally minimal.** Koin core resolves dependencies at runtime with no
  code generation, so it needs no keep rules by default; the snippet exists only to cover the
  Koin-Annotations (KSP) opt-in, which does generate classes.

## Status

Phase 3 framework provider. Mirrors `dagger-plugin` / `retrofit-plugin` / `room-plugin`.
