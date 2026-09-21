# Development plan (vanilla): merge the 7 additive Android plugins into `android-foundation`

Source: `docs/plans/merge-android-plugins-into-foundation/01-business-analysis.md` (binding — FR-1
through FR-7, S1-S8, user_decisions 1-3). This plan implements the resolver + schema mechanism and
the single breaking cut; it does not implement the `multi-host-port` dist emitter fix (out of
scope, noted as a follow-up).

## 0. Non-negotiable ordering

R1 in the BA is the whole risk of this change: a directory move that passes CI and silently
deactivates all seven frameworks in production. So the order below is fixed, not a suggestion:

1. Schema (`frameworks:` shape) — §2.
2. Resolver synthesis in `manifests.mjs`, both loader modes — §3.
3. **The dual-mode equality test (Story 2) — written and green — BEFORE any file is moved.**
4. Only then: relocate skills/snippets, delete the 7 plugin roots, rewrite the 7
   marketplace.json entries, rewrite `KNOWN_PLUGINS`, sweep prompts/commands/docs — §4-§7.
5. `/sdlc:doctor` + `tools/migrate` extension for skill-id/plugin-name staleness — §8.
6. `sdlc:create-pluguin` framework-authoring flow — §9.
7. Lint rule against a nested `manifest.yaml` — §10.
8. Vault: new ADR superseding ADR-0002, its MOC row, 7 component notes, `_moc-root.md`,
   `architecture/manifest-and-aspects.md`, `architecture/stack-provider-pattern.md` — §11.
9. Branch/commit convention — §12 (not executed in this pass).

## 1. Files to create

- `.brain/decisions/ADR-0026-embed-framework-providers-in-the-foundation.md` — supersedes
  ADR-0002; records the reversal, why (marketplace surface, S1/S2), what is preserved (FR-1,
  conditional activation via the new `frameworks:` row), and the R7 trade-off (KMP-capable
  frameworks — ktor/koin/datastore-proto — can no longer be reused by a future non-Android
  foundation without re-extraction).
- `.brain/planning/c3-embed-framework-providers.md` (or an entry appended to
  `planning/roadmap.md` under a new track `C3`) — the BA noted no roadmap item exists (S8); this
  reverses track C2 (`c2-framework-providers.md`), so the new note must link back to it and to
  ADR-0026.
- Test files (co-located with existing suites, matching their runner — `node --test`):
  - `plugins/sdlc/tools/resolve/test/manifests.embedded-frameworks.test.mjs` (or extend the
    existing manifests test file if one exists — verify with `Glob
    plugins/sdlc/tools/resolve/test/*.test.mjs` before creating a new file) — the dual-mode
    equality test (Story 2): build one fixture install root containing only an
    `android-foundation` manifest with all 7 `frameworks:` rows, resolve additive sets via
    `loadManifestsFromTree` (pointed at a tree fixture with the same 7 rows) and via
    `loadInstalledManifests` (pointed at the single-manifest install root), and assert the two
    sorted `additive` arrays are identical, per framework, for all 7.
  - A fixture project per contested aspect (network/persistence/di) proving only the detected
    provider activates, resolved in both modes (Story 1, Story 4) — extend
    `tools/sdlc-lint/fixtures/` if a fixture-project convention already exists there (inspect
    before adding a new one), else add under the resolve test's own tmp fixtures like
    `profile.test.mjs` does.
  - `tools/sdlc-lint/lib/nested-manifest.mjs` + `tools/sdlc-lint/test/nested-manifest.test.mjs`
    — the lint rule from §10.

No new production module. Per the BA's "Placement & boundaries": the new logic is entirely inside
`plugins/sdlc/tools/resolve/manifests.mjs` (synthesis) and `schemas/manifest.schema.json`
(declaration). `detect.mjs` and `plan.mjs` are consumers, unchanged in shape.

## 2. Schema: `schemas/manifest.schema.json`

Add a **foundation-only** `frameworks` property and thread it through the existing `kind`
conditionals. Concretely:

1. New `$defs/frameworkRow`: an object requiring `stack`, `enriches_aspect`, `dependency`,
   reusing the existing property definitions by `$ref` (`stack` pattern, `$defs/functionalAspect`
   for `enriches_aspect`, the existing `dependency` `oneOf` shape, `convention_skills`,
   `phase_injections`, `priority` optional/documentational). `additionalProperties: false` on the
   row, and it explicitly forbids the foundation-only keys the BA's data model lists: `workflow`,
   `agents_per_phase`, `on_demand_agents`, `aar_analyst`, `hosts_aspects`, `framework_detection`,
   `detect`, `aspects`, `role_expertise` — mirror today's `kind: framework` `not` clause rather
   than inventing new wording.
2. Top-level `properties.frameworks`: `type: array`, `items: { $ref: "#/$defs/frameworkRow" }`,
   `uniqueItems` is not enough (rows are objects) — instead add a schema-level assertion (or, if
   AJV 2020 draft support is awkward for cross-item uniqueness, a companion check in
   `tools/sdlc-lint/lib/schema.mjs` or a small dedicated check) that no two rows share a `stack`,
   and that no row's `stack` collides with any foundation's own `stack` id (BA invariant: "stack
   unique across all rows and across all foundation stack ids"). Prefer the lint-side check if
   JSON Schema draft 2020-12 cannot express cross-array-item uniqueness on a computed key
   cleanly — do not fight the schema language for something a 10-line lint check states directly.
3. Extend the existing `kind: foundation` `then` block's `not.anyOf` — currently forbidding
   `enriches_aspect`/`dependency` — is unaffected (frameworks rows carry those, the foundation
   document itself still must not). Add a **new** conditional: `frameworks` is forbidden on `kind:
   framework` documents (mirror the existing framework `not` list, append `frameworks`).
4. Do **not** relax the `kind: framework` restrictions themselves — a standalone framework
   manifest (if any ever exists again, e.g. via `sdlc:create-pluguin`'s embedded-form choice, see
   §9) keeps today's shape. Only the foundation gains the new array.
5. Update the schema's top-level `description` to mention `frameworks` on foundations, matching
   the file's existing self-documenting style.
6. `dependentRequired`/`anyOf` at the top (`detect` or `dependency` required) is untouched — a
   foundation still requires `detect`; a `frameworks` row is not the document's own `dependency`.

Validate with `node tools/sdlc-lint/cli.mjs schema` after the edit, against the still-unmoved
plugin manifests (schema changes first, content changes later, per the ordering in §0).

## 3. Resolver: `plugins/sdlc/tools/resolve/manifests.mjs`

This is the R1-mitigating change and must produce **identical output** whether the frameworks are
read from 7 standalone manifests (today, tree mode) or from one foundation's `frameworks:` array
(after the move, both modes).

1. In `readManifest`/`classify`, after a `kind: foundation` record is classified, **synthesize**
   one framework record per entry in `doc.frameworks ?? []`. Each synthesized record must have the
   exact shape a real framework record has today: `{ file, doc, key?, version?, scope?, source? }`
   where `doc` is `{ kind: "framework", stack, enriches_aspect, dependency, convention_skills,
   phase_injections, priority }` — assembled from the row plus `kind: "framework"` (a row never
   carries `kind` itself; the synthesizer adds it so every downstream consumer that reads
   `r.doc.kind` keeps working unchanged).
2. **Path rewriting for injections**: a row's `phase_injections.security` text that
   references `retrofit-plugin/rules/snippets/retrofit-proguard.md` by path must, after the file
   move (§4), read `rules/snippets/retrofit-proguard.md` relative to
   `android-foundation`'s own root — this is prose text inside a YAML block scalar, not a
   structured field, so the fix happens once, by hand, when editing each embedded row's
   `phase_injections.security` string (§4), not by resolver logic. The resolver's job is only to
   set the synthesized record's `file` to the **foundation's** manifest path, so any *code* that
   resolves "this framework's directory" (e.g. `role_expertise` rule-path resolution in
   `plan.mjs`, which uses `dirname(r.file)`) lands on `android-foundation/`, matching where the
   relocated snippets now live.
3. `classify(records)` gains the synthesis step: call it once per foundation record, after the
   existing kind switch, so both `loadManifestsFromTree` and `loadInstalledManifests` — which both
   call `classify` — get it for free without a second implementation. This is the "one production
   path" FR-3 asks for.
4. De-duplicate by `stack` across (a) embedded rows and (b) any surviving standalone framework
   record — this is Edge case 1 (a stale cached `retrofit-plugin` still installed after the
   merge). When both exist, keep the embedded row (foundation is now authoritative) and push the
   standalone copy into `skipped`/a new `shadowed_frameworks` list with `reason:
   "superseded-by-embedded"`, following the existing `shadows` precedent in `mergePathLoaded`.
   Surface this via a `warn(...)` in `plan.mjs`'s existing warning channel — do not add a second
   reporting path.
5. Tree mode (`loadManifestsFromTree`) needs the same synthesis: it already reads
   `android-foundation/manifest.yaml` via the `plugins/**/manifest.yaml` glob, so passing that
   `doc` through the same `classify` gets `frameworks:` expansion automatically once step 3 is
   done — no separate tree-mode code path.
6. Do **not** touch `detect.mjs`. `resolveStack`/`dependencyPresent` keep consuming
   `{foundations, frameworks}` — the synthesized records satisfy that shape exactly, which is the
   BA's explicit "unchanged by design" boundary.
7. Do **not** touch `plan.mjs`'s `additiveRecords`/`expertiseSources` construction — it already
   filters `manifests.frameworks` by `stack.additive.includes(...)`, and synthesized records pass
   through that filter unchanged.

## 4. Asset relocation (executed only after §2 + §3 + the dual-mode test are green)

For each of the 7 plugins (`retrofit`, `ktor`, `room`, `datastore-proto`, `dagger`, `koin`,
`workmanager`):

1. Move `skills/<name>-conventions/` → `plugins/android-foundation/skills/<name>-conventions/`.
   Update the `SKILL.md` frontmatter if it self-references its own plugin id anywhere (check each
   file; most only reference the skill name, not the plugin id, but verify).
2. Move `rules/snippets/<name>-proguard.md` → `plugins/android-foundation/rules/snippets/`.
   Verify no name collision against the existing `proguard-keep.md` (Edge case 7) — the 7 names
   (`retrofit-proguard.md`, `ktor-proguard.md`, `room-proguard.md`, `datastore-proguard.md`,
   `hilt-proguard.md`, `koin-proguard.md`, `workmanager-proguard.md`) are already distinct from
   each other and from `proguard-keep.md`; confirm content is not duplicated keep-rule text
   (`grep` each snippet against `proguard-keep.md` for overlapping `-keep class` lines).
3. Fold each plugin's `manifest.yaml` fields into one row under
   `android-foundation/manifest.yaml`'s new `frameworks:` array, renaming `convention_skills`
   entries from `<name>-plugin:<name>-conventions` to `android-foundation:<name>-conventions` (the
   S6/FR-4 rename — note `dagger-plugin:hilt-conventions` → `android-foundation:hilt-conventions`,
   the one case where plugin-name and skill-name diverge), and rewriting the `phase_injections`
   snippet-path reference (§3.2) from `<name>-plugin/rules/snippets/...` to
   `rules/snippets/...` (relative to `android-foundation/`, matching how the foundation's own
   `role_expertise` rule paths are already written relative-to-self).
4. Fold `runtime-dependencies.json` content: check whether any of the 7 declare a runtime
   dependency the foundation's own `runtime-dependencies.json` does not already list; merge rather
   than drop (read each file — the BA did not fully inventory these; verify before assuming
   they're empty/trivial).
5. Delete the 7 plugin directories entirely (`plugins/retrofit-plugin/`, `plugins/ktor-plugin/`,
   `plugins/room-plugin/`, `plugins/datastore-proto-plugin/`, `plugins/dagger-plugin/`,
   `plugins/koin-plugin/`, `plugins/workmanager-plugin/`) — one cut, per user_decisions #2. Also
   remove the two stray `.DS_Store` files inside `dagger-plugin/` as part of the deletion (not a
   separate concern, just noting they exist so the delete is understood to be total).
6. Remove their 7 entries from `.claude-plugin/marketplace.json` (17 occurrences per the BA's
   count — verify with `grep -c` after editing that only the `android-foundation` entry's own
   description remains, updated to mention the now-embedded frameworks per Story 5's acceptance
   criteria).

## 5. `tools/brain-sync/lib/classify.mjs`

- `KNOWN_PLUGINS`: remove the 7 entries, keep `sdlc`, `android-foundation`. This is a breaking
  change to `pluginsTouched()` for *historical* PRs that touched `plugins/retrofit-plugin/**` —
  Edge case 6 says those change notes must still resolve. Since `classify()` is only invoked at
  sync time for *new* PRs (existing change notes are static markdown, already rendered), this is
  safe: it only affects future classification, never rewrites history. Confirm by reading
  `tools/brain-sync/lib/render.mjs`'s note-generation path to make sure it does not re-classify
  old PRs on every `sync` run (spot-check, do not assume).
- Update `tools/brain-sync/test/classify.test.mjs` fixtures/assertions that hardcode the old
  `KNOWN_PLUGINS` list or file paths under the 7 removed plugin dirs.
- `tools/brain-sync/test/{render,pr,cli}.test.mjs`: grep each for the 7 plugin names and update
  fixture data that names them.

## 6. Prompts / commands / agents

- `plugins/sdlc/commands/security-init.md` (4 occurrences) — likely enumerates installed stack
  plugins including the 7; update to reflect the merged shape.
- `plugins/sdlc/commands/doctor.md` — the human/JSON output examples already show `➕ frameworks:
  retrofit (additive)` sourced from `additive_profiles`/`stack.additive`, which is **unchanged**
  (FR-4 preserves `stack` ids) — no functional change here, but grep for any literal mention of a
  `*-plugin` name in prose and update it.
- `plugins/sdlc/commands/list-stacks.md` — likely lists plugin roots by globbing
  `plugins/*/manifest.yaml`; confirm it does not hardcode the 7 names, and if it renders "source"
  as a plugin name, confirm it now shows `android-foundation` for all embedded frameworks (correct
  — the row's own manifest **is** the foundation's).
- `plugins/sdlc/agents/security-analyst.md` — grep for framework-plugin names in its prose (likely
  an example list); update.
- `plugins/sdlc/skills/create-pluguin/SKILL.md` — see §9.

## 7. Docs sweep

`README.md` (6), `CONTRIBUTING.md` (3), `CHANGELOG.md` (7 — add a **new** entry announcing the
breaking merge, major version bump, migration path; do not edit historical entries),
`docs/COST-AND-MODELS.md` (4). Grep each file for the 7 plugin names and `enriches_aspect`
examples; update counts ("8 plugins" → "2 plugins": `sdlc` + `android-foundation`) and any
per-plugin cost/model table rows that named a framework plugin separately (they may need folding
into the `android-foundation` row, since a framework never shipped its own agents/models to begin
with — verify `COST-AND-MODELS.md`'s actual structure before assuming a row-per-plugin shape).

`ARCHITECTURE.md` and `CORE-TODO.md` are pointer stubs per CLAUDE.md — do not edit their content;
follow them into `.brain/` (§11).

## 8. `/sdlc:doctor` + `tools/migrate` — FR-6, Story 3

The existing `tools/migrate/{cli,migrate}.mjs` + `config/agent-migrations.json` mechanism is the
right shape to extend (data-driven renames, `check`/`apply`, never auto-applies) — **do not** build
a second migration mechanism.

1. New data file `plugins/sdlc/config/plugin-migrations.json` (separate from
   `agent-migrations.json` since the token shape differs — a `plugin:skill` id, not a bare agent
   name): one entry per removed plugin, `{ "plugin": "retrofit-plugin", "since": "sdlc@X.Y.Z",
   "reason": "...", "skill_renames": { "retrofit-plugin:retrofit-conventions":
   "android-foundation:retrofit-conventions" } }` for all 7, including the
   `dagger-plugin:hilt-conventions` → `android-foundation:hilt-conventions` divergent case.
2. Extend `tools/migrate/migrate.mjs` with a second scan, parallel to `yamlAgentTokens`/
   `scanConfigs`'s agent-name logic but keyed on `skill:` lines instead of `agents:` blocks —
   `.claude/sdlc.local.yaml`'s `extensions.skills[].skill` field and any `convention_skills`-shaped
   override, using the same targeted-token-rewrite discipline (never re-serialize YAML). Also scan
   for a bare removed-plugin **name** appearing as a key anywhere a plugin id is expected (report
   only — there is nothing in `sdlc.local.yaml` shaped that way today; confirm by reading the
   config schema before adding a check for a shape that may not exist).
3. `readInstalledPlugins`/`installed_plugins.json` and `settings.json` `enabledPlugins` are
   **harness-owned files** `/sdlc:doctor` must not write (CLAUDE.md hard rule: never modify
   settings outside explicit user instruction via the dedicated `update-config` mechanism, and
   these aren't even this repo's files — they're the consumer's). For those, `doctor.md` step 3c
   gains a **report-only** addition: if `manifests.mjs`'s new `shadowed_frameworks` (§3.4) is
   non-empty, or a registered install key matches one of the 7 removed plugin names, print a line
   telling the user to uninstall the stale plugin (`/plugin uninstall <name>@agentic-sdlc`) — this
   is advisory text, not a file rewrite, matching FR-6's "report... offer... never automatically."
4. Update `plugins/sdlc/commands/doctor.md` step 3c's description and the human/JSON output
   examples to mention skill-id findings alongside agent-name findings (reuse the existing
   `findings[] = {file, where, from, to, conflict?}` shape — add `kind: "agent" | "skill"` to
   disambiguate in the JSON, since both migrations now run through the same command).
5. New tests: `plugins/sdlc/tools/migrate/test/*.test.mjs` (check whichever test file already
   covers `migrate.mjs` — extend it) for the skill-id rename scan/apply, mirroring the existing
   agent-rename test shapes (idempotency, conflict-when-both-spellings-present, YAML
   comment/formatting preservation).

## 9. `sdlc:create-pluguin` — FR-7

Per user_decisions this is "target the embedded form or be removed." Recommendation: **retarget**,
don't remove — a future non-Android framework (e.g. a Spring Boot library) still needs a place to
land, and the embedded shape is now how frameworks attach to *any* foundation, not just Android.

1. `plugins/sdlc/skills/create-pluguin/SKILL.md`'s "If framework:" branch (line ~51) must ask
   **which foundation hosts it** (today it already asks which aspect and warns if unhosted — extend
   that same question to also confirm the foundation, since the target is now that foundation's
   `frameworks:` array, not a new plugin root).
2. Change the framework template (line ~94 "manifest.yaml — framework template") from "scaffold a
   new plugin directory" to "append a row to `<foundation>/manifest.yaml`'s `frameworks:` array" —
   same fields (`stack`, `enriches_aspect`, `dependency`, `convention_skills`,
   `phase_injections`), same kind-guard validation (line ~173), but the skill/snippet files land
   under the **foundation's** `skills/`/`rules/snippets/` rather than a new `skills/`/`rules/`
   tree.
3. Update the "Kind guards" section's framework checklist (line ~173-174) to also flag `kind`
   (rows never declare it — the synthesizer adds it) and the new cross-row `stack` uniqueness rule
   from §2.2.
4. Keep the standalone-plugin path alive for `kind: foundation` (a genuinely new platform, e.g.
   iOS) — only the framework branch changes.

## 10. Lint: reject a nested `manifest.yaml`

Edge case 3: after the move, `plugins/android-foundation/**` must contain **no** `manifest.yaml`
below its own root, or tree mode (which globs `plugins/**/manifest.yaml`) would find one that
installed mode (`join(info.installPath, "manifest.yaml")`, root only) never would — reproducing
the exact trap this whole change exists to close.

1. New `tools/sdlc-lint/lib/nested-manifest.mjs`: glob `plugins/*/**/manifest.yaml` (i.e.
   `plugins/<name>/**/manifest.yaml` excluding the root itself — `plugins/<name>/manifest.yaml` is
   fine, anything deeper is not) and fail if any match exists. Simple, deterministic, no schema
   validation involved — this is a structural check, sibling to `checkRoster`/`checkMachineValues`
   in the same directory, not an extension of `schema.mjs`'s AJV pass.
2. Wire it into `tools/sdlc-lint/cli.mjs` as a new `nested-manifest` command (mirror the
   `printReadDiscipline`-style wrapper) and into whatever aggregate "run everything" command the
   CLI already exposes (check for an `all`/`ci` command in `cli.mjs` before assuming one needs to
   be added).
3. Test: `tools/sdlc-lint/test/nested-manifest.test.mjs` — a fixture tree with a clean
   `android-foundation/manifest.yaml` at root passes; a fixture with a second manifest under
   `android-foundation/frameworks/x/manifest.yaml` fails with a clear message.

## 11. Vault (`.brain/`) — per `second-brain.md`

All in the **same commit** as the code change per the rule's "add its MOC row in the same
commit":

1. `.brain/decisions/ADR-0026-embed-framework-providers-in-the-foundation.md` (new, §1) —
   frontmatter `adr: 26, status: accepted, date: 2026-09-20, supersedes: 2`. Body: context
   (S1/S2/S8), decision (the `frameworks:` array + resolver synthesis, FR-1 through FR-5),
   consequences (breaking rename S6, R7 KMP-reuse trade-off, granularity loss — Edge case 4).
   References implementing PR(s) as plain text per the rule (`#<n>`, filled in at PR time, not
   during this planning pass).
2. `.brain/decisions/ADR-0002-framework-provider-pattern.md` — add `status: superseded` (or the
   vault's existing convention for a superseded ADR — check another superseded ADR, if any exists,
   for the exact frontmatter shape before inventing one) and a note pointing to ADR-0026. Do not
   delete it (CLAUDE.md hard rule: never delete files unless the spec explicitly asks — the BA
   asks to "supersede," not remove).
3. `.brain/decisions/_moc-decisions.md` — add the ADR-0026 row (same commit, per the rule that a
   note absent from every MOC fails `check`).
4. `.brain/components/*.md` for the 7 removed plugins (`retrofit-plugin.md`, `room-plugin.md`,
   `dagger-plugin.md`, `workmanager-plugin.md`, `koin-plugin.md`, `ktor-plugin.md`,
   `datastore-proto-plugin.md`) — do **not** delete (same hard rule); each gets a short "merged
   into `[[components/android-foundation]]` — see ADR-0026" note replacing its stale content, so
   the note remains resolvable and non-orphaned rather than describing a directory that no longer
   exists.
5. `.brain/components/android-foundation.md` — update to describe the now-embedded frameworks
   (the `frameworks:` array, the 7 stack ids it carries, the skill-id rename).
6. `.brain/_moc-root.md` — the 7 `[[components/<name>-plugin]]` rows under "## Components" stay
   (they still resolve, per §11.4) but each should read as historical/merged, or be re-labelled;
   do not remove the rows (removing an existing MOC row is not itself forbidden by CLAUDE.md, but
   there is no requirement to — leaving them pointing at the "merged into" stub notes is simpler
   and avoids an unrelated MOC diff). Add nothing new here since no new component was created.
7. `.brain/architecture/manifest-and-aspects.md` §2 (3 occurrences per BA) — update the file-tree
   diagram: remove the `retrofit-plugin/` block, add the `frameworks/` note under
   `android-foundation/manifest.yaml`, and update the closing "a framework adds `manifest.yaml` +
   a skill... and nothing else" line to describe the embedded-row shape instead.
8. `.brain/architecture/stack-provider-pattern.md` (2 occurrences) — update wherever it contrasts
   "framework = separate plugin" against "foundation = separate plugin"; both are now one plugin
   for Android, though the *pattern* (aspect ownership vs. aspect enrichment) still holds
   conceptually — the note should say so explicitly to avoid reading as contradicted by ADR-0026.
9. `.brain/planning/` — new `c3-embed-framework-providers.md` (or a `roadmap.md` entry, per §1)
   linking `[[decisions/ADR-0026-embed-framework-providers-in-the-foundation]]` and
   `[[planning/c2-framework-providers]]` (plain reference, reversal noted).
10. Run `node tools/brain-sync/cli.mjs check --vault .brain` and keep it clean before considering
    this section done — per the rule, this is the gate, not a nice-to-have.

## 12. Branch / commit convention (not executed this pass)

Per `scope_note`, this plan does not create the branch or commit. When implementation runs:
branch name follows the repo's existing pattern seen in git status/log (`feature/<slug>` or
similar — confirm the exact convention from recent branch names before implementation, e.g.
`git branch -a --sort=-committerdate | head`), commit messages follow Conventional Commits per
`tools/brain-sync/lib/classify.mjs`'s `changeType` regex (`feat`/`fix`/`docs`/etc. prefix), and per
`user_decisions` #3 the branch is **not merged** until `feat/sdlc-multi-host-port` lands — record
that dependency in the PR description when it is opened.

## 13. Sequencing note — `multi-host-port` (out of scope, follow-up)

`.claude/worktrees/multi-host-port/dist/antigravity/` enumerates all 7 plugin directories in its
emitter and is explicitly out of scope for this change (user_decisions #3). **Follow-up required**
once that branch lands: its emitter must be updated to stop enumerating the 7 removed plugin
dirs and instead emit `android-foundation`'s embedded frameworks however that port's target
format represents additive capabilities (inspect the port's emit manifest shape at that time — do
not guess its structure now, since editing that worktree is out of scope for this pass).

## 14. Risks carried into implementation

- R1/R2 (critical/high, BA) — mitigated structurally by the ordering in §0; the dual-mode test is
  the actual gate, not just documentation of intent. Implementation must not proceed past §4 until
  that test is committed and passing against the **pre-move** tree (7 standalone manifests) to
  prove the synthesis logic is correct before it is the only path.
- Schema cross-item uniqueness (§2.2) may need a lint-side check rather than pure JSON Schema —
  decide during implementation, do not force an awkward `unevaluatedItems`/`contains` trick if a
  10-line JS check is clearer; either is acceptable, precision matters more than "no lint code."
- `runtime-dependencies.json` merge (§4.4) and the `create-pluguin` retarget (§9) are the two
  places this plan recommends verifying content before assuming triviality — both are flagged
  "INCOMPLETE / not verified" in the BA and should be read fresh during implementation, not
  assumed from this plan's description.

## 15. Convention skills to invoke during implementation

- `superpowers:test-driven-development` — before the dual-mode equality test and the lint-rule
  test (§0, §10).
- `superpowers:verification-before-completion` — before declaring the ordering in §0 satisfied.
- No Android-specific convention skill applies: this change touches the marketplace's own
  resolver/schema/vault, not Android application code.
