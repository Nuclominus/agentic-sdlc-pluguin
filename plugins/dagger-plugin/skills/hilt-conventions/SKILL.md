---
name: hilt-conventions
description: Dagger/Hilt-specific DI idioms — constructor injection, @HiltAndroidApp/@AndroidEntryPoint entry points, @HiltViewModel, @Module + @InstallIn with @Binds over @Provides, deliberate scoping, dispatcher qualifiers, and KSP compiler. Invoke before adding or changing Hilt modules, components, scopes, or injected constructors. Generic DI principles (use the project's framework, constructor injection) stay with the hosting foundation's development guidance; layer/dispatcher principles stay with the hosting foundation's data-layer conventions.
---

# hilt-conventions

Library-specific conventions for **Dagger / Hilt**. This is a *specialization* of the foundation's
generic DI principle — it does **not** restate it.

> The foundation says "use the project's DI framework, constructor injection, deliberate scoping." This
> skill covers what is specific to Hilt/Dagger. Layer & dispatcher principles live in [[android-data]]
> (e.g. injecting `@IoDispatcher` rather than hardcoding `Dispatchers.IO`).

## Injection style

- **Constructor injection with `@Inject`** is the default. Reserve **field injection** for framework
  entry points that Hilt instantiates: `@HiltAndroidApp` `Application`, `@AndroidEntryPoint`
  Activities/Fragments/Services/Views.
- ViewModels: `@HiltViewModel` + `@Inject constructor(...)`; obtain via `hiltViewModel()` /
  `by viewModels()`.

```kotlin
@HiltViewModel
class FeatureViewModel @Inject constructor(
    private val repository: FeatureRepository,
    @IoDispatcher private val io: CoroutineDispatcher,
) : ViewModel()
```

## Modules & bindings

- Bindings live in a `@Module` annotated with `@InstallIn(<Component>)` (`SingletonComponent`,
  `ViewModelComponent`, …). Choose the component that matches the binding's lifetime.
- Prefer **`@Binds`** (abstract) for interface→implementation wiring; use **`@Provides`** only for types
  you do not own (constructed third-party objects, builders).

```kotlin
@Module
@InstallIn(SingletonComponent::class)
abstract class FeatureModule {
    @Binds
    abstract fun bindRepository(impl: FeatureRepositoryImpl): FeatureRepository
}
```

## Scoping

- Scope **deliberately**: `@Singleton` (app), `@ActivityRetainedScoped`, `@ViewModelScoped`,
  `@ActivityScoped`. Unscoped bindings are created per request — that is often correct.
- Do **not** make everything `@Singleton`: over-scoping leaks memory and hides lifecycle bugs.

## Qualifiers

- Disambiguate same-type bindings with qualifiers (`@IoDispatcher`, `@DefaultDispatcher`, named base
  URLs, etc.) rather than wrapper types. Dispatcher qualifiers tie into [[android-data]].

## Compiler

- Generate `hilt-compiler` / `dagger-compiler` with **KSP**, not KAPT (house rule — KAPT is forbidden in
  the foundation).

## Anti-patterns

- Field injection outside framework entry points; `@Inject lateinit var` in plain classes.
- `@Provides` where `@Binds` would do; modules without `@InstallIn`.
- Blanket `@Singleton` on everything; scoping by habit instead of by lifetime.
- `@EntryPoint` used to reach into the graph from places that could take constructor injection.

## References

- [[android-data]] — dispatcher qualifiers & layer principles (authoritative; not restated here).
- `dagger-plugin/rules/snippets/hilt-proguard.md` — R8/ProGuard keep rules.
- `security-analyst` agent — lifetime of security-sensitive singletons, `@EntryPoint` exposure.
