---
name: ktor-conventions
description: Ktor-client-specific networking idioms — a single long-lived HttpClient, engine choice, ContentNegotiation with kotlinx-serialization, DEBUG-gated Logging, HttpTimeout, expectSuccess/response validation, and mapping Ktor exceptions to domain Results at the repository boundary. Invoke before adding or changing Ktor HttpClient config, request functions, or plugins. Layer principles (repository ownership, DTO↔domain, dispatcher discipline) stay with the hosting foundation's data-layer conventions.
---

# ktor-conventions

Library-specific conventions for the **Ktor client**. This is a *specialization* of the foundation's
data-layer principles — it does **not** restate them.

> **Layer principles live in [[android-data]]** (repository interface/impl co-location, DTO↔domain
> mapping, dispatcher discipline, `suspend`/`Flow` boundary contract). Read that first; this skill only
> covers what is specific to Ktor.

## Single HttpClient

- Build **one** `HttpClient` for the app with an explicit engine (`OkHttp`, `Android`, or `CIO`) and
  reuse it across every request; do not new-up a client per call.
- The engine is a Gradle choice, not a runtime one — pick it once (`OkHttp` is the common Android
  default when OkHttp is already on the classpath; `CIO` for pure-Kotlin/no-OkHttp setups).
- `close()` the client with its owner's lifecycle (e.g. a singleton scoped to the application, or
  closed in `onCleared()`/`DisposableEffect` if scoped narrower) — a leaked client leaks its engine's
  connection pool and dispatcher threads.

```kotlin
val client = HttpClient(OkHttp) {
    engine {
        config {
            retryOnConnectionFailure(true)
        }
    }
    install(ContentNegotiation) { json(...) }
    install(HttpTimeout) { ... }
    if (BuildConfig.DEBUG) install(Logging) { ... }
    expectSuccess = true
}

// owner lifecycle, e.g. a singleton or a Closeable dependency
fun onAppTerminate() = client.close()
```

## ContentNegotiation — kotlinx-serialization

- Install `ContentNegotiation` with the kotlinx-serialization `json(...)` converter. `ignoreUnknownKeys
  = true` so an additive API field never crashes deserialization.
- Do not mix converters (Gson/Moshi/kotlinx) on the same client — kotlinx-serialization is the house
  default (matches the foundation's serialization pinning).

```kotlin
install(ContentNegotiation) {
    json(Json {
        ignoreUnknownKeys = true
        isLenient = true
    })
}
```

## Logging — DEBUG-gated only

- Install `Logging` **only in debug builds**, and only at a level that never emits headers or bodies in
  release. Never log `Authorization`, cookies, tokens, or request/response bodies outside debug.

```kotlin
if (BuildConfig.DEBUG) {
    install(Logging) {
        logger = Logger.ANDROID
        level = LogLevel.BODY
    }
}
```

## Timeouts & response validation

- Install `HttpTimeout` with explicit `requestTimeoutMillis`, `connectTimeoutMillis`, and
  `socketTimeoutMillis` — do not rely on engine defaults.
- Set `expectSuccess = true` and/or install an `HttpResponseValidator` so non-2xx responses surface as
  exceptions instead of silently-successful `HttpResponse`s the caller must remember to check.

```kotlin
install(HttpTimeout) {
    requestTimeoutMillis = 15_000
    connectTimeoutMillis = 10_000
    socketTimeoutMillis = 15_000
}
expectSuccess = true
```

## Request functions

- Request functions are `suspend fun … : T` (DTO) or a domain `Result`, called from the repository.
  Streams that poll or subscribe return `Flow<T>`.
- Keep request functions transport-only — build the request, decode the DTO. No domain logic, no
  mapping — the repository maps DTO→domain at the boundary (see [[android-data]]). `HttpResponse` never
  crosses out of the data layer.

```kotlin
suspend fun getItems(page: Int): List<ItemDto> =
    client.get("$BASE_URL/items") {
        parameter("page", page)
    }.body()
```

## Error mapping at the boundary

- Wrap calls in the repository and convert Ktor's exception hierarchy to a domain `Result`:
  `ClientRequestException` (4xx), `ServerResponseException` (5xx), the shared `ResponseException`
  parent, and `IOException` for transport failures. Never let Ktor types (`HttpResponse`,
  `ClientRequestException`, …) escape the data layer.

```kotlin
override suspend fun refresh(): Result<Unit> = withContext(io) {
    runCatching { api.getItems(page = 1) }
        .map { dtos -> dao.upsert(dtos.map(ItemDto::toEntity)) }
        .map { }
        .recoverCatching { e ->
            when (e) {
                is ClientRequestException -> throw DomainError.Client(e.response.status)
                is ServerResponseException -> throw DomainError.Server(e.response.status)
                is ResponseException -> throw DomainError.Unexpected(e)
                is IOException -> throw DomainError.NoConnection
                else -> throw e
            }
        }
}
```

## Anti-patterns

- A new `HttpClient(...)` per request instead of one reused, closeable instance.
- A `Logging` install that isn't DEBUG-gated, or that logs `Authorization`/bodies in release.
- Omitting `expectSuccess`/`HttpResponseValidator` and manually re-checking `response.status` at every
  call site.
- Leaking `HttpResponse` / `ClientRequestException` / `ServerResponseException` above the repository.
- A cleartext (`http://`) base URL.

## References

- [[android-data]] — data-layer principles (authoritative for layering; not restated here).
- `ktor-plugin/rules/snippets/ktor-proguard.md` — R8/ProGuard keep rules.
- `security-analyst` agent — TLS/pinning and secret-handling review (MASVS-NETWORK).
