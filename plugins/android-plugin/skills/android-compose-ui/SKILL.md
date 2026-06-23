---
name: android-compose-ui
description: Compose UI conventions — stateful/stateless split, state hoisting, lifecycle-aware state collection, side-effect discipline, previews, recomposition hygiene. Invoke before building or refactoring Compose screens and components.
---

# android-compose-ui

House-style conventions for Jetpack Compose UI. **Principles and patterns, not a library mandate** —
the project's theme system and image-loading library are detected, not prescribed. For visual and
aesthetic decisions (typography, color, layout polish), defer to the
`frontend-design:frontend-design` skill, which is already mandatory for the developer agent.

## Principles

- **Stateful wrapper → stateless `Content`.** A screen-level composable owns the ViewModel and
  collects state; it delegates rendering to a stateless `Content` composable that takes plain
  parameters and event lambdas. This keeps `Content` previewable and testable.
- **State hoisting.** Lift state to the lowest common caller; pass `value` down and `onValueChange`
  up. Components stay stateless unless the state is purely local UI (e.g. a transient animation).
- **Lifecycle-aware collection.** Collect UI state from a ViewModel `StateFlow` with
  `collectAsStateWithLifecycle()`, not a bare `collectAsState()`.
- **No side effects in composition.** Never call suspend functions or launch coroutines directly in
  a `@Composable` body. Use `LaunchedEffect`, `rememberCoroutineScope`, or a store reducer.
- **Recomposition hygiene.** Prefer stable/immutable parameters; use `remember` for derived/expensive
  values and `key` in lists; hoist lambdas to avoid re-allocation where it matters.
- **Previews.** Provide `@Preview` for the stateless `Content` (and key states: loading, empty,
  error) — previews drive review and catch layout regressions.
- **Theming & images — detect.** Use the project's existing Material theme (M2/M3) and its
  image-loading library; don't introduce a new one.

## Patterns

```kotlin
@Composable
fun FeatureScreen(viewModel: FeatureViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    FeatureContent(state = state, onIntent = viewModel::onIntent)   // stateless, previewable
}

@Composable
fun FeatureContent(state: FeatureUiState, onIntent: (FeatureIntent) -> Unit) { /* render only */ }

@Preview @Composable
private fun FeatureContentPreview() = FeatureContent(FeatureUiState(loading = true), onIntent = {})
```

## Anti-patterns

See `${CLAUDE_PLUGIN_ROOT}/rules/snippets/non-negotiable.md`. In particular: no suspend call in a
`@Composable` body (→ `LaunchedEffect`/reducer), no `GlobalScope`, no business logic embedded in
composables (push it into the ViewModel/store).

## References

- `frontend-design:frontend-design` — visual/aesthetic direction (mandatory before UI work).
- `${CLAUDE_PLUGIN_ROOT}/rules/snippets/non-negotiable.md` — forbidden patterns.
- Sibling skills: [[android-architecture]], [[android-navigation]].
