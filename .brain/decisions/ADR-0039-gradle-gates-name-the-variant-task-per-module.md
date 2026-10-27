---
adr: 39
status: accepted
date: 2026-10-27
supersedes: null
---

# ADR-0039 — Gradle gates name the variant task per module

## Context

android-foundation's `heal_checks` ran `./gradlew compileDebugKotlin` and its
`post_pipeline_checks` ran `./gradlew testDebugUnitTest` / `compileDebugKotlin`. Gradle runs a bare
task name in every project that has it and fails only when *no* project has it. An `:app` with
product flavors (`dev` / `production`) has no `compileDebugKotlin` — only `compileDevDebugKotlin`
and `compileProductionDebugKotlin` — so Gradle compiled the unflavored library modules, skipped
`:app` without a word, and exited 0. The After Action Review of three real runs (sdlc 3.2.2 +
android-foundation 3.2.0) found **zero `:app:` tasks** in any heal or post-check log: every gate
reported green without compiling or testing the changed code (issue #238).

The lint line, `detekt || ktlintCheck || true`, could never fail at all, so a run with real lint
violations reported the same green as a clean one.

Two constraints shaped the fix:

1. **Check strings are opaque to the core.** The orchestrator runs each one verbatim through its
   own Bash. A long inline detection script in the manifest would have to be retyped by the
   orchestrating model on every call, and duplicated across the heal and post lists.
2. **`${CLAUDE_PLUGIN_ROOT}` names the wrong plugin there.** The orchestrator is an sdlc skill, so
   in its Bash the variable (when the host exports it) is the sdlc plugin's root. A foundation
   could not call a script it ships. `role_expertise` rule paths had already hit the same problem
   and are emitted absolute by the resolver.

## Decision

1. **The resolver binds `${CLAUDE_PLUGIN_ROOT}` in manifest command lists to the declaring
   plugin's directory.** `bindPluginRoot` in `plugins/sdlc/tools/resolve/manifests.mjs` runs at
   manifest load. It covers `heal_checks`, `post_pipeline_checks` and `pre_phase_commands`, at the
   top level and on embedded `frameworks:` rows (ADR-0026). Only that literal spelling is bound,
   because it is the one Claude Code's hooks.json uses for the same meaning. Prose and project
   overrides in `.sdlc/sdlc.local.yaml` are never rewritten. Every consumer (plan, dry-run,
   telemetry, lint) sees the absolute path the command will really use, on every host and install
   layout.
2. **Every android Gradle gate calls `scripts/gradle-variant-check.sh <compile|test|lint>`**,
   shipped in android-foundation. The script asks Gradle for the build's task list
   (`tasks --all`) and names **one project-qualified variant task per module**, for example
   `:app:compileDevDebugKotlin :core:compileDebugKotlin`. Gradle refuses to skip a
   project-qualified task: a missing one is an error, not a silent no-op. The variant for each
   module is chosen in this order:
   - the flavor named by `default_variant` in `.sdlc/sdlc.local.yaml`, when the module has it;
   - else the module's unflavored task;
   - else its alphabetically first flavor.
   An unknown `default_variant` prints a `WARN` and falls back.
3. **Nothing to check is a failure.** When no module declares a target task, the script exits 1
   and never invokes a build. A failing listing (a broken build script) fails with its own exit
   code. A missing `./gradlew` exits 127, which the orchestrator already treats as "tool
   unavailable on this host".
4. **Lint can fail.** `lint` runs whichever of `detekt` / `ktlintCheck` the build declares, by bare
   name (the sweep is meant to cover every module that has it), with `--continue`. Violations fail
   the check; Step 4 reports a failure and never auto-iterates. A build that declares neither linter
   prints a visible `WARN: … lint SKIPPED` line and exits 0. Absent tooling is a skip, not a pass.
5. **`default_variant` joins the core's `KNOWN_LOCAL_KEYS`.** This is the only core schema change.
   The core reads nothing from the key; it is listed so that naming it does not warn. The script
   reads it from the project file directly.

The task listing costs one Gradle configuration pass. It is cached in
`.gradle/sdlc-variant-check/tasks.txt`, keyed on a checksum of every build script, settings file,
`gradle.properties`, version catalog and `buildSrc` / `build-logic` source. The cache keeps the heal
loop's invocation count (measured in the manifest's perf note) at one extra listing per
build-file change, not one per check.

## Consequences

- A flavored project's gates now compile and test `:app`. A non-flavored project runs the same
  tasks as before, now project-qualified. `tests/test-gradle-variant-check.sh` covers both shapes
  against a fake `./gradlew` under `sh` and `dash`.
- The gates rely on `tasks --all` printing `<project-path>:<task>` lines, which is Gradle's report
  format. If a future Gradle changes it, the failure mode is "no target task → FAIL", never a
  silent pass.
- A post-pipeline run with real lint violations now shows a failed check where it used to show
  green. This is intended: the old green was false.
- Any foundation can now ship a helper and call it as `"${CLAUDE_PLUGIN_ROOT}/…"` from its
  command lists. Before this ADR that spelling resolved to the sdlc plugin.
- A project that needs exact tasks still replaces the lists outright with `heal_checks:` /
  `post_pipeline_checks:` in `.sdlc/sdlc.local.yaml`, which this change does not touch.
- Only Debug variants are targeted, which matches the old gates. KMP targets
  (`compileDebugKotlinAndroid`) are out of scope and fail loudly rather than pass.

## Related
- Implemented by: the PR closing issue #238.
- Relates to: [[decisions/ADR-0026-embed-framework-providers-in-the-foundation]] (embedded rows
  carry command lists too), [[decisions/ADR-0034-phase-boundary-lint-feedback-never-blocks]] (the
  SubagentStop lint hook, which stays non-blocking), [[components/android-foundation]].
