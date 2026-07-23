---
name: datastore-conventions
description: Proto-DataStore-specific persistence idioms — one DataStore<T> per file, a typed Serializer<T> with default + corruption handler, Flow reads, atomic updateData writes, SharedPreferences/Data migrations, and keeping secrets out of the plaintext store. Invoke before adding or changing a DataStore instance, its Serializer, or read/write access. Layer principles (repository ownership, mapping to domain, dispatcher discipline) stay with the hosting foundation's data-layer conventions.
---

# datastore-conventions

Library-specific conventions for **Proto DataStore**. This is a *specialization* of the foundation's
data-layer principles — it does **not** restate them.

> **Layer principles live in [[android-data]]** (repository interface/impl co-location, DTO↔domain
> mapping, dispatcher discipline, `suspend`/`Flow` boundary contract). Read that first; this skill only
> covers what is specific to Proto DataStore.

## One DataStore per file

- Exactly **one** `DataStore<T>` instance may exist for a given file on disk. Expose it as a singleton —
  either the `dataStore(fileName, serializer)` Context-extension delegate declared once at file scope, or
  a DI-provided singleton — and inject/reuse that instance everywhere. Constructing a second `DataStore`
  for the same file throws at runtime.

```kotlin
val Context.settingsStore: DataStore<Settings> by dataStore(
    fileName = "settings.pb",
    serializer = SettingsSerializer,
)
```

## Typed Serializer

- Implement `Serializer<T>` with an explicit `defaultValue` and `readFrom(input: InputStream): T` /
  `writeTo(t: T, output: OutputStream)`. Lead with **kotlinx-serialization** as the house serializer —
  it keeps the schema in plain Kotlin data classes; `protobuf-javalite` generated messages are the
  alternative when you need cross-platform `.proto` schema sharing.

```kotlin
@Serializable
data class Settings(val theme: String = "system", val syncEnabled: Boolean = true)

object SettingsSerializer : Serializer<Settings> {
    override val defaultValue: Settings = Settings()

    override suspend fun readFrom(input: InputStream): Settings =
        try {
            Json.decodeFromStream(input)
        } catch (e: SerializationException) {
            throw CorruptionException("Cannot read settings proto.", e)
        }

    override suspend fun writeTo(t: Settings, output: OutputStream) =
        Json.encodeToStream(t, output)
}
```

## Reads as Flow

- Read state as `dataStore.data: Flow<T>`; project with `.map { }` at the call site rather than exposing
  the raw stored type upward. `readFrom` failures surface as `IOException` on the flow — catch it and
  fall back to the serializer's default rather than propagating a crash.

```kotlin
val theme: Flow<String> = settingsStore.data
    .catch { e -> if (e is IOException) emit(Settings()) else throw e }
    .map { it.theme }
```

## Atomic writes

- Write with `dataStore.updateData { current -> current.copy(...) }`. It is a suspend, read-modify-write
  transaction that returns the new value — never read the current value separately and write it back
  (that races with concurrent writers); never do a partial/blocking write outside `updateData`.

```kotlin
suspend fun setTheme(theme: String) {
    settingsStore.updateData { current -> current.copy(theme = theme) }
}
```

## Corruption & migration

- Pass a `ReplaceFileCorruptionHandler` to the `dataStore` delegate so a corrupted file is replaced with
  a safe default instead of crashing every subsequent read.
- Migrate legacy `SharedPreferences` with `SharedPreferencesMigration`, or arbitrary prior state with a
  custom `DataMigration`, passed via the delegate's `produceMigrations` — migrations run once, before the
  first `data` collection.

```kotlin
val Context.settingsStore: DataStore<Settings> by dataStore(
    fileName = "settings.pb",
    serializer = SettingsSerializer,
    corruptionHandler = ReplaceFileCorruptionHandler(produceNewData = { Settings() }),
    produceMigrations = { context ->
        listOf(SharedPreferencesMigration(context, "legacy_settings"))
    },
)
```

## Boundary & security

- Keep the stored type (`Settings` above) in the data layer; map it to a domain model at the repository
  boundary — never expose it directly to UI/domain (see [[android-data]]).
- DataStore manages its own IO dispatcher internally — don't wrap `data`/`updateData` calls in a manual
  `Dispatchers.IO` or `withContext`.
- The backing file is **plaintext on disk** (MASVS-STORAGE): never persist secrets, tokens, or PII
  unencrypted. Encrypt sensitive fields Keystore-backed, or keep them in secure storage entirely and
  persist only non-sensitive state here — defer the encryption strategy to the `android-security` agent.

## Anti-patterns

- Two `DataStore<T>` instances (or delegate + DI singleton both) pointing at the same file — throws.
- Read-then-write instead of `updateData { }` — loses writes under concurrency.
- Wrapping `data`/`updateData` in a manual dispatcher switch.
- Persisting secrets/tokens/PII unencrypted in the proto/serialized state.
- No `ReplaceFileCorruptionHandler`, so a corrupted file crashes every read instead of degrading.

## References

- [[android-data]] — data-layer principles (authoritative for layering; not restated here).
- `datastore-proto-plugin/rules/snippets/datastore-proguard.md` — R8/ProGuard keep rules.
- `android-security` agent — at-rest encryption and plaintext-storage review (MASVS-STORAGE).
