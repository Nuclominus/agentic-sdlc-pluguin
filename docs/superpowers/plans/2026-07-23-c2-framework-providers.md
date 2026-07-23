# C2 Framework Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new additive framework-provider plugins — `koin-plugin` (di), `ktor-plugin` (network), `datastore-proto-plugin` (persistence) — completing roadmap track C2.

**Architecture:** Each plugin is a new instance of the Framework Provider Pattern (ADR-0002): `kind: framework`, `priority: 150`, ships **no agents**, only `development` + `security` phase-prompt injections plus a conventions skill and R8/ProGuard snippet. It attaches to any foundation hosting its `enriches_aspect` and activates only when its `dependency` group is detected in the project's Gradle catalog. Tasks 1–3 (the three plugins) are independent and write only to their own isolated `plugins/<name>/` directory, so they can be scaffolded in parallel; Task 4 (shared `marketplace.json` registration + validation) and Task 5 (vault sync) are serial and depend on 1–3.

**Tech Stack:** Markdown + YAML + JSON plugin files. Validation via `node tools/sdlc-lint/cli.mjs schema` (JSON-Schema at `schemas/manifest.schema.json` / `schemas/plugin.schema.json`) and `node tools/brain-sync/cli.mjs check --vault .brain` (vault links).

## Global Constraints

- Every framework `manifest.yaml`: `kind: framework`, `priority: 150`, `extra_phases: []`, `pre_phase_commands: []`, `post_pipeline_checks: []`, and **no** `agents_per_phase` / `workflow` keys (the orchestrator rejects framework manifests that declare them).
- `enriches_aspect` MUST be one of the existing functional aspects in `plugins/sdlc/config/aspects.yaml` — this batch uses only `di | network | persistence` (all already hosted; **no taxonomy change**).
- The uniform 6-file plugin layout: `manifest.yaml`, `README.md`, `runtime-dependencies.json`, `.claude-plugin/plugin.json`, `rules/snippets/<name>-proguard.md`, `skills/<name>-conventions/SKILL.md`.
- `runtime-dependencies.json` is always `{"_comment": "...", "dependencies": []}` (no external marketplace deps).
- `plugin.json`: `"version": "1.0.0"`, `"author": {"name": "Nuclominus", "url": "https://github.com/Nuclominus"}`, `"license": "MIT"`, `"homepage": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin"`, `"dependencies": ["sdlc"]`.
- Match the marketplace's existing voice and the manifest field order shown in the templates (`dagger-plugin`, `retrofit-plugin`, `room-plugin`).
- kotlinx.serialization is **out of scope** (deferred — no `serialization` aspect exists yet).
- House serializer for DataStore is **kotlinx-serialization** (not protobuf-javalite) per house style; the proguard snippet documents both but the conventions lead with kotlinx-serialization.
- Commit after each task. Stage only the specific paths for that task (never `git add -A`).

---

### Task 1: koin-plugin (di)

**Files:**
- Create: `plugins/koin-plugin/manifest.yaml`
- Create: `plugins/koin-plugin/.claude-plugin/plugin.json`
- Create: `plugins/koin-plugin/runtime-dependencies.json`
- Create: `plugins/koin-plugin/rules/snippets/koin-proguard.md`
- Create: `plugins/koin-plugin/skills/koin-conventions/SKILL.md`
- Create: `plugins/koin-plugin/README.md`

**Interfaces:**
- Produces: plugin slug `koin-plugin`, `stack: koin`, `enriches_aspect: di`, `dependency: io.insert-koin`, convention skill id `koin-plugin:koin-conventions`. Task 4 registers `koin-plugin` in `marketplace.json`; Task 5 creates `components/koin-plugin.md`.
- Template analog to mirror for prose depth/structure: `plugins/dagger-plugin/`.

- [ ] **Step 1: Write `plugins/koin-plugin/manifest.yaml`**

```yaml
# Koin — SDLC manifest (kind: framework, additive).
# Machine-read source the orchestrator consumes. Human docs live in README.md.

kind: framework
stack: koin
priority: 150                       # documentational for frameworks — they never win an aspect
enriches_aspect: di                # functional category; a foundation hosting `di` resolves me
dependency: io.insert-koin         # covers koin-core/koin-android/koin-androidx-compose; the foundation declares WHERE to look

convention_skills:
  - koin-plugin:koin-conventions

extra_phases: []
pre_phase_commands: []

phase_injections:
  development: |
    Koin is present. Declare bindings in the `module { }` DSL — `single` for singletons, `factory` for
    new-each-time, `viewModel`/`viewModelOf` for ViewModels; resolve dependencies through constructor
    parameters with `get()`, not by pulling from the container inside classes. Start the graph once in
    `Application` via `startKoin { androidContext(this@App); modules(appModule, …) }`. In Compose, obtain
    ViewModels with `koinViewModel()` and dependencies with `koinInject()`; do NOT make domain/data
    classes implement `KoinComponent` to service-locate — inject through constructors so they stay
    framework-agnostic and testable. Scope deliberately (`scope<T> { scoped { … } }`) instead of making
    everything `single`. Organize modules by feature and compose them; expose dispatchers via
    named/typed qualifiers per the hosting foundation's data-layer conventions. See the
    koin-plugin:koin-conventions skill; layer/DI principles stay with the hosting foundation's
    conventions (do not restate them).
  security: |
    Koin: do not hold security-sensitive material (decrypted keys, tokens, plaintext credentials) in
    long-lived `single` definitions longer than needed — prefer `factory`/`scoped` for the narrowest
    lifetime and clear it. Keep the `KoinComponent` service-locator escape hatch out of security-
    sensitive code paths (it bypasses explicit wiring and hides what a class can reach). Koin core is
    runtime/reflection-light and needs no special R8 keep rules; if the project uses Koin Annotations
    (KSP), apply the notes in koin-plugin/rules/snippets/koin-proguard.md.

post_pipeline_checks: []
```

- [ ] **Step 2: Write `plugins/koin-plugin/.claude-plugin/plugin.json`**

```json
{
  "name": "koin-plugin",
  "version": "1.0.0",
  "description": "Additive framework provider for Koin dependency injection (io.insert-koin). Auto-detected by the orchestrator from the Gradle version catalog / build files; enriches the `di` aspect (enriches_aspect: di) via manifest.yaml (kind: framework) with the koin-conventions skill, development + security phase-prompt injections (module DSL, constructor get(), startKoin/androidContext, koinViewModel, deliberate scopes), and minimal R8/ProGuard notes. Ships NO agents — it specializes the existing development / security phase prompts.",
  "author": {
    "name": "Nuclominus",
    "url": "https://github.com/Nuclominus"
  },
  "license": "MIT",
  "homepage": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin",
  "keywords": [
    "android",
    "koin",
    "dependency-injection",
    "di",
    "sdlc",
    "framework-provider"
  ],
  "dependencies": [
    "sdlc"
  ]
}
```

- [ ] **Step 3: Write `plugins/koin-plugin/runtime-dependencies.json`**

```json
{
  "_comment": "Runtime plugin dependencies for koin-plugin, aggregated by pipeline-orchestrator Step 0a. koin-plugin is an additive framework provider with no external marketplace dependencies, so this stays empty.",
  "dependencies": []
}
```

- [ ] **Step 4: Write `plugins/koin-plugin/rules/snippets/koin-proguard.md`**

```markdown
---
loaded_by: [android-security, android-devops]
load_when: "ProGuard/R8 rules review or edit on a project that uses Koin."
---

# ProGuard / R8 Keep Rules — Koin

Contributed by `koin-plugin` (additive). Applied **only when Koin is detected**; surfaced to the
security/devops agents via the framework's security phase injection.

Koin **core** is a runtime DI container that resolves constructor injection at runtime without generated
code, so it needs **no keep rules** — the default R8 config is sufficient.

The exception is **Koin Annotations** (the `koin-ksp-compiler` processing `@Module`/`@Single`/`@Factory`),
which generates classes at build time. If the project uses it, keep the generated modules:

​```proguard
# Koin Annotations (KSP) — keep generated module classes if using koin-annotations
-keep class org.koin.ksp.generated.** { *; }
​```

Plain runtime Koin (no annotation processor) requires nothing here.
```

> NOTE for the implementer: remove the zero-width space before each ``` fence — it is only in this plan to keep the outer code block intact. The real file has plain ` ```proguard ` fences.

- [ ] **Step 5: Write `plugins/koin-plugin/skills/koin-conventions/SKILL.md`**

Mirror the structure/depth of `plugins/dagger-plugin/skills/hilt-conventions/SKILL.md`. Required frontmatter:

```yaml
---
name: koin-conventions
description: Koin-specific DI idioms — module DSL (single/factory/viewModel), constructor injection via get(), startKoin/androidContext bootstrap, koinViewModel in Compose, deliberate scoping, and avoiding the service-locator anti-pattern. Invoke before adding or changing Koin modules, definitions, scopes, or startKoin wiring. Generic DI principles (constructor injection, deliberate scoping) stay with the hosting foundation's development guidance.
---
```

Body must open with the "this is a specialization, layer/DI principles live in the foundation — do not restate them" pointer (mirror how `hilt-conventions` points to the foundation), then cover these sections with a short Kotlin example each:
1. **Modules & definitions** — `module { }`, `single` vs `factory` vs `single(createdAtStart=true)`, `viewModelOf(::FooViewModel)` / `viewModel { FooViewModel(get()) }`.
2. **Constructor injection, not service location** — resolve via `get()` in the module lambda; classes take plain constructor params; avoid `KoinComponent`/`by inject()` in domain/data code.
3. **Bootstrap** — `startKoin { androidContext(this@App); modules(...) }` once in `Application`; module composition by feature.
4. **Compose** — `koinViewModel()`, `koinInject()`.
5. **Scopes & qualifiers** — `scope<T> { scoped { } }`, `named("io")` / typed dispatcher qualifiers deferring to the foundation's data-layer conventions.
6. **Testing** — `checkModules { }` / `verify()` to catch missing bindings; `koinTest` overrides.

- [ ] **Step 6: Write `plugins/koin-plugin/README.md`**

Mirror `plugins/retrofit-plugin/README.md` structure: intro paragraph (name, "additive framework provider for Koin DI", enriches `di`, ships no agents), a pointer to root `ARCHITECTURE.md`, a "## How it attaches" section with the contributions table (convention skill → dev-phase convention list; dev injection → foundation dev prompt; security injection → foundation security prompt; `rules/snippets/koin-proguard.md` → referenced by security injection), and a "## Detection" section (`dependency: io.insert-koin`). State it declares no `agents_per_phase` and no `workflow`, and that it coexists with `dagger-plugin` on the `di` aspect (only the detected one activates).

- [ ] **Step 7: Validate the manifest + plugin.json schema**

Run: `node tools/sdlc-lint/cli.mjs schema`
Expected: `schema: N/N passed` with N increased and no failures mentioning `koin-plugin`.

- [ ] **Step 8: Verify the 6-file structure exists**

Run: `find plugins/koin-plugin -type f | sort`
Expected: exactly the 6 files listed under **Files** above.

- [ ] **Step 9: Commit**

```bash
git add plugins/koin-plugin
git commit -m "feat(koin): add additive framework provider for Koin DI (C2)"
```

---

### Task 2: ktor-plugin (network)

**Files:**
- Create: `plugins/ktor-plugin/manifest.yaml`
- Create: `plugins/ktor-plugin/.claude-plugin/plugin.json`
- Create: `plugins/ktor-plugin/runtime-dependencies.json`
- Create: `plugins/ktor-plugin/rules/snippets/ktor-proguard.md`
- Create: `plugins/ktor-plugin/skills/ktor-conventions/SKILL.md`
- Create: `plugins/ktor-plugin/README.md`

**Interfaces:**
- Produces: plugin slug `ktor-plugin`, `stack: ktor`, `enriches_aspect: network`, `dependency: io.ktor`, convention skill id `ktor-plugin:ktor-conventions`. Task 4 registers it; Task 5 creates `components/ktor-plugin.md`.
- Template analog to mirror: `plugins/retrofit-plugin/`.

- [ ] **Step 1: Write `plugins/ktor-plugin/manifest.yaml`**

```yaml
# Ktor client — SDLC manifest (kind: framework, additive).
# Machine-read source the orchestrator consumes. Human docs live in README.md.

kind: framework
stack: ktor
priority: 150                       # documentational for frameworks — they never win an aspect
enriches_aspect: network           # functional category; a foundation hosting `network` resolves me
dependency: io.ktor                # covers ktor-client-core/engine/content-negotiation/serialization; the foundation declares WHERE to look

convention_skills:
  - ktor-plugin:ktor-conventions

extra_phases: []
pre_phase_commands: []

phase_injections:
  development: |
    Ktor client is present. Build **one** long-lived `HttpClient` with an explicit engine
    (OkHttp/Android/CIO) and reuse it — do not new-up a client per request; `close()` it with its owner's
    lifecycle. Install `ContentNegotiation` with kotlinx-serialization `json(...)`, `HttpTimeout`
    (request/connect/socket), and `Logging` **gated on debug builds only** at a level that never emits
    headers/bodies in release. Use `expectSuccess = true` and/or an `HttpResponseValidator` to turn
    non-2xx into exceptions. Request functions are `suspend` and return DTOs or a domain `Result`; map
    `ClientRequestException` (4xx), `ServerResponseException` (5xx), `ResponseException`, and
    `IOException` to domain Results at the repository boundary — never leak Ktor types (`HttpResponse`,
    exceptions) above the data layer. See the ktor-plugin:ktor-conventions skill; layer principles stay
    with the hosting foundation's data-layer conventions (do not restate them).
  security: |
    Ktor (MASVS-NETWORK): all base URLs MUST be HTTPS — no cleartext; configure certificate/public-key
    pinning where the threat model requires it (engine-level, e.g. OkHttp `CertificatePinner`). The
    `Logging` plugin must be DEBUG-gated and must never log `Authorization` headers, cookies, tokens, or
    request/response bodies in release. Do not disable TLS verification or install trust-all managers.
    Apply the R8/ProGuard keep rules in ktor-plugin/rules/snippets/ktor-proguard.md when the project
    ships R8 (Ktor engine reflection + kotlinx.serialization).

post_pipeline_checks: []
```

- [ ] **Step 2: Write `plugins/ktor-plugin/.claude-plugin/plugin.json`**

```json
{
  "name": "ktor-plugin",
  "version": "1.0.0",
  "description": "Additive framework provider for the Ktor client (io.ktor) networking. Auto-detected by the orchestrator from the Gradle version catalog / build files; enriches the `network` aspect (enriches_aspect: network) via manifest.yaml (kind: framework) with the ktor-conventions skill, development + security phase-prompt injections (single HttpClient, ContentNegotiation + kotlinx-json, DEBUG-gated Logging, HttpTimeout, expectSuccess, exception→Result mapping), and R8/ProGuard keep rules. Ships NO agents — it specializes the existing development / security phase prompts.",
  "author": {
    "name": "Nuclominus",
    "url": "https://github.com/Nuclominus"
  },
  "license": "MIT",
  "homepage": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin",
  "keywords": [
    "android",
    "ktor",
    "networking",
    "http-client",
    "sdlc",
    "framework-provider"
  ],
  "dependencies": [
    "sdlc"
  ]
}
```

- [ ] **Step 3: Write `plugins/ktor-plugin/runtime-dependencies.json`**

```json
{
  "_comment": "Runtime plugin dependencies for ktor-plugin, aggregated by pipeline-orchestrator Step 0a. ktor-plugin is an additive framework provider with no external marketplace dependencies, so this stays empty.",
  "dependencies": []
}
```

- [ ] **Step 4: Write `plugins/ktor-plugin/rules/snippets/ktor-proguard.md`**

Frontmatter identical shape to the retrofit snippet (`loaded_by: [android-security, android-devops]`, `load_when: "ProGuard/R8 rules review or edit on a project that uses Ktor client."`). Body: intro line ("Contributed by `ktor-plugin` (additive). Applied **only when Ktor is detected**…"), then a `proguard` code block with:

```proguard
# Ktor client
-keep class io.ktor.** { *; }
-keepclassmembers class io.ktor.** { *; }
-dontwarn io.ktor.**

# kotlinx.serialization (Ktor's ContentNegotiation JSON converter)
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class * {
    @kotlinx.serialization.Serializable <methods>;
}
# Keep @Serializable model classes (adapt the package to your :feature:<name> layout)
-keep,includedescriptorclasses class com.somepackage.**$$serializer { *; }
-keepclassmembers class com.somepackage.** {
    *** Companion;
}
```

- [ ] **Step 5: Write `plugins/ktor-plugin/skills/ktor-conventions/SKILL.md`**

Mirror `plugins/retrofit-plugin/skills/retrofit-conventions/SKILL.md`. Frontmatter:

```yaml
---
name: ktor-conventions
description: Ktor-client-specific networking idioms — a single long-lived HttpClient, engine choice, ContentNegotiation with kotlinx-serialization, DEBUG-gated Logging, HttpTimeout, expectSuccess/response validation, and mapping Ktor exceptions to domain Results at the repository boundary. Invoke before adding or changing Ktor HttpClient config, request functions, or plugins. Layer principles (repository ownership, DTO↔domain, dispatcher discipline) stay with the hosting foundation's data-layer conventions.
---
```

Body opens with the "specialization of the foundation's data-layer principles; layer principles live in [[android-data]] — read that first, do not restate" pointer (mirror retrofit-conventions). Sections, each with a short Kotlin example:
1. **Single HttpClient** — one instance, explicit engine (`OkHttp`/`Android`/`CIO`), reuse, `close()` lifecycle.
2. **ContentNegotiation** — `install(ContentNegotiation){ json(Json{ ignoreUnknownKeys = true }) }`.
3. **Logging DEBUG-gated** — `install(Logging)` only in debug; never bodies/headers in release.
4. **Timeouts & validation** — `install(HttpTimeout)`, `expectSuccess = true`, `HttpResponseValidator`.
5. **Request functions** — `suspend` calls returning DTO/`Result`; keep `HttpResponse` inside the data layer.
6. **Error mapping** — `ClientRequestException`/`ServerResponseException`/`ResponseException`/`IOException` → domain `Result` at the repository boundary.

- [ ] **Step 6: Write `plugins/ktor-plugin/README.md`**

Mirror `retrofit-plugin/README.md`: intro (additive provider for Ktor client, enriches `network`, no agents), `ARCHITECTURE.md` pointer, "## How it attaches" contributions table (ktor-conventions skill, dev injection, security injection, `rules/snippets/ktor-proguard.md`), "## Detection" (`dependency: io.ktor`). Note it declares no `agents_per_phase`/`workflow` and coexists with `retrofit-plugin` on the `network` aspect (only the detected one activates).

- [ ] **Step 7: Validate schema**

Run: `node tools/sdlc-lint/cli.mjs schema`
Expected: `schema: N/N passed`, no `ktor-plugin` failures.

- [ ] **Step 8: Verify structure**

Run: `find plugins/ktor-plugin -type f | sort`
Expected: the 6 files under **Files**.

- [ ] **Step 9: Commit**

```bash
git add plugins/ktor-plugin
git commit -m "feat(ktor): add additive framework provider for Ktor client networking (C2)"
```

---

### Task 3: datastore-proto-plugin (persistence)

**Files:**
- Create: `plugins/datastore-proto-plugin/manifest.yaml`
- Create: `plugins/datastore-proto-plugin/.claude-plugin/plugin.json`
- Create: `plugins/datastore-proto-plugin/runtime-dependencies.json`
- Create: `plugins/datastore-proto-plugin/rules/snippets/datastore-proguard.md`
- Create: `plugins/datastore-proto-plugin/skills/datastore-conventions/SKILL.md`
- Create: `plugins/datastore-proto-plugin/README.md`

**Interfaces:**
- Produces: plugin slug `datastore-proto-plugin`, `stack: datastore-proto`, `enriches_aspect: persistence`, `dependency: androidx.datastore`, convention skill id `datastore-proto-plugin:datastore-conventions`. Task 4 registers it; Task 5 creates `components/datastore-proto-plugin.md`.
- Template analog to mirror: `plugins/room-plugin/`.

- [ ] **Step 1: Write `plugins/datastore-proto-plugin/manifest.yaml`**

```yaml
# DataStore (Proto) — SDLC manifest (kind: framework, additive).
# Machine-read source the orchestrator consumes. Human docs live in README.md.

kind: framework
stack: datastore-proto
priority: 150                       # documentational for frameworks — they never win an aspect
enriches_aspect: persistence       # functional category; a foundation hosting `persistence` resolves me
dependency: androidx.datastore     # covers datastore/datastore-core; the foundation declares WHERE to look

convention_skills:
  - datastore-proto-plugin:datastore-conventions

extra_phases: []
pre_phase_commands: []

phase_injections:
  development: |
    Proto DataStore is present. Create exactly **one** `DataStore<T>` instance per file — expose it as a
    singleton (the `dataStore` delegate at file scope, or a DI singleton); never construct two for the
    same file (it throws). Define a typed `Serializer<T>` with an explicit `defaultValue` and
    `readFrom`/`writeTo` (kotlinx-serialization is the house serializer). Read state as `data: Flow<T>`
    and write with atomic `updateData { current -> … }` (read-modify-write) — never partial blocking
    writes. Handle corruption with a `ReplaceFileCorruptionHandler`; migrate legacy prefs with
    `SharedPreferencesMigration`/`DataMigration`. DataStore manages its own IO dispatcher — don't wrap it.
    Keep the proto/state type in the data layer and map to domain at the repository boundary. See the
    datastore-proto-plugin:datastore-conventions skill; layer principles stay with the hosting
    foundation's data-layer conventions (do not restate them).
  security: |
    Proto DataStore (MASVS-STORAGE): the backing file is **plaintext on disk** — never persist secrets,
    tokens, or PII unencrypted. Encrypt sensitive fields (Keystore-backed) or keep them in secure storage
    and persist only non-sensitive state here. Do not log the deserialized value if it can contain PII.
    Apply the R8/ProGuard keep rules in datastore-proto-plugin/rules/snippets/datastore-proguard.md when
    the project ships R8 (keep the serializer / protobuf-javalite types).

post_pipeline_checks: []
```

- [ ] **Step 2: Write `plugins/datastore-proto-plugin/.claude-plugin/plugin.json`**

```json
{
  "name": "datastore-proto-plugin",
  "version": "1.0.0",
  "description": "Additive framework provider for Proto DataStore (androidx.datastore) persistence. Auto-detected by the orchestrator from the Gradle version catalog / build files; enriches the `persistence` aspect (enriches_aspect: persistence) via manifest.yaml (kind: framework) with the datastore-conventions skill, development + security phase-prompt injections (one DataStore per file, typed Serializer + default, Flow reads, atomic updateData, corruption handler, migrations, no plaintext secrets), and R8/ProGuard keep rules. Ships NO agents — it specializes the existing development / security phase prompts.",
  "author": {
    "name": "Nuclominus",
    "url": "https://github.com/Nuclominus"
  },
  "license": "MIT",
  "homepage": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin",
  "keywords": [
    "android",
    "datastore",
    "proto-datastore",
    "persistence",
    "sdlc",
    "framework-provider"
  ],
  "dependencies": [
    "sdlc"
  ]
}
```

- [ ] **Step 3: Write `plugins/datastore-proto-plugin/runtime-dependencies.json`**

```json
{
  "_comment": "Runtime plugin dependencies for datastore-proto-plugin, aggregated by pipeline-orchestrator Step 0a. datastore-proto-plugin is an additive framework provider with no external marketplace dependencies, so this stays empty.",
  "dependencies": []
}
```

- [ ] **Step 4: Write `plugins/datastore-proto-plugin/rules/snippets/datastore-proguard.md`**

Frontmatter identical shape to the room snippet (`loaded_by: [android-security, android-devops]`, `load_when: "ProGuard/R8 rules review or edit on a project that uses Proto DataStore."`). Body: intro line ("Contributed by `datastore-proto-plugin` (additive). Applied **only when Proto DataStore is detected**…", note the rules depend on the `Serializer<T>` backing choice), then a `proguard` block:

```proguard
# --- If using kotlinx-serialization as the DataStore Serializer<T> (house style) ---
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class **$$serializer { *; }
-keepclasseswithmembers class * {
    @kotlinx.serialization.Serializable <methods>;
}
# Keep your @Serializable state classes (adapt the package to your :feature:<name> layout)
-keep,includedescriptorclasses class com.somepackage.**$$serializer { *; }

# --- If using protobuf-javalite generated messages instead ---
-keep class com.google.protobuf.** { *; }
-keep class * extends com.google.protobuf.GeneratedMessageLite { *; }
-dontwarn com.google.protobuf.**
```

- [ ] **Step 5: Write `plugins/datastore-proto-plugin/skills/datastore-conventions/SKILL.md`**

Mirror `plugins/room-plugin/skills/room-conventions/SKILL.md`. Frontmatter:

```yaml
---
name: datastore-conventions
description: Proto-DataStore-specific persistence idioms — one DataStore<T> per file, a typed Serializer<T> with default + corruption handler, Flow reads, atomic updateData writes, SharedPreferences/Data migrations, and keeping secrets out of the plaintext store. Invoke before adding or changing a DataStore instance, its Serializer, or read/write access. Layer principles (repository ownership, mapping to domain, dispatcher discipline) stay with the hosting foundation's data-layer conventions.
---
```

Body opens with the "specialization of the foundation's data-layer principles; layer principles live in [[android-data]] — read that first, do not restate" pointer (mirror room-conventions). Sections, each with a short Kotlin example:
1. **One DataStore per file** — `val Context.settingsStore: DataStore<Settings> by dataStore("settings.pb", SettingsSerializer)` or a DI singleton; never two for the same file.
2. **Typed Serializer** — implement `Serializer<T>` with `defaultValue`, `readFrom`/`writeTo` (lead with kotlinx-serialization; mention protobuf-javalite as the alternative).
3. **Reads as Flow** — `store.data: Flow<Settings>`, `.map { }`, handle `IOException` in `.catch { emit(default) }`.
4. **Atomic writes** — `store.updateData { current -> current.copy(...) }`.
5. **Corruption & migration** — `ReplaceFileCorruptionHandler`, `SharedPreferencesMigration`/`DataMigration`.
6. **Boundary & security** — map stored type → domain at the repository; never store unencrypted secrets/PII (MASVS-STORAGE), defer encryption strategy to android-security.

- [ ] **Step 6: Write `plugins/datastore-proto-plugin/README.md`**

Mirror `room-plugin/README.md`: intro (additive provider for Proto DataStore, enriches `persistence`, no agents), `ARCHITECTURE.md` pointer, "## How it attaches" table (datastore-conventions skill, dev injection, security injection, `rules/snippets/datastore-proguard.md`), "## Detection" (`dependency: androidx.datastore`). Note no `agents_per_phase`/`workflow` and that it coexists with `room-plugin` on the `persistence` aspect (only the detected one activates).

- [ ] **Step 7: Validate schema**

Run: `node tools/sdlc-lint/cli.mjs schema`
Expected: `schema: N/N passed`, no `datastore-proto-plugin` failures.

- [ ] **Step 8: Verify structure**

Run: `find plugins/datastore-proto-plugin -type f | sort`
Expected: the 6 files under **Files**.

- [ ] **Step 9: Commit**

```bash
git add plugins/datastore-proto-plugin
git commit -m "feat(datastore): add additive framework provider for Proto DataStore (C2)"
```

---

### Task 4: Register all three in the marketplace + full validation

**Files:**
- Modify: `.claude-plugin/marketplace.json` (append 3 plugin entries to the `plugins` array, after the `workmanager-plugin` entry)

**Interfaces:**
- Consumes: the three plugin slugs/sources produced by Tasks 1–3.
- Produces: a marketplace that lists `koin-plugin`, `ktor-plugin`, `datastore-proto-plugin`.

- [ ] **Step 1: Append the three entries to the `plugins` array in `.claude-plugin/marketplace.json`**

Insert immediately after the `workmanager-plugin` object (mind the trailing comma on the preceding entry):

```json
    {
      "name": "koin-plugin",
      "source": "./plugins/koin-plugin",
      "description": "Additive framework provider for Koin dependency injection (io.insert-koin). Auto-detected by the orchestrator from the Gradle version catalog / build files; enriches the `di` aspect (enriches_aspect: di) via manifest.yaml (kind: framework) with the koin-conventions skill, development + security phase-prompt injections (module DSL, constructor get(), startKoin/androidContext, koinViewModel, deliberate scopes), and minimal R8/ProGuard notes. Coexists with dagger-plugin on the `di` aspect — only the detected provider activates. Ships NO agents — it specializes the existing development / security phase prompts."
    },
    {
      "name": "ktor-plugin",
      "source": "./plugins/ktor-plugin",
      "description": "Additive framework provider for the Ktor client (io.ktor) networking. Auto-detected by the orchestrator from the Gradle version catalog / build files; enriches the `network` aspect (enriches_aspect: network) via manifest.yaml (kind: framework) with the ktor-conventions skill, development + security phase-prompt injections (single HttpClient, ContentNegotiation + kotlinx-json, DEBUG-gated Logging, HttpTimeout, expectSuccess, exception→Result mapping), and R8/ProGuard keep rules. Coexists with retrofit-plugin on the `network` aspect — only the detected provider activates. Ships NO agents — it specializes the existing development / security phase prompts."
    },
    {
      "name": "datastore-proto-plugin",
      "source": "./plugins/datastore-proto-plugin",
      "description": "Additive framework provider for Proto DataStore (androidx.datastore) persistence. Auto-detected by the orchestrator from the Gradle version catalog / build files; enriches the `persistence` aspect (enriches_aspect: persistence) via manifest.yaml (kind: framework) with the datastore-conventions skill, development + security phase-prompt injections (one DataStore per file, typed Serializer + default, Flow reads, atomic updateData, corruption handler, migrations, no plaintext secrets), and R8/ProGuard keep rules. Coexists with room-plugin on the `persistence` aspect — only the detected provider activates. Ships NO agents — it specializes the existing development / security phase prompts."
    }
```

- [ ] **Step 2: Verify marketplace.json parses and contains all three**

Run:
```bash
python3 -c "import json; d=json.load(open('.claude-plugin/marketplace.json')); n=[p['name'] for p in d['plugins']]; print(n); assert {'koin-plugin','ktor-plugin','datastore-proto-plugin'} <= set(n), 'missing'"
```
Expected: prints the plugin-name list including the three new names; no assertion error.

- [ ] **Step 3: Run the full schema lint**

Run: `node tools/sdlc-lint/cli.mjs schema`
Expected: `schema: 27/27 passed` (was 24 — three new manifests + three new plugin.json… count reflects both globs; accept any all-passed result with 0 failures).

- [ ] **Step 4: Run the aspect/detection sanity checks**

Run: `node tools/sdlc-lint/cli.mjs detect` and `node tools/sdlc-lint/cli.mjs cycles`
Expected: both report `failed: 0` (or the human summary shows all passed).

- [ ] **Step 5: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "feat(marketplace): register koin/ktor/datastore-proto framework providers (C2)"
```

---

### Task 5: Vault sync — component notes, roadmap flip, spec status

**Files:**
- Create: `.brain/components/koin-plugin.md`
- Create: `.brain/components/ktor-plugin.md`
- Create: `.brain/components/datastore-proto-plugin.md`
- Modify: `.brain/planning/roadmap.md` (C2 row → done; drop C2 from the "Remaining" line)
- Modify: `.brain/planning/c2-framework-providers.md` (frontmatter `status: in-progress` → `done`)

**Interfaces:**
- Consumes: the three plugins from Tasks 1–3 and the ADR they realize (`decisions/ADR-0002-framework-provider-pattern`).
- Produces: vault reflecting C2 as complete. (Per the second-brain rule, `changes/` notes are machine-owned and generated by `tools/brain-sync` on merge — do NOT hand-create them here.)

- [ ] **Step 1: Write `.brain/components/koin-plugin.md`**

Mirror `.brain/components/retrofit-plugin.md` exactly in shape:

```markdown
---
plugin: koin-plugin
kind: framework
enriches_aspect: di
dependency: io.insert-koin
---

# koin-plugin

## Responsibility

Additive framework provider for Koin dependency injection. Auto-detected from the Gradle version
catalog / build files; enriches the `di` aspect (`enriches_aspect: di`) via `manifest.yaml`
(`kind: framework`) with the `koin-conventions` skill, development + security phase-prompt
injections, and minimal R8/ProGuard notes. Ships no agents — it specializes the existing
development / security phase prompts. Coexists with `dagger-plugin` on the `di` aspect; only the
detected provider activates.

## Key files
- `plugins/koin-plugin/manifest.yaml`
- `plugins/koin-plugin/.claude-plugin/plugin.json`

## Decisions
- [[decisions/ADR-0002-framework-provider-pattern]]

## Change history
_Backlinks from `changes/` accumulate here._
```

- [ ] **Step 2: Write `.brain/components/ktor-plugin.md`**

Same shape; frontmatter `plugin: ktor-plugin`, `enriches_aspect: network`, `dependency: io.ktor`. Responsibility paragraph: Ktor client networking provider, enriches `network`, `ktor-conventions` skill, dev+security injections, R8 rules, no agents, coexists with `retrofit-plugin` on `network`. Key files point to `plugins/ktor-plugin/…`. Same Decisions link to `[[decisions/ADR-0002-framework-provider-pattern]]` and the same Change-history stub line.

- [ ] **Step 3: Write `.brain/components/datastore-proto-plugin.md`**

Same shape; frontmatter `plugin: datastore-proto-plugin`, `enriches_aspect: persistence`, `dependency: androidx.datastore`. Responsibility: Proto DataStore persistence provider, enriches `persistence`, `datastore-conventions` skill, dev+security injections, R8 rules, no agents, coexists with `room-plugin` on `persistence`. Key files point to `plugins/datastore-proto-plugin/…`. Same Decisions link + Change-history stub line.

- [ ] **Step 4: Flip the C2 row in `.brain/planning/roadmap.md`**

Change the C2 table row from:
```
| C2 | WorkManager provider (background) | in-progress | #29 |
```
to reflect completion of the whole track — update the label to cover the batch and mark done:
```
| C2 | framework providers (WorkManager, Koin, Ktor, DataStore-Proto) | done | #29, +this batch |
```
And edit the `_Remaining:` line — remove the "complete C2 (Koin / Ktor / kotlinx.serialization / DataStore-Proto)" clause; note kotlinx.serialization is deferred (needs a `serialization` aspect decision) and that the next item is B3.

- [ ] **Step 5: Flip the spec status in `.brain/planning/c2-framework-providers.md`**

Change frontmatter `status: in-progress` → `status: done`.

- [ ] **Step 6: Run the vault check**

Run: `node tools/brain-sync/cli.mjs check --vault .brain`
Expected: `check: clean`

- [ ] **Step 7: Commit**

```bash
git add .brain/components/koin-plugin.md .brain/components/ktor-plugin.md .brain/components/datastore-proto-plugin.md .brain/planning/roadmap.md .brain/planning/c2-framework-providers.md
git commit -m "docs(brain): record koin/ktor/datastore-proto providers, mark C2 done"
```

---

## Self-Review

**1. Spec coverage:**
- koin-plugin (di) → Task 1 ✓; ktor-plugin (network) → Task 2 ✓; datastore-proto-plugin (persistence) → Task 3 ✓
- Uniform 6-file structure → each task's Files + Step 8 structure check ✓
- Minimal Koin proguard + note decision → Task 1 Step 4 ✓
- kotlinx-serialization as DataStore house serializer → Task 3 Steps 1/5 + Global Constraints ✓
- kotlinx.serialization deferral (no build) → Global Constraints + Task 5 Step 4 note ✓
- Central marketplace registration + validation → Task 4 ✓
- Vault sync (component notes ×3 linking ADR-0002, roadmap flip, spec status) → Task 5 ✓
- Acceptance: manifest schema, marketplace shape, brain-sync check, list-stacks → Task 4 + Task 5 Step 6 ✓

**2. Placeholder scan:** Machine-critical files (manifest.yaml ×3, plugin.json ×3, runtime-dependencies.json ×3, proguard blocks, marketplace entries ×3, component notes) carry full verbatim content. Prose deliverables (README ×3, SKILL ×3) carry an exact frontmatter block + an explicit section/idiom contract + the named template file to mirror — this is the complete authoring spec for documentation, not a "TODO". No "TBD"/"handle edge cases"/"similar to Task N" left.

**3. Type consistency:** slugs, `stack`, `enriches_aspect`, `dependency`, and skill ids are identical across each plugin's manifest, plugin.json, marketplace entry, and component note (verified: `koin-plugin`/`koin`/`di`/`io.insert-koin`/`koin-plugin:koin-conventions`; `ktor-plugin`/`ktor`/`network`/`io.ktor`/`ktor-plugin:ktor-conventions`; `datastore-proto-plugin`/`datastore-proto`/`persistence`/`androidx.datastore`/`datastore-proto-plugin:datastore-conventions`).
