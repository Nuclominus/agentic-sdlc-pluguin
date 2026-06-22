---
loaded_by: [tester]
load_when: "Before writing tests."
---

# Testing Strategy

## Scope by Agent

| Agent | Responsibility |
|-------|---------------|
| `tester` | Unit tests for ViewModels / state stores, repositories, non-trivial business logic |
| `qa` | E2E / instrumented tests, manual verification on device / emulator |
| `developer` | Does NOT write tests — hands off to `tester` after implementation |

## Tooling

| Tool | Use case |
|------|---------|
| Turbine | `Flow` / `StateFlow` emission tests |
| MockK | Mocking in unit tests |
| Robolectric | Android runtime required without emulator |
| Compose UI Test (`createAndroidComposeRule`) | Screen-level instrumented tests |
| JUnit 5 | Test runner |
| Kover | Coverage reports |

## Flow Test Pattern (Turbine)

```kotlin
@Test
fun `repository emits items`() = runTest {
    repository.observe().test {
        val items = awaitItem()
        assertThat(items).isNotEmpty()
        cancelAndIgnoreRemainingEvents()
    }
}
```

## Coverage Target

- Minimum: every `<Screen>ViewModel` has at least one state-transition test.
- Error paths: every failure branch in the ViewModel must have a corresponding test.
- Repository: happy path + one error path.

## Gradle Commands

```bash
./gradlew testDevDebugUnitTest
./gradlew koverReport
```

If these tasks are absent on first attempt, skip and note in the report — do not retry.

## Test Source Exemptions

`println`, `Log.*`, `Kermit` calls in `src/test/`, `src/androidTest/`, `*Test.kt`, `*Spec.kt` are allowed and exempt from the validate-kotlin hook.
