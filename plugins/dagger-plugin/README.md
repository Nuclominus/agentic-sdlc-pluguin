# dagger-plugin

Additive **framework provider** for Dagger / Hilt dependency injection — a Framework-Provider-Pattern
plugin alongside `retrofit-plugin` and `room-plugin`. It enriches the
[Android Foundation](../android-foundation/README.md) pipeline without owning any phase: it ships **no
agents**, only guidance that the foundation's existing `android-developer` and `android-security` agents
consume.

For the pattern itself, see the root [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

---

## How it attaches

`framework.md` is a profile with `additive: true`. The orchestrator collects it into `ADDITIVE_PROFILES`
and merges its contributions into the run **only when Dagger/Hilt is detected** (or force-enabled):

| Contribution | Where it lands |
|--------------|----------------|
| `dagger-plugin:hilt-conventions` skill | the development phase "convention skills" list |
| development phase injection | the `android-developer` prompt |
| security phase injection | the `android-security` prompt |
| R8/ProGuard keep rules (`rules/snippets/hilt-proguard.md`) | referenced by the security injection |

It declares **no** `agents per phase` and **no** `workflow`.

## Detection

The plugin only **names** the library — it ships no search rules:

```yaml
dependency: com.google.dagger        # covers plain Dagger and Hilt (hilt-android, hilt-compiler)
```

The **orchestrator** owns where and in what order to look: **version catalog first**
(`gradle/libs.versions.toml`), then module build files (`**/build.gradle*`, gitignore-aware) as a
fallback. Override per project in `.claude/sdlc.local.yaml`:

```yaml
frameworks:
  enable: [dagger]    # force-on
  disable: [dagger]   # suppress
```

## The "detect, don't impose" resolution

The foundation states only the **generic** DI principle (use the project's DI framework, constructor
injection, deliberate scoping). The **Hilt/Dagger-specific** guidance lives here and activates only when
`com.google.dagger` is detected. A project on a different DI framework (e.g. Koin) simply does not
activate this plugin — a future `koin-plugin` would mirror this shape. This is how the marketplace avoids
imposing a single DI framework.

## Boundary with the foundation

- **Dispatcher qualifiers & layer principles** stay in `android-foundation:android-data` — this plugin
  cross-links, never restates.
- **Hilt/Dagger keep rules** were extracted out of the foundation's `rules/snippets/proguard-keep.md`
  into this plugin.

## Status

Phase 3 framework provider. Mirrors `retrofit-plugin` / `room-plugin`.
