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
- **Theming & images — detect, but honor pinned libraries.** Use the project's existing Material
  theme (M2/M3) and image-loading library; don't introduce a new one. **Exception:** where
  `non-negotiable.md` pins a library (e.g. image loading → Coil 3), that rule wins — "detect" only
  applies where the rule is silent.

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

## Test tags

Every Compose component a test or QA flow can target carries a stable `testTag`. Tags are the
contract between production UI, `android-qa` Compose UI Tests, and Maestro flows — `Modifier.testTag`
values and Maestro `id:` are the same string. This is the single source of truth for the convention;
`android-developer` applies the tags, `android-qa` consumes them, `android-reviewer` enforces them.

### Grammar (the string contract)

`<screen>.<element>[.<variant>][.<index>]`

- All lowercase, dot-separated, no spaces; **stable** identifiers — never localized display text.
- `<screen>` = the route/screen name (`login`, `dashboard`, `effects`).
- Every screen exposes a root: `<screen>.root`.
- List items are parameterized by index (or a stable key): `effects.item.{index}`.
- Examples: `login.email`, `login.submit`, `dashboard.tab.feature`, `effects.list`, `effects.item.0`.

### Definition — one centralized `TestTag` namespace

Tag strings live in **one place**: a `TestTag` object with a nested object per screen. Production
code and tests reference the constant, never a string literal.

```kotlin
object TestTag {
    object LoginTags {
        const val ROOT = "login.root"
        const val EMAIL = "login.email"
        const val PASSWORD = "login.password"
        const val SUBMIT = "login.submit"
    }
    object EffectsTags {
        const val LIST = "effects.list"
        fun item(index: Int) = "effects.item.$index"   // dynamic list items
    }
}

// production
TextField(value = email, onValueChange = …, modifier = Modifier.testTag(TestTag.LoginTags.EMAIL))

// test / Maestro consume the SAME constant or its value
composeRule.onNodeWithTag(TestTag.LoginTags.EMAIL).performTextInput("a@b.c")   //  id: "login.email"
```

**Location.** Put `TestTag` in a shared, low-level module visible to every feature's `main` **and**
`androidTest` source sets (e.g. `:core:ui` / `:core:designsystem`). Multi-module fallback (documented,
not preferred): each feature owns `object <Feature>TestTags` following the **identical grammar** — the
string grammar is the real cross-cutting contract, the single object is the convenience.

### Required vs exempt

**MUST be tagged** — screen root (`<screen>.root`); every interactive component (`Button`,
`IconButton`, `TextField`, `Checkbox`, `Switch`, `RadioButton`, `Slider`, `Chip`, `Tab`, clickable
`Card`/`Row`/`Box`, `FloatingActionButton`, menu/dropdown items); asserted display nodes (verified
`Text`, counts, error/empty/loading/status); scrollable containers (`LazyColumn`/`LazyRow`/`LazyGrid`,
`Pager`) and their items; dialogs / bottom sheets / snackbar hosts.

**Exempt (decoration & layout only)** — `Divider`, `Spacer`, `ConstraintLayout` guidelines/refs,
decorative `Icon`/`Image` (`contentDescription = null`), pure layout wrappers nothing targets, static
non-asserted decorative `Text`. When in doubt, tag it.

### Project index — `ui-patterns.md`

The plugin defines the grammar; each consumer project keeps a per-screen index in
`.obsidian-vault/architecture/ui-patterns.md` so `android-qa` can search tags fast. `android-developer`
updates it whenever tags change. Schema:

| Screen | Element | Constant | testTag | Component | Interactions | State / Notes |
|--------|---------|----------|---------|-----------|--------------|---------------|
| Login | Email field | `TestTag.LoginTags.EMAIL` | `login.email` | TextField | input | required |
| Login | Submit | `TestTag.LoginTags.SUBMIT` | `login.submit` | Button | click | disabled until valid |
| Effects | List | `TestTag.EffectsTags.LIST` | `effects.list` | LazyColumn | scroll | — |
| Effects | List item | `TestTag.EffectsTags.item(i)` | `effects.item.{index}` | Card | click | dynamic, by index |

- `Constant` = copy-paste into a test; `testTag` = the searchable value and the Maestro `id:`.
- `Interactions` tells QA which matcher/action applies; dynamic items get one `{index}` row.

## Anti-patterns

See `${CLAUDE_PLUGIN_ROOT}/rules/snippets/non-negotiable.md`. In particular: no suspend call in a
`@Composable` body (→ `LaunchedEffect`/reducer), no `GlobalScope`, no business logic embedded in
composables (push it into the ViewModel/store). Never inline a tag literal —
`Modifier.testTag("login.email")` must be `Modifier.testTag(TestTag.LoginTags.EMAIL)`; never leave a
non-decorative component untagged.

## References

- `frontend-design:frontend-design` — visual/aesthetic direction (mandatory before UI work).
- `${CLAUDE_PLUGIN_ROOT}/rules/snippets/non-negotiable.md` — forbidden patterns.
- `.obsidian-vault/architecture/ui-patterns.md` — the project's per-screen testTag index (QA search).
- Sibling skills: [[android-architecture]], [[android-navigation]].
