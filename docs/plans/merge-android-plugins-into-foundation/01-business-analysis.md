# Business Analysis: Merge the additive Android framework plugins into `android-foundation`

> Stack standard: **none supplied.** No `Stack expertise for business-analyst` block was present in
> this dispatch, and the target artefact is this marketplace repo (not an Android app), so the
> Android requirements skill does not apply. Generic BA guidance + `.brain/` (repo SSOT) were used.

## Executive summary

The brief asks to fold the seven additive framework plugins (`retrofit`, `ktor`, `room`,
`datastore-proto`, `dagger`, `koin`, `workmanager`) into `android-foundation`, on the premise that
"each of the additive plugins carries nothing more than skills". **That premise is false in the one
respect that matters.** Each additive plugin also carries a `kind: framework` `manifest.yaml` whose
`enriches_aspect` + `dependency` pair is the *conditional activation contract* — it is what makes
Retrofit guidance appear only in Retrofit projects and Ktor guidance only in Ktor projects. The
consolidation is desirable (7 install entries → 1; less marketplace surface), but it is a
**resolver + schema change**, not a directory move, and the naive version silently breaks in
production while continuing to pass CI.

## Source consolidation & conflicts

| # | Requirement / claim | Source | Verdict against the codebase |
|---|---|---|---|
| S1 | "Merge all Android-related plugins into android-foundation" | `_brief.md` | Feasible, but only via a new embedded-framework mechanism (FR-2). |
| S2 | "Each of the additive plugins carries nothing more than skills" | `_brief.md` | **CONFLICT — false.** See "Codebase validation" below. |
| S3 | A framework is a separate plugin with `kind: framework`, additive, no agents | `.brain/decisions/ADR-0002-framework-provider-pattern.md` | **CONFLICT with S1.** ADR-0002 is `status: accepted` and mandates the per-plugin split this brief reverses. Must be superseded. |
| S4 | Foundation owns WHERE to look; framework owns WHAT to look for | `ADR-0002`, `.brain/architecture/manifest-and-aspects.md` §4.1 | Holds. A merge collapses both sides into one file — the separation of concerns is *lost*, which is acceptable only because there is exactly one foundation hosting them. |
| S5 | "a framework adds `manifest.yaml` + a skill (+ optional ProGuard snippet) **and nothing else**" | `.brain/architecture/manifest-and-aspects.md` line 48 | Accurate, and note it lists the manifest *first*. The manifest is the mechanism; the skill is the payload. |
| S6 | No runtime compatibility shims; rename once, migrate via a doctor command with approval | user memory `no-runtime-compat-shims`, realized by `/sdlc:doctor` | Binding constraint on the migration design (FR-6). |
| S7 | Machine contracts live in state files, not SKILL.md prose | user memory `machine-contracts-live-in-state-files` | Applies: the merged shape must be enforced by `schemas/manifest.schema.json` + `sdlc-lint`, not by documentation. |
| S8 | No roadmap/backlog item exists for this merge | `.brain/planning/backlog.md`, `roadmap.md` (grepped) | **Gap.** This reverses track C2 ("framework providers", `.brain/planning/c2-framework-providers.md`), which created these plugins. Needs a roadmap entry + ADR before implementation. |

## Codebase validation — what the additive plugins actually carry

Verified by inventorying all seven plugin trees. Every one carries **five** artefact classes, not one:

1. `manifest.yaml` — `kind: framework`, `stack`, `priority`, `enriches_aspect`, `dependency`,
   `convention_skills`, and **`phase_injections.development` + `phase_injections.security`**
   (multi-paragraph prose merged into phase prompts). Example:
   `/Users/roman/Developer/Agentic-SDLC-Pluguin/plugins/retrofit-plugin/manifest.yaml`.
2. `skills/<name>-conventions/SKILL.md` — the bulk, and the only part the brief accounts for.
3. `rules/snippets/<name>-proguard.md` — R8 keep rules, **referenced by path from the security
   injection** (`plugins/retrofit-plugin/manifest.yaml:29`). Moving the file without rewriting the
   injection breaks the reference.
4. `.claude-plugin/plugin.json` — the harness-level plugin identity.
5. `runtime-dependencies.json` — consumed by orchestrator Step 0a.

**The load-bearing asset is conditional activation.** `dependency` + `enriches_aspect` are what keep
`koin` guidance out of a Hilt project and `ktor` guidance out of a Retrofit project. Three aspects
are currently contested by two providers each — `network` (retrofit ‖ ktor), `persistence`
(room ‖ datastore-proto), `di` (dagger ‖ koin) — and the marketplace descriptions state the
invariant explicitly: *"Coexists with retrofit-plugin on the `network` aspect — only the detected
provider activates."*

### The blocking constraint: one manifest per installed plugin

Two loader modes exist and they disagree, which is the trap:

- **tree mode** (`plugins/sdlc/tools/resolve/manifests.mjs:72`) globs `plugins/**/manifest.yaml` —
  a nested `android-foundation/frameworks/retrofit/manifest.yaml` **would** be found.
- **installed mode** (`manifests.mjs:229`, the production path) reads exactly
  `join(info.installPath, "manifest.yaml")` — one manifest, at the plugin root. A nested manifest is
  **invisible**. `roots.mjs:178` confirms the same one-per-root rule for path-loaded checkouts.

Consequence: *physically moving the seven plugin directories under `android-foundation/` passes CI,
passes the dev-checkout lint, and silently deactivates all seven frameworks for every real user.*
The module header at `manifests.mjs:10-13` records that this exact tree-vs-installed confusion
already produced a wrong answer once (during ADR-0019 work). This is the single highest-risk item.

### The schema forbids the naive merge shape

`schemas/manifest.schema.json` sets `additionalProperties: false` and encodes mutually exclusive
shapes: a `foundation` **MUST NOT** declare `enriches_aspect` or `dependency` (lines 109-124); a
`framework` **MUST NOT** declare `hosts_aspects` or `framework_detection` (lines 48-92). So the
framework fields cannot simply be folded into `android-foundation/manifest.yaml` — a new property
must be designed and added.

### Skill-id and identity impact

Merging changes the skill namespace: `retrofit-plugin:retrofit-conventions` →
`android-foundation:retrofit-conventions` (×7, and `dagger-plugin:hilt-conventions` →
`android-foundation:hilt-conventions`). These ids appear in `convention_skills`, in user
`.claude/sdlc.local.yaml` `extensions.skills` rows, and in the deps preflight.

**Two identity axes must be distinguished, and only one needs to break:**

- `stack` id (`retrofit`, `koin`, …) — the durable machine identity. It keys telemetry
  `additive_profiles` (`plan.mjs:426`) and the `frameworks.enable/disable` override. **Preserve it.**
- plugin name (`retrofit-plugin`, …) — the install/skill-namespace identity. **This is what breaks.**

### Files impacted (385 occurrences across 87 files; `.claude/worktrees/` excluded)

Code / machine contracts (must change):
- `plugins/sdlc/tools/resolve/manifests.mjs` — synthesize framework records from the foundation.
- `plugins/sdlc/tools/resolve/detect.mjs` — `resolveStack` consumes `{foundations, frameworks}`;
  embedded frameworks must arrive in the same shape (keeps `dependencyPresent` untouched).
- `plugins/sdlc/tools/resolve/plan.mjs:222-268` — additive record lookup + `expertiseSources`.
- `schemas/manifest.schema.json` — new `frameworks` property; relax the foundation `not` clauses.
- `tools/brain-sync/lib/classify.mjs:4-7` — hardcoded `KNOWN_PLUGINS` list (+ its tests).
- `tools/sdlc-lint/test/profile.test.mjs`, `tools/brain-sync/test/{classify,render,pr,cli}.test.mjs`.
- `.claude-plugin/marketplace.json` — remove 7 entries (17 occurrences).

Prompts / commands: `plugins/sdlc/commands/security-init.md` (4), `commands/doctor.md`,
`commands/list-stacks.md`, `plugins/sdlc/agents/security-analyst.md`,
`plugins/sdlc/skills/create-pluguin/SKILL.md` (the "author a framework plugin" flow).

Vault (`.brain/`, per `second-brain.md` rule): 7 `components/*.md` notes + `_moc-root.md` rows (7),
`architecture/manifest-and-aspects.md` (3), `architecture/stack-provider-pattern.md` (2),
`decisions/ADR-0002` (supersede), a new ADR, and a `planning/` entry.

Docs: `README.md` (6), `CONTRIBUTING.md` (3), `CHANGELOG.md` (7), `docs/COST-AND-MODELS.md` (4).

## Functional requirements

1. **FR-1 — Preserve conditional activation.** After the merge, each framework's convention skill,
   `development` injection and `security` injection MUST reach a phase prompt **only when** its
   dependency coordinate is detected in the project. Unconditional inclusion is out of scope and is
   an explicit non-goal.
2. **FR-2 — Embedded-framework declaration.** `android-foundation/manifest.yaml` MUST be able to
   declare its frameworks inline (e.g. a `frameworks:` array whose rows carry `stack`,
   `enriches_aspect`, `dependency`, `convention_skills`, `phase_injections`), and
   `schemas/manifest.schema.json` MUST validate that shape and reject a row missing `dependency`
   or `enriches_aspect`.
3. **FR-3 — Resolver synthesis, one production path.** The installed-mode loader MUST expand
   embedded framework rows into the same `{file, doc}` framework records tree mode produces, so
   `resolveStack` and `mergeProfiles` are unchanged. Tree mode and installed mode MUST resolve the
   identical additive set for the same project — this is the regression gate for the
   `manifests.mjs:10-13` trap.
4. **FR-4 — Stack ids are stable; plugin names break once.** `additive_profiles` telemetry values
   and `frameworks.enable/disable` keys MUST keep their current `stack` ids. Skill ids are
   renamed to the `android-foundation:` namespace in a single cut, with no alias layer (S6).
5. **FR-5 — Asset relocation with reference integrity.** The seven `rules/snippets/*-proguard.md`
   files move under `android-foundation/rules/snippets/`, and every injection referencing them by
   path is rewritten in the same commit. No dangling path may survive.
6. **FR-6 — Migration path for existing installs.** `/sdlc:doctor` MUST detect a project or user
   config still naming a removed plugin or a stale `*-plugin:*` skill id, report it, and offer the
   rewrite **only with explicit approval** (never automatically).
7. **FR-7 — Authoring flow follows.** `sdlc:create-pluguin`'s "framework provider" branch MUST
   either target the embedded form or be removed; it must not keep scaffolding standalone framework
   plugins that the resolver no longer discovers in production.

## Non-functional requirements

- **Performance (prompt budget):** the merged manifest must not enlarge the always-on stable prefix.
  Framework injections are billed on every turn of a phase (ADR-0008 read discipline; the H1
  compliance work measured prefix cost directly). Seven unconditional injections would add roughly
  7× a per-framework injection to every dispatch on every Android project — the regression FR-1
  prevents.
- **Correctness:** contradictory guidance must remain impossible. Two providers on one aspect
  (retrofit ‖ ktor, room ‖ datastore-proto, dagger ‖ koin) must never both activate.
- **Compatibility:** breaking, by policy (S6) — one cut, no shims, doctor-assisted migration,
  announced in `CHANGELOG.md` with a major marketplace version bump.
- **Compliance (repo rules):** `node tools/brain-sync/cli.mjs check --vault .brain` clean before
  merge; ADR added **with its `_moc-*` row in the same commit**; brain-sync PR ordering respected.
- **Testability:** a fixture project per contested aspect proving only the detected provider
  activates, run in both loader modes.

## User stories (Gherkin)

### Story 1: Retrofit project still gets exactly its own guidance
**As a** developer running the SDLC pipeline on an Android app that uses Retrofit
**I want** Retrofit conventions injected and Ktor conventions withheld
**So that** the development phase does not receive two contradictory networking standards.

**Acceptance criteria (FR-1, FR-3):**
- Given a project whose `gradle/libs.versions.toml` names `com.squareup.retrofit2` and not `io.ktor`
- When the orchestrator resolves the stack in **installed** mode
- Then `additive_profiles` contains `retrofit` and does not contain `ktor`
- And the development prompt contains the Retrofit injection and no Ktor injection.

### Story 2: The installed-mode trap is closed
**As a** maintainer
**I want** tree mode and installed mode to resolve the same additive set
**So that** a green CI run cannot hide a production-only deactivation.

**Acceptance criteria (FR-3):**
- Given the fixture project from Story 1
- When the additive set is resolved once via `loadManifestsFromTree` and once via
  `loadInstalledManifests` against an install root containing only `android-foundation`
- Then both return the identical sorted `additive` array
- And a test asserts this equality for every one of the seven frameworks.

### Story 3: An existing user is migrated, not silently broken
**As a** user whose `.claude/sdlc.local.yaml` names `retrofit-plugin:retrofit-conventions`
**I want** `/sdlc:doctor` to tell me and offer the fix
**So that** my config does not silently stop resolving after I upgrade.

**Acceptance criteria (FR-6, S6):**
- Given a project config naming a removed plugin or a stale `*-plugin:*` skill id
- When I run `/sdlc:doctor`
- Then it reports each stale reference with its new `android-foundation:` id
- And it applies no change until I explicitly approve
- And no alias/shim resolves the old id at runtime.

### Story 4: Only the detected DI provider activates
**As a** developer on a Koin project
**I want** Hilt guidance withheld
**So that** the reviewer does not reject my Koin modules against Dagger rules.

**Acceptance criteria (FR-1):**
- Given a project naming `io.insert-koin` and not `com.google.dagger`
- When the pipeline resolves
- Then `additive_profiles` contains `koin` and not `dagger`
- And the same holds symmetrically for a Dagger-only project.

### Story 5: The marketplace shrinks to two Android entries
**As a** new user installing the marketplace
**I want** one Android plugin instead of eight
**So that** setup is a single install and the plugin list is comprehensible.

**Acceptance criteria (FR-2, FR-5):**
- Given the merged `marketplace.json`
- When I list the marketplace
- Then the seven `*-plugin` entries are absent and `android-foundation` is present
- And every relocated ProGuard snippet resolves from its injection's path
- And `sdlc-lint` plus the manifest schema validate the merged manifest.

## Placement & boundaries

- **Owner of the new logic:** `plugins/sdlc/tools/resolve/` — specifically `manifests.mjs`
  (synthesis of embedded framework records). This is the module whose header already documents the
  tree-vs-installed distinction; the change belongs where that knowledge lives.
- **Unchanged by design:** `detect.mjs` (`resolveStack`, `dependencyPresent`) must keep consuming
  `{foundations, frameworks}` records. Keeping the matching mechanics untouched is what makes the
  change reviewable and keeps the core stack-agnostic (ADR-0001).
- **New boundary needed?** No new module. One new *declarative* boundary inside an existing file:
  the `frameworks:` block in a foundation manifest, owned by `schemas/manifest.schema.json`.
- **Contracts crossed:** the manifest schema (machine contract), telemetry `additive_profiles`
  (machine contract, values preserved), the `plugin:skill` id namespace (breaks once),
  `marketplace.json` (breaks once), `sdlc.local.yaml` `frameworks.*` (preserved).

## Data model sketch — the manifest model

Current (8 documents, 1 per plugin root):

```
foundation(android)  : kind, stack, priority, aspects[], workflow, detect,
                       hosts_aspects, framework_detection[], role_expertise{11 roles},
                       convention_skills[], heal_checks[], post_pipeline_checks[]
framework(retrofit)  : kind, stack, priority, enriches_aspect, dependency,
                       convention_skills[], phase_injections{development, security}
  ... ×7, each a separate installed plugin root
```

Target (1 document; the 7 framework docs become rows):

```
foundation(android)
  └── frameworks: [                      ← NEW, foundation-only, array
        { stack: retrofit,               ← PRESERVED identity (telemetry + enable/disable key)
          enriches_aspect: network,
          dependency: com.squareup.retrofit2,
          convention_skills: [android-foundation:retrofit-conventions],   ← RENAMED namespace
          phase_injections: { development, security } },                  ← snippet paths rewritten
        ... ×7 ]
```

Relationships & invariants:
- foundation 1—N framework-row; a row's `enriches_aspect` ∈ the foundation's `hosts_aspects`
  (now trivially true — self-hosted; the schema should still assert it).
- `stack` unique across all rows **and** across all foundation `stack` ids.
- N rows may share one `enriches_aspect` (network ×2, persistence ×2, di ×2); at most one may
  activate per project — an invariant the resolver must not be able to violate.
- A row is forbidden the foundation-only keys (`workflow`, `agents_per_phase`, `hosts_aspects`,
  `framework_detection`, `role_expertise`, `aspects`), mirroring today's framework restrictions.

## API contract sketch — the consumer-visible surface

| Surface | Before | After | Breaking? |
|---|---|---|---|
| Marketplace entries | `android-foundation` + 7 `*-plugin` | `android-foundation` only | **Yes** — 7 removed |
| Skill id | `retrofit-plugin:retrofit-conventions` | `android-foundation:retrofit-conventions` | **Yes** — ×7 (incl. `dagger-plugin:hilt-conventions`) |
| `installed_plugins.json` / `enabledPlugins` | 8 Android keys | 1 key; 7 dangle | **Yes** — doctor-migrated (FR-6) |
| Telemetry `additive_profiles` | `["retrofit"]` | `["retrofit"]` | No — stack ids preserved (FR-4) |
| `sdlc.local.yaml` `frameworks.enable/disable` | keyed on stack id | unchanged | No |
| `sdlc.local.yaml` `extensions.skills` rows | may name `*-plugin:*` | must name `android-foundation:*` | **Yes** — doctor-migrated |
| `resolve/cli.mjs expertise --role` output | merged foundation + frameworks | unchanged shape | No |
| `manifest.schema.json` | no `frameworks` key | `frameworks[]` on foundations | Additive |
| `/sdlc:list-stacks`, `/sdlc:doctor` output | "Active frameworks: retrofit" | unchanged wording | No |

## Edge cases & error scenarios

1. **Stale install of a removed plugin** — user has `retrofit-plugin@agentic-sdlc` in
   `installed_plugins.json` after upgrade. Its cached `manifest.yaml` still validates and still
   classifies as a framework, so the *old copy keeps attaching* alongside the embedded row →
   **duplicate injections for the same stack id**. The resolver must de-duplicate by `stack` and
   report the shadowed copy (`mergePathLoaded` already has a `shadows` precedent).
2. **Both providers of one aspect detected** (a project migrating Retrofit → Ktor names both
   coordinates). Current behaviour already activates both; the merge must not make it worse, and
   the merged shape makes it detectable — decide whether to warn.
3. **Nested-manifest false positive in a dev checkout** — if the merge leaves any
   `manifest.yaml` under `plugins/android-foundation/**`, tree mode finds it and installed mode does
   not. Lint must **fail** on any manifest below a plugin root.
4. **Disabled foundation** — with the frameworks embedded, disabling `android-foundation` now
   disables all seven at once. Previously they were independently disableable via `enabledPlugins`.
   Granularity is lost; `frameworks.disable` in `sdlc.local.yaml` becomes the only lever.
5. **Concurrent workstream collision** — `.claude/worktrees/multi-host-port/dist/antigravity/`
   emits one output directory per plugin and enumerates all seven. Merging while that port is in
   flight guarantees conflicts in `dist/` and in its emit manifest.
6. **brain-sync `KNOWN_PLUGINS`** — after deletion, a PR touching `plugins/retrofit-plugin/**` can
   no longer classify; historical change notes referencing those paths must still resolve, and the
   7 `components/*.md` notes must not become orphans (`check` fails on an unlisted note).
7. **ProGuard snippet name collisions** — seven `*-proguard.md` files join
   `android-foundation/rules/snippets/`, which already contains `proguard-keep.md`. Names are
   currently distinct; verify no collision and no duplicated keep-rule content.
8. **Partial migration** — user approves the doctor fix for `sdlc.local.yaml` but not
   `settings.json`; config must remain internally consistent, not half-rewritten.

## Risks & dependencies

- **R1 (critical)** — the installed-mode blind spot. A directory-move-only implementation is green
  in CI and broken for every user. Mitigated by FR-3's dual-mode equality test, which should be
  written **before** any file moves.
- **R2 (high)** — losing conditional activation. If injections become unconditional, the pipeline
  emits contradictory guidance on three aspects and pays 7× injection cost per turn. FR-1 is the
  guard; this is the requirement most likely to be quietly dropped for expedience.
- **R3 (high)** — ADR-0002 is accepted and states the opposite. Shipping without superseding it
  leaves the vault self-contradictory, violating the `second-brain.md` SSOT rule.
- **R4 (medium)** — breaking change for existing installs; depends on `/sdlc:doctor` extension
  landing in the same release, plus a major version bump and CHANGELOG entry.
- **R5 (medium)** — 385 references across 87 files; docs drift is near-certain without a
  completion checklist.
- **R6 (medium)** — worktree conflict with the multi-host port (edge case 5). Sequencing decision
  needed before starting.
- **R7 (low)** — forecloses reuse: `ktor`, `koin`, `datastore-proto` are KMP-capable and could have
  enriched a future non-Android foundation. Embedding them in `android-foundation` makes that a
  re-extraction. Acceptable today (Android-only marketplace), worth recording in the ADR.
- **Dependency** — no backlog/roadmap item exists (S8); one should be created alongside the ADR.

## Open questions for stakeholders

1. **Must dependency-gated activation survive the merge (FR-1)?** The whole design hinges on this.
   If the answer were "no, inject everything always", the work collapses to a file move — and the
   pipeline starts telling developers to use Retrofit and Ktor simultaneously. Recommendation:
   **yes, it must survive**; proceed on that assumption unless told otherwise.
2. **Is the breaking rename accepted now, or deferred to the next major?** Seven marketplace entries
   and seven skill ids disappear with no shim (S6). Confirm the doctor-migration-plus-major-bump
   route, and whether the 7 plugin directories are deleted or kept as tombstones for one release.
3. **What is the sequencing against the in-flight `multi-host-port` worktree**, which enumerates all
   seven plugin directories in its `dist/` emitter?

## Estimated complexity

**large** — not for the volume of moved content (which is mechanical), but because it requires a
schema extension, a production-path resolver change guarded by a dual-mode equality test, a
superseding ADR, a breaking public-surface rename with a doctor-assisted migration, and a
385-occurrence documentation sweep across code, vault and docs.

## INCOMPLETE / not verified in this pass

- The exact `sdlc-lint` rule set that would need new/changed cases (only `test/profile.test.mjs`
  was identified by name, not read).
- `plugins/sdlc/tools/resolve/deps.mjs` skill-availability preflight was inferred from references,
  not read — the precise failure mode for a renamed `plugin:skill` id is unconfirmed.
- Whether `mergeProfiles` de-duplicates `convention_skills` by id across profiles (relevant to
  edge case 1).
