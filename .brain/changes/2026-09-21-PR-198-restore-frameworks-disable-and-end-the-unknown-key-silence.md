---
pr: 198
date: 2026-09-21
author: Nuclominus
type: fix
plugins: [sdlc]
roadmap: null
files_changed: 16
---

# PR #198 — restore frameworks.disable, and end the unknown-key silence

> `fix` · merged 2026-09-21 · by @Nuclominus

## Summary

`frameworks.enable` / `frameworks.disable` were documented in `.claude/sdlc.local.yaml` as the way
to override framework auto-detection, and **no code read either key from `v1.13.0` through
`v3.0.0`** — seven releases. They had been orchestrator prose (Step 0b-frameworks) and were lost in
`05ecdb6` (#121) when resolution moved into `tools/resolve/` per
[[decisions/ADR-0019-the-run-start-is-one-command]]. #195 removed the false claim from the docs;
this restores the capability behind it, and decides the two halves separately because they are not
equal.

**`disable` is back, applied inside `resolveStack`** — where attachment is decided, not as a filter
over the returned `additive`. A framework that never attached also never contributed a
`role_expertise` path, a `convention_skills` row or a phase injection; unpicking those downstream is
three separate chances to miss one. Verified end to end against the real `android-foundation`
manifest on a project carrying Ktor + Retrofit + Room: `android-foundation:ktor-conventions` leaves
`convention_skills` and every Ktor paragraph leaves the development injection.

[[decisions/ADR-0026-embed-framework-providers-in-the-foundation]] is why this matters now rather
than in `1.13.0`. Two providers can contest one functional aspect — Ktor/Retrofit on `network`,
Dagger/Koin on `di`, Room/DataStore-Proto on `persistence` — so a project mid-migration gets *both*
sets of guidance in every development and security prompt, and the only workaround was removing the
dependency from the build, which is exactly what a migration cannot do.

**`enable` is not restored.** Under ADR-0002 a framework was a separately installed plugin and
opting in was plausible; under ADR-0026 it is a row keyed to a dependency coordinate, so forcing one
on injects guidance for a library the project demonstrably does not use.

**The silence was the worse half.** An unknown top-level key was ignored without a word, so a
project still carrying `frameworks: {disable: [ktor]}` got no diagnostic at all and the config read
as honoured. Every unreadable key now warns once per run against one exported whitelist,
`KNOWN_LOCAL_KEYS`, spanning both consumers of the file — `plan.mjs` (`active_workflow`,
`frameworks`) and `applyLocalOverrides` (the rest).

Reading `sdlc.local.yaml` moved earlier in `resolveProfile`, ahead of detection: `frameworks.disable`
is an input to detection, not to the profile merge, and the file was previously parsed *after* the
decision it is meant to inform.

**What the two review rounds cost:** no correctness bug was found in the resolver code either time.
Every one of the seven findings was documentation contradicting the new behaviour — `WORKFLOW.md`
still advertising `enable`, `/sdlc:doctor` and `/sdlc:list-stacks` about to print an active
framework the run suppresses, two incomplete key lists. That is the same failure mode that let the
key sit dead for seven releases, and it took seven files of prose to move for one ~40-line code
change. One review finding was a defect in a *previous* review fix: the `← suppressed` marking added
to `/sdlc:list-stacks` could never fire, because that command enumerates providers by looking for
`kind: framework` documents and ADR-0026 left zero of those in the marketplace.

## Changed areas

- [[components/sdlc]] — `tools/resolve/{detect,profile,plan}.mjs`; `KNOWN_LOCAL_KEYS` and
  `parseFrameworkOverrides` are new exports. `/sdlc:doctor`, `/sdlc:list-stacks` and `/sdlc:init`
  updated to match.
- [[architecture/manifest-and-aspects]] — §4's additive-set resolution corrected: the override is
  `disable` only, and it is an input to attachment rather than a filter after it.
- `docs/CONFIGURATION.md`, `docs/WORKFLOW.md`, `plugins/sdlc/README.md` — the supported-key list is
  now load-bearing, since an unlisted key produces a warning.

## Decisions & rationale

- Implements [[decisions/ADR-0027-suppression-is-configurable-activation-is-not]] (new). The
  asymmetry is the decision: a user may **subtract** from what detection concluded, never **add** to
  it. Detection follows the build, and the build is ground truth about which libraries a project
  actually uses.
- Builds on [[decisions/ADR-0026-embed-framework-providers-in-the-foundation]], which created the
  contested-aspect case, and repairs a regression from
  [[decisions/ADR-0019-the-run-start-is-one-command]].

## Planning

- Not a roadmap item — a regression repair surfaced by the `3.0.0` release-notes audit (#195).
- Leaves one known gap, pre-existing since ADR-0026: `/sdlc:list-stacks` and `/sdlc:doctor` describe
  framework enumeration in prose rather than calling the resolver, so they can drift from it again.
  Both were corrected here; making them call `resolve/cli.mjs` instead would remove the class.

---
_Auto-generated by `tools/brain-sync`. Frontmatter and the index are machine-owned; every prose section, Summary included, is meant to be enriched — but `sync --pr` rewrites the whole file, so enrich after running it._
