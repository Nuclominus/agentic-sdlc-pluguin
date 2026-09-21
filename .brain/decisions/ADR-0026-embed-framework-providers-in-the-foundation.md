---
adr: 26
status: accepted
date: 2026-09-20
supersedes: 2
---

# ADR-0026 — Embed framework providers in the hosting foundation

## Context

ADR-0002 gave every additive Android library (Retrofit, Ktor, Room, Proto DataStore, Dagger/Hilt,
Koin, WorkManager) its own installed plugin: a `manifest.yaml` (`kind: framework`), a convention
skill, an optional ProGuard snippet, a `.claude-plugin/plugin.json`, and an empty
`runtime-dependencies.json`. That gave the marketplace 8 Android install entries for what is, from
a user's perspective, one platform — install `android-foundation`, everything else should just
work when detected.

A brief to fold the 7 framework plugins into `android-foundation` on the premise that "each
carries nothing more than skills" turned out to be false in the one respect that matters: each
plugin's `manifest.yaml` is the **conditional-activation contract** — `enriches_aspect` +
`dependency` is what keeps Retrofit guidance out of a Ktor project and Koin guidance out of a
Hilt project. `schemas/manifest.schema.json` also actively forbade the naive merge: a
`kind: foundation` document could not declare `enriches_aspect`/`dependency`, and a
`kind: framework` document could not declare foundation-only keys — so "just move the files" was
not merely undesirable, it did not validate.

The real trap (R1) was structural, not cosmetic: two loader modes already existed and disagreed.
Tree mode (`plugins/**/manifest.yaml`, dev/CI only) would find a manifest nested under
`android-foundation/`; installed mode (`join(installPath, "manifest.yaml")`, the production path)
never would. A directory-move-only implementation passes CI and the dev-checkout lint, and
silently deactivates all seven frameworks for every real user — the exact tree-vs-installed
confusion `manifests.mjs`'s own header already records once happening for real (during ADR-0019's
pre-implementation checks).

## Decision

A foundation's `manifest.yaml` may declare a `frameworks:` array (`schemas/manifest.schema.json`
`$defs/frameworkRow`): one row per embedded framework, carrying the same fields a standalone
framework manifest carried (`stack`, `enriches_aspect`, `dependency`, `convention_skills`,
`phase_injections`, optional `priority`/`extra_phases`/`pre_phase_commands`/
`post_pipeline_checks`) minus `kind` — a row never declares `kind` itself.

`plugins/sdlc/tools/resolve/manifests.mjs`'s `classify()` synthesizes one ordinary
`kind: framework` record per row, in **both** loader modes (tree and installed), since both call
`classify()`. This is the "one production path" guarantee: tree mode and installed mode resolve
the identical additive set for the same project, verified by a dual-mode equality test written
and committed **before** any file was moved (Story 2). `detect.mjs` (`resolveStack`,
`dependencyPresent`) and `plan.mjs`'s additive-record filtering are unchanged by design — a
synthesized record satisfies the `{foundations, frameworks}` shape a standalone one always did.

`android-foundation` embeds all 7 frameworks this way. Their skills relocate to
`android-foundation/skills/<name>-conventions/`, their ProGuard snippets to
`android-foundation/rules/snippets/`, and their `manifest.yaml` content folds into rows under
`android-foundation/manifest.yaml`'s new `frameworks:` array. The 7 plugin directories
(`retrofit-plugin`, `ktor-plugin`, `room-plugin`, `datastore-proto-plugin`, `dagger-plugin`,
`koin-plugin`, `workmanager-plugin`) are deleted in the same commit as the schema + resolver
change, and their 7 `.claude-plugin/marketplace.json` entries removed — a single breaking cut,
not a deprecation window (per `no-runtime-compat-shims`).

**What is preserved (no action needed by an existing user):** the `stack` id — `additive_profiles`
telemetry and `.claude/sdlc.local.yaml` `frameworks.enable/disable` keys are unchanged (`retrofit`,
`ktor`, `room`, `datastore-proto`, `dagger`, `koin`, `workmanager`).

**What breaks once, with no alias layer:** the skill namespace —
`retrofit-plugin:retrofit-conventions` → `android-foundation:retrofit-conventions` (×7, including
the divergent `dagger-plugin:hilt-conventions` → `android-foundation:hilt-conventions`).
`/sdlc:doctor` migrates a project's `.claude/sdlc.local.yaml` `extensions.skills[].skill` entries
via `plugins/sdlc/config/plugin-migrations.json`, on explicit approval only, mirroring the
existing agent-name migration (ADR-0021) rather than inventing a second mechanism.

A stale standalone install of a now-embedded framework (Edge case 1 — a cached `retrofit-plugin`
still registered after upgrade) is de-duplicated by `stack` in `classify()`: the embedded row wins
and the standalone copy is reported as `shadowed_frameworks`, following the existing `shadows`
precedent in `mergePathLoaded`.

A new `tools/sdlc-lint` rule (`nested-manifest`) fails the build if any `manifest.yaml` survives
below a plugin root — the structural precondition that makes the tree-vs-installed trap
unreachable going forward, not just avoided this once.

## Consequences

- Marketplace surface: 9 install entries (`sdlc`, `android-foundation`, 7 `*-plugin`) → 3
  (`sdlc`, `android-foundation`, plus the two optional external dependencies `superpowers` and
  `security-guidance`).
  **Amended by [[decisions/ADR-0028-an-external-dependency-is-never-a-marketplace-entry]]:** the
  surface is **2**, not 3. `superpowers` and `security-guidance` were never ours to list, and
  counting them as install entries of this marketplace is precisely what produced the
  `superpowers@agentic-sdlc` clone.
- **Granularity loss (Edge case 4):** disabling `android-foundation` now disables all 7 embedded
  frameworks at once; they were previously independently disableable via `enabledPlugins`. The
  `frameworks.disable` override in `sdlc.local.yaml` is the only remaining per-framework lever.
- **R7 — KMP-reuse trade-off, accepted:** Ktor, Koin and Proto DataStore are KMP-capable and could
  have enriched a future non-Android foundation as standalone plugins. Embedding them in
  `android-foundation` makes that a re-extraction later, not a reuse today. Acceptable because the
  marketplace is Android-only at present (`CONTRIBUTING.md`).
- `sdlc:create-pluguin`'s "framework" branch now asks which foundation hosts the new framework and
  appends a row to that foundation's `frameworks:` array, rather than scaffolding a new plugin
  directory — the resolver no longer discovers a standalone framework manifest in production.
- The 7 `components/*.md` notes for the removed plugins are not deleted (no hard rule requires
  removing them, and deleting would orphan every existing link to them) — each is replaced with a
  short "merged into `[[components/android-foundation]]`" note.
- Reverses `.brain/planning/c2-framework-providers.md` (track C2, which created the 7 plugins);
  see `.brain/planning/c3-embed-framework-providers.md`.

## Related
- Amended by: [[decisions/ADR-0028-an-external-dependency-is-never-a-marketplace-entry]]
- Supersedes ADR-0002 (Framework Provider Pattern).
- Implemented by # (filled in when the PR is opened — documentation phase).
