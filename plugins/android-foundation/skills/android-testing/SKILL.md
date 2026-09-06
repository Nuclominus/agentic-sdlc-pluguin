---
name: android-testing
description: Android unit and integration testing — MockK, Turbine, kotlinx-coroutines-test, Robolectric, Kover; ViewModel/store, repository and mapper patterns; what to test and what not to; Gradle test tasks. Invoke before writing or fixing JVM unit tests in an Android (Kotlin) project.
---

# android-testing

Unit and integration testing for the project's state-management stores, `<Screen>ViewModel`s,
`:feature:<name>` repositories, mappers, and data sources. The TDD cycle itself, the deliverable,
and the 3-attempt iteration cap belong to the core `tester` agent; this skill supplies the Android
test stack and its patterns.

Compose UI / E2E / Maestro / instrumented tests are **not** in scope — see `android-e2e`.

## Authoritative references

- `.obsidian-vault/architecture/layering.md` — layering + state-management overview
- `.obsidian-vault/architecture/dependency-graph.md` — generated module dependency graph
- `.obsidian-vault/architecture/ui-patterns.md` — the project's testing patterns, including store tests
- `.obsidian-vault/modules/` — per-module responsibilities (follow each note's `depends_on` edges)
- `CLAUDE.md` — Gradle commands, including single-class invocation via `--tests`

## Testing stack

| Tool | Purpose |
|------|---------|
| JUnit4 / JUnit5 | Runner + assertions (match the project's baseline) |
| MockK | Mocking / stubbing, including `coEvery`, `coVerify` |
| `kotlinx-coroutines-test` | `runTest`, `TestDispatcher`, `advanceUntilIdle` |
| Turbine | Assertions over `Flow` / `StateFlow` emissions |
| Robolectric | When Android runtime classes are required without an emulator |
| Kover | Coverage reports |

Follow the project's layering conventions, detected from the vault and codebase. The examples below
assume stores call repositories directly and repositories return `Result<T>` / `Flow<T>` with no
`Resource<T>` wrapper and no Interactor/UseCase layer — adapt if the project differs.

## Patterns

> Illustrative examples (MockK + Turbine). Match the project's detected state-management pattern
> and test libraries — run the Architecture Detection grep in the `android-architecture` skill.
> The structure (arrange → act → assert state/effects) carries over regardless. See
> `.obsidian-vault/architecture/ui-patterns.md` for the project's full ViewModel-test pattern.

### Flow test with Turbine

```kotlin
@Test
fun `observe emits items from dao`() = runTest {
    every { dao.observeAll() } returns flowOf(listOf(entity))

    repository.observe().test {
        assertThat(awaitItem()).isEqualTo(listOf(entity.toDomain()))
        awaitComplete()
    }
}
```

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

### Repository test with dispatcher injection

```kotlin
class FeatureRepositoryImplTest {
    private val testDispatcher = UnconfinedTestDispatcher()
    private val repository = FeatureRepositoryImpl(
        api = mockk(),
        dao = mockk(),
        io = testDispatcher,
    )
}
```

### Coroutine rules

- `runTest` — never `runBlocking` in tests.
- `UnconfinedTestDispatcher` for immediate execution; pass it as the `@IODispatcher` replacement.
- `advanceUntilIdle()` to drain pending coroutines when using a standard `TestDispatcher`.
- Never `Thread.sleep` — use `advanceTimeBy`.

### MockK

```kotlin
val repo = mockk<FeatureRepository>()
coEvery { repo.fetch() } returns Result.success(listOf(item))
every { repo.observe() } returns flowOf(emptyList())

coVerify(exactly = 1) { repo.fetch() }
confirmVerified(repo)
```

## What to test

- `<Screen>ViewModel` — every input / `Intent` branch: the resulting `State` transitions and the
  `Action` / side-effect emissions.
- Repositories — success, failure, mapping, and caching behaviour.
- Mappers — DTO ↔ domain ↔ entity.
- Error paths — network failures, backend/service errors, serialization errors.
- Edge cases — empty list, null, boundary values.

## What not to test

- DI wiring (that is integration).
- `data class` `copy` / `equals` / `hashCode`.
- Trivial delegations with no logic.
- Compose UI — delegate to `android-e2e`.

## Coverage target

- Minimum: every `<Screen>ViewModel` has at least one state-transition test.
- Error paths: every failure branch in the ViewModel has a corresponding test.
- Repository: happy path plus at least one error path.

## Commands

```bash
# Substitute the project's debug flavor (from its build variants) for <Flavor>:
./gradlew test<Flavor>DebugUnitTest
./gradlew test<Flavor>DebugUnitTest --tests "<applicationId>.ui.SampleTest"
./gradlew test<Flavor>DebugUnitTest --continuous
./gradlew koverHtmlReport
./gradlew ktlintCheck detekt
```

Single-test-class invocation is per `CLAUDE.md`. If a task is absent on the first attempt, skip it
and note that in the report — do not retry under alternate names.

## Test source exemptions

`println`, `Log.*`, and Kermit calls inside `src/test/`, `src/androidTest/`, `*Test.kt`, and
`*Spec.kt` are allowed and exempt from the `validate-kotlin.sh` hook.

## Android test quality checklist

- [ ] AAA structure per test
- [ ] `runTest` everywhere (no `runBlocking`)
- [ ] Every `Intent` → state / action path covered
- [ ] Flows asserted via Turbine
- [ ] Success AND failure paths
- [ ] Mocks verified (`coVerify` / `verify`) where behaviour matters
- [ ] Deterministic — no `Thread.sleep`, no real time
- [ ] No `!!` and no `GlobalScope` in test code
- [ ] Unit-test + `ktlintCheck` + `detekt` tasks clean for the project's debug flavor
