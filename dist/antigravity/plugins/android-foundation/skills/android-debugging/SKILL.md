---
name: android-debugging
description: Android root-cause analysis — coroutine/Flow, Compose recomposition, memory-leak and null/`!!` bug categories with their likely causes; Logcat and heap-dump commands; Layout Inspector and Profiler workflow. Invoke before diagnosing a crash, ANR, leak, or unexpected behaviour in an Android project.
---

# android-debugging

The Android-specific half of a root-cause investigation. The five-phase method (gather → reproduce →
isolate → prescribe → verify), the read-only discipline, and the report contract belong to the core
`debugger` agent; this skill supplies the symptom→cause tables and the platform tooling.

Detect the project's stack (UI toolkit, DI, navigation, logging) before assuming a cause. Follow
evidence, not assumptions.

## Authoritative references

- `.obsidian-vault/architecture/layering.md` — layering + architecture overview
- `.obsidian-vault/architecture/dependency-graph.md` — trace what a failing module pulls in
- `.obsidian-vault/architecture/ui-patterns.md` — Compose patterns, if present
- `.obsidian-vault/modules/` — per-module responsibilities (follow each note's `depends_on` edges)
- `CLAUDE.md` — Gradle commands and `config/*.properties`

## Android specifics per investigation phase

**Gather** — read the full stack trace (exact file, line, thread); pull Logcat context from before
the crash, filtered by the project's log tag; check recent changes with `git log --oneline -15`;
identify the originating layer (UI screen, ViewModel/store, `:feature:<name>` repository, or data
source).

**Isolate** — narrow to the exact layer, then check, in order: coroutine scope (cancelled
prematurely? wrong dispatcher?); state management (is the correct reducer branch firing? is the
state actually changing, or is equality blocking emission?); Compose (recomposition skipping or
firing too often? are the parameters stable?); lifecycle (`collectAsStateWithLifecycle()` versus raw
`collectAsState`).

**Verify** — state what must hold once the fix lands: the project's unit-test task for its debug
flavor passes, `./gradlew ktlintCheck detekt` is clean, and the Phase-2 reproduction no longer
triggers.

## Common bug categories

### Coroutine / Flow issues

| Symptom | Likely cause |
|---------|--------------|
| State not propagating to UI | Collecting outside lifecycle; use `collectAsStateWithLifecycle()` |
| Coroutine leaks | `GlobalScope` or a bare `CoroutineScope()` |
| ANR | Blocking call on Main (`runBlocking`, `Thread.sleep`) |
| Race condition | Shared mutable state without proper reduction |
| Wrong-thread IO | Missing `@IODispatcher` on IO calls |

### Compose issues (if the project uses Compose)

| Symptom | Likely cause |
|---------|--------------|
| Unwanted re-renders | Unstable param (lambda capturing mutable state, non-`@Immutable` class) |
| State resets on rotation | Missing `rememberSaveable` |
| `IllegalStateException: @Composable invoked outside composition` | Calling a composable from a coroutine — wrap in `LaunchedEffect` |
| Flicker / stale state | Raw `collectAsState` instead of `collectAsStateWithLifecycle` |
| Side effect runs on every recomposition | `LaunchedEffect(Unit)` where a key should change it |

Tools:
- **Layout Inspector** (Android Studio) with the Compose tree — inspect semantics, modifiers, and
  recomposition counts.
- `Modifier.testTag(TestTag.…)` (the central `TestTag` object) to target nodes in Layout Inspector
  and UI tests.
- `@Preview` variants to reproduce a specific screen state in isolation.
- `snapshotFlow { derived }` to observe derived state from a coroutine.

### Memory leaks

```bash
# Heap dump via ADB
adb shell am dumpheap <pid> /data/local/tmp/heap.hprof
adb pull /data/local/tmp/heap.hprof
# Open in Android Studio → Profiler → Memory
```

Common causes:
- Holding a `Context` / Activity in a singleton or `object`.
- A `CoroutineScope` that is never cancelled (prefer `viewModelScope`).
- Captured references in long-lived callbacks — unsubscribe on teardown (`DisposableEffect`,
  store close).
- If LeakCanary is wired into the app, read its reports first.

### Null / `!!` issues

- `!!` in production is always the culprit — replace with `?.`, `?:`, `requireNotNull`, or sealed
  branching.
- Navigation route args — validate via `toRoute<Route>()` on the typed `@Serializable` route.

## Logging and Logcat

Use the project's logging library — never `android.util.Log` or `println`.

> Illustrative example (Kermit `taggedLogger`). Adapt to the project's logging library.

```kotlin
private val log = taggedLogger("ProfileViewModel")

log.d { "loading profile userId=$userId" }
log.e(throwable) { "failed to load profile" }
```

```bash
# Filter Logcat by the project's log tag
adb logcat -s "ProfileViewModel"

# All app logs by package
adb logcat --pid=$(adb shell pidof -s <applicationId>)

# Errors only
adb logcat *:E
```

## Android prescription checklist

The checklist covers the report handed to the development phase, not code you wrote.

- [ ] Prescribed fix introduces no `!!`, `GlobalScope`, or `runBlocking`
- [ ] Prescribed fix introduces no suspend calls in composable bodies (if Compose)
- [ ] Lifecycle-aware state collection specified for store state (e.g. `collectAsStateWithLifecycle()`)
- [ ] Dispatcher qualifier specified for IO/CPU work, per the project's DI conventions
- [ ] Regression test specified for the test or QA phase to write
- [ ] Verification criteria stated: unit-test task + `ktlintCheck` + `detekt` for the debug flavor
