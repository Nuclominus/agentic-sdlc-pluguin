---
name: android-navigation
description: Navigation conventions — type-safe @Serializable routes over strings, per-module route ownership, typed arguments, ViewModel-sourced nav events, deep-link validation. Invoke before adding routes, graphs, screen transitions, or deep links.
---

# android-navigation

House-style conventions for navigation. **Principles, not a library mandate** — detect the project's
navigation framework and follow it; the patterns below apply regardless of the specific library.
**Exception:** where `non-negotiable.md` pins a library (e.g. navigation → Navigation Compose), that
rule wins — "detect" only applies where the rule is silent.

## Principles

- **Type-safe routes.** Prefer `@Serializable` route types (data classes/objects) over string
  routes. String routes are forbidden (see non-negotiable.md).
- **Route ownership.** Each feature module owns its route definitions and contributes them to the
  nav graph; avoid a single global registry that every feature must edit.
- **Typed arguments.** Pass small, serializable identifiers through the route; do not pass complex
  domain objects or thread state through a shared global. Re-fetch by id at the destination.
- **Nav events from a single source.** Emit navigation events from the ViewModel/store (one source
  of truth); the UI consumes them — don't scatter `navController` calls through composables.
- **Back-stack discipline.** Be explicit about `popUpTo`/`launchSingleTop`/inclusive semantics;
  avoid accidental duplicate destinations on the stack.
- **Deep links are a trust boundary.** Validate and sanitize all deep-link / external Intent
  arguments before use — coordinate with the `android-security` agent.

## Patterns

```kotlin
@Serializable data object FeatureList                      // no-arg destination
@Serializable data class FeatureDetail(val id: String)     // typed argument, not a string route

// Nav events originate in the ViewModel (single source); the host collects and applies them.
sealed interface FeatureNav { data class ToDetail(val id: String) : FeatureNav }

// Feature module contributes its routes to the graph:
fun NavGraphBuilder.featureGraph(navController: NavController) {
    composable<FeatureList> {
        val vm: FeatureListViewModel = /* injected */ TODO()
        // One screen-level boundary consumes ViewModel nav events — composables don't call navigate().
        LaunchedEffect(vm) {
            vm.navEvents.collect { event ->
                when (event) { is FeatureNav.ToDetail -> navController.navigate(FeatureDetail(event.id)) }
            }
        }
        FeatureListScreen(state = /* collected */ TODO(), onIntent = vm::onIntent)
    }
    composable<FeatureDetail> { /* read typed args; re-fetch by id */ }
}
```

## Anti-patterns

See `${CLAUDE_PLUGIN_ROOT}/rules/snippets/non-negotiable.md`. In particular: no string navigation
routes (→ `@Serializable` types), no passing large/mutable objects between destinations, and no
unvalidated deep-link arguments reaching the data layer.

## References

- `${CLAUDE_PLUGIN_ROOT}/rules/snippets/non-negotiable.md` — forbidden patterns (string routes).
- `android-security` agent — deep-link / Intent validation.
- Sibling skills: [[android-architecture]], [[android-compose-ui]], [[android-data]].
