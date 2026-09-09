---
name: android-review
description: Android code-review dimensions — Kotlin correctness, layering, Compose patterns and testTags, navigation, design system, DI, persistence/logging, performance, and vault freshness. Invoke before reviewing a diff in an Android (Kotlin) project.
---

# android-review

The Android-specific dimensions of a code review. Severity levels, the report shape, and the
review-loop cap belong to the core `reviewer` agent; this skill supplies what to look **for** in a
Kotlin / Gradle / `:feature:<name>` codebase.

Detect the project's stack (UI toolkit, DI framework, navigation approach) first and review against
*its* conventions, not an assumed one. **Security is not a review dimension here** — it belongs to
the security phase. If you spot an obvious security issue, note it as "Possible security concern —
see the security phase" without deep analysis.

## Knowledge sourcing — before any finding

`Read` from the vault to verify the diff respects documented invariants:

- `.obsidian-vault/architecture/dependency-graph.md` (generated module graph) plus
  `.obsidian-vault/architecture/` (layering, DDD, ADRs)
- `.obsidian-vault/modules/<module>.md` for each affected module, following its
  `depends_on` / `screens` / `flows` edges
- `.obsidian-vault/navigation/routes.md` for route changes

When the vault is absent, review against the codebase's own established patterns.

## Review dimensions

### 1. Correctness
- Logic errors, off-by-one, null handling.
- Coroutine scope misuse (leaks, wrong dispatcher).
- `!!` usage.
- `Flow` not properly collected/cancelled.
- Missing error handling in suspend functions.

### 2. Architecture & layering
- UI → feature (domain) → data/infra direction respected; no upward imports.
- Repositories inside the owning module; interface + impl co-located; impl `internal`.
- No business logic in composables.
- No cross-module domain leakage; shared primitives in the model module.
- DI modules installed in the correct component/scope; bindings `internal`.

### 3. Kotlin conventions
- `var` in State / data classes → must be `val`.
- `!!` anywhere.
- `runBlocking` / `GlobalScope` in production code.
- Missing `private` / `internal` on non-public API surface.
- Magic strings instead of sealed types / enums.

### 4. UI patterns (if the project uses Compose)
- Screen split: stateful wrapper → stateless Content.
- No suspend calls in composable bodies.
- `collectAsStateWithLifecycle()` — not raw `collectAsState`.
- `remember` / `rememberSaveable` / `derivedStateOf` used correctly.
- Stable / `@Immutable` composable params.
- `DisposableEffect` cleans up subscriptions.
- **testTags**: every non-decorative component (interactive, asserted, scrollable + its items,
  screen root, dialogs) carries a `testTag` from the central `TestTag` object — no inline
  `testTag("literal")`, no localized text as a selector. Exemptions are limited to decoration
  (Divider, Spacer, guidelines, decorative Icon/Image). New or changed tags are reflected in
  `.obsidian-vault/architecture/ui-patterns.md`. Convention: the `android-compose-ui` skill
  § Test tags.

For a non-Compose UI, review against the project's own UI conventions instead.

### 5. Navigation
- Routes follow the project's convention (e.g. type-safe `@Serializable` types — no string routes).
- Navigation side effects follow the project pattern (one-shot effect/event channel, or a
  callback-based approach), consistently across the codebase.

### 6. Design system & theming
- Colors / typography / shapes come from the theme.
- No hardcoded colors, raw sp, or literal dp beyond spacing primitives.
- Images via the project's image-loading library with placeholder + error + contentDescription.

### 7. DI
- ViewModels obtained via the project's DI framework with constructor injection.
- Dispatcher qualifiers used for IO/CPU work.
- No manual ViewModel instantiation.

### 8. Persistence & logging
- Sensitive data in the project's secure persistence — no raw `SharedPreferences`.
- The project's logging library — no `android.util.Log` / `println`.
- Sensitive data never logged.

### 9. Performance
- IO/CPU work off the Main dispatcher.
- Lazy lists use a stable `key = { … }`.
- No unstable parameters that defeat recomposition skipping.
- Long-running subscriptions cancelled on teardown.

### 10. Test coverage
- ViewModels / stores tested via the appropriate test harness.
- Error paths covered.

### 11. Vault freshness (`.obsidian-vault/`)
- New `:feature:<name>` module → `.obsidian-vault/modules/<module>.md` exists and is filled (no
  `<!-- STUB -->` marker). The Dataview MOCs index it automatically — no manual bullet to check.
- New `@Composable` screen or `@Serializable` route → `.obsidian-vault/screens/<Name>.md` filled
  with `route:` set; `.obsidian-vault/navigation/routes.md` updated.
- Changed public Repository / ViewModel interface → the corresponding
  `.obsidian-vault/modules/<module>.md` Public API section updated.
- **Typed edges** — `depends_on` / `screens` / `flows` / `adrs` are path-qualified wikilinks that
  resolve; `depends_on:` agrees with its `## Dependencies` / `## Modules involved` prose mirror.
- **Generated graph** — a changed `depends_on:` edge is reflected in
  `architecture/dependency-graph.md` (the docs phase re-ran `gen-mermaid.mjs`).
- **Validator** — `node .claude/scripts/validate-docs.mjs` must be clean, or each finding escalated.
  A layer violation rewritten to a false edge to make it pass is a **hard reject**: the data stays
  faithful (raise an ADR or fix the code instead).
- Any `<!-- STUB -->` marker remaining in a changed note → reject the diff.
- Violation severity: **important** — return the diff with the note "Update `.obsidian-vault/`
  before re-review".

## Android review checklist

- [ ] No `!!` operator
- [ ] State uses `val` only
- [ ] No suspend calls in composables (if Compose)
- [ ] `collectAsStateWithLifecycle()` used (if Compose)
- [ ] Stable / `@Immutable` composable params (if Compose)
- [ ] Non-decorative Compose components carry a `testTag` from `TestTag` (no inline literals);
      `ui-patterns.md` updated (if Compose)
- [ ] Navigation routes follow the project's convention (e.g. `@Serializable`)
- [ ] Theme tokens from the design system
- [ ] Image loader with placeholder / error / contentDescription
- [ ] The project's logging library only (no `android.util.Log` / `println`)
- [ ] Secure persistence (not raw `SharedPreferences` for sensitive data)
- [ ] Dispatcher qualifier on IO/CPU work
- [ ] Tests present
- [ ] `.obsidian-vault/` updated for new modules / screens / routes / public API changes; no
      `<!-- STUB -->` markers remain
