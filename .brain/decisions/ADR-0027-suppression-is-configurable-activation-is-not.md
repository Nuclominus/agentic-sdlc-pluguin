---
adr: 27
status: accepted
date: 2026-09-21
supersedes: null
---

# ADR-0027 — Suppression is configurable, activation is not

## Context

`.claude/sdlc.local.yaml` documented `frameworks.enable` and `frameworks.disable` as the way to
override framework auto-detection. Both were orchestrator prose (Step 0b-frameworks) and both were
lost in `05ecdb6` (#121) when resolution moved into `tools/resolve/` per
[[decisions/ADR-0019-the-run-start-is-one-command]]. Nothing in `plugins/sdlc/` read either key
from `v1.13.0` to `v3.0.0` — seven releases of a documented capability that did nothing
(issue #197). #195 removed the false claim from the docs; this decides what to build back.

Two facts make the halves unequal.

**`disable` got a stronger case, not a weaker one.**
[[decisions/ADR-0026-embed-framework-providers-in-the-foundation]] lets two providers contest one
functional aspect — Ktor and Retrofit both `enriches_aspect: network`, Dagger and Koin both `di`,
Room and DataStore-Proto both `persistence`. A project mid-migration genuinely carries both
coordinates, so both sets of guidance land in every development and security prompt. The only
workaround was removing the dependency from the build, which is precisely what a migration cannot
do.

**`enable` lost its meaning.** Under ADR-0002 a framework was a separately installed plugin, and
"activate one whose `detect` did not match" was a plausible way to opt in. Under ADR-0026 a
framework is a row in its foundation's own manifest, keyed to a `dependency` coordinate. Forcing
one on now means injecting guidance for a library the project demonstrably does not use — a wrong
answer with a configuration key in front of it.

A third fact sat underneath both: an unknown top-level key in `sdlc.local.yaml` was ignored in
complete silence. A project still carrying `frameworks: {disable: [ktor]}` got no diagnostic at
all, so the config read as honoured. That silence is what let a dead key survive seven releases
without a single report.

## Decision

1. **`frameworks.disable` is restored, and applied in `resolveStack`** — where attachment is
   decided, not as a filter over the returned `additive`. A framework that never attached also
   never contributed a `role_expertise` path, a `convention_skills` row or a phase injection;
   unpicking those downstream is three separate chances to miss one.
2. **`frameworks.enable` is not restored.** A stale `enable:` block produces a warning naming the
   real remedy (add the dependency), rather than doing nothing quietly.
3. **Every unknown top-level key in `sdlc.local.yaml` warns, once per run**, against a single
   exported whitelist (`KNOWN_LOCAL_KEYS`) that spans both consumers of the file — `plan.mjs`
   (`active_workflow`, `frameworks`) and `applyLocalOverrides` (everything else). A whitelist
   scoped to one function would warn about the other's keys on every run.
4. **A suppression is reported as a fact of the run**: a `suppressed:` row in the active-profiles
   banner, and `stack.suppressed_profiles` in the machine plan and the run telemetry. A run that
   held a framework back and a run whose dependency was never present resolve to the same
   `additive_profiles`; only this field distinguishes them in a rollup.

Asymmetry is the point: the user may subtract from what detection concluded, never add to it.
Detection follows the build, and the build is the ground truth about which libraries a project
actually uses.

## Consequences

- The mid-migration case ADR-0026 created has a supported answer that does not touch the build.
- `frameworks.enable` is gone for good. A project that wants a framework's guidance adds its
  dependency — there is no second path, and therefore no second thing to keep in sync.
- Documentation of a config key is now checkable against one list instead of prose in two files.
  `KNOWN_LOCAL_KEYS` carries a note to keep `docs/CONFIGURATION.md` in step; the unit test asserts
  every key the resolver reads is in the set, which is the half that actually regressed.
- Reading `sdlc.local.yaml` moved earlier in `resolveProfile`, before detection. One read, two
  consumers — the file is no longer parsed after the decision it is supposed to inform.
- Users with a genuine typo in an otherwise-working config will now see a warning they did not see
  before. That is the intended outcome; the run is unaffected, as this file can never abort one.

## Related
- Implemented by: #198
- Relates to: [[decisions/ADR-0026-embed-framework-providers-in-the-foundation]] /
  [[decisions/ADR-0019-the-run-start-is-one-command]] /
  [[decisions/ADR-0002-framework-provider-pattern]]
