---
stack: room
additive: true
priority: 150
aspects: []
# The FUNCTIONAL category this framework decorates. It attaches under any foundation whose
# `hosts_aspects` includes `persistence`. Replaces any plugin→plugin dependency.
enriches_aspect: persistence
# Just name the library. The hosting FOUNDATION declares WHERE to look (via its `framework_detection`:
# version catalog first, then module build files); the orchestrator executes that search on the
# foundation's behalf — see 0b-frameworks in the pipeline-orchestrator skill.
dependency: androidx.room
---

# Room — Framework Provider (additive)

Additive framework provider for Room persistence. Detect-activated: it contributes guidance to
**existing** phases and ships **no agents** — it specializes the foundation's `android-developer` and
`android-security` prompts. `priority` here is documentational only; additive profiles never compete for
or win an aspect.

This profile only **names** the dependency (`androidx.room`) and the functional category it enriches
(`persistence`); the hosting **foundation** (whose `hosts_aspects` includes `persistence`) declares where
to look (version catalog first, then module build files) and the orchestrator executes that search.
Activation is therefore automatic when Room is found. Toggle explicitly from a project's `.claude/sdlc.local.yaml`:

```yaml
frameworks:
  enable: [room]    # force-on even if detection missed it
  disable: [room]   # suppress even if detected
```

## Convention skills to apply

- room-plugin:room-conventions

## Extra phases

(none — frameworks enrich existing phases, they do not own one)

## Phase prompts injection

For development phase, inject:
  "Room is present. `@Dao` methods are `suspend` for one-shot reads/writes and return `Flow<T>` for
   observable queries — never blocking calls on the main thread. Use `@Transaction` for multi-statement
   atomic operations and for `@Relation` reads. Generate the compiler with KSP (not KAPT). Provide
   explicit `Migration` objects and keep `exportSchema = true`; do NOT ship
   `fallbackToDestructiveMigration()` in release. Keep Room `@Entity` types in the data layer and map
   them to domain models at the repository boundary — never expose entities upward. See the
   room-plugin:room-conventions skill; layer principles stay with the hosting foundation's data-layer
   conventions (do not restate them)."

For security phase, inject:
  "Room (MASVS-STORAGE): every query MUST be parameterized — use `@Query` bind parameters (`:arg`) or
   `SupportSQLiteQuery` bind args for `@RawQuery`; never concatenate untrusted input into SQL. Sensitive
   data at rest (tokens, credentials, PII) must not sit in a plaintext database — use an encrypted store
   (e.g. SQLCipher) or field-level encryption and coordinate the trust boundary with android-security.
   Keep `exportSchema = true` for auditable migrations; never log query contents containing PII. Apply
   the R8/ProGuard keep rules in room-plugin/rules/snippets/room-proguard.md when the project ships R8."

## Pre-phase commands

(none)

## Post-pipeline checks

(none — Room has no standalone Gradle gate beyond the foundation's compile/test/lint; schema export is
validated at compile time)
