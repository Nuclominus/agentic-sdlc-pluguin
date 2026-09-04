---
adr: 20
status: accepted
date: 2026-09-04
supersedes: null
---

# ADR-0020 — Diagnostic logging lives in a development artifact, not behind a runtime flag

## Context

`plugins/android-foundation/rules/logging.md` shipped as "Logging Hygiene", and its premise was
that a log statement is **not code**: logs were "a temporary debugging aid, not a feature", agents
could add them freely during a session, and the rule's operative section was a cleanup checklist —
`git diff develop...HEAD`, delete every `Logger.` / `Log.` / `println(` / `printStackTrace(` line
added, re-run `ktlintCheck`, and only then claim Done. `android-reviewer` was told to reject any
diff that introduced a non-test log statement.

That premise fails in three ways.

**It makes tracing disposable.** The diagnostics an agent builds while understanding a component
are the diagnostics the next agent needs when the same component breaks. A rule whose only verb is
"delete" guarantees that every investigation starts from zero, and that the most valuable artifact
of a debugging session — a working trace of the call flow — is the one thing required to be thrown
away before the work can be called finished.

**It pushes guards into business logic.** If the only two states are "log present" and "log
deleted", anything worth keeping has to earn its place inside production code, and it earns it by
growing an `if (isDebugBuild)` around itself. The guard is noise at the call site, it is invisible
to the facade that already knows the build type, and it puts a build-configuration concern in the
middle of a domain method.

**It is unenforceable where it matters and redundant where it does not.** The blocking part —
`println`, `android.util.Log.*`, `.printStackTrace()` in production Kotlin — is already enforced
mechanically by the `validate-kotlin.sh` PostToolUse hook and restated in
`rules/snippets/non-negotiable.md`. What the rule uniquely owned, "remove the rest before Done",
is a prose instruction with no check behind it, of exactly the kind ADR-0015 and the
`machine-values` linter exist to distrust.

The real question was never *whether* a log line may exist. It is *which artifact it is compiled
into*.

## Decision

The rule is rewritten around **separation, not deletion**. Diagnostic logging exists for
developers, not for users; the test a shipped log line must pass is "would I want a user's device
doing this work?"

**1. Compile-time separation is the preferred mechanism.** Tracing a component means writing a
`Development<Type>` decorator in the development source set — delegating (`: Foo by delegate`),
overriding only the methods worth tracing — and binding it by DI in the debug variant while the
release variant binds the implementation directly. The diagnostic code is not compiled into the
release artifact at all, so there is nothing to strip and nothing to guard.

**2. A runtime severity gate is the baseline.** For a diagnostic with no seam to decorate, the
facade decides what survives: in release builds only `ERROR` and above reaches a sink, and message
construction must be lazy (`logger.d { "state=$state" }`, never a pre-built string). Hand-rolled
`if (isDebugBuild)` guards inside business logic are explicitly forbidden — the facade already does
this.

**3. A configuration-point flag is the narrow exception.** Where there is no object of ours to
decorate — a third-party component whose verbosity is a level knob — the level is set once, at the
single configuration point, from the build flag.

**4. The decorator carries logging and nothing else.** No behaviour, no state, no retries, no
caching, no swallowed errors. This is the pattern's one hard constraint: a decorator that changes
behaviour produces "works in debug, fails in production" bugs that are, by construction,
undebuggable.

**5. The axis is build type, not flavor.** Keying the substitution on debug/release rather than
staging/production keeps a production-configured debug build from silently losing its diagnostics,
and a development-configured release build from shipping them.

## Consequences

- **`ERROR` ships to production.** It is the one level that survives the gate, so it is reserved
  for real, actionable failures. Flow tracing is `DEBUG`; lifecycle milestones are `INFO`.
- **A DI provider must exist in every variant source set** — same package, same class name, same
  signature. A provider present in only one breaks the other variant's dependency graph at compile
  time, and that break is invisible until that variant is actually built. The review checklist
  therefore requires verification against **both** a debug and a release variant; a debug-only
  build cannot see a release-source-set gap.
- **The seam must be a public interface** while the implementation stays internal, so the
  development source set can wrap it. That is a visibility constraint someone will otherwise
  "tighten" later and break the debug build, so the rule requires stating the reason in a doc
  comment on the interface.
- **The pre-Done cleanup sweep is gone**, along with the reviewer's mandate to reject any non-test
  log statement. Neither is a loss of enforcement: the forbidden constructs are still blocked by
  `hooks/validate-kotlin.sh` and `rules/snippets/non-negotiable.md`, and the test-source exemption
  still lives in `rules/testing.md`, which the rewritten rule now cross-references so an agent
  reading "one facade only" does not read it as a ban in test sources.
- **The rule's audience widens** from `[developer, reviewer]` to
  `[developer, reviewer, debugger, tester, security-scanner]`. `debugger` adds tracing and must add
  it in the right place; `tester` needs the exemption boundary; `security-scanner` owns the "never
  log PII or secrets" content rule. `rules/INDEX.md` is updated in step, since it is the declared
  source the frontmatter repeats.
- **`rules/workflow.md` no longer contradicts the rule it links to.** Its General Rules bullet said
  "Debug logs are session-only. Remove before Done." and pointed straight at `logging.md`; it now
  states the separation principle instead.
- The rule stays **library-neutral**. It names no logging facade, so it holds for a hand-rolled
  facade, a third-party library, or a platform log call, and a foundation may substitute the API
  its project actually uses without touching the doctrine.

## Related
- Implemented by: #135
- Relates to: [[decisions/ADR-0015-the-machine-value-invariant]] / [[decisions/ADR-0018-reviewers-do-not-write-code]]
