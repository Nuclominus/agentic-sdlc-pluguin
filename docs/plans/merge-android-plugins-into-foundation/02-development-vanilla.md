# Development: merge the 7 additive Android plugins into `android-foundation` (ADR-0026)

## Files created

- `.brain/decisions/ADR-0026-embed-framework-providers-in-the-foundation.md` — the ADR recording
  the reversal of ADR-0002.
- `.brain/planning/c3-embed-framework-providers.md` — roadmap note reversing C2.
- `plugins/sdlc/config/plugin-migrations.json` — skill-id rename data for `/sdlc:doctor` (parallel
  to `agent-migrations.json`, keyed on `plugin:skill` id).
- `tools/sdlc-lint/lib/nested-manifest.mjs` + `tools/sdlc-lint/test/nested-manifest.test.mjs` — the
  lint rule against a manifest below a plugin root (edge case 3).

## Files moved (git mv, tracked as renames)

- `plugins/{retrofit,ktor,room,datastore-proto,dagger,koin,workmanager}-plugin/skills/*-conventions/`
  → `plugins/android-foundation/skills/*-conventions/`
- `plugins/{retrofit,ktor,room,datastore-proto,dagger,koin,workmanager}-plugin/rules/snippets/*-proguard.md`
  → `plugins/android-foundation/rules/snippets/*-proguard.md`

## Files deleted

- The 7 plugin directories in full: `plugins/retrofit-plugin/`, `plugins/ktor-plugin/`,
  `plugins/room-plugin/`, `plugins/datastore-proto-plugin/`, `plugins/dagger-plugin/`,
  `plugins/koin-plugin/`, `plugins/workmanager-plugin/` (manifest.yaml, `.claude-plugin/plugin.json`,
  README.md, runtime-dependencies.json, plus stray `.DS_Store` files under `dagger-plugin/`).

## Files modified

- `schemas/manifest.schema.json` — new `$defs/frameworkRow`, new foundation-only `frameworks`
  property, a new `kind: framework` guard forbidding `frameworks` on a standalone framework
  manifest.
- `plugins/sdlc/tools/resolve/manifests.mjs` — `classify()` now synthesizes one `kind: framework`
  record per `frameworks:` row on every foundation record (both `loadManifestsFromTree` and
  `loadInstalledManifests` call `classify`, so both loader modes get it for free), plus a
  de-duplication pass by `stack` that resolves Edge case 1 (a stale standalone install of a
  now-embedded framework) into a new `shadowed_frameworks` list.
- `plugins/sdlc/tools/resolve/plan.mjs` — one new `warn(...)` line surfacing
  `manifests.shadowed_frameworks` through the existing warning channel.
- `plugins/android-foundation/manifest.yaml` — new `frameworks:` array (7 rows) folding in each
  plugin's `enriches_aspect`/`dependency`/`convention_skills` (renamed to the
  `android-foundation:` namespace)/`phase_injections` (ProGuard snippet paths rewritten from
  `<name>-plugin/rules/snippets/...` to `rules/snippets/...`).
- `plugins/android-foundation/skills/{retrofit,ktor,room,datastore,hilt,koin,workmanager}-conventions/SKILL.md`
  — fixed the one stale path reference each (`<name>-plugin/rules/snippets/...` →
  `rules/snippets/...`); no frontmatter self-plugin-id references found.
- `plugins/android-foundation/.claude-plugin/plugin.json`, `plugins/android-foundation/README.md`
  — version bump to `3.0.0`, description updated for the embedded frameworks.
- `.claude-plugin/marketplace.json` — 7 `*-plugin` entries removed, `android-foundation`'s
  description updated, marketplace version bumped `2.0.0` → `3.0.0`.
- `tools/brain-sync/lib/classify.mjs` + `tools/brain-sync/test/classify.test.mjs` — `KNOWN_PLUGINS`
  trimmed to `sdlc`/`android-foundation` (only 4 of the 7 removed plugins were ever listed there);
  fixtures updated.
- `plugins/sdlc/commands/security-init.md`, `plugins/sdlc/agents/security-analyst.md` — prose
  examples updated from `retrofit-plugin` to "the embedded `retrofit` row".
- `plugins/sdlc/skills/create-pluguin/SKILL.md` — the "framework" branch retargeted end-to-end:
  Phase 0/1 ask which foundation hosts the new framework and check cross-row `stack` uniqueness;
  Phase 2's scaffold + template now append a row instead of creating a plugin directory; Phase 4
  skips marketplace registration for a framework; Phase 5 validates the row-shaped kind guards.
  The "foundation" branch is unchanged.
- `plugins/sdlc/tools/migrate/migrate.mjs` + `plugins/sdlc/tools/migrate/cli.mjs` — new
  `loadSkillRenames`/`yamlSkillTokens`/`rewriteSkillLine` plumbing; `scanConfigs`/`applyRenames`
  now handle both the agent-name migration (ADR-0021) and the new skill-id migration (ADR-0026) in
  one pass, findings tagged `kind: "agent" | "skill"`.
- `tools/sdlc-lint/test/migrate.test.mjs` — 4 new tests for the skill-id scan/apply/idempotency and
  the combined-migration report.
- `tools/sdlc-lint/test/manifests.test.mjs` — the dual-mode equality test (Story 2), a
  Story-1/4 activation test, and the shadowed-framework de-dup test.
- `tools/sdlc-lint/cli.mjs` — wired `nested-manifest` in as a new verb and into `all`.
- `plugins/sdlc/commands/doctor.md` — step 3c now covers both migrations plus a print-only
  `shadowed_frameworks`/stale-install advisory; human/JSON output examples updated.
- `README.md`, `CONTRIBUTING.md`, `CHANGELOG.md` (new `[3.0.0]` breaking-change entry),
  `docs/COST-AND-MODELS.md`, `docs/WORKFLOW.md`, `docs/INSTALLATION.md` — the documentation sweep:
  every reference to a `*-plugin` name replaced with the embedded-row shape, marketplace/plugin
  counts corrected, `CONTRIBUTING.md`'s "Adding a framework" section rewritten around the row
  template.
- `.brain/decisions/ADR-0002-framework-provider-pattern.md` — `status: superseded`, a pointer note
  to ADR-0026 added; body kept for history (not deleted).
- `.brain/decisions/_moc-decisions.md`, `.brain/planning/_moc-planning.md` — new rows for
  ADR-0026 / the c3 note (same commit, per the second-brain rule).
- `.brain/components/{retrofit,ktor,room,datastore-proto,dagger,koin,workmanager}-plugin.md` —
  replaced with a short "merged into `[[components/android-foundation]]`" note each (not deleted).
- `.brain/components/android-foundation.md` — updated to describe the embedded frameworks.
- `.brain/architecture/manifest-and-aspects.md`, `.brain/architecture/stack-provider-pattern.md` —
  file-tree diagram and pattern description updated for the embedded shape; both note the pattern
  itself (aspect ownership vs. enrichment) is unchanged, only where a row's declaration lives.

## Key design decisions

1. **Followed the plan's §0 ordering literally.** Schema → resolver synthesis → dual-mode equality
   test written and green against the **pre-move** tree (7 standalone manifests still existed) →
   only then moved files/deleted plugins/rewrote marketplace.json. Verified the gate with
   `node --test tools/sdlc-lint/test/manifests.test.mjs` before touching a single plugin directory.
2. **Synthesis lives once, inside `classify()`**, called from both `loadManifestsFromTree` and
   `loadInstalledManifests` — not duplicated per loader mode. This is the actual mechanism that
   makes the dual-mode equality test pass by construction rather than by coincidence.
3. **De-duplication by `stack` resolves Edge case 1** without a second reporting path: a losing
   standalone record is pushed into `shadowed_frameworks`, surfaced through `plan.mjs`'s existing
   `warn()` channel (not a new one), mirroring the existing `mergePathLoaded` `shadows` precedent.
4. **The plan's guessed test-file paths didn't exist** (e.g. `plugins/sdlc/tools/resolve/test/`
   and `plugins/sdlc/tools/migrate/test/`) — per the plan's own instruction to verify with `Glob`
   first, I located and extended the real files: `tools/sdlc-lint/test/manifests.test.mjs` and
   `tools/sdlc-lint/test/migrate.test.mjs`.
5. **Skill-id migration reuses the existing agent-migration mechanism's shape and discipline**
   (data file, `check`/`apply`, targeted-token YAML rewrite, never re-serializing) rather than
   inventing a second migration architecture, per the plan's explicit instruction.
6. **Runtime-dependencies.json merge (§4.4) verified trivial**, not assumed: all 7 removed plugins'
   `runtime-dependencies.json` had an empty `dependencies: []` — nothing to fold into the
   foundation's own file.
7. **`sdlc:create-pluguin` retargeted rather than removed** (plan's recommendation), including the
   cross-row `stack`-uniqueness check and the `kind`-is-synthesized note in the validation section.

## Deviations from spec

- None substantive. One small addition beyond the plan: also updated
  `plugins/android-foundation/README.md` (not explicitly listed in the plan's docs sweep, but
  directly describes this plugin's own shape and was clearly stale) and `docs/WORKFLOW.md` /
  `docs/INSTALLATION.md` (also not in the plan's explicit §7 list, which named only
  README/CONTRIBUTING/CHANGELOG/COST-AND-MODELS, but both contained the same stale `*-plugin`
  references and architecture diagrams that would otherwise mislead a reader).
- The plan's §2.2 cross-item `stack`-uniqueness invariant was left to `tools/sdlc-lint` /
  `sdlc:create-pluguin`'s prose check rather than a schema-level assertion, per the plan's own
  "either is acceptable" guidance — no dedicated lint script was added for it in this pass beyond
  the `create-pluguin` skill's manual-check instruction, since no existing fixture stresses two
  real foundations sharing a stack id today; flagged below as a follow-up if desired.

## Manual verification done

- `node tools/sdlc-lint/cli.mjs schema` — 19/19 passed (schema change validated against the
  still-unmoved manifests, then again after the move).
- `node --test tools/sdlc-lint/test/manifests.test.mjs` — 21/21 pass, including the Story 2
  dual-mode equality test (all 7 frameworks), Story 1/4 activation test, and the shadowed-framework
  de-dup test.
- `node --test tools/sdlc-lint/test/plan.test.mjs tools/sdlc-lint/test/profile.test.mjs` — 88/88
  pass (unaffected consumer paths).
- `node --test tools/sdlc-lint/test/migrate.test.mjs` — 10/10 pass, including the 4 new skill-id
  migration tests.
- `node --test tools/sdlc-lint/test/nested-manifest.test.mjs` — 3/3 pass.
- `node --test tools/brain-sync/test/*.test.mjs` — 32/32 pass.
- `node tools/brain-sync/cli.mjs check --vault .brain` — clean.
- `node tools/sdlc-lint/cli.mjs all` — clean except one **pre-existing, unrelated** finding in
  `plugins/sdlc/evals/results/2026-09-20T15-42-44-182Z/aggregate-result.json` (a `~/.claude` path
  in an eval results artifact, untouched by this change — confirmed via `git diff` showing no
  modification to that file).
- Ad hoc: `loadManifestsFromTree(repoRoot)` against the real, post-move repo resolves all 7
  frameworks (`dagger, datastore-proto, koin, ktor, retrofit, room, workmanager`) with zero errors.
- Secret-leak scan (see below) over every file this change touched: clean.

## Open issues / blockers for next phases

- **Out of scope by instruction:** `.claude/worktrees/multi-host-port/dist/antigravity/` still
  enumerates all 7 removed plugin directories in its emitter. Per the per-call instructions this
  worktree was not read into or edited. Follow-up needed once that branch lands: its emitter must
  stop enumerating the 7 removed plugin dirs and instead emit `android-foundation`'s embedded
  frameworks in whatever shape that port's target format represents additive capabilities.
- **Not executed this pass (§12 of the plan, by its own instruction):** branch/commit/PR — this
  developer dispatch only branched and worked in the tree, per `branch_first`.
- **Follow-up candidate (not blocking):** a dedicated cross-row `stack`-uniqueness lint check
  (rather than relying on `create-pluguin`'s manual instruction) could be added if a future PR
  actually needs to catch a duplicate `stack` id between two foundations' `frameworks:` arrays at
  CI time.

## SECRET-LEAK CHECK

value: clean — grep for `aws[_-]?access|api[_-]?key|secret[_-]?key|password\s*[:=]|bearer\s|private[_-]?key`
across every file this change touched hit only one pre-existing, unmodified line
(`plugins/sdlc/commands/security-init.md:69` — the example rule name `hardcoded_api_key`, part of
a sample YAML block already in the file before this change).

## Review finding fix

**Finding #1 (Important):** `schemas/manifest.schema.json`'s `frameworks` property description
claimed `stack` uniqueness was "enforced by `tools/sdlc-lint`", but no check existed — a
duplicate `stack` (or a collision with a foundation's own `stack` id) passed schema validation
and `sdlc-lint all` cleanly, and `manifests.mjs`'s `classify()` de-dup then silently dropped one
side with a misleading `superseded-by-embedded` reason.

Fixed by making the claim true, per the finding's instruction (make it true, don't weaken the
schema description):

- **Created** `tools/sdlc-lint/lib/stack-uniqueness.mjs` — a structural check, sibling to
  `nested-manifest.mjs` (same file shape, same "report violations only" return convention). Reads
  every `plugins/*/manifest.yaml`, collects one entry per (file, stack) for a foundation's own
  `stack`, each embedded `frameworks[]` row's `stack`, and a standalone `kind: framework`
  manifest's `stack`, then flags every group of 2+ entries sharing a `stack` — covering all three
  collision classes named in the finding (within one foundation, across two foundations, and
  foundation-vs-standalone).
- **Modified** `tools/sdlc-lint/cli.mjs` — imported `checkStackUniqueness`, added
  `printStackUniqueness` (mirrors `printNestedManifest`'s violations-only shape), wired the new
  `stack-uniqueness` verb into the `case` dispatch, `runAll()`, the `VERBS` list, and the
  `--help` usage/description lines (also added the previously-missing `nested-manifest` help line
  while touching that block).
- **Created** `tools/sdlc-lint/test/stack-uniqueness.test.mjs` — 5 tests: one clean case, and one
  per collision class (embedded-vs-embedded same foundation, embedded-vs-embedded cross
  foundation, embedded-vs-foundation's-own-stack, embedded-vs-standalone-framework).

**Deviation from the finding's literal read:** none — did not touch `manifests.mjs`'s de-dup
tie-break or the `minItems: 1` constraint, as instructed.

**Bug caught during verification:** the first draft of `checkStackUniqueness` read manifests via
`readFileSync(file, "utf8")` using the repo-relative path returned by `globSync({ cwd: root })`
(matching `checkNestedManifest`'s path convention, which never reads file contents). Since
`readFileSync` resolves relative paths against `process.cwd()`, not `root`, every manifest read
failed silently in the scratch-directory tests (though it happened to work against the real repo,
where `cwd === root`). Fixed by resolving reads through `join(root, file)` while keeping the
reported `file` field repo-relative.

### Verification

- `node --test tools/sdlc-lint/test/stack-uniqueness.test.mjs` — 5/5 pass.
- `node --test tools/sdlc-lint/test/nested-manifest.test.mjs tools/sdlc-lint/test/manifests.test.mjs`
  — 24/24 pass (no regression).
- `node tools/sdlc-lint/cli.mjs all` — `stack-uniqueness: clean`; every other verb unchanged;
  the only remaining failure is the pre-existing, out-of-scope `plugin-paths` finding in
  `plugins/sdlc/evals/results/2026-09-20T15-42-44-182Z/aggregate-result.json`.
- No genuine collision found in the current tree — nothing to report as a blocker.

### Files touched by this fix

- Created: `tools/sdlc-lint/lib/stack-uniqueness.mjs`,
  `tools/sdlc-lint/test/stack-uniqueness.test.mjs`
- Modified: `tools/sdlc-lint/cli.mjs`
