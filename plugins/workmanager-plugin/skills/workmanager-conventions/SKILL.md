---
name: workmanager-conventions
description: WorkManager-specific idioms — CoroutineWorker over threaded Worker, unique enqueue with an explicit ExistingWorkPolicy, meaningful Constraints + backoff, WorkerFactory-based DI, idempotent doWork with correct Result, small non-sensitive inputData, WorkInfo Flow observation, and work-testing. Invoke before adding or changing Workers, enqueue calls, WorkManager Configuration/initialization, or worker tests. Layer/DI/concurrency principles stay with the hosting foundation's conventions.
---

# workmanager-conventions

Library-specific conventions for **WorkManager** (`androidx.work`). This is a *specialization* of the
foundation's architecture/concurrency principles — it does **not** restate them.

> **Concurrency & layer principles live in [[android-architecture]]** (coroutine/dispatcher discipline,
> module placement) and **[[android-data]]** (repository ownership, DTO↔domain). **DI wiring** (the
> `WorkerFactory` seam) belongs to the hosting foundation's DI conventions. Read those first; this skill
> only covers what is specific to WorkManager.

Use WorkManager only for **deferrable, guaranteed** work that must survive process death / reboot
(sync, upload, cleanup). For in-process async tied to a screen, use a coroutine in the ViewModel — not a
Worker.

## Workers — prefer CoroutineWorker

- Extend `CoroutineWorker` and implement `suspend fun doWork()`; work runs on `Dispatchers.Default` by
  default — switch with `withContext(io)` for IO. Never block or start your own threads.
- Keep `doWork()` **idempotent**: WorkManager may re-run it after process death or a retry.

```kotlin
class SyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val repository: FeatureRepository,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val id = inputData.getString(KEY_ID) ?: return Result.failure()
        return when (repository.sync(id)) {           // repository maps transport errors → domain Result
            is DomainResult.Ok      -> Result.success()
            is DomainResult.Transient -> Result.retry()
            is DomainResult.Fatal   -> Result.failure()
        }
    }
    companion object { const val KEY_ID = "id" }
}
```

## Enqueue — unique work + constraints + backoff

- Enqueue **unique** work so a duplicate tap/trigger does not spawn parallel chains. Choose the
  `ExistingWorkPolicy` (`KEEP` / `REPLACE` / `APPEND[_OR_REPLACE]`) deliberately.
- Attach `Constraints` that reflect the real requirement, and set a backoff policy for retries.

```kotlin
val request = OneTimeWorkRequestBuilder<SyncWorker>()
    .setInputData(workDataOf(SyncWorker.KEY_ID to id))          // small, non-sensitive
    .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
    .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
    .build()

WorkManager.getInstance(context)
    .enqueueUniqueWork("sync-$id", ExistingWorkPolicy.KEEP, request)
```

- Periodic work: minimum interval is 15 minutes; use `enqueueUniquePeriodicWork` with an
  `ExistingPeriodicWorkPolicy`. Do not fake shorter intervals by chaining one-time work.

## Dependency injection — via WorkerFactory, never `new`

- Inject collaborators through a `WorkerFactory`; never construct repositories/use-cases inside a
  worker. With Hilt present, use `@HiltWorker` + `@AssistedInject` and the generated `HiltWorkerFactory`
  wired into a `Configuration.Provider` (disable the default initializer). The **DI mechanics belong to
  the hosting foundation's DI conventions** — this skill only marks the seam.

## inputData & Result

- `inputData` is persisted (unencrypted) and size-limited (~10 KB). Pass **ids/flags only**; load real
  or sensitive data inside the worker. See the security phase injection.
- Return the right `Result`: `retry()` (transient — respects backoff), `failure()` (permanent — stops
  the chain), `success()` (done). Don't `retry()` on a permanent error — it loops.

## Observing state

- Observe with the `Flow` APIs (`getWorkInfoByIdFlow`, `getWorkInfosForUniqueWorkFlow`) collected in the
  ViewModel; map `WorkInfo.State` to UI state. Never block on `.get()` off a `ListenableFuture`.

## Testing

- Use the `androidx.work:work-testing` artifact: `WorkManagerTestInitHelper` for enqueue/constraint
  tests, `TestListenableWorkerBuilder` to unit-test a worker's `doWork()` in isolation with fake
  collaborators.

## Anti-patterns

- A threaded `Worker` doing blocking IO, or `runBlocking`/manual threads inside `doWork()`.
- Non-unique enqueue that spawns duplicate chains on repeated triggers.
- Secrets/tokens/PII in `inputData` or worker tags.
- `Result.retry()` on a permanent failure (infinite retry loop).
- Newing-up repositories inside a worker instead of injecting via a `WorkerFactory`.
- Blocking on `WorkInfo` futures from the UI instead of collecting the `Flow`.

## References

- [[android-architecture]] — coroutine/concurrency + module placement (authoritative; not restated here).
- [[android-data]] — repository ownership and domain `Result` mapping the worker calls into.
- `workmanager-plugin/rules/snippets/workmanager-proguard.md` — R8/ProGuard keep rules (default factory).
- `android-security` agent — inputData/PII and foreground-service review (MASVS-STORAGE/PLATFORM).
