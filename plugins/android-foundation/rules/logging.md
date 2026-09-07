---
loaded_by: [developer, reviewer, debugger, tester, security-analyst]
load_when: "developer: before writing a log line. reviewer/security-analyst: during review. debugger: when adding tracing. tester: for the test-source exemption."
---

# Logging — separating development and release code

Scope: every agent that writes or reviews code.

This rule is about **where diagnostic code lives**, not about which logging library
is used. It applies identically to a hand-rolled facade, a third-party logging
library, or a platform log call. Whatever the sink, the separation strategy is the
same.

## Principle

Diagnostic logging exists for developers, not for users. Therefore:

> **Verbose diagnostics belong in a development-only artifact, not behind a runtime
> flag inside production code.**

Two levels of separation, in order of preference:

1. **Compile-time separation (preferred)** — the diagnostic code is not compiled
   into the release artifact at all.
2. **Runtime severity gate (baseline)** — the logging facade drops everything below
   `ERROR` in release builds, and message construction is lazy so a dropped call
   costs nothing.

Every log line that ships must survive one question: *would I want a user's device
doing this work?* If not, it belongs at level 1.

## 1. Compile-time separation — the `Development*` decorator

The default pattern for tracing a component. Production code stays free of
tracing; a development-only decorator wraps it and is substituted by dependency
injection.

```
<module>/src/main/…/Foo.kt              # public interface — the seam
<module>/src/main/…/FooImpl.kt          # real implementation, no tracing
<module>/src/debug/…/DevelopmentFoo.kt  # tracing decorator — debug builds only
<module>/src/debug/…/di/FooModule.kt    # binds DevelopmentFoo(impl)
<module>/src/release/…/di/FooModule.kt  # binds impl directly
```

```kotlin
// development source set — never compiled into a release artifact
internal class DevelopmentFoo(private val delegate: Foo) : Foo by delegate {

    private val logger = /* the project's logging facade */

    override suspend fun doThing(id: String): Result<Unit> {
        logger.d { "doThing($id): started" }
        val result = delegate.doThing(id)
        logger.d { "doThing($id): finished, success=${result.isSuccess}" }
        return result
    }
}
```

```kotlin
// debug source set                       // release source set
fun provideFoo(impl: FooImpl): Foo        fun provideFoo(impl: FooImpl): Foo
    = DevelopmentFoo(impl)                    = impl
```

Rules:

1. **Name it `Development<Type>`** and place it in the development source set.
2. **Delegate, don't subclass.** Use language-level delegation (`: Foo by delegate`)
   and override only the methods worth tracing. The decorator stays short.
3. **The DI provider must exist in every variant source set** — same package, same
   class name, same provider signature. A provider present in only one source set
   breaks the other variant's dependency graph at compile time, and that break is
   invisible until that variant is actually built.
4. **The seam must be a public interface.** The implementation and its collaborators
   stay internal; only the interface is public, so the development source set can
   wrap it. State that reason in a doc comment on the interface, or someone will
   tighten the visibility later and break the debug build.
5. **Logging only.** No behaviour, no state, no retries, no caching, no swallowed
   errors. A decorator that changes behaviour produces "works in debug, fails in
   production" bugs that are, by construction, undebuggable. This is the one hard
   constraint of the pattern.
6. **Key on the build-type axis** (debug vs release), not the environment/flavor
   axis (staging vs production endpoints, feature switches). Mixing the two means a
   production-configured debug build silently loses its diagnostics, or a
   development-configured release build ships them.

## 2. Runtime severity gate — the baseline

For diagnostics that must sit inside production code — a branch with no seam to
decorate, an error path, a state transition worth one line:

- The facade decides what survives. In release builds only **`ERROR` and above**
  reach a sink.
- **Message construction must be lazy.** Pass a lambda/closure, never a pre-built
  string: `logger.d { "state=$state" }`, not `logger.d("state=$state")`. Eager
  construction pays the cost even when the line is discarded — a review blocker.
- Consequence: **`ERROR` ships to production.** Reserve it for real, actionable
  failures. Flow tracing is `DEBUG`; lifecycle milestones are `INFO`.

Do **not** hand-roll `if (isDebugBuild) logger.d { … }` inside business logic. The
facade already does this, and the guard only obscures the call site.

## 3. Configuration-point flag — the narrow exception

When there is no object of ours to decorate — typically a third-party component
whose verbosity is a level knob — set that level once, at the single configuration
point, from the build flag:

```kotlin
thirdPartyLogging.setLevel(if (isDebugBuild) Level.VERBOSE else Level.NONE)
```

Acceptable because it is one line, in configuration, not in logic.

## 4. Choosing the mechanism

| Need | Do this |
|---|---|
| Trace calls in and out of a component | `Development*` decorator in the development source set (§1) |
| One-off diagnostic inside an implementation | Lazy `debug` log in production code — the facade drops it in release (§2) |
| Genuine failure worth seeing in production | `error` log carrying the throwable (§2) |
| Third-party library verbosity | Build flag at the single configuration point (§3) |

## 5. Content rules (independent of mechanism)

- **Never log PII or secrets**: message bodies, credentials, tokens, session ids,
  emails, phone numbers, connection credentials. Log identifiers, counts, states and
  booleans instead — `id=$id`, `success=${result.isSuccess}`, `count=${xs.size}`.
- **Tag = the class**, derived automatically where the facade supports it. Use an
  explicit tag only for a subsystem that spans classes.
- **Decorator message shape**: `"method(args): started"` / `"method(args): finished, <outcome>"`.
  Consistency is what makes a trace greppable.
- **No logging in hot paths** — tight loops, per-frame UI recomposition, high-rate
  stream callbacks. If tracing is needed there, it belongs in a decorator (§1),
  never in production code.
- **Never log-and-swallow.** A caught throwable is logged *and* handled or
  propagated.
- **One facade only.** Direct platform log calls, `println`, or a second logging
  library bypass every gate above.
- **Test sources are exempt.** `println` and platform log calls in `src/test/`,
  `src/androidTest/`, `*Test.kt`, `*Spec.kt` and Maestro flows are allowed and are not
  subject to the rules above — see the `android-foundation:android-testing` skill
  § Test source exemptions.

## 6. Review checklist

- [ ] No direct platform log / `println` / second logging library outside the facade.
- [ ] All messages lazily constructed; no eager string building.
- [ ] `ERROR` used only for real failures — it ships to production.
- [ ] Any new `Development*` decorator lives in the development source set and adds
      no behaviour.
- [ ] A matching DI provider exists in **every** variant source set, same signature.
- [ ] The wrapped seam is a public interface, with a comment saying why.
- [ ] No PII or secrets in any message.
- [ ] No logging added to a hot path.
- [ ] Verified against **both** a debug and a release variant build — a
      release-source-set DI gap is invisible to a debug-only build.

Most of this list is checked mechanically at publish time: the `git-guard` PreToolUse hook blocks
`git commit`, `git push` and `gh pr create` on Tier 1 constructs, eager construction, hand-rolled
debug guards, decorator placement, and a `src/debug/**` DI provider with no release counterpart.
It **reports only** — it never edits code, because the fix for a misplaced trace is a refactor.
PII, hot paths and "adds no behaviour" stay human review. See `enforcement.md`.
