---
name: android-data
description: Data layer conventions — repository interface/impl co-location, DTO↔domain mapping, persistence choice, suspend/Flow networking, dispatcher discipline, secure storage. Invoke before building repositories, data sources, persistence, or network/realtime integrations.
---

# android-data

House-style conventions for the data layer. **Principles, not a library mandate** — the local
database, preferences store, and networking stack are detected from the project, not prescribed here.

## Principles

- **Repository ownership.** The repository **interface and its implementation are co-located in the
  owning feature/data module**; the implementation is `internal`. Consumers depend on the interface,
  never the impl.
- **DTO ↔ domain mapping.** Map transport/storage DTOs to domain models at the boundary; keep domain
  models pure (no serialization or framework annotations leaking inward).
- **Persistence — detect.** Follow the project's local DB and preferences store. Prefer a structured,
  typed store over raw `SharedPreferences`. Sensitive data (tokens, credentials, PII) goes to secure
  storage — coordinate with the `security-analyst` agent on the trust boundary.
- **Networking / realtime.** Expose `suspend` functions for one-shot calls and `Flow` for streams.
  Handle errors and map them to domain-level results at the boundary; don't leak transport
  exceptions up the stack.
- **Dispatcher discipline.** Run IO off the main thread on the project's injected dispatcher
  qualifier (e.g. `@IoDispatcher`), not a hardcoded `Dispatchers.IO`.
- **Caching.** Use the project's caching strategy where one exists; note (don't silently invent)
  single-source-of-truth/offline-first decisions for review.

## Patterns

```kotlin
interface FeatureRepository {                 // public contract
    fun observeItems(): Flow<List<Item>>
    suspend fun refresh(): Result<Unit>
}

internal class FeatureRepositoryImpl(         // internal impl, co-located in the same module
    private val api: FeatureApi,
    private val dao: FeatureDao,
    @IoDispatcher private val io: CoroutineDispatcher,
) : FeatureRepository {
    override fun observeItems(): Flow<List<Item>> = dao.observe().map { it.toDomain() }
    override suspend fun refresh(): Result<Unit> = withContext(io) {
        // .map { } discards the DAO return value (e.g. Room @Insert row ids) → Result<Unit>.
        runCatching { dao.upsert(api.fetch().toEntity()) }.map { }
    }
}
```

## Anti-patterns

See `${CLAUDE_PLUGIN_ROOT}/rules/snippets/non-negotiable.md`. In particular: no raw
`SharedPreferences` for sensitive data, no `runBlocking` to bridge suspend code, no `!!` on nullable
query/network results, and no exposing the repository implementation as public API.

## References

- `${CLAUDE_PLUGIN_ROOT}/rules/snippets/non-negotiable.md` — forbidden patterns.
- `security-analyst` agent — secure-storage and trust-boundary review.
- Sibling skills: [[android-architecture]], [[android-navigation]].
