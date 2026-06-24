---
name: room-conventions
description: Room-specific persistence idioms — @Entity/@Dao/@Database structure, suspend/Flow DAO signatures, @Transaction atomicity, parameterized queries, migrations with exportSchema, KSP compiler, and entity↔domain mapping at the boundary. Invoke before adding or changing Room entities, DAOs, the database class, type converters, or migrations. Layer principles (repository ownership, DTO↔domain, dispatcher discipline) stay with the hosting foundation's data-layer conventions.
---

# room-conventions

Library-specific conventions for **Room**. This is a *specialization* of the foundation's data-layer
principles — it does **not** restate them.

> **Layer principles live in [[android-data]]** (repository interface/impl co-location, DTO↔domain
> mapping, dispatcher discipline, `suspend`/`Flow` boundary contract). Read that first; this skill only
> covers what is specific to Room.

## DAO signatures

- One-shot reads/writes are `suspend`; observable reads return `Flow<T>`. Room runs both off the main
  thread on its own executors — do not wrap them in `runBlocking` or a manual `Dispatchers.IO`.
- Use `@Transaction` for multi-statement atomic operations and for any `@Relation`/multi-table read.
- Prefer `@Upsert` over a manual insert-or-update; use `@Insert(onConflict = …)` deliberately.

```kotlin
@Dao
interface ItemDao {
    @Query("SELECT * FROM items WHERE status = :status ORDER BY updated DESC")
    fun observeByStatus(status: String): Flow<List<ItemEntity>>

    @Upsert
    suspend fun upsert(items: List<ItemEntity>)

    @Transaction
    @Query("SELECT * FROM items WHERE id = :id")
    suspend fun itemWithTags(id: Long): ItemWithTags?
}
```

## Entities & database

- Keep `@Entity` types **in the data layer**. They are storage DTOs — map them to domain models at the
  repository boundary (see [[android-data]]); never expose entities to UI/domain.
- Declare explicit column names / indices where they matter; don't rely on incidental field names.
- The `@Database` class lists entities + version and is `internal`; expose DAOs through the repository.

## Queries — parameterize

- Always bind parameters (`:arg`) in `@Query`. For dynamic SQL use `@RawQuery` with a
  `SupportSQLiteQuery` and **bound args** — never string-concatenate input into SQL.

## Migrations

- Provide explicit `Migration(from, to)` objects and keep `exportSchema = true` (commit the schema JSON).
- Do **not** ship `fallbackToDestructiveMigration()` in release builds — it silently drops user data.

## Compiler

- Generate `room-compiler` with **KSP**, not KAPT (house rule — KAPT is forbidden in the foundation).

## Anti-patterns

- Blocking DAO calls on the main thread, or `runBlocking` to bridge a `suspend` DAO.
- Exposing `@Entity` types as domain/UI models.
- String-concatenated SQL in `@RawQuery`.
- `fallbackToDestructiveMigration()` in production; missing/!committed exported schema.

## References

- [[android-data]] — data-layer principles (authoritative for layering; not restated here).
- `room-plugin/rules/snippets/room-proguard.md` — R8/ProGuard keep rules.
- `android-security` agent — at-rest encryption and query-injection review (MASVS-STORAGE).
