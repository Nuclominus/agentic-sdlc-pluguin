---
name: android-architecture
description: App architecture & module conventions — layering, :feature modularization, state management (detect then follow), coroutine/Flow concurrency, DI, version catalog. Invoke before structuring features, ViewModels/stores, modules, or DI wiring.
---

# android-architecture

House-style conventions for app architecture and module structure. These are **principles, not a
library mandate** — concrete libraries (DI framework, state pattern) are chosen by the project, not
by this skill. Run the **Architecture Detection** grep below first and follow what the codebase
already does.

## Architecture Detection

Detect the project's existing state-management pattern before any state-management implementation,
then follow it — never impose a pattern the project does not use.

```bash
grep -rhoE "MVVM|MVI|MVP|Redux|Clean|StateFlow|MutableStateFlow|sealed (interface|class) \w+(State|Intent|Action|Event)" \
  $(find . -name "*.kt" -path "*/src/*" 2>/dev/null) 2>/dev/null | sort | uniq -c | sort -rn | head -20
```

| Result | Decision |
|--------|----------|
| Existing pattern found | Identify it (MVVM/MVI/MVP/Redux/Clean) from the code and follow it consistently |
| No clear pattern | Default to the project's idiomatic `ViewModel` + `StateFlow`. Do NOT impose an unused pattern. |

## Principles

- **Layering.** UI → domain → data, with dependencies pointing inward. The domain layer is
  framework-free (no Android, Compose, or networking types leaking in).
- **Modularization.** Features live in `:feature:<name>` modules. Keep the public API minimal;
  mark implementation classes `internal`. Respect the existing module graph — do not reach across
  module boundaries that the structure forbids.
- **State management — detect, don't impose.** Identify the project's pattern (MVVM / MVI / MVP /
  Redux / Clean) from the Architecture Detection grep and follow it consistently. When no clear
  pattern exists, default to `ViewModel` + `StateFlow` with **unidirectional data flow** (UDF):
  state flows down, events flow up.
- **Concurrency.** Coroutines + `Flow`. Launch from `viewModelScope` (or `lifecycleScope`), never
  the main thread for blocking work. IO/CPU work runs on the project's dispatcher qualifier (from
  DI), not a hardcoded `Dispatchers.IO`.
- **Dependency injection — detect, don't impose.** Use the project's framework (Hilt or Koin);
  prefer constructor injection and scope dependencies to where they're used.
- **Dependencies.** Declare via the Gradle version catalog (`libs.versions.toml`), pinned.
- **Immutability.** `val` in state and data classes; copy to mutate.

## Patterns

```kotlin
// ViewModel exposes immutable UI state; collapses domain results into a single StateFlow.
class FeatureViewModel(
    private val repository: FeatureRepository,        // interface from the data layer
    @IoDispatcher private val io: CoroutineDispatcher, // qualifier from DI, not Dispatchers.IO
) : ViewModel() {
    private val _state = MutableStateFlow(FeatureUiState())
    val state: StateFlow<FeatureUiState> = _state.asStateFlow()

    fun onIntent(intent: FeatureIntent) { /* reduce → update _state */ }
}

data class FeatureUiState(val items: List<Item> = emptyList(), val loading: Boolean = false) // all val
```

## Anti-patterns

See `${CLAUDE_PLUGIN_ROOT}/rules/snippets/non-negotiable.md` for the hook-enforced forbidden list.
In particular: no `runBlocking`/`GlobalScope` in production, no `!!`, no `var` in state/data
classes, and no imposing a state-management pattern or DI framework the project does not already use.

## References

- `${CLAUDE_PLUGIN_ROOT}/rules/snippets/non-negotiable.md` — forbidden patterns.
- Sibling skills: [[android-compose-ui]], [[android-data]], [[android-navigation]].
