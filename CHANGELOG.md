# Changelog

All notable changes to the Agentic SDLC Plugin (Android) marketplace.

## [Unreleased]

`sdlc` `1.16.0` → `1.18.0`, `android-foundation` `1.7.0` → `1.8.0`.

### Changed

- **Model registry refreshed against Anthropic's current pricing** (`plugins/sdlc/config/models.json`,
  checked 2026-09-04). The `fable` tier now resolves to **Claude Fable 5.1** (`claude-fable-5-1`)
  instead of the legacy `claude-fable-5` — the same failure shape as the earlier `opus` repoint:
  sessions are served by Fable 5.1, so a fable-tier phase priced against the old id resolved
  `cost_usd: null`. Fable 5.1 also prices cache reads at **0.025×** input (`$0.25/MTok`) rather than
  the standard 0.1×, so `cached_input` moves from `1.00` to `0.25`; input/output stay `$10/$50`.
  Sonnet 5's `$2 / $0.20 / $10` is now Anthropic's standard price (the scheduled 2026-09-01 rise to
  `$3/$15` was cancelled), so the `pricing.note` that flagged it as intro pricing is gone. New
  `mythos` moves to `claude-mythos-5-1` (same 0.025× cache-read rate). Pin-only entries keep every
  active id priceable: `fable-5` (`claude-fable-5`) and `mythos-5` (`claude-mythos-5`) at the old
  rates, `opus-4-5` (`claude-opus-4-5`) and `sonnet-4-5` (`claude-sonnet-4-5`). Pins are keyed on
  the bare id — the pricing lookup strips a snapshot date, never adds one, so a dated key would not
  resolve from its alias. No tier was added, so `pipeline_tiers`, the hook and both schemas are
  untouched.
- The usage test's `TIER_MODEL` map is derived from the registry so it cannot drift on a repoint,
  with the current tier ids, tag uniqueness and the Fable 5.1 estimate row pinned explicitly. The orchestrator's
  `_telemetry.json` example shows `claude-opus-5` for an opus-tier phase, not `claude-opus-4-8`.

- **Logging is separated, not deleted.** `android-foundation/rules/logging.md` was "Logging
  Hygiene": logs were a temporary debugging aid, and the rule's operative section was a pre-Done
  cleanup sweep that deleted every log statement added during a session. It is now organised around
  *which artifact a log line is compiled into* — a `Development<Type>` decorator bound by DI in the
  debug source set (preferred), a lazy runtime severity gate where there is no seam to decorate
  (baseline), or a build-flag level set once at a third-party component's configuration point (the
  narrow exception). Hand-rolled `if (isDebugBuild)` guards inside business logic are forbidden;
  decorators carry logging and no behaviour; substitution keys on the build-type axis, not the
  flavor axis. Recorded as ADR-0020.
- The rule's audience widens from `[developer, reviewer]` to
  `[developer, reviewer, debugger, tester, security-scanner]`, and `rules/INDEX.md` is updated in
  step. It now cross-references the test-source exemption in `rules/testing.md`, so an agent reading
  "one facade only" does not read it as a ban in `src/test/`.
- `rules/workflow.md` no longer contradicts the rule it links to — its General Rules bullet said
  "Debug logs are session-only. Remove before Done." while pointing straight at `logging.md`.

### Added

- **Agents live in the core; foundations carry expertise — PR-1 of 3 (ADR-0021, `sdlc` 1.18.0).**
  The core now ships the whole roster: `reviewer`, `tester` (3-attempt cap), `debugger`
  (read-only), `devops` and `cicd` join the existing seven, and `plugins/sdlc/manifest.yaml` binds
  every phase (`review`, `test`, `debugging` included) plus the on-demand agents. Every role agent
  carries the same **Stack expertise slot**: orchestrated, it receives a `Stack expertise for
  <role>` block and a `Skills for this role` list in its stable prefix; on demand, it runs exactly
  one command — `node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs expertise --role <name>` — and
  receives the same two blocks. A foundation declares that expertise in a new manifest block,
  `role_expertise` (per core role: `invariants` ≤ 1400 chars, `rules` paths emitted absolute,
  `skills` rows with a mandatory/recommended policy); the resolve command merges it (foundation
  first, frameworks alphabetically), renders `plan.profile.prompt_blocks[agent]`, and the
  orchestrator pastes the blocks verbatim (3b-1) instead of hand-rendering the extension list
  (3b-1a). `sdlc-lint roster` (part of `all`) holds the four seams: every bound role ships a core
  `.md`, every recipe phase is bound, every `role_expertise` key/rule/skill resolves (a
  `superpowers:*` skill must be declared by the plugin that mandates it), and every agent carries
  its bootstrap line. **Nothing changes for an Android run yet**: `android-foundation` still binds
  its own roster (now warned as deprecated); PR-2 extracts its expertise into skills +
  `role_expertise`, PR-3 deletes `android-foundation/agents/`.
  Design: `docs/superpowers/specs/2026-09-05-agents-in-core-design.md`;
  track: `.brain/planning/i1-agents-in-core.md`.
- **`/sdlc:doctor` migrates a project's config across an agent rename — and there are no runtime
  aliases.** An agent name is used exactly as written: the key in `.claude/model.local.json`, the
  name dispatched, the `role_expertise` key and the file on disk are one string. A first cut of this
  release kept the retired `android-*` names alive by rewriting them in the resolver, the tier
  lookup and the model-enforcement hook; review found six defects in that layer, every one a
  disagreement between two copies of the same map about which spelling a given step was keyed on.
  The layer is gone. Instead, every run now REPORTS a config entry that names an agent the
  marketplace does not ship (`extensions.skills[].agents`, `model.local.json` `agents{}`), and
  `/sdlc:doctor` fixes them: it reads the versioned rename data in
  `plugins/sdlc/config/agent-migrations.json`, lists each `from → to`, and rewrites only those name
  tokens **after you approve** (`tools/migrate/cli.mjs check|apply` — YAML by targeted replacement
  so comments and formatting survive, JSON by re-serialisation). This is the first time doctor
  writes anything; diagnosis stays read-only, the write is bounded to those two files and is never
  performed non-interactively or under `--json`. An un-migrated project degrades rather than
  misbehaves: the extension row injects nothing, the model key leaves the frontmatter tier in force,
  and both are named on every run.
- **A publish-time gate for the logging rule.** `hooks/git-guard.sh` (`PreToolUse(Bash)`) blocks
  `git commit`, `git push` and `gh pr create` when the code being published violates
  `rules/logging.md`, and `hooks/validate-logging.sh` is the per-file checker behind it. This closes
  a real gap: `kotlin-guard.sh` is `PostToolUse(Edit|Write)`, so it only ever sees files edited
  through those tools — a hand edit, a `sed` in a Bash call, a merge, a rebase or a cherry-pick
  reached the commit unchecked. The gate re-scans the staged diff on `commit`, and the branch's
  commits over its base on `push` / `pr create`.
  It checks Tier 1 constructs (`println(`, `android.util.Log.*`, `.printStackTrace()`) plus the
  ADR-0020 rules: eager message construction, hand-rolled `if (BuildConfig.DEBUG)` guards around a
  log call, a `Development*` decorator outside a development source set, and a `src/debug/**` DI
  provider with no `src/release/**` counterpart. Test sources are exempt throughout.
  **It reports `file:line` and blocks; it never edits code** — the fix for a misplaced trace is to
  move it into a decorator, which is a refactor, and deleting a legitimately-placed log is itself a
  violation under the new rule. It fails open on every condition it cannot evaluate (no `jq`, not a
  git repo, an undeterminable base).

Enforcement of the forbidden constructs themselves is unchanged: `println`, `android.util.Log.*`
and `.printStackTrace()` in production Kotlin are still blocked at write time by the
`validate-kotlin.sh` hook and `rules/snippets/non-negotiable.md`.

## [1.13.0] — 2026-08-05

`sdlc` `1.15.0` → `1.16.0`, `android-foundation` `1.6.0` → `1.7.0`. Two changes to the shape of a
run, both of them about the difference between what an instruction says and what a program does.

**Reviewing agents stop writing code.** Agents stop inheriting every tool, and a reviewer's findings
reach the codebase through a gated `remediation` phase instead of the reviewer's own `Edit`.

**The run's start stops being prose.** Steps 0 → 1d of `pipeline-orchestrator/SKILL.md` — roots,
dependency preflight, stack detection, profile merge, project overrides, model tiers, workflow
resolution, skip-rules and the cost cap — become one shipped command that answers in **0.77 s** what
the prose cost a measured median of 24 turns / 14 tool calls / $1.31 to discover. `SKILL.md` loses
808 lines (−31.8%, ~40.6k → ~28.2k tokens).

**The bump matters for the same reason it did in 1.12.0.** `plugin_version` in `_telemetry.json`
comes from `plugins/sdlc/.claude-plugin/plugin.json`, and it is what tells a run whose security
phase could edit code apart from one whose security phase only reports. Shipping this under
`1.15.0` would leave both pipeline shapes reporting the same string.

### Added

- **Explicit `tools:` allowlists on every shipped agent.** The key is an allowlist, and omitting it
  does not mean "the defaults" — it grants the FULL toolset. Ten of eleven `android-foundation`
  agents omitted it, so `android-reviewer` ("READ-ONLY … does NOT write code") could `Edit` any
  file, and `android-debugger` ("Writing the fix → developer") told itself four sections later to
  "Fix root cause". Prose was the only thing holding those boundaries.
- **A gated `remediation` phase.** New generic control flow — `gate: {after, min_severity}` in
  `schemas/workflow.schema.json`, orchestrator step `3-gate` — parses the machine-contract line
  `ISSUES_FOUND: critical=N high=N medium=N low=N` and dispatches the development agent only when a
  Critical or High finding exists; otherwise the phase is recorded `status: "skipped"` at zero cost.
  A one-way hand-off, not a loop, and necessarily separate from `loop:` because `security` runs
  inside `parallel: [security, test]`, whose members are bare strings that cannot carry control
  flow. It fails **open** on an unparsable producer: one needless dispatch beats a dropped Critical.
- **`sdlc-lint agent-tools`** — CI enforcement for a declared non-empty `tools:`, no agent-dispatch
  tool (`Agent`/`Task`/`SendMessage`/`Workflow` belong to the orchestrator alone), no `Edit` on a
  reviewing agent, and a present `description:`. Plus gate-ordering validation in `cycles`.
- **Descriptions for `android-cicd` and `android-devops`**, which had none and so rendered as
  "Agent from android-foundation" — unreachable by trigger words, only by exact name.
- **The `resolve` command** — `node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs plan --dry-run`.
  Eleven dependency-free modules under `plugins/sdlc/tools/resolve/`, because the plugin ships no
  `package.json`. `tools/sdlc-lint/lib/detect.mjs` and `lib/load.mjs` become re-export shims, ending
  a double implementation the orchestrator prose had documented rather than fixed. Two things had to
  be reimplemented for the same reason — YAML and workflow schema validation — and each is allowed
  only under a **differential gate** that runs it against `yaml` / `ajv` over the same inputs in CI
  and requires agreement. The YAML gate earned its place immediately, catching blank lines counted as
  continuation progress, which had silently turned `enabled: true` into the string `"true"` in nine
  files.
- **`sdlc-lint start-window`** — the instrument ADR-0019's Definition of Done depends on. It measures
  from the `pipeline-orchestrator` `Skill` invocation to the first agent dispatch, split at the
  `.checkpoint/_started_at` write so the collapsible steps are separated from Step 2's workspace
  creation. The figure it was built to defend had been produced by a script that was never committed:
  quoted in an ADR and two planning notes, re-derivable by nobody. It reproduces that figure exactly
  in that figure's own unit — and in doing so exposed the unit. The published counts were assistant
  **JSONL lines**, one per content block; deduped by `message.id` (real API calls) the same corpus is
  median 13 whole / 9 collapsible, a 2.10× ratio. Both units are now reported side by side, and the
  DoD is restated in API calls: **9 → 2–3**.
- **A repeatable `--runs`** on `sdlc-lint`, which previously took only the first glob — so auditing
  two corpora as one population *required* copying trees together, which is the operation that
  triggered the mtime defect below.

### Fixed

- **`3-parallel` never said its members run `3d`.** Step 4 specified only "run 3e validation on
  each", but 3d is what populates `CONTEXT.{phase}_output`. Since `security` is a parallel member
  and the new gate reads that field, the gate would have failed open on every run. Step 4 now
  spells out the full per-phase tail (3d → 3d-1/3d-2 → 3e → 3d-3).
- **`cycles` validated `loop.return_to` ordering but not `gate.after`**, so a gate pointing at a
  later or undeclared phase would pass CI and then silently dispatch on every run instead of never.
- **The opposite defect in core**: `business-analyst` and `document-writer` were instructed to write
  their deliverable with no `Write` tool, and no agent carried `Skill` even though the orchestrator
  injects convention skills into every phase prompt — so mandatory skill invocations failed silently.
- **Five defects the resolve command found by *running* a step rather than reading it.**
  `thinking-deeply` was declared as a runtime dependency since `Initial commit` and exists in no
  version of superpowers, yet three consecutive runs recorded `missing_skills: []`. The preflight
  stamp could not go stale — its documented invalidation triggers did not include *a dependency
  changing underneath it* — so a green preflight stood for six weeks over a dependency that was never
  satisfiable; it is keyed to the versions it was computed against now. The dependency declaration
  was inverted: `sdlc` declared two skills none of its own agents use while `android-foundation`,
  where all six mandates live, declared an empty array, leaving `brainstorming` claimed by nobody.
  Plugin discovery globbed a cache that holds every version ever installed and let filesystem order
  pick the winner; it reads the exact `installPath` from `installed_plugins.json` now. Plus two
  `[object Object]` defects invisible to unit fixtures, which is why `plan.test.mjs` builds a
  synthetic consumer on disk.
- **Three signals wired to dead channels**, all found reviewing the prose collapse. The compliance
  contract measuring this very change reported a flat 0%, because its pattern wanted `cli.mjs plan`
  and the command it guards is `node "…/cli.mjs" plan` — a closing quote where the pattern wanted a
  space. The degraded path echoed stderr, which is empty under `--json`, so a halt reached the user
  with no reason. And `warnings[]` was written to stderr in non-JSON mode only, while the
  orchestrator always invokes with `--json` — a project whose `sdlc.local.yaml` failed to parse ran
  on plugin defaults *silently*. `contracts.test.mjs` now asserts every `bash_match` pattern matches
  some fenced block in the document it guards.
- **`--stack=NAME` was advertised in four places and did nothing.** It skips detection now rather
  than filtering it — the distinction is the flag's whole purpose — and an unknown name halts instead
  of falling through to vanilla. The `🎯 Active stack profiles` print, which the deleted prose called
  "a contract with the user", is restored.
- **`profile_source` read the workflow recipe's origin**, so a project-local *recipe* would make the
  *stack profile* report `"project"`. Split into `stack.profile_source` and `workflow.origin`.
- **The run date came from `mtime`** (#116). mtime is not a property of a run — copying, restoring or
  syncing rewrites it — and the run date decides every `predates` verdict and therefore every
  contract's denominator. A `cp -R` without `-p` while merging two corpora moved three published
  rates by up to 37 points, and both outputs looked equally healthy. Four content-derived links
  replace it (telemetry `started_at` → `.checkpoint/_started_at` → the oldest checkpoint's
  `completed_at` → the owning session's earliest transcript timestamp); when none resolves, every
  contract scores `na: undated`, and an undated run no longer renders as a compliant `✓`.
- **`sdlc-lint --json` emitted no envelope on some error paths** (#126), so a caller piping to `jq`
  got a parse error rather than a diagnosis and could not tell *"the tool failed"* from *"the tool
  had nothing to say"*. A per-verb table test now asserts `--json` parses on every exit code a verb
  can return.
- **Two `seal.test.mjs` fixtures aged out of their own window**, leaving `develop` red from
  2026-07-29 and handing two unrelated PRs a red baseline. A fixture for a **subprocess** cannot use
  an injected clock — the child reads `Date.now()` — so against the suite's fixed anchor those
  fixtures drifted past `findSealable`'s 24 h window and were skipped as `"stale"`. The failure
  surfaced as `sealed.length === 0`, which reads like a bug in the sealer.

### Changed

- **`security` loses its `heal:` block in every recipe.** Healing re-dispatches the phase's own
  agent to repair a build break; an agent with no `Edit` can only re-report the same failure at full
  price. `remediation` carries the guard instead, because it is the phase that writes code.
- **Cost caps rise on the six recipes that gained the phase** (`default` $12.75 → $16.00, `bugfix` /
  `hotfix` / `refactor` $9.00 → $12.50, `android-feature` $16.50 → $19.75, `android-bugfix` $12.75 →
  $16.00). A gated phase enters `base_total` at half weight and `worst_total` at full: when the gate
  opens, `remediation` is a full development dispatch, and a cap that ignored it would halt the run
  at exactly the moment a Critical vulnerability was found. `analysis.yaml` is the deliberate
  exception — it ships no code to remediate.

### Removed

- **Steps 0a/0b/0c/1/1a/1b/1c/1d leave `pipeline-orchestrator/SKILL.md`** — 2544 → 1736 lines
  (−808, −31.8%; 162,436 → 112,883 chars). The `resolve` command shipped first, deliberately without
  touching `SKILL.md`, so a regression in either half stays attributable.

  **Breaking for anything citing those step labels.** All thirteen cross-references into the deleted
  region were retargeted at the modules that now implement them, and `0-anchors` keeps seven
  historical labels alive as key-map rows (`0a-1`, `0c`, `1b`, `1b-ext`, `1d-0`, `1d-2`, `1d-4`)
  while declaring every other sub-step number stale. A hand-written sweep missed three of six
  dangling citations — a grep for `0a-2` does not catch a bare `Step 0b` — so `all.test.mjs` now
  walks every shipped `.md` and fails on a citation of a deleted label.

### Measurement & docs

- **Track H re-measured on a corpus nearly twice the size** — 29 auditable runs, live-contract
  compliance **91.9%**. `5b-finish`, the contract that replaced the 67% `5-clock`, is 6/6: the first
  real evidence ADR-0014 worked, though still short of the ~10 runs its gate asked for. The
  cardinality finding weakened as its denominator grew (`3d-1b-phase-cost` 40% → 60%), so "collapse
  cardinality, not lines" is now directional rather than established.
- **The H5 prompt-surface measurement inverted its own premise and nothing was cut for cost.** The
  saving from moving tokens out of the stable prefix is arithmetic, not an experiment
  (`removed_prefix_tokens × main_loop_turns × cached_input_price`) — and benchmarking it would have
  been worse than useless, since the 55.6–64.2% run-to-run spread on cache-read swallows the effect
  whole. Recorded as `measured`, not `decided`.
- **A brain-sync ordering rule**: merge the outstanding vault-sync PR *before* the next feature PR.
  Merging to `develop` opens the next sync PR immediately, so an unmerged one does not sit
  harmlessly — it becomes two open at once, and the `_moc-changes.md` collision stops being likely
  and becomes certain. Fourteen seconds of ordering replaces a checkout → merge → `reindex` loop.
- **Six tests closing the two real gaps from #129** — happy-path JSON shape for both verbs, and
  `resolveRunSessions` directly. Two of that issue's four claimed gaps did not exist; the correction
  was made on the issue publicly rather than by quietly narrowing scope. One assertion pins the
  `date_source` allowlist so mtime cannot come back at the contract level.

See `.brain/decisions/ADR-0018-reviewers-do-not-write-code.md` and
`.brain/decisions/ADR-0019-the-run-start-is-one-command.md`.

## [1.12.0] — 2026-07-29

`sdlc` `1.14.1` → `1.15.0` (other plugins unchanged). Track H, instruction fidelity: the end of a
run stops being three prose-driven steps, stops asking the model to compute values a machine
already holds, and gains a hook that seals a run the orchestrator forgot.

**The version bump matters more than usual here.** `plugin_version` in `_telemetry.json` is read
from `plugins/sdlc/.claude-plugin/plugin.json`, and it is what lets the compliance auditor tell a run on the new tail apart from one
on the old. Shipping these three changes under `1.14.1` would have left both eras reporting the same
string — and the re-measurement that decides Track H's remaining item reads exactly that field.

### Added

- **A `Stop` hook seals a run the orchestrator did not.** `plugins/sdlc/hooks/seal-run.sh` runs
  `finish` when a run's phases are all complete and `.checkpoint/_sealed` is absent, so a forgotten
  seal is repaired instead of lost. The gate is **completeness**, not recency — recency cannot tell a
  paused run from a finished one — and it was chosen by measurement: over a 19-run corpus it opens
  for 10 runs including the incident run that opened Track H, and stays shut for the three runs the
  audit had named as the worst offenders. The clock comes from the run's newest `mtime` rather than
  the wall clock, because a hook is late by construction and `now - anchor` would bill a run for the
  time that passed after it finished. The hook exits 0 unconditionally: for `Stop`, exit code 2
  blocks the agent from stopping, and a sealing net that can trap a user in a loop is worse than no
  net. See ADR-0016.

- **`sealed_by` in telemetry, and a `seal:stop-hook` line in `sdlc-lint compliance`.** The key
  records which path sealed a run; the auditor reports the split **beside** the contract rates,
  never inside them — the hook leaves no transcript trace, so folding it into a contract would let
  the net flatter the very number it must not influence. The share reads `n/a` rather than `0%` when
  nothing recorded a sealer, because a zero would assert the net never fired when the truth is that
  nobody was looking.

### Changed

- **The model no longer computes values a machine already holds.** `plugins/sdlc/MACHINE-VALUES.md`
  is the contract, the audit and the lint's own input at once: a registry of `key: owner` lines read
  by the new `sdlc-lint machine-values` verb, which fails when a registered key appears as the
  subject of a computation in shipped prose. Six formulas and 21 machine-owned telemetry keys left
  the orchestrator's prose. The case for a lint over firmer wording came from the audit itself — the
  two definitions of `cache_hit_ratio` had already diverged, with no symptom, because the tool
  overwrites whatever the model computed. See ADR-0015.

- **The completeness rule ships with the plugin.** `loadCheckpoints` / `computeReentry` /
  `resolveWorkspace` moved to `plugins/sdlc/tools/run/reentry.mjs`; `tools/sdlc-lint/lib/resume.mjs`
  is now a re-export shim over it. `--resume` and the seal gate share one definition of "done"
  instead of two that can drift, and the rule reaches a consumer's machine through
  `${CLAUDE_PLUGIN_ROOT}`.

- **The end of a run is one command instead of three.** Steps 5 and 5b used to mandate the run-clock
  arithmetic, `usage/cli.mjs enrich` and `report/cli.mjs report` as three separate prose-driven
  invocations across six sub-steps. The compliance audit shipped in Track H measured what that
  costs: single-command steps score 87–100%, while the one genuinely multi-step instruction — read
  the anchor, subtract, render with a BSD-vs-GNU `date` fallback — scored **67%**, the worst in the
  set, while carrying the most emphatic prose in the file. Compliance tracks how many separate
  things an instruction asks for, not how firmly it asks.

  A new shipped tool, `plugins/sdlc/tools/run/`, does all three in one call:

  ```
  node "${CLAUDE_PLUGIN_ROOT}/tools/run/cli.mjs" finish {task_slug} [--no-report]
  ```

  It writes `started_at` / `completed_at` / `wall_clock_seconds` from the machine anchor
  `.checkpoint/_started_at` — the orchestrator no longer authors them at all — then enriches cost
  from the phase transcripts, reconciles the cap verdict and the run window, and renders the HTML
  report. Every stage fails open: sealing a run cannot fail a run that already succeeded. There is
  no `--session` argument, because the enricher recovers the session by itself; the glob the model
  used to run (and could get wrong on any worktree-isolated run) is gone rather than relocated.
  See ADR-0014.

  `usage/cli.mjs enrich` and `report/cli.mjs report` are unchanged and still work for backfills and
  for auditing older runs — and that is the right tool for the job: `finish` computes
  `wall_clock_seconds` as `now - anchor`, so pointing it at a run that finished hours ago inflates
  that run's duration and cost, while `enrich` leaves the clock untouched by design.

- **`sdlc-lint` contracts can retire.** A contract may now carry `until: YYYY-MM-DD`; runs dated
  after it record `na: retired` rather than a failure. The three contracts this change replaced moved
  to `plugins/sdlc/skills/pipeline-orchestrator/contracts-retired.md`, so the compliance rates
  already published for the historical corpus stay reproducible — verified: the same 82.3% over the
  same 15 runs, after the procedure they measured no longer exists. The per-run detail also stops
  listing `na` verdicts as deviations, which had made runs that did everything asked of them render
  as failures.

## [1.11.2] — 2026-07-28

`sdlc` `1.14.0` → `1.14.1` (other plugins unchanged). Cost-record integrity: a run that nothing
priced can no longer report a clean cap verdict, and worktree-isolated runs price their
orchestration overhead against the right session.

### Fixed

- **A run nobody priced reported its cost cap as `within`.** An observed Android run finished with
  `total_cost_usd: null`, `cost_basis: "subagent_aggregate"` and `cap_gate_blind` on every phase,
  yet its report rendered `— · $16.50 cap · within`. Re-running enrichment against transcripts that
  had been on disk the whole time priced it at **$15.38 (93% of the cap)** — nothing had breached,
  but nothing had checked. The session transcript shows `tools/usage/cli.mjs` was never invoked at
  all: both the in-run pricing call and the end-of-run enrichment are prose steps in
  `pipeline-orchestrator/SKILL.md`, and skipping them left no trace (including the WARN that was
  supposed to announce it). The report now renders `unverified — run unpriced` instead of a cap
  verdict unless the run is transcript-priced, adds a `Cost: unpriced` signal naming the blind
  phases, and warns on stderr from `report/cli.mjs`. See ADR-0012.
- **Worktree-isolated runs mis-priced their orchestration overhead.** Step 5b(a) derived the
  session transcript by encoding the *current* cwd, but the harness files a session under the cwd
  it **started** in — so any run that moves into a git worktree (every `/sdlc:batch` task) resolved
  `--session` to an unrelated session. Phase costs survived; overhead was priced against a
  stranger's main loop, reporting **$0.55 where the truth was $5.21**, with no sign anything was
  wrong. Session lookup is now anchored on a dispatched `agent_id`, and `enrichTelemetry` discards
  a `--session` that holds none of the run's agents (`session_mismatch` + self-recovery from the
  phase transcripts).
- **The report under-reported QA iterations.** The KPI keyed on a phase literally named `qa`, but
  the loop belongs to whichever phase a recipe puts it in — `android-feature` runs it as `test`. A
  run that spent 2 iterations rendered `0 QA iteration(s)` while `aar/metrics.mjs`, which sums,
  reported 2 off the same telemetry. Now summed across phases, with one Signals line per phase that
  actually ran a loop.
- **Run timestamps were model-authored and wrong.** Step 5 asks for `started_at` / `completed_at`
  rendered from the `.checkpoint/_started_at` epoch via `date -u -r`; an observed run instead wrote
  its local EEST clock stamped `Z` — 3h20m off the anchor — and derived `completed_at` from it, so
  the record was internally consistent and externally false. Pricing already ignored these strings
  (ADR-0007), but the report header, the journal and every rollup read them. Enrichment now
  reconciles both against the anchor (120s tolerance) and warns, leaving `wall_clock_seconds`
  untouched.

### Added

- **`reindex` verb in `tools/brain-sync` (#96).** Two brain-sync follow-up PRs open at once both
  append a row to `_moc-changes.md`, so merging `develop` into the second conflicts every time. The
  index is machine-owned and must be regenerated rather than hand-merged — but the only
  regenerating verb was `sync --backfill`, which rewrites every note from its PR and destroys the
  enriched prose the vault rule requires. `reindex` rebuilds the index from the notes on disk and
  touches nothing else; the second-brain rule now names the conflict and prescribes it.
- **Track H — instruction fidelity, opened as the priority roadmap track (#93).** The four defects
  above were all steps `SKILL.md` mandates and the orchestrator did not perform — `usage/cli.mjs`
  appears zero times across that run's 42 `Bash` calls. The fixes make such misses loud, not
  impossible, so Track H moves load-bearing steps out of prose entirely: a transcript compliance
  auditor (H1, diagnostic and first), collapsing multi-step prose into single commands (H2), the
  machine-value invariant (H3), deterministic control flow gated on H1's numbers (H4), prompt
  surface reduction (H5) and a `Stop` hook sealing the run (H6). Spec in
  `.brain/planning/h-instruction-fidelity.md`; H1 displaces E8 as the highest-ROI next step.
  Includes a `roadmap/generate.mjs` fix — two hard-coded `[A-G]` track ranges silently dropped
  every Track H card from the generated board.

## [1.11.1] — 2026-07-28

`sdlc` `1.13.0` → `1.14.0` (other plugins unchanged). Point-fix closing the cost-cap work from
1.11.0.

### Fixed

- **`--dry-run` cost preview under-reported by 6–10× (#88).** Step 1d-1 modelled a phase as a
  *single API call* — 35k input, 60% cached, 3k output, pricing an `opus` row at `$0.16`. A phase
  is a multi-turn agent loop, and every turn re-reads its whole accumulated prefix. Measured
  across 56 transcript-priced phases from 10 real runs, the true shape is close to the inverse of
  the assumption: uncached input is negligible (24–194 tokens) while **cache reads dominate the
  bill** (670k–820k per phase) and were not modelled at all — real medians `$0.95` opus / `$0.38`
  sonnet / `$0.15` haiku. The estimate was wrong in *shape*, not scale, which is why caps sized
  from it sat below their own median run and breached the moment the gate began working (#82).
  New `estimation_baselines` block in `config/models.json`, rewritten Step 1d-1 estimation, and a
  recalibrated `development` phase multiplier.

## [1.11.0] — 2026-07-28

`sdlc` `1.11.0` → `1.13.0`, `android-foundation` `1.5.0` → `1.6.0`. Makes the cost cap actually
fire, and introduces the stable `@release` install channel.

### Fixed

- **The cost cap had never been able to fire (#82).** `caps.max_total_cost_usd` (Step 3d-cap) was
  not a blind spot in an edge case — it was dead code on every run. Its only input was Step 3d-1's
  pricing of the **Agent result envelope**, which on this harness exposes a single aggregate
  `subagent_tokens` count with no input/output/cache split (ADR-0004). A phase cannot be priced
  from that, so 3d-1 correctly wrote `cost_usd: null` — and 3d-cap counted a `null`-priced phase
  as `$0`. Every phase contributed `$0`, `running_cost_usd` stayed at `0` for the whole run, and
  `running_cost_usd > cost_cap` was unreachable at any cap value. Found on the Android run
  `flutter-to-native-migration-plan`: cap `$0.75`, actual phase spend `$3.37`, no pause,
  `cap_status: "within"` written into telemetry — while phase 1's transcript, already on disk and
  unread, priced at `$2.97` on its own. Phases are now priced in-run from their transcript
  (`phaseCost()` / `cli.mjs phase-cost`, Step 3d-1b), with a Step 5b(d) reconciliation, new
  `cap_gate_blind` / `cap_breach_usd` fields and an `"exceeded-undetected"` status.
- **Every shipped recipe cap re-sized against measured cost.** The caps had been derived from the
  dry-run heuristic, so once the gate worked they self-breached; all 8 `sdlc` recipes and the 3
  `android-foundation` recipes were re-sized against real spend, and a last-dispatch overage is no
  longer blamed on the gate.

### Added

- **Per-project cost-cap override (#86).** An optional `cost_caps` key in
  `<project>/.claude/sdlc.local.yaml` retunes — or switches off — a shipped recipe's cap without
  shadowing the whole recipe: an exact recipe name wins over a `"*"` fallback, and an explicit
  `null` means uncapped in that project. Parsed in Step 1b, applied in Step 1d-0, recorded as
  `cost_cap_source` in telemetry and labelled in the HTML report.
- **Stable `@release` install channel (#78).** A `release` branch (cut from `develop` at `c1e3ac1`)
  now backs `/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin@release`. A marketplace added
  with a branch ref keeps updating from that ref, so `@release` only moves when a release is
  deliberately cut, while a plain `develop` install still tracks every merge. Documented in the
  README quickstart and `docs/INSTALLATION.md`.
- **`/release` maintainer command.** Repo-local (`.claude/commands/release.md`, deliberately not
  shipped in any plugin): preflight divergence/nothing-to-ship guards, a `chore(release): vX.Y.Z`
  bump on `develop` via a temp worktree, fast-forward of `release`, and the tag — never
  force-pushing. Includes a warn-only gate for plugins whose content changed since the last
  release without a `plugin.json` version bump.

## [1.10.0] — 2026-07-27

`sdlc` `1.9.1` → `1.11.0`, `android-foundation` `1.4.0` → `1.5.0`, plus three new framework
providers at `1.0.0`. The G1 self-healing micro-loops (ADR-0010), the E2 read-discipline contract
(ADR-0008) and its benchmark harness, the last C2 framework providers, and the plugin-path fix
(ADR-0009).

### Added

- **G1 — self-healing compiler/lint micro-loops (#77, ADR-0010).** After any guarded phase the
  orchestrator runs the active profile's compile/lint `heal_checks`; on failure it re-dispatches
  that phase's own agent with the tool output (max `heal.max_attempts`, default 2) instead of
  letting broken code ride to the end of the pipeline or leak into review rounds. A `heal:`
  workflow primitive keyed on **exit codes** (sibling of `loop:`, keyed on prose verdicts); step
  3b-0 snapshots the pre-dispatch tree so step 3e-heal can classify failures whose diagnostics all
  name files outside the phase's touched set as `pre-existing` at zero attempt cost; checkpoint
  fields `heal_attempts_used` / `heal_status` (`healed | exhausted | skipped | pre-existing`) flow
  into AAR metrics, the cross-run rollup and the HTML report. Android recipes guard
  `development` / `qa` with compile-only checks. Validated by 8 live pipeline runs.
- **Read-discipline contract + `sdlc-lint` guard (#68, ADR-0008).** Track E targets the pipeline's
  dominant cost — prompt-cache reads, measured at **6.65M tokens across 117 subagent turns** on a
  real 7-phase run (~27% fixed floor, ~73% accumulated context peaking at 101k). An audit of the
  five agent contracts that touch the file system found the guidance contradicting itself, so the
  contract moved into the orchestrator's `=== STABLE PREFIX ===` (served as a cache hit on every
  subagent turn, inherited by every future agent) and four agent contracts now defer to it rather
  than restating it. It draws one explicit line: reading from disk instead of trusting stale
  prompt state is *kept* (correctness); re-reading the same lines, or pulling a whole file where a
  narrower read would do, is *forbidden* (pure cost). Verification switched to targeted `grep`.
- **E2 benchmark harness (#69) and its campaign report (#75).** `bench/` is a two-arm A/B rig —
  `prepare.mjs` (disposable Kotlin/JVM specimen + provenance recorded *before* the run),
  `harvest.mjs` (archives first, then validates, so a failed run's evidence survives) and
  `compare.mjs` (medians, ranges, an engineering verdict). Three load-bearing constraints: no
  p-values ever, strict arm alternation, provenance recorded before the run. `bench/report/e2.html`
  is a self-contained bilingual (EN/УКР) visual twin of `bench/RESULTS.md`, rebuilt by `build.mjs`
  from the raw results so it cannot silently drift. The campaign itself was a **null result** —
  −10.65% inside a 55.6–64.2% within-arm spread — with the real yield being #70 and a `compare.mjs`
  defect.
- **C2 framework providers complete (#64).** Three additive providers — `koin-plugin` (`di`),
  `ktor-plugin` (`network`) and `datastore-proto-plugin` (`persistence`) — each `kind: framework`,
  shipping no agents, injecting only the `development` + `security` phases plus a conventions skill
  and an R8/ProGuard snippet, activating only when their dependency is detected.
  `kotlinx.serialization` was deliberately deferred: the aspect taxonomy has no `serialization`
  category yet.
- **Read-only roadmap board (#62).** `roadmap/generate.mjs` renders `roadmap/index.html` from the
  vault roadmap table, which stays the single source of truth; the generator rewrites only the
  SEED block, so curated card prose and priority flags survive every regeneration. The vault
  absorbed the Roadmap Development Plan, seeding tracks E6–E8, F1–F2 and G1–G2.
- **`sdlc-lint plugin-paths` drift guard.** Scans all shipped plugin text for home-anchored
  `.claude` paths in every spelling (`~`, `$HOME`, `${HOME}`), allowing only
  `${CLAUDE_CONFIG_DIR:-…}` (where a custom config dir still wins) plus an inline escape-hatch
  marker that requires a stated reason; also asserts the orchestrator still references the path
  contract. Wired into `sdlc-lint all` (`143/143 clean`) and CI. Same shape as the ADR-0008
  `read-discipline` guard.

### Fixed

- **Orchestrator read the wrong plugin tree, ignoring `CLAUDE_CONFIG_DIR` (#70, ADR-0009).** Plugin
  discovery globbed a literal `~/.claude/plugins/cache/**` — 27 occurrences across 10 shipped
  files, covering foundation detection, workflow recipe lookup, the model registry (tiers *and*
  pricing), runtime-dependency declarations, skill-path fallbacks and the deps-preflight stamp.
  Under a custom `CLAUDE_CONFIG_DIR` the pipeline therefore read the **operator's real home** while
  running under a different config tree. Caught in the E2 benchmark harness: of nine identical
  headless runs against a plain Kotlin/JVM specimen, one selected `android-foundation` — a plugin
  enabled in **neither** arm — and ran its 7-phase pipeline instead of the 5-phase vanilla one.
  Nondeterministic at ~1 in 9, so two runs of the same command on the same project could take
  different pipelines. Every path now resolves from the running install via the three roots defined
  in `plugins/sdlc/PLUGIN-PATHS.md` (`SDLC_PLUGIN_ROOT` / `PLUGIN_CACHE_ROOT` / `CONFIG_DIR`),
  computed in a new orchestrator **Step 0** from `${CLAUDE_PLUGIN_ROOT}` with a
  `${CLAUDE_CONFIG_DIR:-…}` fallback. Affects any non-default config dir — CI containers,
  per-project configs, multi-version testing — not just the benchmark.
- **Model registry could come from a different install than the one running.** The cache holds
  several versions of one plugin side by side (`sdlc/1.9.0/`, `sdlc/1.10.0/`), so the
  `**/sdlc/config/models.json` glob matched more than one registry and picked arbitrarily. The
  registry and `config/aspects.yaml` are now `Read` from `{SDLC_PLUGIN_ROOT}` directly.
- **`usage.mjs` hard-coded `homedir()`** for both the model registry and the `projects/**`
  transcript root, giving transcript-derived cost the same defect in code. New exported
  `claudeConfigDir()` resolves `CLAUDE_CONFIG_DIR` → `CLAUDE_PLUGIN_ROOT` → `$HOME`.

### Changed

- **HTML run-report restyled from the design mock (#60).** Presentation only — the renderer at
  `plugins/sdlc/tools/report/report.mjs` stays dependency-free and the shipped SSOT, with
  `tools/sdlc-lint/lib/report.mjs` re-exporting it so tests exercise the exact shipped code.
- **README slimmed to a front door (#58, #66).** 618 lines down to ~115 — quickstart, a
  documentation index, the commands and plugins tables — with every deep topic moved to a
  topic-per-file page under `docs/` (`RECIPES`, `COST-AND-MODELS`, `CONFIGURATION`,
  `INSTALLATION`), `docs/WORKFLOW.md` absorbing the Stack Provider Pattern prose and
  `CONTRIBUTING.md` absorbing both "adding a plugin" sections. The intro was then rewritten in
  plain language and the roadmap promoted to its own topic with the board screenshot.
- **Plugin versions bumped for the G1 release (#80).** `sdlc` `1.10.1` → `1.11.0`,
  `android-foundation` `1.4.0` → `1.5.0`. #77 shipped 32 files of G1 behavior under unchanged
  versions, and installed plugin copies cache **by version** — so the feature existed on `develop`
  and nowhere else until these bumps. A standing trap for any content-only PR under `plugins/`.

### Known gap

- Discovery still globs the **cache**, which holds every plugin installed under that config dir,
  enabled or not — so a cached-but-disabled plugin can still win foundation selection. This fix
  bounds the blast radius to one config tree; filtering to enabled plugins is tracked separately in
  `.brain/planning/backlog.md`.

## [1.9.1] — 2026-07-08

`sdlc` → `1.9.1` (other plugins unchanged). Point-fix to the transcript-derived
orchestration-overhead accounting from 1.7.0/1.9.0. Design in ADR-0007.

### Fixed

- **Orchestration overhead silently priced at `$0` (ADR-0007).** The
  `orchestration_overhead.main_loop` window was read from telemetry
  `started_at`/`completed_at` — ISO strings the LLM orchestrator authors in Step 5. On
  run `cit-478-batch-editor-animations` it wrote a start of `00:14:19Z` where the
  machine anchor (`.checkpoint/_started_at` epoch) and the real transcript turns were at
  `14:54:19Z`: right *duration* (2776s, so `completed_at` stayed self-consistent),
  absolute start off ~14h. `priceMainLoop` filtered **every** one of the ~34
  `claude-opus-4-8` orchestrator turns out of that window, so `main_loop` collapsed to
  `{turns:0, cost_usd:null}` and the run's largest cost bucket read as `$0` — reported
  `$8.15` vs a true `$13.22`. Per-phase costs use no window, so the loss was silent.
  `overheadWindow()` now sources the window from the machine-written
  `.checkpoint/_started_at` epoch + `wall_clock_seconds`, falling back to the telemetry
  ISO only when no anchor exists. Defense-in-depth: a window that still excludes every
  main-loop turn while the transcript has some reprices unbounded and sets
  `overhead_window_fallback`, which `cli.mjs` surfaces as a `WARN` — a zeroed overhead
  can never be silent again. Two regression tests; full sdlc-lint suite green (106).

## [1.9.0] — 2026-07-08

`sdlc` → `1.9.0` (other plugins unchanged). Resilient transcript-derived cost + a
durable AAR artifact. Design in ADR-0005 (2026-07-08 addendum) / ADR-0006; per-PR
detail in [`.brain/changes/`](.brain/changes/).

### Fixed

- **Lost cost when `agent_id` never reached `_telemetry.json` (#52).** A run shipped
  `$—` because each phase's `agent_id` was written to `.checkpoint/*.json` but not to
  `_telemetry.json`, so enrichment (which keys phases to transcripts by `agent_id`)
  skipped every phase (transcripts were intact — a `--session` backfill recovered
  `$18.01` + `$8.99` overhead). Enrichment now recovers the id from
  `.checkpoint/<phase>.json`, never clobbers `total_cost_usd` to `0` when nothing
  resolves, prices a resumed subagent's shared transcript once, and tolerates model-id
  suffixes (`[1m]`, dated snapshots). Step 3d-1 makes per-phase `agent_id` mandatory;
  Step 5b auto-resolves `--session` and verifies `cost_basis` flipped to `transcript`.

### Added

- **Durable `_aar.md` artifact (ADR-0006).** `/sdlc:aar` now persists its review to
  `docs/plans/{slug}/_aar.md` (discoverable + durable); the analyst stays read-only, the
  main session writes the file, and the trigger stays user-only.

## [1.8.0] — 2026-07-08

`sdlc` → `1.8.0` (other plugins unchanged). Track E enabler: a per-phase
cache-pressure signal built on the transcript-derived usage (1.7.0/1.7.1).

### Added

- **Cache-pressure signal (E5, #50).** `tools/usage` now records per phase `turns`,
  `peak_prefix_tokens` (largest single-turn cache-read), and a `cache_pressure` flag
  (peak > 80k). The HTML report shows `reads/turn · peak` under each phase and flags
  heavy phases in Signals; `tools/aar/metrics` adds those fields to `by_phase` plus a
  `cache_pressure_phases` list the AAR analyst uses to target cache-read reduction.
  `schemas/checkpoint.schema.json` registers the new fields.

## [1.7.1] — 2026-07-07

`sdlc` → `1.7.1` (other plugins unchanged). Point-fix to the `1.7.0` transcript-derived cost tool.

### Fixed

- **Cache/token/cost over-count in `tools/usage` (#48).** Claude Code writes one transcript line per
  content block of an assistant turn (a thinking block, each parallel tool call, …), and every line
  repeats the *same* response-level `message.usage`. `extractUsage` summed per line, so a single API
  call's usage was multiplied by its block count — inflating cache-read, billed tokens, and
  `cost_usd` by ~2–4× (measured 2.4× on a real 7-phase run: `$16.87` → `~$5.4`). `extractUsage` now
  dedupes on `message.id` (unique per API response), counting each turn once and falling back to
  per-line counting only for lines with no id. Regression test covers a multi-block turn.

`sdlc` → `1.7.0` (other plugins unchanged). Replaces the `cost_usd: null` fallback of `1.6.0` with
**real, transcript-derived per-phase cost**. Design in ADR-0005; per-PR detail in
[`.brain/changes/`](.brain/changes/).

### Added

- **Transcript-derived cost + real billed tokens (#46).** New dependency-free tool
  `plugins/sdlc/tools/usage/` (`enrich <run-dir> [--session <transcript>]`) reads each phase's
  subagent transcript (`~/.claude/projects/<cwd>/<session>/subagents/agent-<id>.jsonl`), sums the
  real `input`/`output`/`cache-read`/`cache-write` split, prices it against the registry, and
  rewrites `_telemetry.json` with real per-phase `cost_usd`, `billed_tokens`, `cache_creation_tokens`
  (`usage_source: "transcript"`), real `total_*` aggregates + `cache_hit_ratio`, and an
  `orchestration_overhead` block (orchestrator main-loop bounded to the run window + nested agents).
- **Cache-write pricing (#46).** `config/models.json` gains `cache_write_multipliers`
  (`ephemeral_5m: 1.25`, `ephemeral_1h: 2.0`) so prompt-cache creation is priced relative to the
  input rate; cache reads stay at `cached_input` (0.1×). Registered in `schemas/models.schema.json`.
- **Checkpoint fields (#46).** `schemas/checkpoint.schema.json` registers `agent_id`,
  `cache_creation_tokens`, `billed_tokens`, and the `transcript` usage source.

### Changed

- **Report + metrics show the real billed split (#46).** `tools/report/report.mjs` renders per-phase
  input / output / cache-read / cache-write + cost and an orchestration row that reconciles to the
  total; `tools/aar/metrics.mjs` adds `billed_tokens`/`cache_creation_tokens` and ranks top consumers
  by billed tokens. Both keep an aggregate fallback for un-enriched (older / missing-transcript) runs.
- **Orchestrator wiring (#46).** `pipeline-orchestrator` Step 3d-1 always records the phase `agent_id`;
  Step 5b runs cost enrichment before rendering the report. Enrichment never fails the pipeline.

### Fixed

- **Report no longer shows 0 tokens / no cost (#46).** `1.6.0` taught only `metrics.mjs` about the
  aggregate `subagent_tokens`; `report.mjs`/`rollup.mjs` still summed the unset split and rendered 0.
  Cost is now the real transcript-derived figure instead of `—`. Supersedes the cost-null decision of
  ADR-0004.

## [1.6.0] — 2026-07-07

`sdlc` → `1.6.0` and `android-foundation` → `1.3.0` (other plugins unchanged). Applies the
`brain-rudderstack-phase-b` After Action Review findings to plugin source (the review targeted the
plugin cache, whose edits are clobbered on update). Design in ADR-0004; per-PR detail in
[`.brain/changes/`](.brain/changes/).

### Fixed

- **Per-phase telemetry no longer zeroes all tokens (#44).** The harness result envelope exposes
  only an aggregate `subagent_tokens` count, not the split input/output/cached triple the
  orchestrator's Step 3d-1 expected — so estimation always fired and the metrics dashboard reported
  all-zero usage with a misleading zero cache ratio. Step 3d-1 now captures the aggregate verbatim
  (`usage_source: subagent_aggregate`), Step 5 sums `total_subagent_tokens` and reports
  `cache_hit_ratio: null` when genuinely unknown, and `tools/aar/metrics.mjs` surfaces the field.
- **Crash recovery is defined and correctly labelled (#44).** `android-foundation` workflow Step 2
  now attempts an in-session resume of the same agent before spawning a fresh one, and records which
  mechanism ran in a new per-phase `recovery` field — so cost attribution stops mislabelling a
  fresh restart as a same-session resume.

### Added

- **Aggregate-token + recovery telemetry fields (#44).** `schemas/checkpoint.schema.json` registers
  `subagent_tokens` / `tool_uses` / `duration_ms`, the `subagent_aggregate` usage source, and the
  `recovery` enum.

### Changed

- **Workflow-doc corrections from the same review (#44):** worktree-first workspace resolution in
  orchestrator Step 2 (resolve an existing worktree before any stash/checkout); point-of-use Skill
  self-checks plus a mismatched skills-matrix row-label fix in the android BA/developer agents; a
  documented docs-phase model escalation for outward PR + submodule work; and de-hardcoded the
  logging rules from a fixed library to "the project's logger (Kermit if present)".

## [1.5.0] — 2026-07-06

Only the `sdlc` plugin changed (→ `1.5.0`); other plugins are unchanged. This tag also formally
releases `sdlc` work that shipped to `develop` since **v1.2.0** without a cut release — the
intermediate `1.3.0` / `1.4.0` version steps were never tagged. Per-PR detail lives in
[`.brain/changes/`](.brain/changes/).

### Added

- **`session-recorder` closing agent + run journal (#35).** A top-level agent dispatched by the
  orchestrator as a built-in final step (Step 6): it reads the finished run's `_telemetry.json`,
  composes a ~20–30 word note, and creates-or-appends one newest-first entry (`date · slug · note ·
  elapsed · cost · phase count`) to the cumulative journal `docs/plans/_journal.md`. Each entry is
  closed by a `---` delimiter; same-day + same-slug re-runs replace in place. Best-effort (never
  fails the run), skipped under `--dry-run`. Design in ADR-0003.
- **Measured run clock (#35).** Orchestrator Step 2 captures a write-once start anchor
  (`.checkpoint/_started_at`); Step 5 computes `wall_clock_seconds` from it — run timing is now
  measured, not estimated, so `/sdlc:report`, the cross-run rollup, and `/sdlc:aar` all report
  accurate elapsed time.
- **Catch-up since v1.2.0** (previously shipped to `develop`, never tagged — detail in
  `.brain/changes/`): `sdlc:aar` After Action Review cycle (#27), `--resume` per-phase checkpoints
  (#25), HTML run-report artifact (#26), cross-run rollup `/sdlc:report` (#28), WorkManager
  framework provider (#29), `--dry-run` + cost-cap enforcement (#21), match-based workflow
  auto-selection (#20), project-local workflows + new intents (#22), deterministic `sdlc-lint`
  verifier + GitHub Actions CI (#23), and the Second Brain vault `.brain/` with PR-merge auto-sync
  (#31–#34).

### Fixed

- **Two pre-existing CI failures (#36).** Stale `load.test.mjs` frameworks snapshot (added the
  `workmanager` provider) and an `AAR reference integrity` false positive (excluded `.brain/`
  historical change notes from the dead-AAR-identifier grep, mirroring the existing
  `docs/superpowers/` exclusion).

## [1.3.0] — 2026-07-02

Only the `sdlc` plugin changed; other plugins remain at `1.1.0`.

### Added

- **Project-local model tier overrides `<project>/.claude/model.local.json`.** A project can reassign
  which tier each SDLC agent dispatches on — a `default` for all agents plus a per-agent `agents{}` map
  (`opus | sonnet | haiku | fable`). Resolution is `agents[<bare-name>] → default → agent .md
  frontmatter → sonnet`, applied identically by the `enforce-agent-model.sh` hook (so overrides are not
  reverted) and the orchestrator (new Step 1b-models; Step 3b-3). Validated by
  `schemas/model-local.schema.json`. Fail-open: a missing/malformed file or invalid tier falls back to
  the built-in frontmatter tiers. The registry stays the SSOT for tag→model_id+pricing — this only
  changes which tag an agent uses.
- **`/sdlc:model-config` command.** Interactive authoring of `.claude/model.local.json`: sources valid
  tiers from the registry, sets a project-wide default first, then optional per-agent overrides; merges
  idempotently and never clobbers existing config.

## [1.2.0] — 2026-07-01

Only the `sdlc` plugin changed; other plugins remain at `1.1.0`.

### Added

- **Model registry `plugins/sdlc/config/models.json`** — single source of truth mapping each short tag
  (`opus` / `sonnet` / `haiku` / `fable`, plus current-generation reference entries) to its concrete
  model ID. `pipeline_tiers` mirrors the `enforce-agent-model.sh` valid-tier list; `schemas/models.schema.json`
  validates the file. README, CORE-TODO, and the orchestrator (Step 3d-0/3d-1) now link to / resolve from
  the registry instead of restating model IDs.
- **Per-model pricing in the registry (SSOT for telemetry cost).** Each model carries
  `pricing: { input, cached_input, output }` (USD per MTok; `cached_input` = 0.1× input), plus an optional
  `pricing.note`. The orchestrator (Step 3d-1) now computes each phase's `cost_usd` from the registry —
  `(input−cached)/1e6·input + cached/1e6·cached_input + output/1e6·output` — instead of a hardcoded rate
  table; a model with no `pricing` yields `cost_usd: null` (stderr warning, excluded from `total_cost_usd`,
  which then prints a `partial` marker). `sonnet` uses intro pricing (`$2/$0.20/$10`, flagged via
  `pricing.note`, reverts to `$3/$0.30/$15` after 2026-08-31).

### Changed

- **`sonnet` tier now resolves to `claude-sonnet-5`** (was `claude-sonnet-4-6`) for telemetry/cost,
  following the Sonnet 5 release. The enforcement hook is unchanged — it enforces the short tier verbatim.

### Fixed

- **Stale Opus telemetry rate.** The old inline cost table billed Opus at `$15/$75` per MTok
  (Opus 4.0/4.1-era); Opus 4.8 is `$5/$25`, so telemetry over-reported Opus cost ~3×. Now sourced from
  the registry.

## [1.1.0] — 2026-06-24

All plugins bumped together to `1.1.0`. Reshapes the foundation↔framework relationship into a clean
three-level tree and moves every plugin profile to a single machine-read `manifest.yaml`.

### Changed — BREAKING (plugin profile format)

- **Single `manifest.yaml` per plugin replaces `stack.md` / `framework.md`.** All declarative profile
  data (previously split between YAML frontmatter and markdown body sections) now lives in one
  machine-read `manifest.yaml` with a `kind:` field (`foundation` | `framework`); `kind: framework`
  replaces the old `additive: true`. Plugin `.md` / `README.md` files are now human docs only — the
  orchestrator no longer parses them. The orchestrator globs `**/manifest.yaml` and splits by `kind`.
- **Aspect vocabulary extracted to `plugins/sdlc/config/aspects.yaml`** (single source of truth:
  `platform` + `functional` lists). Foundations may declare `hosts_aspects: all` (sugar = every
  functional category) instead of enumerating them; `framework_detection` and `hosts_aspects` are
  co-required.
- **Schema renamed + expanded:** `schemas/stack.schema.json` → `schemas/manifest.schema.json`; validates
  the full manifest (incl. `agents_per_phase`, `phase_injections`, `convention_skills`, …) and the
  `kind`-based guards. The aspect enums mirror `aspects.yaml`.

### Changed — foundation→framework aspect tree

- **Framework detection delegated from core to the foundation.** The core globs only foundations, picks
  the winner, and delegates framework discovery to it: the foundation declares `framework_detection`
  (where to look) and `hosts_aspects` (which functional categories it accepts); the orchestrator executes
  the search on its behalf and stays platform-agnostic.
- **Functional aspects replace the tautological `enriches_aspect: android`.** Frameworks now point *up* to
  a library category — `retrofit → network`, `room → persistence`, `dagger → di` — and attach under any
  foundation hosting that category. Two distinct aspect axes: `platform` (winner resolution) and
  `functional` (framework taxonomy).
- **Zero plugin→plugin dependencies.** Framework plugins declare `dependencies: ["sdlc"]` only and never
  reference another plugin's skill id; the foundation contract is the aspect, not a named plugin.

### Added

- **`sdlc:create-pluguin` skill** — a step-by-step wizard that scaffolds a schema-valid plugin (framework
  or foundation): identity, functional-aspect pick from the taxonomy, `manifest.yaml`, drafted phase
  injections + a conventions skill (asks auto vs. manual), marketplace registration, and validation.

## [1.0.0] — 2026-06-24

First stable release. **All plugins are versioned together at `1.0.0`** from this release
(`sdlc`, `android-foundation`, `retrofit-plugin`, `room-plugin`, `dagger-plugin`, and the
`agentic-sdlc` marketplace).

Android-only restructure: the marketplace drops iOS and reorganizes the Android stack into a
**foundation + additive framework plugins** model (the Framework Provider Pattern).

### Added
- **Framework Provider Pattern** — framework libraries (Retrofit, Room, Dagger/Hilt, …) are now
  **additive plugins** that attach to the orchestrator-managed flow rather than owning it. A framework
  plugin ships a `framework.md` profile with `additive: true` (same schema as `stack.md`), is
  **auto-detected** from the Gradle version catalog / build files, and is **enrich-only**: it
  contributes a convention skill + development/security phase-prompt injections + ProGuard keep rules
  + post-checks, but ships **NO agents** and owns **NO phases**.
- `additive: true` flag in `schemas/stack.schema.json` — marks a profile as an additive framework
  provider. The orchestrator collects additive profiles into an `ADDITIVE_PROFILES` set, merges their
  enrichments into the active flow, and **excludes** them from per-aspect winner resolution and
  `PRIMARY_PROFILE` selection (additive profiles never become the primary stack).
- `frameworks.enable` / `frameworks.disable` override in `.claude/sdlc.local.yaml` — force a framework
  profile on or off, overriding auto-detection.
- **`dependency`-based framework detection** — a framework plugin only **names** its library
  (`dependency: <coordinate>`); the orchestrator owns the search strategy: version catalog
  (`gradle/libs.versions.toml`) first with short-circuit, then module build files (`**/build.gradle*`,
  gitignore-aware). `file_contains` detect rules also gained glob-path support. A hand-written `detect`
  block remains as an escape hatch. Schema requires one of `detect`/`dependency`; `dependency` implies
  `additive: true`.
- **`retrofit-plugin`** — reference framework plugin (Retrofit / OkHttp): `framework.md`
  (`dependency: com.squareup.retrofit2`), `retrofit-conventions` skill, dev/security injections,
  `retrofit-proguard.md`.
- **`room-plugin`** — framework plugin for Room (`dependency: androidx.room`): `room-conventions` skill
  (suspend/Flow DAOs, `@Transaction`, parameterized queries, migrations + `exportSchema`, KSP),
  dev/security (MASVS-STORAGE) injections, `room-proguard.md`.
- **`dagger-plugin`** — framework plugin for Dagger/Hilt (`dependency: com.google.dagger`):
  `hilt-conventions` skill (constructor injection, `@Module`/`@InstallIn`, `@Binds` over `@Provides`,
  deliberate scoping, KSP), dev/security injections, `hilt-proguard.md`.

### Changed
- **`android-plugin` → `android-foundation`** — the Android stack provider was renamed to the
  "Android Foundation", the centerpiece stack provider. Its internal stack id stays `android`
  (aspect: android, priority 300); only the plugin name changed.
- Marketplace scope is now **Android-only**; the top-level marketplace description was rebranded to
  Android-centric (name stays `agentic-sdlc`).
- **DI "detect, don't impose" resolved** — the foundation now states only the generic DI principle;
  Hilt/Dagger specifics live in `dagger-plugin` and activate only when detected (a Koin project simply
  does not activate it). The long-standing `stack.md` DI TODO is removed.
- Retrofit/OkHttp, Room, and Dagger/Hilt ProGuard keep rules were **extracted out of** the foundation's
  `rules/snippets/proguard-keep.md` into each framework plugin. The pinned house rules (Coil3, Kermit,
  KSP, `@Serializable` routes, DataStore, Play Billing) stay in the foundation; only detect-don't-impose
  libraries (Retrofit, Room, Dagger/Hilt) move to framework plugins.

### Removed
- **`ios-plugin`** removed entirely — iOS is no longer in scope.
- `ios` and `shared` aspects removed from the `schemas/stack.schema.json` aspects enum.

### Fixed
- `sdlc` **0.2.2** — `enforce-agent-model.sh` never matched plugin-namespaced agents. Agents are
  dispatched as `<plugin>:<agent>` (e.g. `android-plugin:android-developer`) but the frontmatter
  file on disk is `<agent>.md`, so the hook searched `*/agents/android-plugin:android-developer.md`,
  found nothing, fell into fail-open, and emitted `[model-enforcement] … .md not found — skipping
  model check (non-SDLC agent?)` instead of enforcing the declared tier. The hook now strips the
  `<plugin>:` prefix (`bare_name="${agent_name##*:}"`) before building the search path.
- `sdlc` **0.2.1** — model-tier dispatch broke every agent call (`InputValidationError:
  expected one of "sonnet"|"opus"|"haiku"|"fable"`). The `Agent` tool's `model` parameter now
  accepts the short tier name only; both enforcement layers were converting it to a full model ID
  (`opus → claude-opus-4-8`). `enforce-agent-model.sh` now enforces the short tier verbatim (and
  recognizes the new `fable` tier); `pipeline-orchestrator` §3b-3/§3c pass the tier to `Agent()`,
  with the tier→full-ID mapping confined to telemetry/cost (§3d-1).

## [0.4.0] — 2026-06-23

Builds out the marketplace from the initial skeleton into a working native-mobile SDLC system.

### Added
- Full Android specialized roster (11 agents): `android-ba`, `android-developer`, `android-reviewer`,
  `android-security`, `android-tester`, `android-qa`, `android-docs`, plus on-demand `android-debugger`,
  `android-devops`, `android-cicd`, `android-aar` — with model/effort tiering.
- Generic orchestrator control flow: review-loops (`loop: {return_to, max_rounds}`) and parallel groups
  (`{parallel: [...]}`); `workflow.schema.json` + RESOLVER support; `android-feature` / `android-bugfix` recipes.
- Workflow discovery across all plugins (`**/workflows/*.yaml`); core ships only generic recipes.
- Profile-declared default workflow (`stack.md` `workflow:` field) — Android auto-selects `android-feature`.
- `file_glob` detection rule + nested `any`/`all`; precise detection — Android = Gradle **and** Kotlin,
  iOS = `*.xcodeproj` / `*.xcworkspace` / `Package.swift` (app-target + monorepo).
- MASVS/MASTG security in `android-security`; core `security-analyst` made platform-neutral.
- `manage-vault` skill — Obsidian vault lifecycle (scaffold → repair → STUB-aware (re)populate → archive).
- Authored the four Android convention skills (`android-architecture`, `android-compose-ui`,
  `android-data`, `android-navigation`) — previously Phase-3 stubs. Stack-agnostic principles,
  patterns, and anti-patterns; library choices defer to Architecture Detection and reference
  `rules/snippets/non-negotiable.md` rather than duplicating it.
- testTag convention + UI-testing requirement: every non-decorative Compose component carries a
  `testTag` from a centralized `TestTag` object (`TestTag.<Screen>Tags.<ELEMENT>`, grammar
  `<screen>.<element>`); per-screen index in `ui-patterns.md` for fast QA lookup. Documented in the
  `android-compose-ui` skill (§ Test tags) and enforced via `android-developer`/`android-qa`/
  `android-reviewer` checklists + `non-negotiable.md`.
- `validate-kotlin.sh` now also blocks inline `testTag("…")` / `testTag = "…"` literals in production
  Kotlin (steers to the central `TestTag` object). Fixed `kotlin-guard.sh` to propagate the
  validator's exit code — previously it swallowed exit 2, so **all** non-negotiable checks were silent
  no-ops; the regex rules now actually surface to the agent as documented.
- Vault testTag index: seeded `architecture/ui-patterns.md` note (the per-screen testTag table QA
  searches) + `android-docs` owns reconciling it whenever UI components change; documented in the
  `documentation.md` canon (structure, triggers) and the docs-agent Definition of Done.
- Android CLI as an OPTIONAL, plugin-owned advisory hook (core has zero Android-CLI knowledge).
- `/sdlc:init` command; `/sdlc:doctor` host-capability probe (uname + toolchains).
- `docs/WORKFLOW.md` (system diagrams) + `docs/WALKTHROUGH.md` (end-to-end Android run); READMEs
  restructured into the sectioned style and de-duplicated (root overview vs per-plugin detail).

### Changed
- QA in-pipeline scope = lint + unit + compile-check; full builds and instrumentation/UI/on-device tests
  are CI-deferred; capability-gated post-pipeline checks SKIP (not fail) when the tool is absent off-host.
- Version aligned to 0.1.1 across the marketplace and the `android`/`ios` plugins.

### Fixed
- 8 convention-skill stub frontmatters whose inline HTML comment broke YAML parsing.

## [0.1.0] — initial skeleton baseline

Initial native-mobile marketplace.

### Added
- `sdlc` core plugin (copied from upstream): pipeline-orchestrator skill, 5 cost-tiered default
  agents, slash commands, workflow recipes, and the enforce-agent-model hook. Web examples in
  commands/agents/orchestrator retuned to Android/iOS.
- `android-plugin` skeleton — `android` aspect (priority 300): stack.md, android-architect agent
  frontmatter, format/guard hooks. Convention skills are stubs (Phase 3).
- `ios-plugin` skeleton — `ios` aspect (priority 300): stack.md, ios-architect agent frontmatter,
  host-capability-aware format/guard hooks. Convention skills are stubs (Phase 4).
- `stack.schema.json` extended with `android`, `ios`, `shared` aspects.
- `CORE-TODO.md` tracking the mobile retune (file_glob detection, MASVS security, CI-deferred builds).

### Removed
- All web/server framework providers from upstream (Laravel, Django, NestJS, Next.js, React, Vue,
  Angular, Symfony, Flask, FastAPI, Spring, etc.) and the JS/PHP/Python/Java/C# foundations.

### Known limitations
- iOS app-target auto-detection needs `file_glob` (not yet supported); SPM packages detect today,
  app-only repos use `--stack=ios`. See CORE-TODO.md §1.
- security-analyst base checklist is still OWASP-web; MASVS retune pending. See CORE-TODO.md §2.
