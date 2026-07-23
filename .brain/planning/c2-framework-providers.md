---
status: done
---

# C2 batch — three additive framework providers

> Design spec for the remaining [[planning/roadmap]] **C2** work: Koin, Ktor, DataStore-Proto.
> Each is a new instance of the [[decisions/ADR-0002-framework-provider-pattern]] — no new
> architectural decision, only new library specializations. See [[planning/_moc-planning]].

## Goal

Fill three pre-declared gaps in the marketplace: popular Android libraries that share a
**functional aspect** with an existing provider but have no dedicated plugin yet. The foundation
already anticipates them (its own text says *"guidance is added by the matching framework plugin
when detected"*, and it carries house rules mentioning DataStore). C2 lands these providers so the
orchestrator can specialize the dev/security phases when the library is actually present.

**In scope:** `koin-plugin`, `ktor-plugin`, `datastore-proto-plugin`.
**Deferred (out of scope):** `kotlinx.serialization` — the aspect taxonomy
(`network, persistence, di, ui, background, analytics, architecture`) has no `serialization`
category. Whether to add one or fold it into `network` as a converter concern is an open
taxonomy decision, tracked for a follow-up (candidate future ADR). Not built in this batch.

## Architecture

All three follow the established framework-provider shape (`kind: framework`, `priority: 150`,
**ship no agents** — they only inject into the existing `development` + `security` phase prompts).
Both Koin (`di`) and Ktor (`network`) **coexist** with the existing Dagger/Retrofit providers on
the same aspect; only the provider whose `dependency` group is present in the project's Gradle
catalog activates. This is the additive design working as intended, not a conflict.

Each plugin is the uniform **6-file structure** (template analog in parentheses):

- `manifest.yaml` — machine-read profile the orchestrator consumes
- `README.md` — human docs
- `runtime-dependencies.json` — empty deps array (no external marketplace deps)
- `.claude-plugin/plugin.json` — plugin registration
- `rules/snippets/<name>-proguard.md` — R8 keep rules
- `skills/<name>-conventions/SKILL.md` — the conventions skill

Plus one entry each in the shared `.claude-plugin/marketplace.json`.

## Components

### koin-plugin (template analog: dagger-plugin)
- **`enriches_aspect`:** `di`
- **`dependency`:** `io.insert-koin`
- **Convention focus:** module DSL (`module { single/factory/viewModel { get() } }`), constructor
  DI via `get()`, `startKoin { androidContext(); modules(...) }`, `koinViewModel()` in Compose,
  deliberate scopes, avoid the service-locator smell (inject, don't `KoinComponent.get()` in
  domain code), module organization, `verify()` / `checkModules()` in tests.
- **ProGuard:** minimal snippet + note — Koin core is runtime/reflection-light and needs **no**
  keep rules; the snippet documents that and calls out the Koin-Annotations (KSP) exception
  (keep generated `*_KoinModule` / annotated constructors). Keeps the 6-file template uniform.
- **Security injection:** DI wiring carries little direct attack surface; note not to bind secrets
  as eagerly-created singletons and to keep the service-locator escape hatch out of security-
  sensitive code paths. Layer/DI principles stay with the foundation (do not restate).

### ktor-plugin (template analog: retrofit-plugin)
- **`enriches_aspect`:** `network`
- **`dependency`:** `io.ktor`
- **Convention focus:** a single long-lived `HttpClient` + explicit engine (OkHttp/Android/CIO),
  `install(ContentNegotiation) { json(...) }` with kotlinx-serialization, `install(Logging)`
  **DEBUG-gated only**, `install(HttpTimeout)`, `expectSuccess` / `HttpResponseValidator`, suspend
  request functions (never blocking), map `ClientRequestException` / `ServerResponseException` /
  `ResponseException` → domain `Result` at the repository boundary (never leak Ktor types above
  the data layer), `client.close()` lifecycle.
- **ProGuard:** yes — Ktor engine + kotlinx.serialization keep rules.
- **Security injection (MASVS-NETWORK):** HTTPS only / no cleartext; `Logging` must be DEBUG-gated
  and never log `Authorization`, cookies, or bodies in release; certificate/public-key pinning
  where the threat model requires it.

### datastore-proto-plugin (template analog: room-plugin)
- **`enriches_aspect`:** `persistence`
- **`dependency`:** `androidx.datastore`
- **Convention focus:** exactly one `DataStore<T>` instance per file (singleton via the `dataStore`
  delegate or DI — never two for the same file), a typed `Serializer<T>` with a default value and
  `readFrom`/`writeTo`, `data: Flow<T>` reads, atomic `updateData { }` writes,
  `ReplaceFileCorruptionHandler` for `CorruptionException`, `SharedPreferencesMigration` /
  `DataMigration` when migrating, DataStore manages its own IO dispatcher.
- **ProGuard:** yes — serializer keep rules (protobuf-javalite or the chosen kotlinx-serialization
  serializer).
- **Security injection (MASVS-STORAGE):** DataStore files are **plaintext on disk** — never store
  secrets/tokens/PII unencrypted; encrypt sensitive fields (Keystore-backed) or keep them in secure
  storage and persist only non-sensitive state here.

## Build mechanism ("launch as a batch")

1. **Parallel scaffold** — three agents, one per plugin, each authoring **only** its own isolated
   `plugins/<name>/` directory from its template analog, following the `sdlc:create-pluguin`
   contract. Isolated directories ⇒ no write conflicts between agents.
2. **Central integration (serial, by the orchestrator)** — register all three in the shared
   `.claude-plugin/marketplace.json`; validate manifests against `manifest.schema.json`; run
   `node tools/brain-sync/cli.mjs check --vault .brain` clean.
3. **Vault sync** — flip roadmap **C2 → done**, add `components/{koin,ktor,datastore-proto}-plugin`
   notes (each linking [[decisions/ADR-0002-framework-provider-pattern]]), update this spec's
   status. Change notes are machine-owned — generated by `tools/brain-sync` on merge, then enriched.

## Testing / acceptance

- Each `manifest.yaml` validates against `plugins/sdlc/schemas/manifest.schema.json`.
- Each plugin registers in `marketplace.json` with a `name` + local `source`, matching the shape of
  the existing five framework/foundation entries.
- `node tools/brain-sync/cli.mjs check --vault .brain` is clean (structure + links).
- Manual sanity: `/sdlc:list-stacks` shows the three new frameworks under their aspects.
- `enriches_aspect` values are all in the `di | network | persistence` set already hosted by the
  foundation (`hosts_aspects: all`) — no taxonomy change required for this batch.

## Non-goals

- No new agents (frameworks never ship agents).
- No changes to the aspect taxonomy (that is the deferred kotlinx.serialization question).
- No changes to existing dagger/retrofit/room providers.
