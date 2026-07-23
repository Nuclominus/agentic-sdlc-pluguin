---
name: koin-conventions
description: Koin-specific DI idioms — module DSL (single/factory/viewModel), constructor injection via get(), startKoin/androidContext bootstrap, koinViewModel in Compose, deliberate scoping, and avoiding the service-locator anti-pattern. Invoke before adding or changing Koin modules, definitions, scopes, or startKoin wiring. Generic DI principles (constructor injection, deliberate scoping) stay with the hosting foundation's development guidance.
---

# koin-conventions

Library-specific conventions for **Koin**. This is a *specialization* of the foundation's generic DI
principle — it does **not** restate it.

> The foundation says "use the project's DI framework, constructor injection, deliberate scoping." This
> skill covers what is specific to Koin. Layer & dispatcher principles live in [[android-data]] (e.g.
> injecting a qualified `CoroutineDispatcher` rather than hardcoding `Dispatchers.IO`).

## Modules & definitions

- Declare bindings inside a `module { }` block. `single` creates one instance for the container's
  lifetime; `factory` creates a new instance on every resolution; `single(createdAtStart = true)` eagerly
  instantiates at `startKoin` time (reserve for objects that must exist up front, e.g. a crash reporter).
- ViewModels: `viewModelOf(::FeatureViewModel)` (constructor-reference shorthand) or the explicit
  `viewModel { FeatureViewModel(get(), get()) }` when arguments need shaping.

```kotlin
val featureModule = module {
    single<FeatureRepository> { FeatureRepositoryImpl(get(), get(named("io"))) }
    factory { FeatureUseCase(get()) }
    viewModelOf(::FeatureViewModel)
}
```

## Constructor injection, not service location

- Resolve dependencies through **constructor parameters** using `get()` inside the module lambda — the
  class itself stays a plain Kotlin class with no Koin imports.
- Avoid `KoinComponent` / `by inject()` in domain and data code: it turns the class into a service
  locator, hides its real dependencies, and makes it hard to test without booting the whole container.
  It is acceptable only at framework entry points Koin does not construct for you (e.g. a legacy
  `ContentProvider`), never as a convenience shortcut.

```kotlin
// Good — constructor injection, framework-agnostic and unit-testable
class FeatureRepositoryImpl(
    private val api: FeatureApi,
    private val io: CoroutineDispatcher,
) : FeatureRepository

// Avoid — service location inside a domain/data class
class FeatureRepositoryImpl : FeatureRepository, KoinComponent {
    private val api: FeatureApi by inject()
}
```

## Bootstrap

- Start the graph **once**, in `Application.onCreate()`:

```kotlin
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        startKoin {
            androidContext(this@App)
            modules(appModule, featureModule, dataModule)
        }
    }
}
```

- Compose modules **by feature** and combine them at the `startKoin` call site rather than authoring one
  monolithic module — it keeps ownership close to the code it wires and lets features be added/removed
  independently.

## Compose

- Obtain ViewModels with `koinViewModel()`, not `viewModel()` from `androidx.lifecycle`:

```kotlin
@Composable
fun FeatureScreen(viewModel: FeatureViewModel = koinViewModel()) { … }
```

- Obtain plain (non-ViewModel) dependencies with `koinInject()` when a composable genuinely needs one
  directly, rather than threading it through parameters — prefer parameters/hoisted state first; reach
  for `koinInject()` only when threading is impractical (e.g. a cross-cutting analytics client).

## Scopes & qualifiers

- Scope **deliberately** instead of defaulting everything to `single`: `scope<T> { scoped { … } }` ties a
  definition's lifetime to an owner (e.g. a screen/flow scope created and closed with that owner) rather
  than living for the whole process.
- Disambiguate same-type bindings with qualifiers — `named("io")`, a typed qualifier object, or
  `named<T>()` — rather than wrapper types. Dispatcher qualifiers tie into [[android-data]]; this skill
  does not restate which dispatcher goes where, only that Koin exposes them via qualifiers.

```kotlin
val dataModule = module {
    single<CoroutineDispatcher>(named("io")) { Dispatchers.IO }
    scope<FeatureActivity> {
        scoped { FeatureSessionState() }
    }
}
```

## Testing

- Call `checkModules { }` (or `KoinApplication.checkModules()` / `verify()` on newer Koin versions) in a
  test to fail fast on missing bindings — it walks the graph without needing an Android runtime.
- In instrumented/unit tests, use `koinTest` (`KoinTest` + `KoinTestRule`) and override definitions with
  `modules(testModule)` rather than mutating production modules — keep fakes/mocks in a dedicated test
  module loaded only by the test rule.

## Anti-patterns

- `KoinComponent` / `by inject()` inside domain or data classes instead of constructor injection.
- Everything declared `single` regardless of real lifetime — prefer `factory`/`scoped` where the object
  should not outlive its caller.
- Multiple `startKoin { … }` calls, or modules loaded ad hoc outside the single bootstrap site.
- One giant module instead of composing per-feature modules.

## References

- [[android-data]] — dispatcher qualifiers & layer principles (authoritative; not restated here).
- `koin-plugin/rules/snippets/koin-proguard.md` — R8/ProGuard notes (Koin Annotations only).
- `android-security` agent — lifetime of security-sensitive `single` definitions, `KoinComponent`
  exposure.
