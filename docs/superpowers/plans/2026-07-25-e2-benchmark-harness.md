# E2 Benchmark Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reference project, a fixed task, and three deterministic scripts that let a human run the SDLC pipeline under two plugin versions and get an honest answer to "did read discipline reduce cache-read cost, and by how much?"

**Architecture:** `bench/reference-app/` is a committed Kotlin/JVM Gradle specimen, never run against directly. `prepare.mjs` copies it to a scratch directory outside the repo, `git init`s it, and writes a provenance manifest **before** the run. A human runs `/sdlc:start` there. `harvest.mjs` validates provenance, archives the scratch tree, and stores the telemetry. `compare.mjs` computes medians and spread via the pipeline's own `computeMetrics` and issues a labelled engineering verdict — never a p-value.

**Tech Stack:** Node 22 ESM, `node:test` + `node:assert/strict`, Node builtins only for the harness. Kotlin/JVM + Gradle (no Android SDK) for the specimen.

**Spec:** `docs/superpowers/specs/2026-07-25-e2-benchmark-harness-design.md`

## Global Constraints

- **Spec is authoritative.** Any deviation must be raised, not silently taken.
- **No new npm dependencies.** Node builtins only. `tinyglobby` is available if genuinely needed, but the harness should not need it.
- **Harness tests stay OUT of `tools/sdlc-lint/test/`.** `sdlc-lint all` is a CI merge gate; a benchmark script has no business turning CI red. Tests live in `bench/test/*.test.mjs` and run as `node --test bench/test/*.test.mjs`.
- **No second implementation of the metric math.** `compare.mjs` imports `computeMetrics` from `plugins/sdlc/tools/aar/metrics.mjs`. Do not recompute `peak_prefix_tokens`, `reads_per_turn` or totals by hand.
- **Provenance is written at prepare time, never read at harvest time as the source of truth.** Harvest reads the manifest from the scratch dir and *cross-checks* it against live state, failing on divergence rather than preferring either value.
- **Never shrink the reference task or the corpus** as a response to noise. Remedies are, in order: raise N, pin model tiers, enlarge the task.
- **The word "significant" and any p-value are forbidden in harness output.** At N=3 per arm the smallest achievable two-sided p from an exact rank test is ≈ 0.10; at N=4 ≈ 0.03 only under perfect separation. Output is medians, ranges, and a labelled engineering verdict.
- **Scratch lives outside the repository:** `${BENCH_SCRATCH_ROOT:-<os.tmpdir()>/sdlc-bench}/<arm>-<run>`. Never inside `bench/`.
- **Corpus power floor:** `FLOOR_TOKENS = 21_000` (the measured worst-case per-turn fixed floor, `android-docs`). The readable corpus must be **≥ 3×** that, i.e. ≥ 63,000 estimated tokens.
- **Staging:** stage explicit paths only. Never `git add -A` — the working tree carries unrelated `.brain/.obsidian/*` and `.claude/settings.json` changes.
- **Branch:** `feat/bench-harness` (already created off `develop`; the spec commits `ce7d520` and `edbb043` are on it).
- **Arm identifiers are the literal strings `a` and `b`.** Arm `a` = `sdlc@1.9.1` (develop @ 9d1af30). Arm `b` = `sdlc@1.10.0` (feat/e2-read-discipline).

## File Structure

| File | Status | Responsibility |
|------|--------|----------------|
| `bench/README.md` | create | The runbook: Step 0 environment freeze, the run loop, the decision rules. The only doc a human needs open while running. |
| `bench/reference-app/**` | create | The specimen. Kotlin/JVM Gradle project, ≥63k estimated tokens of readable corpus, `./gradlew test` green. |
| `bench/task.md` | create | The brief, passed byte-identically to `/sdlc:start` every run. |
| `bench/answers.md` | create | Scripted human responses to approval gates and clarifying questions. |
| `bench/lib/corpus.mjs` | create | Corpus token estimation + the power check. Pure functions. |
| `bench/lib/manifest.mjs` | create | Manifest read/write/compare. Shared by prepare and harvest, so the shape cannot drift between them. |
| `bench/prepare.mjs` | create | Copy → scratch, `git init`, write manifest, print the run command. |
| `bench/harvest.mjs` | create | Validate provenance, gate on `cost_basis`, archive, write `results/<arm>-<run>.json`. |
| `bench/compare.mjs` | create | Medians, ranges, spread, verdict. Imports `computeMetrics`. |
| `bench/test/*.test.mjs` | create | Unit tests for the four modules above. |
| `bench/test/fixtures/**` | create | Synthetic telemetry and result fixtures. |
| `bench/results/`, `bench/archive/` | create | `.gitkeep` only at first; runs land here later. |
| `.gitignore` | modify | Ignore `bench/archive/*.tar.gz` (large binaries); keep `bench/results/*.json` tracked — they are the evidence. |
| `.brain/planning/backlog.md` | modify | Record the harness as the instrument closing E2's deferred DoD. |
| `bench/baseline.json` | **not created here** | Produced by the run phase (spec Step 4), which is out of scope for this plan. It carries arm B's numbers plus the spread, N, run order, addressable share, and the statistical-honesty statement. |

**Task order rationale:** Task 1 verifies the one assumption that can void the whole design, and produces nothing else — if arms cannot be isolated, no money and no further work is spent. Everything after it is ordinary TDD.

---

### Task 1: Verify arm isolation — the gate

The spec's Step 0 rests on an **unverified** assumption: that two Claude Code environments with different installed plugin versions can be selected deterministically. If they cannot, the comparison has no valid arms and the rest of this plan is void.

This task writes no harness code. Its deliverable is a verified procedure (or a blocking finding).

**Files:**
- Create: `bench/README.md` (the "Step 0 — freeze the environment" section only; the rest is Task 7)

**Interfaces:**
- Consumes: nothing.
- Produces: a documented, reproducible arm-switch procedure that Task 7's runbook and every later run depend on. If BLOCKED, produces a written finding instead.

- [ ] **Step 1: Record the current state**

```bash
cat ~/.claude/plugins/known_marketplaces.json
ls ~/.claude/plugins/cache/agentic-sdlc/sdlc/
git -C ~/.claude/plugins/marketplaces/agentic-sdlc rev-parse HEAD
git -C ~/.claude/plugins/marketplaces/agentic-sdlc rev-parse --abbrev-ref HEAD
```

Expected at time of writing: `autoUpdate: true`; cache contains `1.9.0/` and `1.9.1/`; the marketplace clone is on `develop` at `9d1af30`. Record what you actually see — if it differs, say so; the environment has moved and later steps may need adjusting.

- [ ] **Step 2: Determine whether `CLAUDE_CONFIG_DIR` is honoured**

```bash
mkdir -p /tmp/bench-env-probe
CLAUDE_CONFIG_DIR=/tmp/bench-env-probe claude --version
ls -a /tmp/bench-env-probe
```

If the probe directory gets populated with Claude Code state, the variable is honoured and it is the arm-isolation mechanism. If it stays empty, fall back to a per-arm `HOME` and test that the same way. Record which mechanism works.

- [ ] **Step 3: Build the two arm environments**

Create `bench/env/arm-a/` and `bench/env/arm-b/` (paths outside the repo are also acceptable — record whichever you use). In each, install the `agentic-sdlc` marketplace with `autoUpdate` disabled: arm A from `develop`, arm B from `feat/e2-read-discipline`.

- [ ] **Step 4: Prove the arms are actually different**

Launch Claude Code under each arm and confirm the loaded `sdlc` plugin version, then check the discriminating fact:

```bash
grep -c "Read discipline:" <arm-env>/plugins/cache/agentic-sdlc/sdlc/*/skills/pipeline-orchestrator/SKILL.md
```

Expected: arm A → `0`, arm B → **non-zero**. Assert non-zero, not an exact count: arm B greps to `2`, because the `DRIFT GUARD` maintenance comment beside the contract also quotes the phrase. The discriminator is presence versus absence — that is the entire independent variable.

- [ ] **Step 5: Prove the arms are stable**

Repeat Step 4 after switching arms twice (a → b → a). The counts must be `0`, `1`, `0`. A drifting result means arm selection is not deterministic. Also re-check the marketplace SHA in each env to confirm `autoUpdate: false` held.

- [ ] **Step 6: Write it down, or block**

If Steps 2–5 succeeded, write the `## Step 0 — freeze the environment` section of `bench/README.md`: the exact commands, the arm paths, the discriminating grep, and the recorded SHAs and versions.

If any step failed, **STOP and report BLOCKED** with the exact output. Do not invent a workaround; the design explicitly says it must be revisited in that case.

- [ ] **Step 7: Commit**

```bash
git add bench/README.md
git commit -m "docs(bench): verified arm-isolation procedure (Step 0)"
```

---

### Task 2: Gradle scaffold and the corpus power check

Build the specimen's skeleton and, in the same task, the tool that decides whether it is big enough — because a specimen that fails the power check is not a specimen, and the two should never be able to drift apart.

**Files:**
- Create: `bench/reference-app/settings.gradle.kts`
- Create: `bench/reference-app/gradle/libs.versions.toml`
- Create: `bench/reference-app/app/build.gradle.kts`
- Create: `bench/reference-app/app/src/main/kotlin/bench/domain/Result.kt`
- Create: `bench/reference-app/app/src/main/kotlin/bench/domain/model/Money.kt`
- Create: `bench/reference-app/app/src/test/kotlin/bench/domain/ResultTest.kt`
- Create: `bench/lib/corpus.mjs`
- Create: `bench/test/corpus.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export const FLOOR_TOKENS = 21_000`
  - `export const MIN_CORPUS_RATIO = 3`
  - `export function estimateTokensFromLength(chars: number): number` — `Math.ceil(chars / 4)`, the single definition of the formula
  - `export function estimateTokens(text: string): number` — `estimateTokensFromLength(text.length)`
  - `export function corpusStats(rootDir: string): { files: number, chars: number, tokens: number, ratio: number, ok: boolean }` — walks `**/*.kt` under `rootDir`

- [ ] **Step 1: Write the Gradle scaffold**

`bench/reference-app/settings.gradle.kts`:

```kotlin
dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}

rootProject.name = "bench-orders"
include(":app")
```

Without the `dependencyResolutionManagement` block, `kotlin-stdlib` is unresolvable and the build fails.

`bench/reference-app/gradle/libs.versions.toml` — deliberately declares **no** framework coordinates, so no additive SDLC framework provider activates:

```toml
[versions]
kotlin = "2.1.0"

[libraries]
kotlin-test = { module = "org.jetbrains.kotlin:kotlin-test", version.ref = "kotlin" }

[plugins]
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
```

`bench/reference-app/app/build.gradle.kts`:

```kotlin
plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    testImplementation(libs.kotlin.test)
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}
```

- [ ] **Step 2: Write the two seed Kotlin files**

`app/src/main/kotlin/bench/domain/Result.kt`:

```kotlin
package bench.domain

sealed interface Result<out T> {
    data class Success<T>(val value: T) : Result<T>
    data class Failure(val error: DomainError) : Result<Nothing>
}

sealed interface DomainError {
    val message: String
}

data class ValidationError(override val message: String, val field: String) : DomainError

data class NotFoundError(override val message: String, val id: String) : DomainError

inline fun <T, R> Result<T>.map(transform: (T) -> R): Result<R> = when (this) {
    is Result.Success -> Result.Success(transform(value))
    is Result.Failure -> this
}
```

`app/src/main/kotlin/bench/domain/model/Money.kt`:

```kotlin
package bench.domain.model

@JvmInline
value class Money(val cents: Long) {
    operator fun plus(other: Money): Money = Money(cents + other.cents)
    operator fun times(quantity: Int): Money = Money(cents * quantity)

    companion object {
        val ZERO = Money(0)
        fun ofUnits(units: Long): Money = Money(units * 100)
    }
}
```

`app/src/test/kotlin/bench/domain/ResultTest.kt`:

```kotlin
package bench.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ResultTest {
    @Test
    fun `map transforms a success`() {
        val result: Result<Int> = Result.Success(2)
        assertEquals(Result.Success(4), result.map { it * 2 })
    }

    @Test
    fun `map leaves a failure untouched`() {
        val failure: Result<Int> = Result.Failure(ValidationError("bad", "qty"))
        assertTrue(failure.map { it * 2 } is Result.Failure)
    }
}
```

- [ ] **Step 3: Verify the specimen builds and tests green**

Run: `cd bench/reference-app && ./gradlew test`

If no Gradle wrapper is present, generate one with a locally installed Gradle (`gradle wrapper`) and commit it — the runbook depends on `./gradlew` existing. Expected: BUILD SUCCESSFUL, 2 tests passing.

- [ ] **Step 4: Write the failing corpus test**

`bench/test/corpus.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { estimateTokens, estimateTokensFromLength, corpusStats, FLOOR_TOKENS, MIN_CORPUS_RATIO } from "../lib/corpus.mjs";

test("estimateTokens uses 4 chars per token, rounded up", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});

test("the power floor and ratio are pinned", () => {
  assert.equal(FLOOR_TOKENS, 21_000);
  assert.equal(MIN_CORPUS_RATIO, 3);
});

function corpusOf(totalChars) {
  const root = mkdtempSync(join(tmpdir(), "corpus-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "A.kt"), "x".repeat(totalChars));
  writeFileSync(join(root, "src", "notes.md"), "y".repeat(totalChars)); // must be ignored
  return corpusStats(root);
}

test("corpusStats counts only .kt files", () => {
  const s = corpusOf(4000);
  assert.equal(s.files, 1);
  assert.equal(s.chars, 4000);
  assert.equal(s.tokens, 1000);
});

test("a corpus below 3x the floor is not ok", () => {
  const s = corpusOf(FLOOR_TOKENS * 4 * MIN_CORPUS_RATIO - 4); // one token short
  assert.equal(s.ok, false);
  assert.ok(s.ratio < MIN_CORPUS_RATIO);
});

test("a corpus at exactly 3x the floor is ok", () => {
  const s = corpusOf(FLOOR_TOKENS * 4 * MIN_CORPUS_RATIO);
  assert.equal(s.ok, true);
  assert.equal(s.ratio, MIN_CORPUS_RATIO);
});

test("generated and cached .kt are not counted toward the corpus", () => {
  const root = mkdtempSync(join(tmpdir(), "corpus-"));
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "build", "generated"), { recursive: true });
  mkdirSync(join(root, ".gradle"), { recursive: true });
  writeFileSync(join(root, "src", "A.kt"), "x".repeat(400));
  writeFileSync(join(root, "build", "generated", "Gen.kt"), "y".repeat(999_999));
  writeFileSync(join(root, ".gradle", "Cached.kt"), "z".repeat(999_999));
  const s = corpusStats(root);
  assert.equal(s.files, 1, "only hand-authored source counts");
  assert.equal(s.chars, 400);
});

test("estimateTokens and estimateTokensFromLength agree", () => {
  assert.equal(estimateTokens("abcde"), estimateTokensFromLength(5));
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `node --test bench/test/corpus.test.mjs`
Expected: FAIL — `Cannot find module '../lib/corpus.mjs'`

- [ ] **Step 6: Write the implementation**

`bench/lib/corpus.mjs`:

```js
// Power check for the benchmark specimen. Read discipline can only move the
// part of the prompt prefix made of file content the agent chose to pull in;
// the fixed floor is E1's problem, not E2's. If the readable corpus is small
// relative to the floor, the experiment cannot detect the effect even if it
// is real — so the specimen's size is a measurement precondition, not taste.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/** Measured worst-case per-turn fixed floor (android-docs). */
export const FLOOR_TOKENS = 21_000;

/** Corpus must be at least this many times the floor to have detection power. */
export const MIN_CORPUS_RATIO = 3;

/** Rough token estimate from a character count. 4 chars/token is the usual approximation. */
export function estimateTokensFromLength(chars) {
  return Math.ceil(chars / 4);
}

/** Rough token estimate for a string. */
export function estimateTokens(text) {
  return estimateTokensFromLength(text.length);
}

/**
 * Directories that never hold hand-authored source. Generated Kotlin counted
 * toward the corpus would report a false `ok: true` — the instrument lying in
 * the reassuring direction, which is the failure this whole check exists to
 * prevent. Dot-directories (.gradle, .kotlin, .git) are skipped by prefix.
 */
const SKIP_DIRS = new Set(["build", "out", "node_modules"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (extname(abs) === ".kt") out.push(abs);
  }
  return out;
}

/**
 * Estimate the readable corpus of a Kotlin project.
 * @returns {{files:number, chars:number, tokens:number, ratio:number, ok:boolean}}
 */
export function corpusStats(rootDir) {
  const files = walk(rootDir);
  const chars = files.reduce((n, f) => n + readFileSync(f, "utf8").length, 0);
  const tokens = estimateTokensFromLength(chars); // no throwaway allocation
  const ratio = tokens / FLOOR_TOKENS;
  return { files: files.length, chars, tokens, ratio, ok: ratio >= MIN_CORPUS_RATIO };
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node --test bench/test/corpus.test.mjs`
Expected: PASS — 7/7

- [ ] **Step 8: Report the current (deliberately insufficient) corpus size**

Run:

```bash
node -e "import('./bench/lib/corpus.mjs').then(m=>console.log(m.corpusStats('bench/reference-app')))"
```

Expected: `ok: false` with a ratio far below 3. That is correct at this point — Task 3 grows the corpus. Record the number in your report so Task 3 knows its starting point.

- [ ] **Step 9: Commit**

```bash
git add bench/reference-app bench/lib/corpus.mjs bench/test/corpus.test.mjs
git commit -m "feat(bench): Kotlin/JVM specimen scaffold + corpus power check"
```

---

### Task 3: Grow the corpus to the power target

The specimen must reach **≥ 63,000 estimated tokens** of Kotlin, or the experiment cannot see the effect it is looking for. This is the task that makes the instrument capable.

**Files:**
- Create: at least 45 files under `bench/reference-app/app/src/main/kotlin/bench/` and `app/src/test/kotlin/bench/` (67 as built)

**Interfaces:**
- Consumes: `Result`, `DomainError`, `ValidationError`, `NotFoundError`, `Money` from Task 2; `corpusStats` for the gate.
- Produces: `CreateOrder` — the class the reference task targets — plus `ProductRepository` and `OrderRepository`, which the task's acceptance depends on. Exact shapes below.

- [ ] **Step 1: Write the domain models**

Under `app/src/main/kotlin/bench/domain/model/`, create `Customer.kt`, `Product.kt`, `OrderLine.kt`, `Order.kt`, `Discount.kt`, `InventoryItem.kt`, `Address.kt`, `OrderStatus.kt`. Give each realistic fields, `require`-free constructors (validation is the task's job, not the model's), KDoc on each public type, and small helper methods. Aim for 60-120 lines per file.

`Order.kt` and `Product.kt` are load-bearing — the reference task reads them. They must contain at minimum:

```kotlin
package bench.domain.model

data class Product(
    val id: String,
    val name: String,
    val unitPrice: Money,
    val active: Boolean,
)

data class OrderLine(
    val productId: String,
    val quantity: Int,
    val unitPrice: Money,
) {
    val subtotal: Money get() = unitPrice * quantity
}

data class Order(
    val id: String,
    val customerId: String,
    val lines: List<OrderLine>,
    val status: OrderStatus,
) {
    val total: Money get() = lines.fold(Money.ZERO) { acc, line -> acc + line.subtotal }
}
```

- [ ] **Step 2: Write the repository interfaces**

`app/src/main/kotlin/bench/domain/repository/ProductRepository.kt`:

```kotlin
package bench.domain.repository

import bench.domain.model.Product

interface ProductRepository {
    fun findById(id: String): Product?
    fun findAll(): List<Product>
}
```

`app/src/main/kotlin/bench/domain/repository/OrderRepository.kt`:

```kotlin
package bench.domain.repository

import bench.domain.model.Order

interface OrderRepository {
    fun save(order: Order): Order
    fun findById(id: String): Order?
    fun findByCustomer(customerId: String): List<Order>
}
```

Add `CustomerRepository` and `InventoryRepository` in the same style — they are read-noise the agent must navigate past.

- [ ] **Step 3: Write the use cases**

Under `app/src/main/kotlin/bench/domain/usecase/`, create **ten** use cases. `CreateOrder` is the reference task's target and must start **without** validation — that is what the task adds:

```kotlin
package bench.domain.usecase

import bench.domain.Result
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.model.OrderStatus
import bench.domain.repository.OrderRepository
import bench.domain.repository.ProductRepository

/**
 * Creates a new order for a customer.
 *
 * Note: this use case currently trusts its input.
 */
class CreateOrder(
    private val orders: OrderRepository,
    private val products: ProductRepository,
) {
    operator fun invoke(customerId: String, lines: List<OrderLine>): Result<Order> {
        val order = Order(
            id = "ord-${'$'}{orders.findByCustomer(customerId).size + 1}",
            customerId = customerId,
            lines = lines,
            status = OrderStatus.PENDING,
        )
        return Result.Success(orders.save(order))
    }
}
```

The other nine — `CancelOrder`, `ApplyDiscount`, `ListOrders`, `ReserveInventory`, `ReleaseInventory`, `CalculateShipping`, `ArchiveOrder`, `FindProducts`, `SummariseCustomerSpend` — are realistic read-noise. Each fully implemented, each with KDoc, 40-90 lines.

- [ ] **Step 4: Write the in-memory data layer**

Under `app/src/main/kotlin/bench/data/`, implement every repository interface with an in-memory map-backed class plus a small seed-data object. These must be real, working implementations — the QA phase will exercise them.

- [ ] **Step 5: Write the existing test suite**

Under `app/src/test/kotlin/bench/domain/usecase/`, write passing tests for at least five of the non-target use cases, in a consistent style (`kotlin.test`, backtick test names, arrange/act/assert). This is the convention the QA phase will follow instead of inventing one — and its consistency is part of what makes the two arms comparable.

**Do not write tests for `CreateOrder` validation.** That is the reference task's deliverable.

- [ ] **Step 6: Verify the specimen still builds green**

Run: `cd bench/reference-app && ./gradlew test`
Expected: BUILD SUCCESSFUL, all tests passing.

If it fails, fix the specimen — a benchmark that starts from a broken build measures the agents' recovery behaviour, not their read behaviour.

- [ ] **Step 7: Verify the power check now passes**

Run:

```bash
node -e "import('./bench/lib/corpus.mjs').then(m=>console.log(m.corpusStats('bench/reference-app')))"
```

Expected: `ok: true`, `ratio >= 3`, `tokens >= 63000`, and at least 45 files. The token ratio is the binding gate; the file count is only a proxy for "spread across enough files that an agent must navigate". As built the specimen has 67 files — reaching the ratio with real, tested code needed more than the original estimate assumed. Never delete or merge files to hit a count.

If `ok` is false, **add more realistic code** — more use cases, richer models, more tests. Do not lower `FLOOR_TOKENS` or `MIN_CORPUS_RATIO`; those are pinned by test for exactly this reason.

- [ ] **Step 8: Commit**

```bash
git add bench/reference-app
git commit -m "feat(bench): grow specimen corpus past the 3x floor power target"
```

---

### Task 4: `prepare.mjs` — disposable copy, real git repo, provenance up front

**Files:**
- Create: `bench/lib/manifest.mjs`
- Create: `bench/prepare.mjs`
- Create: `bench/test/manifest.test.mjs`
- Create: `bench/test/prepare.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks (the specimen path is a CLI argument).
- Produces:
  - `manifest.mjs`: `export const MANIFEST_NAME = "_bench-manifest.json"`; `export function buildManifest(fields): object`; `export function writeManifest(dir, manifest): void`; `export function readManifest(dir): object`; `export function diffManifest(recorded, live): string[]` — returns a list of human-readable divergence descriptions, empty when they agree; `export function resolveConfigDir(env?): string`; `export function resolvePluginVersion(cacheDir): string` — throws on an ambiguous cache, returns `""` when the cache is absent.
  - `prepare.mjs` CLI: `node bench/prepare.mjs --arm <a|b> --run <n> --specimen bench/reference-app --gap <seconds>`, exit 0 on success, non-zero on refusal.
  - Scratch path convention: `${BENCH_SCRATCH_ROOT:-<os.tmpdir()>/sdlc-bench}/<arm>-<run>`.

- [ ] **Step 1: Write the failing manifest test**

`bench/test/manifest.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MANIFEST_NAME, buildManifest, writeManifest, readManifest, diffManifest, resolveConfigDir, resolvePluginVersion } from "../lib/manifest.mjs";

const base = {
  arm: "a", run: 1, plugin_version: "1.9.1", marketplace_sha: "9d1af30",
  config_dir: "/tmp/arm-a", task_sha256: "aaa", answers_sha256: "bbb",
  inter_run_gap_seconds: 3600, prepared_at: "2026-07-25T12:00:00.000Z",
};

test("manifest round-trips through disk", () => {
  const dir = mkdtempSync(join(tmpdir(), "man-"));
  const m = buildManifest(base);
  writeManifest(dir, m);
  assert.deepEqual(readManifest(dir), m);
});

test("reading a missing manifest throws a named error", () => {
  const dir = mkdtempSync(join(tmpdir(), "man-"));
  assert.throws(() => readManifest(dir), /_bench-manifest\.json/);
});

test("identical manifests diff to nothing", () => {
  assert.deepEqual(diffManifest(buildManifest(base), buildManifest(base)), []);
});

test("a changed plugin version is reported as divergence", () => {
  const live = buildManifest({ ...base, plugin_version: "1.10.0" });
  const d = diffManifest(buildManifest(base), live);
  assert.equal(d.length, 1);
  assert.match(d[0], /plugin_version.*1\.9\.1.*1\.10\.0/);
});

test("every provenance field is compared", () => {
  const live = buildManifest({ ...base, marketplace_sha: "deadbee", config_dir: "/tmp/arm-b", task_sha256: "zzz" });
  assert.equal(diffManifest(buildManifest(base), live).length, 3);
});

test("prepared_at and run are not divergence — they are recorded, not compared", () => {
  const live = buildManifest({ ...base, prepared_at: "2026-07-26T09:00:00.000Z" });
  assert.deepEqual(diffManifest(buildManifest(base), live), []);
});

test("MANIFEST_NAME is the agreed filename", () => {
  assert.equal(MANIFEST_NAME, "_bench-manifest.json");
});

test("resolveConfigDir does not append .claude to CLAUDE_CONFIG_DIR", () => {
  assert.equal(resolveConfigDir({ CLAUDE_CONFIG_DIR: "/tmp/arm-a" }), "/tmp/arm-a");
  assert.equal(resolveConfigDir({ HOME: "/home/x" }), join("/home/x", ".claude"));
});

test("resolvePluginVersion returns the single installed version", () => {
  const cache = mkdtempSync(join(tmpdir(), "cache-"));
  mkdirSync(join(cache, "1.10.0"));
  assert.equal(resolvePluginVersion(cache), "1.10.0");
});

test("an ambiguous plugin cache is a hard error, not a guess", () => {
  const cache = mkdtempSync(join(tmpdir(), "cache-"));
  mkdirSync(join(cache, "1.9.1"));
  mkdirSync(join(cache, "1.10.0"));
  // Lexicographic "latest" would pick 1.9.1 here — exactly the two arm versions.
  assert.throws(() => resolvePluginVersion(cache), /found 2:/);
});

test("an absent plugin cache records an empty version rather than throwing", () => {
  assert.equal(resolvePluginVersion(join(tmpdir(), "definitely-not-there-12345")), "");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test bench/test/manifest.test.mjs`
Expected: FAIL — `Cannot find module '../lib/manifest.mjs'`

- [ ] **Step 3: Write `manifest.mjs`**

```js
// Provenance for one benchmark run. Written by prepare.mjs BEFORE the run,
// never derived at harvest time: arms are switched between runs by design, so
// reading provenance afterwards records the state that happened to be live
// when someone got round to harvesting. That record is plausible and wrong —
// the worst failure mode available here, because it looks verified.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const MANIFEST_NAME = "_bench-manifest.json";

/**
 * CLAUDE_CONFIG_DIR, when set, IS the config directory — do not append
 * ".claude". Shared by prepare and harvest: if the two ever resolved it
 * differently, every run would report a false provenance divergence.
 */
export function resolveConfigDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(env.HOME || "", ".claude");
}

/**
 * The design keeps exactly one plugin version per arm environment. Picking
 * "the latest" from several would be a guess, and a wrong guess writes the
 * wrong arm into the manifest — which harvest's cross-check cannot catch,
 * because both sides would guess identically. So: absent cache (not an arm
 * environment, e.g. under test) records an empty string; an ambiguous cache
 * is a hard error naming what it found.
 */
export function resolvePluginVersion(cacheDir) {
  let entries;
  try { entries = readdirSync(cacheDir); } catch { return ""; }
  if (entries.length !== 1) {
    throw new Error(
      `expected exactly one installed sdlc version in ${cacheDir}, found ${entries.length}: ${entries.join(", ")}`);
  }
  return entries[0];
}

/** Fields compared between the recorded manifest and live state at harvest. */
const COMPARED = ["arm", "plugin_version", "marketplace_sha", "config_dir", "task_sha256", "answers_sha256"];

export function buildManifest(fields) {
  return {
    arm: fields.arm,
    run: fields.run,
    plugin_version: fields.plugin_version,
    marketplace_sha: fields.marketplace_sha,
    config_dir: fields.config_dir,
    task_sha256: fields.task_sha256,
    answers_sha256: fields.answers_sha256,
    inter_run_gap_seconds: fields.inter_run_gap_seconds,
    prepared_at: fields.prepared_at,
  };
}

export function writeManifest(dir, manifest) {
  writeFileSync(join(dir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n");
}

export function readManifest(dir) {
  const path = join(dir, MANIFEST_NAME);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`cannot read ${MANIFEST_NAME} at ${path}: ${e.message}`);
  }
}

/** @returns {string[]} one description per diverging field; empty when they agree. */
export function diffManifest(recorded, live) {
  return COMPARED
    .filter((k) => recorded[k] !== live[k])
    .map((k) => `${k}: recorded "${recorded[k]}" but live is "${live[k]}"`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test bench/test/manifest.test.mjs`
Expected: PASS — 11/11

- [ ] **Step 5: Write the failing prepare test**

`bench/test/prepare.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { MANIFEST_NAME } from "../lib/manifest.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PREPARE = join(REPO, "bench", "prepare.mjs");

function specimen() {
  const dir = mkdtempSync(join(tmpdir(), "spec-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "A.kt"), "fun a() {}\n");
  writeFileSync(join(dir, "build.gradle.kts"), "// build\n");
  return dir;
}

function run(args, env = {}) {
  return execFileSync("node", [PREPARE, ...args], {
    cwd: REPO, encoding: "utf8", env: { ...process.env, ...env },
  });
}

test("copies the specimen tree file for file", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "scratch-"));
  const spec = specimen();
  run(["--arm", "a", "--run", "1", "--specimen", spec, "--gap", "60"], { BENCH_SCRATCH_ROOT: scratchRoot });
  const dest = join(scratchRoot, "a-1");
  assert.equal(readFileSync(join(dest, "src", "A.kt"), "utf8"), "fun a() {}\n");
  assert.equal(readFileSync(join(dest, "build.gradle.kts"), "utf8"), "// build\n");
});

test("the copy is a git repo with exactly one commit", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "scratch-"));
  run(["--arm", "a", "--run", "2", "--specimen", specimen(), "--gap", "60"], { BENCH_SCRATCH_ROOT: scratchRoot });
  const dest = join(scratchRoot, "a-2");
  assert.ok(existsSync(join(dest, ".git")), "expected a .git directory");
  const count = execFileSync("git", ["-C", dest, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(count, "1");
});

test("writes a complete manifest", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "scratch-"));
  run(["--arm", "b", "--run", "3", "--specimen", specimen(), "--gap", "900"], { BENCH_SCRATCH_ROOT: scratchRoot });
  const m = JSON.parse(readFileSync(join(scratchRoot, "b-3", MANIFEST_NAME), "utf8"));
  assert.equal(m.arm, "b");
  assert.equal(m.run, 3);
  assert.equal(m.inter_run_gap_seconds, 900);
  // prepared_at has no external dependency — always populated.
  assert.ok(m.prepared_at != null && m.prepared_at !== "", `manifest.prepared_at must be populated, got ${JSON.stringify(m.prepared_at)}`);
  // plugin_version/marketplace_sha/config_dir depend on the live ~/.claude environment;
  // task_sha256/answers_sha256 depend on bench/task.md and bench/answers.md, which are
  // Task 7 deliverables and do not exist yet at Task 4. All five may legitimately be
  // empty strings here — only their presence as keys is asserted.
  for (const k of ["plugin_version", "marketplace_sha", "config_dir", "task_sha256", "answers_sha256"]) {
    assert.ok(k in m, `manifest.${k} must be present`);
  }
});

test("refuses to overwrite an existing run directory", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "scratch-"));
  const spec = specimen();
  run(["--arm", "a", "--run", "9", "--specimen", spec, "--gap", "60"], { BENCH_SCRATCH_ROOT: scratchRoot });
  assert.throws(
    () => run(["--arm", "a", "--run", "9", "--specimen", spec, "--gap", "60"], { BENCH_SCRATCH_ROOT: scratchRoot }),
    (e) => /a-9/.test(e.stderr ?? "") && e.status !== 0,
  );
});

test("rejects an unknown arm", () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), "scratch-"));
  assert.throws(
    () => run(["--arm", "c", "--run", "1", "--specimen", specimen(), "--gap", "60"], { BENCH_SCRATCH_ROOT: scratchRoot }),
    (e) => e.status !== 0,
  );
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `node --test bench/test/prepare.test.mjs`
Expected: FAIL — prepare.mjs does not exist.

- [ ] **Step 7: Write `prepare.mjs`**

```js
#!/usr/bin/env node
// Prepare one benchmark run: copy the specimen to a disposable scratch tree,
// make it a real git repo (the pipeline's dev/QA/docs phases expect branches,
// commits and diffs — a bare file tree would behave differently from real
// use), and record provenance BEFORE the run.
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildManifest, writeManifest, MANIFEST_NAME, resolveConfigDir, resolvePluginVersion } from "./lib/manifest.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const die = (msg) => { console.error(`prepare: ${msg}`); process.exit(1); };

const arm = arg("arm");
const run = Number(arg("run"));
const specimen = resolve(arg("specimen", "bench/reference-app"));
const gap = Number(arg("gap", "0"));

if (arm !== "a" && arm !== "b") die(`--arm must be "a" or "b", got ${JSON.stringify(arm)}`);
if (!Number.isInteger(run) || run < 1) die(`--run must be a positive integer, got ${JSON.stringify(arg("run"))}`);
if (!existsSync(specimen)) die(`specimen not found: ${specimen}`);

const scratchRoot = process.env.BENCH_SCRATCH_ROOT || join(tmpdir(), "sdlc-bench");
const dest = join(scratchRoot, `${arm}-${run}`);

if (existsSync(dest)) {
  die(`scratch directory already exists: ${dest}\n` +
      `Refusing to overwrite — it may hold an unharvested run. Harvest or remove it first.`);
}

mkdirSync(scratchRoot, { recursive: true });
cpSync(specimen, dest, { recursive: true });

execFileSync("git", ["-C", dest, "init", "-q"]);
execFileSync("git", ["-C", dest, "add", "-A"]);
execFileSync("git", ["-C", dest, "-c", "user.name=bench", "-c", "user.email=bench@local",
                     "commit", "-q", "-m", "bench: specimen baseline"]);

const sha256 = (p) => existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "";
const git = (cwd, ...a) => { try { return execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" }).trim(); } catch { return ""; } };

const configDir = resolveConfigDir();
const marketplaceDir = join(configDir, "plugins", "marketplaces", "agentic-sdlc");
const cacheDir = join(configDir, "plugins", "cache", "agentic-sdlc", "sdlc");

let pluginVersion = "";
try { pluginVersion = resolvePluginVersion(cacheDir); } catch (e) { die(e.message); }

writeManifest(dest, buildManifest({
  arm, run,
  plugin_version: pluginVersion,
  marketplace_sha: git(marketplaceDir, "rev-parse", "HEAD"),
  config_dir: configDir,
  task_sha256: sha256(resolve("bench/task.md")),
  answers_sha256: sha256(resolve("bench/answers.md")),
  inter_run_gap_seconds: gap,
  prepared_at: new Date().toISOString(),
}));

console.log(`prepared arm ${arm} run ${run}`);
console.log(`  scratch:  ${dest}`);
console.log(`  manifest: ${join(dest, MANIFEST_NAME)}`);
console.log(``);
console.log(`Next: launch Claude Code for arm ${arm}, then in ${dest} run:`);
console.log(`  /sdlc:start "$(cat ${resolve("bench/task.md")})"`);
console.log(`Answer any gates from bench/answers.md verbatim; anything not covered there: "proceed".`);
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test bench/test/manifest.test.mjs bench/test/prepare.test.mjs`
Expected: PASS — 16/16

Note: `plugin_version`, `marketplace_sha` and `config_dir` may be empty strings in the test environment, which is why the manifest test asserts the keys are **present**, not that they hold particular values. Divergence detection is Task 5's job.

PLAN DEFECT (implementer-found): `task_sha256`/`answers_sha256` hash `bench/task.md`/`bench/answers.md`,
which are Task 7 deliverables — they do not exist yet when Task 4 runs, so `sha256()` returns `""` for
both. The prepare test's "writes a complete manifest" case originally asserted all six fields non-empty,
which cannot hold before Task 7. Corrected to assert presence only for the five environment-dependent
fields (adding `task_sha256`/`answers_sha256` to the existing three); `prepared_at` has no external
dependency and keeps its non-empty assertion.

- [ ] **Step 9: Commit**

```bash
git add bench/lib/manifest.mjs bench/prepare.mjs bench/test/manifest.test.mjs bench/test/prepare.test.mjs
git commit -m "feat(bench): prepare.mjs — disposable git copy + provenance manifest"
```

---

### Task 5: `harvest.mjs` — validate, archive, store

**Files:**
- Create: `bench/harvest.mjs`
- Create: `bench/test/harvest.test.mjs`
- Create: `bench/test/fixtures/telemetry-transcript.json`
- Create: `bench/test/fixtures/telemetry-aggregate.json`
- Create: `bench/results/.gitkeep`, `bench/archive/.gitkeep`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `readManifest`, `diffManifest`, `MANIFEST_NAME` from Task 4.
- Produces: `bench/results/<arm>-<run>.json` with shape `{ manifest, telemetry, flags: string[], harvested_at }`. `flags` is empty for a clean run; `compare.mjs` (Task 6) excludes any result with a non-empty `flags`.

- [ ] **Step 1: Write the telemetry fixtures**

`bench/test/fixtures/telemetry-transcript.json` — a minimal but realistic two-phase run:

```json
{
  "task_slug": "bench-validation",
  "stack": "android",
  "cost_basis": "transcript",
  "total_input_tokens": 12000,
  "total_output_tokens": 8000,
  "total_cached_input_tokens": 900000,
  "total_cache_creation_tokens": 40000,
  "total_subagent_tokens": 20000,
  "total_cost_usd": 1.85,
  "wall_clock_seconds": 640,
  "phases": [
    { "phase": "development", "agent": "android-developer", "model": "claude-sonnet-5",
      "status": "completed", "usage_source": "transcript", "turns": 30,
      "input_tokens": 6000, "output_tokens": 5000, "cached_input_tokens": 600000,
      "cache_creation_tokens": 25000, "peak_prefix_tokens": 74000, "cost_usd": 1.2 },
    { "phase": "documentation", "agent": "android-docs", "model": "claude-haiku-4-5-20251001",
      "status": "completed", "usage_source": "transcript", "turns": 20,
      "input_tokens": 6000, "output_tokens": 3000, "cached_input_tokens": 300000,
      "cache_creation_tokens": 15000, "peak_prefix_tokens": 41000, "cost_usd": 0.65 }
  ]
}
```

`bench/test/fixtures/telemetry-aggregate.json` — identical, except `"cost_basis": "aggregate"` and every `peak_prefix_tokens` removed and `"usage_source": "subagent_aggregate"`. This is the shape harvest must reject.

- [ ] **Step 2: Write the failing harvest test**

`bench/test/harvest.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildManifest, writeManifest } from "../lib/manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const HARVEST = join(REPO, "bench", "harvest.mjs");

const manifestFields = (over = {}) => ({
  arm: "a", run: 1, plugin_version: "1.9.1", marketplace_sha: "9d1af30",
  config_dir: "/tmp/arm-a", task_sha256: "aaa", answers_sha256: "bbb",
  inter_run_gap_seconds: 60, prepared_at: "2026-07-25T12:00:00.000Z", ...over,
});

// Build a scratch tree that looks like a finished pipeline run.
function scratchRun(fixture, over = {}) {
  const root = mkdtempSync(join(tmpdir(), "scratch-"));
  const dest = join(root, `${over.arm ?? "a"}-${over.run ?? 1}`);
  mkdirSync(join(dest, "docs", "plans", "bench-validation"), { recursive: true });
  cpSync(join(HERE, "fixtures", fixture), join(dest, "docs", "plans", "bench-validation", "_telemetry.json"));
  writeManifest(dest, buildManifest(manifestFields(over)));
  return { root, dest };
}

function harvest(args, env = {}) {
  return execFileSync("node", [HARVEST, ...args], {
    cwd: REPO, encoding: "utf8", env: { ...process.env, BENCH_SKIP_LIVE_CHECK: "1", ...env },
  });
}

test("stores a result with the manifest and telemetry", () => {
  const { root } = scratchRun("telemetry-transcript.json");
  const out = mkdtempSync(join(tmpdir(), "results-"));
  harvest(["--arm", "a", "--run", "1", "--results", out], { BENCH_SCRATCH_ROOT: root });
  const r = JSON.parse(readFileSync(join(out, "a-1.json"), "utf8"));
  assert.equal(r.manifest.arm, "a");
  assert.equal(r.telemetry.total_cached_input_tokens, 900000);
  assert.deepEqual(r.flags, []);
});

test("rejects telemetry whose cost_basis is not transcript", () => {
  const { root } = scratchRun("telemetry-aggregate.json", { run: 2 });
  const out = mkdtempSync(join(tmpdir(), "results-"));
  assert.throws(
    () => harvest(["--arm", "a", "--run", "2", "--results", out], { BENCH_SCRATCH_ROOT: root }),
    (e) => /cost_basis/.test(e.stderr ?? "") && e.status !== 0,
  );
});

test("fails when no telemetry exists", () => {
  const root = mkdtempSync(join(tmpdir(), "scratch-"));
  mkdirSync(join(root, "a-3"), { recursive: true });
  writeManifest(join(root, "a-3"), buildManifest(manifestFields({ run: 3 })));
  const out = mkdtempSync(join(tmpdir(), "results-"));
  assert.throws(
    () => harvest(["--arm", "a", "--run", "3", "--results", out], { BENCH_SCRATCH_ROOT: root }),
    (e) => /_telemetry\.json/.test(e.stderr ?? "") && e.status !== 0,
  );
});

test("archives even when the harvest is rejected", () => {
  // The runs most worth inspecting are the ones that failed. Archiving must
  // happen before any check that can abort.
  const { root } = scratchRun("telemetry-aggregate.json", { run: 6 });
  const out = mkdtempSync(join(tmpdir(), "results-"));
  const arch = mkdtempSync(join(tmpdir(), "archive-"));
  assert.throws(
    () => harvest(["--arm", "a", "--run", "6", "--results", out, "--archive", arch], { BENCH_SCRATCH_ROOT: root }),
    (e) => e.status !== 0,
  );
  assert.ok(existsSync(join(arch, "a-6.tar.gz")), "a rejected run must still be archived");
});

test("archives the whole scratch tree", () => {
  const { root } = scratchRun("telemetry-transcript.json", { run: 4 });
  const out = mkdtempSync(join(tmpdir(), "results-"));
  const arch = mkdtempSync(join(tmpdir(), "archive-"));
  harvest(["--arm", "a", "--run", "4", "--results", out, "--archive", arch], { BENCH_SCRATCH_ROOT: root });
  assert.ok(existsSync(join(arch, "a-4.tar.gz")), "expected an archive tarball");
});

test("flags a run whose arm disagrees with its filename", () => {
  const { root } = scratchRun("telemetry-transcript.json", { arm: "a", run: 5 });
  // Corrupt the manifest so the recorded arm no longer matches the CLI arm.
  const dest = join(root, "a-5");
  const m = JSON.parse(readFileSync(join(dest, "_bench-manifest.json"), "utf8"));
  writeFileSync(join(dest, "_bench-manifest.json"), JSON.stringify({ ...m, arm: "b" }, null, 2));
  const out = mkdtempSync(join(tmpdir(), "results-"));
  assert.throws(
    () => harvest(["--arm", "a", "--run", "5", "--results", out], { BENCH_SCRATCH_ROOT: root }),
    (e) => /arm/.test(e.stderr ?? "") && e.status !== 0,
  );
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test bench/test/harvest.test.mjs`
Expected: FAIL — harvest.mjs does not exist.

- [ ] **Step 4: Write `harvest.mjs`**

```js
#!/usr/bin/env node
// Harvest one finished benchmark run: validate provenance recorded at prepare
// time against live state, reject telemetry that cannot answer the question,
// archive the scratch tree unconditionally, and store the result.
//
// The archive is unconditional on purpose: storage is far cheaper than a
// repeat run, and a run already paid for should never be discarded because
// someone judged its value prematurely.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { readManifest, diffManifest, buildManifest, resolveConfigDir, resolvePluginVersion } from "./lib/manifest.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const die = (msg) => { console.error(`harvest: ${msg}`); process.exit(1); };

const arm = arg("arm");
const run = Number(arg("run"));
const resultsDir = resolve(arg("results", "bench/results"));
const archiveDir = resolve(arg("archive", "bench/archive"));

if (arm !== "a" && arm !== "b") die(`--arm must be "a" or "b", got ${JSON.stringify(arm)}`);
if (!Number.isInteger(run) || run < 1) die(`--run must be a positive integer`);

const scratchRoot = process.env.BENCH_SCRATCH_ROOT || join(tmpdir(), "sdlc-bench");
const dest = join(scratchRoot, `${arm}-${run}`);
if (!existsSync(dest)) die(`scratch directory not found: ${dest}`);

// Archive FIRST, before any validation can abort. Storage is far cheaper than a
// repeat run, and the runs most worth inspecting are the ones that failed — an
// aborted pipeline leaves the scratch tree as the only forensic evidence there
// is. Archiving after the checks would discard exactly those.
mkdirSync(archiveDir, { recursive: true });
execFileSync("tar", ["-czf", join(archiveDir, `${arm}-${run}.tar.gz`), "-C", scratchRoot, `${arm}-${run}`]);

let manifest;
try { manifest = readManifest(dest); } catch (e) { die(e.message); }

if (manifest.arm !== arm) {
  die(`arm mismatch: directory says "${arm}" but the manifest recorded "${manifest.arm}". ` +
      `Provenance is untrustworthy for this run — do not include it.`);
}

// Cross-check the recorded provenance against live state. Divergence means the
// environment moved between prepare and harvest; neither value is preferred.
if (process.env.BENCH_SKIP_LIVE_CHECK !== "1") {
  const git = (cwd, ...a) => { try { return execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" }).trim(); } catch { return ""; } };
  // Resolved by the SAME helpers prepare.mjs used — if the two ever diverged,
  // every run would report a false provenance divergence.
  const configDir = resolveConfigDir();
  const cacheDir = join(configDir, "plugins", "cache", "agentic-sdlc", "sdlc");
  let pluginVersion = "";
  try { pluginVersion = resolvePluginVersion(cacheDir); } catch (e) { die(e.message); }
  const live = buildManifest({
    ...manifest,
    plugin_version: pluginVersion,
    marketplace_sha: git(join(configDir, "plugins", "marketplaces", "agentic-sdlc"), "rev-parse", "HEAD"),
    config_dir: configDir,
  });
  const divergence = diffManifest(manifest, live);
  if (divergence.length) {
    die(`provenance diverged between prepare and harvest:\n  ${divergence.join("\n  ")}\n` +
        `Neither value can be trusted for this run. Discard it and re-run.`);
  }
}

// Locate the single telemetry file the run produced.
const plansDir = join(dest, "docs", "plans");
const slugs = existsSync(plansDir)
  ? readdirSync(plansDir).filter((d) => statSync(join(plansDir, d)).isDirectory() && existsSync(join(plansDir, d, "_telemetry.json")))
  : [];
if (slugs.length !== 1) {
  die(`expected exactly one docs/plans/*/_telemetry.json under ${dest}, found ${slugs.length}`);
}
const telemetry = JSON.parse(readFileSync(join(plansDir, slugs[0], "_telemetry.json"), "utf8"));

if (telemetry.cost_basis !== "transcript") {
  die(`cost_basis is "${telemetry.cost_basis}", not "transcript". ` +
      `Aggregate telemetry has no meaningful peak_prefix_tokens; harvesting it would poison the median.`);
}

// A truncated run must not be indistinguishable from a clean one: a pipeline
// that aborted early records fewer phases rather than failed ones, so counting
// only non-completed phases would report flags: [] and let it into the median.
const flags = [];
const phases = telemetry.phases ?? [];
if (!phases.length) flags.push("no phases recorded");
if (!telemetry.completed_at) flags.push("no completed_at — run did not finish");
for (const p of phases) {
  if (p.status && p.status !== "completed") flags.push(`phase ${p.phase} status=${p.status}`);
}

mkdirSync(resultsDir, { recursive: true });
writeFileSync(
  join(resultsDir, `${arm}-${run}.json`),
  JSON.stringify({ manifest, telemetry, flags, harvested_at: new Date().toISOString() }, null, 2) + "\n",
);

console.log(`harvested arm ${arm} run ${run}${flags.length ? ` (FLAGGED: ${flags.join("; ")})` : ""}`);
console.log(`  result:  ${join(resultsDir, `${arm}-${run}.json`)}`);
console.log(`  archive: ${join(archiveDir, `${arm}-${run}.tar.gz`)}`);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test bench/test/harvest.test.mjs`
Expected: PASS — 6/6

- [ ] **Step 6: Add the directories and gitignore rule**

Create empty `bench/results/.gitkeep` and `bench/archive/.gitkeep`. Append to `.gitignore`:

```gitignore
# Benchmark run archives are large binaries; the JSON results beside them are the evidence and stay tracked.
bench/archive/*.tar.gz
```

- [ ] **Step 7: Run the whole harness suite**

Run: `node --test bench/test/*.test.mjs`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add bench/harvest.mjs bench/test/harvest.test.mjs bench/test/fixtures \
        bench/results/.gitkeep bench/archive/.gitkeep .gitignore
git commit -m "feat(bench): harvest.mjs — provenance cross-check, archive, store"
```

---

### Task 6: `compare.mjs` — medians, ranges, and a verdict that knows its own strength

**Files:**
- Create: `bench/compare.mjs`
- Create: `bench/test/compare.test.mjs`

**Interfaces:**
- Consumes: result files written by Task 5; `computeMetrics` from `plugins/sdlc/tools/aar/metrics.mjs`.
- Produces:
  - `export function median(xs: number[]): number`
  - `export function spread(xs: number[]): number` — `(max - min) / min`, `0` for fewer than two values
  - `export function runMetrics(result): { total_cache_read: number, peak_prefix: number, turns: number, cost_usd: number|null }`
  - `export function recommendN(observedSpread: number): { n: number|null, action: string }`
  - `export function verdict(armA, armB, noise): { moved: boolean|null, reason: string, delta: number|null }`
  - CLI: `node bench/compare.mjs [--results <dir>] [--pilot]`

- [ ] **Step 1: Write the failing test**

`bench/test/compare.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { median, spread, runMetrics, recommendN, verdict } from "../compare.mjs";

const result = (cacheRead, peak, flags = []) => ({
  manifest: { arm: "a", run: 1 },
  flags,
  telemetry: {
    task_slug: "t", cost_basis: "transcript",
    total_input_tokens: 0, total_output_tokens: 0,
    total_cached_input_tokens: cacheRead, total_cache_creation_tokens: 0,
    total_subagent_tokens: 0, total_cost_usd: 1.0,
    phases: [
      { phase: "development", usage_source: "transcript", turns: 10, peak_prefix_tokens: peak, cached_input_tokens: cacheRead },
      { phase: "documentation", usage_source: "transcript", turns: 5, peak_prefix_tokens: Math.round(peak / 2), cached_input_tokens: 0 },
    ],
  },
});

test("median of an odd count is the middle value", () => {
  assert.equal(median([3, 1, 2]), 2);
});

test("median of an even count averages the two middle values", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("spread is the range over the minimum", () => {
  assert.equal(spread([100, 110]), 0.1);
  assert.equal(spread([100]), 0);
  assert.equal(spread([]), 0);
});

test("runMetrics takes the sum for cache-read and the max for peak", () => {
  const m = runMetrics(result(900000, 74000));
  assert.equal(m.total_cache_read, 900000);
  assert.equal(m.peak_prefix, 74000);   // max across phases, not the last one
  assert.equal(m.turns, 15);
});

test("recommendN maps spread to N at the documented boundaries", () => {
  assert.equal(recommendN(0.09).n, 3);
  assert.equal(recommendN(0.10).n, 4);
  assert.equal(recommendN(0.24).n, 4);
  assert.equal(recommendN(0.25).n, null);
  assert.match(recommendN(0.25).action, /enlarge/i);
  assert.doesNotMatch(recommendN(0.25).action, /shrink/i);
});

test("no verdict below three runs per arm", () => {
  const v = verdict([1, 2], [3, 4, 5], 0.05);
  assert.equal(v.moved, null);
  assert.match(v.reason, /at least 3/);
});

test("no verdict when the difference is inside the noise", () => {
  const v = verdict([100, 100, 100], [96, 96, 96], 0.20);
  assert.equal(v.moved, false);
  assert.match(v.reason, /no measurable effect/i);
});

test("a difference larger than the noise counts as movement", () => {
  const v = verdict([100, 100, 100], [50, 50, 50], 0.10);
  assert.equal(v.moved, true);
  assert.equal(v.delta, -0.5);
});

test("verdict language never claims statistical significance", () => {
  const all = [verdict([1,2], [3,4,5], 0.05), verdict([100,100,100],[96,96,96],0.2), verdict([100,100,100],[50,50,50],0.1)];
  for (const v of all) {
    assert.doesNotMatch(v.reason, /significant|p\s*[<=]|p-value/i);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test bench/test/compare.test.mjs`
Expected: FAIL — `Cannot find module '../compare.mjs'`

- [ ] **Step 3: Write `compare.mjs`**

```js
#!/usr/bin/env node
// Compare the two benchmark arms.
//
// Reports medians, ranges and a labelled engineering verdict — never a
// p-value. At N=3 per arm the smallest achievable two-sided p from an exact
// rank test is about 0.10; at N=4 about 0.03 and only under perfect
// separation. No result at this budget can reach p<0.05, whatever the data
// show, so claiming significance would be false precision.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeMetrics } from "../plugins/sdlc/tools/aar/metrics.mjs";

export function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function spread(xs) {
  if (xs.length < 2) return 0;
  const min = Math.min(...xs);
  return min === 0 ? 0 : (Math.max(...xs) - min) / min;
}

/** Per-run metrics: a sum for cost, a max for the DoD figure. */
export function runMetrics(result) {
  const m = computeMetrics(result.telemetry);
  return {
    total_cache_read: m.totals.cached_input_tokens,
    peak_prefix: Math.max(0, ...m.by_phase.map((p) => p.peak_prefix_tokens)),
    turns: m.by_phase.reduce((n, p) => n + p.turns, 0),
    cost_usd: m.totals.cost_usd,
  };
}

/**
 * Map an observed within-arm spread to a run count.
 * The spread is a LOWER BOUND — two observations give one range from an
 * unknown distribution — so these are the minimum defensible response, not a
 * measurement of the true spread.
 */
export function recommendN(observedSpread) {
  if (observedSpread < 0.10) return { n: 3, action: "proceed with N=3 per arm" };
  if (observedSpread < 0.25) return { n: 4, action: "proceed with N=4 per arm" };
  return {
    n: null,
    action: "STOP. Remediate before continuing: raise N, pin model tiers, or enlarge the task. " +
            "Never reduce the task — that shrinks the effect along with the noise.",
  };
}

/** Engineering verdict. `moved: null` means no verdict is available. */
export function verdict(armA, armB, noise) {
  if (armA.length < 3 || armB.length < 3) {
    return { moved: null, delta: null, reason: `no verdict: need at least 3 unflagged runs per arm, have ${armA.length} and ${armB.length}` };
  }
  const a = median(armA), b = median(armB);
  const delta = a === 0 ? 0 : (b - a) / a;
  if (Math.abs(delta) <= noise) {
    return { moved: false, delta, reason: `no measurable effect at this task size: the ${(delta * 100).toFixed(1)}% difference is within the observed ${(noise * 100).toFixed(1)}% run-to-run spread` };
  }
  return { moved: true, delta, reason: `arms differ by ${(delta * 100).toFixed(1)}%, beyond the observed ${(noise * 100).toFixed(1)}% run-to-run spread` };
}

function loadResults(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

function main() {
  const i = process.argv.indexOf("--results");
  const dir = resolve(i === -1 ? "bench/results" : process.argv[i + 1]);
  const pilot = process.argv.includes("--pilot");

  const all = loadResults(dir);
  const dropped = all.filter((r) => r.flags?.length);
  const clean = all.filter((r) => !r.flags?.length);
  const byArm = { a: [], b: [] };
  for (const r of clean) byArm[r.manifest.arm]?.push(r);

  const metricsOf = (rs) => rs.map(runMetrics);
  const A = metricsOf(byArm.a), B = metricsOf(byArm.b);

  if (dropped.length) console.log(`dropped ${dropped.length} flagged run(s): ${dropped.map((r) => `${r.manifest.arm}-${r.manifest.run}`).join(", ")}`);

  for (const [name, rs] of [["a", A], ["b", B]]) {
    if (!rs.length) { console.log(`arm ${name}: no clean runs`); continue; }
    const cr = rs.map((m) => m.total_cache_read), pk = rs.map((m) => m.peak_prefix);
    console.log(`arm ${name}  n=${rs.length}`);
    console.log(`  cache-read  median ${median(cr).toLocaleString()}  range ${Math.min(...cr).toLocaleString()}..${Math.max(...cr).toLocaleString()}  spread ${(spread(cr) * 100).toFixed(1)}%`);
    console.log(`  peak-prefix median ${median(pk).toLocaleString()}  range ${Math.min(...pk).toLocaleString()}..${Math.max(...pk).toLocaleString()}`);
    console.log(`  turns       median ${median(rs.map((m) => m.turns))}`);
  }

  const noise = Math.max(spread(A.map((m) => m.total_cache_read)), spread(B.map((m) => m.total_cache_read)));

  if (pilot) {
    const rec = recommendN(spread(A.map((m) => m.total_cache_read)));
    console.log(`\npilot: observed arm-a spread ${(spread(A.map((m) => m.total_cache_read)) * 100).toFixed(1)}% (a LOWER BOUND, not a point estimate)`);
    console.log(`       ${rec.action}`);
    return;
  }

  const v = verdict(A.map((m) => m.total_cache_read), B.map((m) => m.total_cache_read), noise);
  console.log(`\nverdict (engineering judgement, not a statistical test): ${v.reason}`);
  const pkB = B.map((m) => m.peak_prefix);
  if (pkB.length) console.log(`E2 DoD (<60k peak prefix): arm b median ${median(pkB).toLocaleString()}, range ${Math.min(...pkB).toLocaleString()}..${Math.max(...pkB).toLocaleString()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test bench/test/compare.test.mjs`
Expected: PASS — 9/9

- [ ] **Step 5: Run the whole harness suite**

Run: `node --test bench/test/*.test.mjs`
Expected: PASS.

- [ ] **Step 6: Confirm CI is unaffected**

Run: `node tools/sdlc-lint/cli.mjs all`
Expected: exit 0. The harness tests are deliberately not part of this gate; confirm nothing under `bench/` was picked up by it.

- [ ] **Step 7: Commit**

```bash
git add bench/compare.mjs bench/test/compare.test.mjs
git commit -m "feat(bench): compare.mjs — medians, spread, labelled verdict"
```

---

### Task 7: The runbook, the brief, and the scripted human

Everything a person needs open while spending money, in one file — plus the two inputs that must be byte-identical across every run.

**Files:**
- Create: `bench/task.md`
- Create: `bench/answers.md`
- Modify: `bench/README.md` (Task 1 wrote its Step 0 section; this adds the rest)
- Modify: `.brain/planning/backlog.md`

**Interfaces:**
- Consumes: the arm-switch procedure from Task 1; the three CLIs from Tasks 4-6.
- Produces: no code interface.

- [ ] **Step 1: Write `bench/task.md`**

Exactly this, and nothing else — it is hashed into every manifest, so any edit invalidates comparability with earlier runs:

```markdown
Add input validation to the `CreateOrder` use case. Reject an empty customer id, a non-positive
quantity on any order line, and a product id that does not exist in `ProductRepository`. Surface
each failure as a `ValidationError` through the existing `Result` type rather than throwing.
Follow the existing test conventions.
```

- [ ] **Step 2: Write `bench/answers.md`**

The human is a variance source too. Script the responses:

```markdown
# Scripted responses

Answer approval gates and clarifying questions with these verbatim. Anything not covered here:
answer with the single word `proceed`, and note the deviation in the run's report.

- Approval to proceed after any phase: `proceed`
- "Should validation happen in the use case or the model?": `In the use case. The models stay dumb data holders.`
- "Should an empty line list be rejected?": `Yes, treat an empty line list as a validation failure.`
- "Which error type should carry the field name?": `ValidationError, with the offending field name.`
- "Should I add integration tests?": `Unit tests only, following the existing conventions.`
- "Should I update the README?": `No. Code and tests only.`
```

- [ ] **Step 3: Write the rest of `bench/README.md`**

Add, after the Step 0 section Task 1 wrote:

- **Step 0.5 — power check.** `node -e "import('./bench/lib/corpus.mjs').then(m=>console.log(m.corpusStats('bench/reference-app')))"` must report `ok: true`. Pre-warm Gradle by running `./gradlew test` once in a throwaway copy so run 1 does not pay for a distribution download.
- **The run loop**, verbatim:

```bash
node bench/prepare.mjs --arm a --run 1 --gap <seconds>
# launch Claude Code for arm a (per Step 0), cd to the printed scratch dir,
# run the printed /sdlc:start command, answer gates from bench/answers.md
node bench/harvest.mjs --arm a --run 1
```

- **Run order**: `A B A` for the pilot, then interleaved `B A B …` to N. Never all of one arm then all of the other — any factor that varies with time would otherwise correlate perfectly with arm.
- **After the pilot**: `node bench/compare.mjs --pilot` and follow its recommendation.
- **After N per arm**: `node bench/compare.mjs`.
- **The inter-run gap** is chosen once in Step 0 and applied identically to every run; record it and pass the same `--gap` every time.
- **What the output is and is not**: medians, ranges and an engineering verdict. Not a statistical result — at these run counts none is reachable.

- [ ] **Step 4: Record the harness in the vault backlog**

In `.brain/planning/backlog.md`, in the Track E section, add a short paragraph: the benchmark harness lives in `bench/`, it is the instrument that closes E2's deferred behavioural DoD, and E1/E3/E4 use the same instrument. Note that its numbers measure a **delta between arms** and are not comparable to the 101k figure from the downstream application.

Do not touch `.brain/changes/` (machine-owned) and do not add a PR reference (none exists yet).

- [ ] **Step 5: Verify everything is green**

```bash
node --test bench/test/*.test.mjs
node tools/sdlc-lint/cli.mjs all
node tools/brain-sync/cli.mjs check --vault .brain
```

Expected: harness suite green; `all` exit 0; brain-sync clean.

- [ ] **Step 6: Commit**

```bash
git add bench/task.md bench/answers.md bench/README.md .brain/planning/backlog.md
git commit -m "docs(bench): runbook, reference task, scripted answers"
```

---

## Done criteria

- `node --test bench/test/*.test.mjs` green.
- `node tools/sdlc-lint/cli.mjs all` exit 0 — the harness has not touched the CI gate.
- `node tools/brain-sync/cli.mjs check --vault .brain` clean.
- `cd bench/reference-app && ./gradlew test` green.
- `corpusStats('bench/reference-app')` reports `ok: true`, `tokens >= 63000`, and at least 45 files (67 as built).
- Task 1's arm-isolation procedure is written down in `bench/README.md` and was **verified**, not assumed.

**Explicitly NOT part of this plan:** running the benchmark. This plan builds the instrument. Spending money on runs is a separate decision, taken after Step 0 and the power check confirm the instrument can answer the question.
