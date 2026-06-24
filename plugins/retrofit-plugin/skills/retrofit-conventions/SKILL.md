---
name: retrofit-conventions
description: Retrofit/OkHttp-specific networking idioms — suspend/Flow service signatures, single OkHttpClient with ordered interceptors, converter setup, and transport-error mapping to domain Results. Invoke before adding or changing Retrofit service interfaces, OkHttp client config, or API DTO mapping. Layer principles (repository ownership, DTO↔domain, dispatcher discipline) stay with the hosting foundation's data-layer conventions.
---

# retrofit-conventions

Library-specific conventions for **Retrofit + OkHttp**. This is a *specialization* of the foundation's
data-layer principles — it does **not** restate them.

> **Layer principles live in [[android-data]]** (repository interface/impl co-location, DTO↔domain
> mapping, dispatcher discipline, `suspend`/`Flow` boundary contract). Read that first; this skill only
> covers what is specific to Retrofit/OkHttp.

## Service interfaces

- One-shot calls return `suspend fun … : T` (or a domain `Result`); streams return `Flow<T>`. Never
  expose `Call<T>` or call `.execute()`/`.enqueue()` directly from the repository.
- Keep service interfaces transport-only: annotations (`@GET`, `@POST`, `@Query`, `@Body`) + DTO types.
  No domain logic, no mapping — the repository maps DTO→domain at the boundary (see [[android-data]]).

```kotlin
interface FeatureApi {
    @GET("items")
    suspend fun getItems(@Query("page") page: Int): List<ItemDto>

    @POST("items")
    suspend fun create(@Body body: CreateItemDto): ItemDto
}
```

## OkHttpClient — single, centralized

- Build **one** `OkHttpClient` for the app (timeouts, interceptors) and reuse it; do not new-up clients
  per request.
- Interceptor order matters: app interceptors (auth, headers) before the network logging interceptor.
- The logging interceptor MUST be gated on `BuildConfig.DEBUG` and set to a level that never emits
  bodies/headers in release.

```kotlin
val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .addInterceptor(AuthInterceptor(tokenProvider))      // app interceptor first
    .apply {
        if (BuildConfig.DEBUG) {
            addInterceptor(HttpLoggingInterceptor().apply { level = Level.BODY })
        }
    }
    .build()
```

## Converter

- Pin a single converter. **kotlinx-serialization** is the house default (matches the foundation's
  serialization pinning); do not mix Gson/Moshi/kotlinx in the same Retrofit instance.

```kotlin
val retrofit = Retrofit.Builder()
    .baseUrl(BASE_URL)                                   // HTTPS only
    .client(client)
    .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
    .build()
```

## Error mapping at the boundary

- Wrap calls in the repository and convert `HttpException` / `IOException` to a domain `Result`. Never
  let Retrofit/OkHttp types escape the data layer.

```kotlin
override suspend fun refresh(): Result<Unit> = withContext(io) {
    runCatching { api.getItems(page = 1) }
        .map { dtos -> dao.upsert(dtos.map(ItemDto::toEntity)) }
        .map { }
        // map HttpException(401) → domain AuthError, IOException → domain NetworkError, etc.
}
```

## Anti-patterns

- `Call<T>.execute()` on the main thread, or `runBlocking` to bridge a suspend API.
- A logging interceptor that logs bodies/headers in release, or logs `Authorization`.
- Leaking `Response<T>` / `HttpException` above the repository.
- A cleartext (`http://`) base URL.

## References

- [[android-data]] — data-layer principles (authoritative for layering; not restated here).
- `retrofit-plugin/rules/snippets/retrofit-proguard.md` — R8/ProGuard keep rules.
- `android-security` agent — TLS/pinning and secret-handling review (MASVS-NETWORK).
