---
loaded_by: [developer, reviewer, debugger]
load_when: "android-developer: BEFORE writing code. android-reviewer: during review. android-debugger: when verifying fix."
---

# Non-Negotiable Rules

These are enforced by `${CLAUDE_PLUGIN_ROOT}/hooks/validate-kotlin.sh` (regex, production sources only).
AST-level rules are documented but require Detekt custom rules to enforce automatically.

## Forbidden patterns (hook-enforced)

| Pattern | Replacement |
|---------|------------|
| `!!` | `?.`, `?:`, `requireNotNull()`, explicit `if` branch |
| `runBlocking(...)` | `viewModelScope.launch`, `withContext(io)` in suspend |
| `println(...)` | `Logger.d { "..." }` (Kermit) |
| `android.util.Log.d/e/i/w/v(...)` | `Logger.d/e/i { "..." }` (Kermit) |
| `.printStackTrace()` | `Logger.e(throwable) { "..." }` (Kermit) |

## Forbidden patterns (documentation-only, no hook)

| Pattern | Replacement |
|---------|------------|
| `var` in `State` / data classes | `val` always |
| `GlobalScope` | `viewModelScope`, `lifecycleScope` |
| Suspend call in `@Composable` body | `LaunchedEffect` or store reducer |
| String navigation routes | `@Serializable` data class / object |
| `SharedPreferences` directly | DataStore via `feature:datastore` |
| Glide / RevenueCat / Cicerone | Coil 3 / Play Billing 8 / Navigation Compose |
| `android.util.Log.*` | Kermit `taggedLogger()` |
| KAPT | KSP |

## Test sources exemption

All rules above are **not applied** to:
- `src/test/**`
- `src/androidTest/**`
- Files matching `*Test.kt` or `*Spec.kt`
