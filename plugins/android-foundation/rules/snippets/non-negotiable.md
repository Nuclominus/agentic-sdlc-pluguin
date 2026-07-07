---
loaded_by: [developer, reviewer, debugger]
load_when: "android-developer: BEFORE writing code. android-reviewer: during review. android-debugger: when verifying fix."
---

# Non-Negotiable Rules

These are enforced by `${CLAUDE_PLUGIN_ROOT}/hooks/validate-kotlin.sh` (regex, production sources only).
AST-level rules are documented but require Detekt custom rules to enforce automatically.

> The **logger** named in the Replacement columns (Kermit's `Logger`) is project-detected, not mandated. Substitute the logging library the project actually uses; a foundation may override it.

## Forbidden patterns (hook-enforced)

| Pattern | Replacement |
|---------|------------|
| `!!` | `?.`, `?:`, `requireNotNull()`, explicit `if` branch |
| `runBlocking(...)` | `viewModelScope.launch`, `withContext(io)` in suspend |
| `println(...)` | the project's logger — `Logger.d { "..." }` (Kermit if present) |
| `android.util.Log.d/e/i/w/v(...)` | the project's logger — `Logger.d/e/i { "..." }` (Kermit if present) |
| `.printStackTrace()` | the project's logger — `Logger.e(throwable) { "..." }` (Kermit if present) |
| `Modifier.testTag("literal")` / `testTag = "literal"` | `Modifier.testTag(TestTag.<Screen>Tags.<ELEMENT>)` — central `TestTag` object |

## Forbidden patterns (documentation-only, no hook)

| Pattern | Replacement |
|---------|------------|
| `var` in `State` / data classes | `val` always |
| `GlobalScope` | `viewModelScope`, `lifecycleScope` |
| Suspend call in `@Composable` body | `LaunchedEffect` or store reducer |
| String navigation routes | `@Serializable` data class / object |
| `SharedPreferences` directly | DataStore via `feature:datastore` |
| Glide / RevenueCat / Cicerone | Coil 3 / Play Billing 8 / Navigation Compose |
| `android.util.Log.*` | the project's tagged logger (Kermit `taggedLogger()` if present) |
| KAPT | KSP |
| Non-decorative Compose component with no `testTag` | add a tag from `TestTag` (exempt: Divider/Spacer/guidelines/decorative Icon-Image) — cannot be regex-enforced |

## Test sources exemption

All rules above are **not applied** to:
- `src/test/**`
- `src/androidTest/**`
- Files matching `*Test.kt` or `*Spec.kt`
