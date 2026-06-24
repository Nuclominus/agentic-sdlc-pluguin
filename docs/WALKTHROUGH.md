# End-to-end walkthrough — Android

A complete run of the `android-feature` pipeline on a simple, realistic task. This traces every phase,
the two-pass development gate, the review loop firing once, the parallel security/test group, and the
artifacts produced. Console blocks show the orchestrator's verbatim banners; summary blocks show the
compact handoffs agents return.

> **Task:** `Add a Settings screen with a dark-mode toggle that persists across launches.`

---

## 0. Invocation & detection

```
$ /sdlc:start "Add a Settings screen with a dark-mode toggle that persists across launches"

🔧 Dependency preflight: cached (all satisfied)
🔎 Stack detection:
   🎯 android  (priority=300, from android-foundation/stack.md)
      matched: all[ any[settings.gradle.kts], file_glob **/*.kt ]
   ➕ additive: retrofit  (libs.versions.toml contains retrofit)
   workflow: android-feature  (declared by profile; 6 phases)
📁 Workspace: docs/plans/add-settings-dark-mode-toggle/
```

The project has `settings.gradle.kts` and Kotlin sources, so the `android` profile wins and its declared
`workflow: android-feature` is auto-selected — no `--workflow=` needed. Narrative language is detected
from the prompt (here: English).

---

## 1. business_analysis — `android-ba` (Opus)

```
▶ Phase 1/6: business_analysis → android-ba (opus)
```

`android-ba` reads the brief and the codebase, applies embedded DDD to place the feature, and writes
`01-business-analysis.md` (scope, acceptance criteria, module placement, edge cases). It returns:

```
SCOPE: a Settings screen with a single dark-mode toggle; preference persisted; theme applied app-wide.
MODULE PLACEMENT: :feature:settings (new) — UI + ViewModel; persistence via :core:preferences (existing DataStore).
ACCEPTANCE:
  - toggling updates the theme immediately (no restart)
  - choice survives process death (DataStore)
  - default follows system setting on first launch
EDGE CASES: rapid toggle; system theme change while app open; migration for users with no stored pref.
OPEN QUESTIONS: none blocking.
STATUS: ready-for-development
```

---

## 2. development — `android-developer` (Sonnet), two passes

### Pass 1 — planning

```
▶ Phase 2/6: development → android-developer (sonnet)  [plan pass]
```

The agent runs Architecture Detection (it does **not** impose a stack — it reads the project's actual
DI, navigation, and persistence choices) and writes `02-development-plan.md`. Then the orchestrator stops
at the approval gate:

```
📋 Implementation plan ready for development.
   Review: docs/plans/add-settings-dark-mode-toggle/02-development-plan.md

   Plan summary:
   - :feature:settings — SettingsScreen.kt (Compose), SettingsViewModel.kt (StateFlow<SettingsUiState>)
   - :core:preferences — ThemePreferenceRepository: Flow<ThemeMode> + suspend setThemeMode()
   - app theme reads ThemeMode from a CompositionLocal driven by the repository Flow
   - navigation: add @Serializable SettingsRoute, composable<SettingsRoute> in the app NavHost

   Approve / request changes / abort?
```

→ **You approve.**

### Pass 2 — implementation

```
▶ Phase 2/6: development → android-developer (sonnet)  [implement pass]
```

The agent implements against the approved plan and writes `02-development.md`:

```
FILES CHANGED:
  + feature/settings/.../SettingsScreen.kt
  + feature/settings/.../SettingsViewModel.kt
  + feature/settings/.../SettingsRoute.kt        (@Serializable)
  ~ core/preferences/.../ThemePreferenceRepository.kt   (added themeMode Flow + setter)
  ~ app/.../AppNavHost.kt                          (registered composable<SettingsRoute>)
  ~ app/.../AppTheme.kt                            (theme driven by ThemeMode)
VERIFICATION: ktlint + detekt clean; unit compile-check passed. Real build CI-deferred.
STATUS: implemented
```

(The `kotlin-guard` PostToolUse hook ran on each `.kt` write, enforcing the non-negotiable patterns —
no `!!`, no `runBlocking`, no `println`/`android.util.Log` in production.)

---

## 3. review — `android-reviewer` (Sonnet), loop phase

```
▶ Phase 3/6: review → android-reviewer (sonnet)
```

Read-only review against the diff. First round finds a real issue and returns **changes requested**:

```
VERDICT: changes-requested
FINDINGS:
  - [High] SettingsViewModel collects the repository Flow on Dispatchers.IO without a
    SupervisorJob scope; a persistence error would cancel the UI state collection.
  - [Med] setThemeMode() not wrapped in runCatching; DataStore IOException would crash the toggle.
```

The orchestrator re-runs **development** (implement pass only — the plan stays approved) with these
findings injected, then re-runs review:

```
↻ review round 2/3
▶ Phase 2/6: development → android-developer (sonnet)  [implement pass, loop_findings applied]
▶ Phase 3/6: review → android-reviewer (sonnet)
```

```
VERDICT: approved
NOTES: both findings resolved; viewModelScope used with proper error handling; LGTM.
```

→ Loop satisfied in 2 rounds (cap 3). Result written to `03-review.md`.

---

## 4. [ security ‖ test ] — parallel group

```
▶ Phase 4/6: [security ‖ test] — parallel
▶ Phase 4/6: security → android-security (opus)
▶ Phase 4/6: test    → android-tester (sonnet)
```

Both agents are dispatched **in one message** (true concurrency) and both must return before `qa`.

`android-security` audits against MASVS/MASTG and writes `04-security.md`:

```
ISSUES_FOUND: critical=0 high=0 medium=1 low=0
MASVS:
  - [MASVS-STORAGE / MASTG-TEST storage] dark-mode pref is non-sensitive → plain DataStore is fine (no encryption needed).
  - [Med · MASVS-PLATFORM] SettingsRoute deep link not validated against an allow-list (document-only; not a current attack path).
STATUS: clean (1 documented recommendation)
```

`android-tester` writes unit/integration tests and `04-test.md`:

```
TESTS ADDED:
  - SettingsViewModelTest (Turbine on uiState; MockK repository) — toggle, error path, default-from-system
  - ThemePreferenceRepositoryTest — persists + emits; survives a simulated relaunch
COVERAGE (Kover): :feature:settings 92% line / :core:preferences delta +4%
STATUS: green
```

---

## 5. qa — `android-qa` (Sonnet)

```
▶ Phase 5/6: qa → android-qa (sonnet)
```

End-to-end / UI verification, writes `05-qa.md`:

```
E2E:
  - Compose UI Test: toggle flips theme immediately; semantics assert dark colors applied
  - Maestro flow: set dark → background app → relaunch → still dark (persistence across launches ✓)
A11Y: toggle has contentDescription + state; min touch target met; contrast AA in both themes
STATUS: pass
```

---

## 6. documentation — `android-docs` (Haiku)

```
▶ Phase 6/6: documentation → android-docs (haiku)
```

Assembles the PR description from all phase outputs and writes `06-documentation.md`. Because this project
uses an Obsidian vault, `android-docs` also creates `<!-- STUB -->` notes for the new module/screen/flow
(via the `manage-vault` conventions) for later filling — it never invents content.

```
PR: "feat(settings): dark-mode toggle with persistence"
  - Summary, screenshots placeholder, acceptance checklist (all ticked)
  - Security review: 0 Critical / 0 High / 1 Medium (documented)
  - Tests: unit + E2E green; coverage noted
VAULT: stubbed screens/SettingsScreen.md, modules/settings.md, business-logic/settings.md (STUB markers)
STATUS: PR ready
```

---

## Done

```
✅ Pipeline complete: add-settings-dark-mode-toggle
   phases: 6/6  ·  review loop: 2 rounds  ·  security: clean  ·  qa: pass
   artifacts: docs/plans/add-settings-dark-mode-toggle/
   telemetry: _telemetry.json (per-phase tokens / cost / skips)

   Next: review the PR; run `android-docs` (or open Obsidian) to fill the new vault stubs before merge.
```

### What this demonstrates

- **Auto-selection** of the platform workflow from the profile (`/sdlc:start` only).
- **Two-pass development** with a human approval gate between plan and implementation.
- **The review loop** firing once (changes-requested → re-implement → approved), capped and content-aware.
- **The parallel group** dispatching security and test together.
- **Platform standard injection** — security ran MASVS/MASTG, not web-OWASP, with zero core changes.
- **Compact handoffs** — each phase returns a small summary; full detail lives in `docs/plans/<slug>/`.
