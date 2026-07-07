---
loaded_by: [developer, reviewer]
load_when: "android-developer: before claiming Done (cleanup). android-reviewer: during review (enforcement)."
---

# Logging Hygiene

Work by these rules. No exceptions.

## Purpose

Logs (the project's logging facade — e.g. Kermit's `Logger` — plus `android.util.Log.*`, `println`, `printStackTrace`) are a **temporary debugging aid**, not a feature. They must never reach the final diff.

> **Logger is project-detected.** Kermit is named below only as the common default. Detect the logging library the project actually uses (grep the codebase / version catalog) and substitute its API; a foundation may override this reference. If the project has no logging library, drop the `Logger`-specific rows entirely.

## Allowed During a Session

While investigating a bug or verifying behaviour, agents may freely add:
- `Logger.d/e/i/v(...)` (the project's logging facade, e.g. Kermit)
- `Log.d/e/i/v/w(...)`
- `println(...)`
- `e.printStackTrace()`

## Mandatory Cleanup Before Completion

Before marking any task `Done` (PR, "task complete" message), the agent **MUST**:

1. Run `git diff develop...HEAD -- 'app/**' 'feature/**/src/main/**' 'build-logic/**'` and remove every log statement added during the session.
2. Confirm no new `Logger.`, `Log.`, `println(`, or `printStackTrace(` lines remain in the diff for non-test sources.
3. Re-run `./gradlew ktlintCheck` and the relevant unit test target to confirm the cleanup didn't break anything.

### Self-Check Checklist

- [ ] Diff contains no new `Logger.` / `Log.` / `println(` / `printStackTrace(` outside test sources.
- [ ] `./gradlew ktlintCheck` passes.
- [ ] Any remaining log calls are inside test sources only (see exception below).

## Exception — Tests

Log and `println` calls inside the following locations **may stay** if they are part of the test's assertion or diagnostic output:

- `src/test/**`
- `src/androidTest/**`
- Files matching `*Test.kt` or `*Spec.kt`
- Maestro flow files

All other sources are subject to the cleanup rule above.

## android-reviewer Enforcement

The `reviewer` agent **must reject** (move card back to `In Progress`) any diff that introduces non-test log statements in `app/`, `feature/*/src/main/`, or `build-logic/` source sets. No exceptions.
