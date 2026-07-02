---
loaded_by: [developer, reviewer, debugger]
load_when: "android-developer / android-debugger: before claiming Done (cleanup). android-reviewer: during review (enforcement)."
---

# Logging & Comment Hygiene

Work by these rules. No exceptions. Both logs (below) and comments (§ Comment Hygiene at the
end) are **session debris** — helpful while working, but they must not reach the final diff.

# Logging Hygiene

## Purpose

Logs (`Kermit`, `android.util.Log.*`, `println`, `printStackTrace`) are a **temporary debugging aid**, not a feature. They must never reach the final diff.

## Allowed During a Session

While investigating a bug or verifying behaviour, agents may freely add:
- `Logger.d/e/i/v(...)` (Kermit)
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

---

# Comment Hygiene

Comments are **not** a substitute for readable code, and session-scaffolding comments are debris.
The final diff must contain only comments that carry durable value.

## Forbidden in the final diff (non-test sources)

- **Commented-out code** — dead code belongs in git history, not the source.
- **Narration / restatement** — comments that describe *what* the next line obviously does
  (`// increment counter`, `// return the result`, `// loop over items`).
- **Process / provenance chatter** — anything referencing the agent, the plan, or the task
  workflow: `// AI:`, `// generated`, `// added per plan`, `// as requested`, `// Claude`,
  `// step 2 of the plan`, and similar. These leak the authoring process into the codebase.
- **Scaffolding TODOs left unresolved** — a `// TODO` that marks work the task was supposed
  to finish. A TODO is allowed ONLY when it references a tracked ticket and represents
  deliberately deferred scope (`// TODO(CRF-42): …`).

## Allowed — keep these

- **KDoc** on public APIs (classes, public functions/properties) — see `android-docs` KDoc standard.
- **"Why" comments** — a short note explaining a non-obvious decision, workaround, or constraint
  that the code itself cannot express (e.g. why an unusual order or cast is required).

## Rule of thumb

If a comment explains *what* the code does, delete it and let the code speak. If it explains
*why* — and the "why" is non-obvious — keep it. If it mentions the AI, the plan, or the task,
delete it.

## Self-Check (android-developer, before Done)

- [ ] No commented-out code in the diff (non-test sources).
- [ ] No narration/restatement comments; no `// AI` / `// generated` / `// per plan` provenance chatter.
- [ ] Every remaining `// TODO` references a tracked ticket; no scaffolding TODOs.

## android-reviewer Enforcement

The `reviewer` agent **must flag** (and, for provenance chatter or commented-out code, reject)
any non-test diff that introduces the forbidden comment categories above.
