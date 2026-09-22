---
adr: 29
status: accepted
date: 2026-09-08
supersedes: null
---

# ADR-0029 — One SSOT, host packages emitted at build time

## Context

The marketplace runs only on Claude Code. Its substance is host-neutral — a 12-agent roster, stack
detection, workflow recipes, per-role expertise — but its expression is not: dispatch is
`Agent({subagent_type, …})`, paths resolve through `${CLAUDE_PLUGIN_ROOT}` and a `/plugins/cache/`
marker, cost comes from parsing Claude Code JSONL transcripts, and `config/models.json` maps tier
tags to Anthropic model ids.

Two other CLIs now ship plugin systems close enough to target: **Antigravity CLI** (`agy`, the
Gemini CLI successor) and **Codex CLI**. The question was not whether to support them but where the
host difference is allowed to live.

Two facts, both measured rather than assumed, bound the answer.

**Antigravity is natively compatible to a degree the docs do not state.** Against a probe tree built
from unmodified `plugins/sdlc`, `agy plugin validate` on 1.1.27 reported `skills: 3 processed`,
`agents: 12 processed`, `commands: 11 processed (converted to skills)`, `hooks: 1 processed` — and
every installed file was byte-identical to its source (`diff` clean on `agents/reviewer.md`). The
host performs the command→skill conversion itself, accepts flat `agents/*.md`, and passes agent
frontmatter through untouched. The only structural requirement is that `plugin.json` and
`hooks.json` sit at the plugin root; until they do, `agy plugin validate` says `missing plugin.json`
and `hooks: skipped (not found)`.

**Antigravity model ids embed reasoning effort.** `agy models` lists `gemini-3.8-flash-high|medium|low`
and `gemini-3.1-pro-high|low`. So the `model:` + `effort:` pair the roster already declares maps to
exactly one string — the `effort:` key is not a field this host lacks, it is half the key.

## Decision

**The authored tree stays exactly as it is. Host packages are rendered from it at build time,
committed, and gated. Nothing translates at run time.**

1. **`plugins/**` is the single source of truth.** Authors keep writing Claude Code shapes. A new
   `sdlc-lint emit` verb renders `dist/<host>/`; `emit --check` compares without writing and is
   wired into `all`, so CI gates it with no new step.

2. **Emit, never interpret.** The rejected alternative was for `resolve/cli.mjs plan --json` to hand
   the orchestrator a `host.dispatch` recipe to read and follow. That is a runtime translation
   layer — the shape [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]] §5
   deleted after six defects, every one of them two copies of a map keyed differently. It also puts
   an indirection hop on Step 3c, the most load-bearing instruction in the orchestrator, where
   [[planning/h1-compliance-auditor]] measured that compliance tracks how many separate things an
   instruction asks for. And only a generator can *delete*: on a host with no transcript parser, the
   Claude-envelope prose must not be present at all, or a model can follow it and fabricate.

3. **A host target is a repackager until measurement says otherwise.** Every transform must justify
   its existence against observed host behaviour. Antigravity therefore gets two file moves, one
   frontmatter rewrite (tier+effort → one model id, with the now-redundant `effort:` removed rather
   than left as a second editable spelling), and one hook-event filter. It does **not** get a
   command→skill converter, because the host already has one and a second implementation is a second
   thing that can drift.

4. **`enforce-agent-model.sh` does not port; the tier is baked in instead.** The hook enforces the
   model tier by rewriting the dispatch through the `PreToolUse` `updatedInput` envelope, which
   neither new host documents, and matches the tool name `Agent`, which neither has. Emitting the
   resolved model id into the agent file is enforcement by construction. The cost is stated, not
   hidden: `.claude/model.local.json` per-project overrides have no mechanism on these hosts, and
   that is a declared gap — **not** a substitute mechanism, which would be the compat shim this ADR
   exists to avoid.

   **How it is declared, corrected after implementation.** This decision first said "reported by
   doctor". What shipped is better and the wording is fixed to match: the host declaration carries
   `model_arg`, and the resolver reports the override inert on every run and every `--dry-run`, at
   the moment it would otherwise mislead. Doctor is a command someone has to think to run.

   Leaving the override *applied* was never an option, but neither was dropping it silently, and the
   first implementation did neither cleanly — it printed "Model tier overrides loaded" and previewed
   `business-analyst (opus)` while the agent file said `gemini-3.1-pro-high` and the dispatch passed
   no model at all. A preview naming a model the run will not use is the same class of defect as
   pricing an unpriced run at `$0.00`: not a missing feature, a false statement about what happened.

5. **`dist/` is committed.** None of the three hosts has an install-time build step; each installs
   from a checked-out tree, including a feature branch or a worktree — which is exactly how this
   repo's unreleased work gets tested against real projects. A gitignored `dist/` built only on
   release would make the first real `agy` run wait a release cycle, at the point the emitter is
   least trustworthy. `emit --check` is what makes committing generated output safe, on three axes:
   **content** (the hand edit), **orphans** (the hand edit that was then renamed, which content
   comparison alone cannot see), and **declared drops** (every skipped artifact needs a stated
   reason — the [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]] lesson
   that a paragraph which fails to land raises no error, it just stops existing). `emit` writes;
   only `--check` runs in CI, because regenerating in CI would let a bad transform land unseen.

6. **Tier tags are never translated.** `opus|sonnet|haiku|fable` stay tier *names*, resolving to
   different model ids per host. The tag in the frontmatter, the tag in `model.local.json` and the
   key in the map are one string by construction — the same rule ADR-0021 applied to agent names.

7. **One registry per dispatcher: `config/models/<host>.yaml`.** The tier→id mapping and the
   id→price mapping are different questions, so they live in different places. **Tier→id is host
   knowledge** and lives in `tools/sdlc-lint/hosts/<host>.json`, keyed on tier+effort where the host
   needs it. **id→price is provider knowledge** and lives in one file per dispatcher, which a
   package carries exactly one of, chosen by its own `config/host.json`.

   An intermediate draft kept a single registry holding every provider, on the argument that
   splitting a price list into N is how price lists drift. That argument does not survive contact
   with the case: drift needs the *same fact* in two places, and Claude prices and Gemini prices are
   disjoint sets with no shared number between them. What a shared file did produce was every
   package shipping a price list it could never use, plus `pipeline_tiers` and
   `estimation_baselines` — Claude-only concepts — arriving at a host where nothing is dispatched
   by tag at all. The Antigravity file therefore has no `pipeline_tiers`, and that absence is
   information.

   YAML rather than JSON because the rationale is most of the content: the >200K Gemini tier this
   registry cannot express, the Flash intro price expiring 2027-01-01, `fable`'s `cached_input` of
   0.25 where every neighbour uses 10%. In JSON each of those had to be smuggled into a
   machine-read `note`/`description` string; in YAML they are comments. The shipped, dependency-free
   `resolve/yaml.mjs` parses the shape correctly (floats stay floats), and `sdlc-lint schema`
   already validates YAML against JSON Schema for manifests and workflows, so this added no
   machinery.

   Two seams are asserted rather than trusted: every model a host map can emit must be priced by
   that host's registry, and a cross-provider lookup must return `null` — a mis-attributed model
   ends up unpriced rather than priced at someone else's rate.

## Consequences

- **The Antigravity package is 78 files and one transform table.** `agy plugin validate` is green on
  the emitted tree, and it costs zero model tokens, so structural regressions are caught by a CI-able
  command rather than by a live run.
- **`effort:` survives the port.** The earlier design recorded it as a dropped field on Antigravity;
  the model-id shape recovered it. With only two model families, `sonnet/low` and `haiku/low`
  necessarily collapse onto one id — a real loss of tier granularity, recorded in the descriptor.
- **Three orchestrator bodies will exist, one per host,** rendered from one SSOT via anchored
  overlays for the ~150 dispatch- and telemetry-specific lines. Authors still edit one file for the
  other ~1750. The risk this buys is that a renamed heading silently drops an overlay, so emit fails
  when an anchor is missing rather than rendering without it.
- **Codex cannot bundle subagents** (`plugin.json` has no `agents` field; openai/codex#28491 closed
  as a duplicate and unshipped), so its package ships `agents/*.toml` as plain files plus an install
  skill, with `/sdlc-doctor` reporting drift. That seam is Codex-specific and does not leak into the
  shared emitter.
- **Cost telemetry degrades honestly rather than silently.** No new state was needed:
  `caps.mjs` and `usage.mjs` already return `null` when a registry carries no pricing, and the
  existing `cap_gate_blind` + `cost_basis` machinery from
  [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]] already refuses a verdict on an
  unpriced run. Antigravity may not need a transcript parser at all — `agy -p --output-format json`
  returns a per-run envelope carrying `input_tokens`, `output_tokens`, `thinking_tokens` and
  `cache_read_tokens` directly.
- **Never gate on the host's own success field.** An `agy` run that produced nothing and had an
  action auto-denied still reported `status: "SUCCESS"` with an empty `response` and a populated
  `denied_actions[]`. The existing rule — gate on `_telemetry.json` on disk, not on exit code
  ([[decisions/ADR-0015-the-machine-value-invariant]]) — now covers `status` too.
- **The running package owns the recipes it ships.** Emitting a package makes the same plugin exist
  at two paths — the checked-out `dist/` tree and whatever the host installed — and on a host with no
  installed-plugins registry, discovery has to find plugins by scanning. Scanning by path cannot see
  that two paths are one plugin: with the release installed and a branch checkout running, a run
  halted on `Workflow 'default' is ambiguous`, naming one plugin twice. So host plugin roots are
  deduped by declared plugin *identity*, own package first, and an installed copy of itself is
  shadowed rather than merged. This is the same rule
  [[decisions/ADR-0009-plugin-root-resolution]] applies to roots, extended to everything a package
  ships, and the same failure as issue #70 — one run reading two copies of one tree.
- **A host's own isolation knobs are not assumed to work either.** The verification plan called for
  installing into a throwaway config directory; measured on agy 1.1.28, `GEMINI_CONFIG_DIR` is
  honoured by neither install nor list, so that isolation does not exist and every install is global.
  Where a package must read a host-declared directory, it reads the env-named one AND the default
  rather than one instead of the other — one extra stat, correct whether or not the host ever honours
  the variable. The resolver following a convention the host ignores is how a wrong answer gets to
  look like a right one.
- **A second maintenance surface exists**: `dist/` diffs on every agent or skill edit. Mitigated by
  `linguist-generated` in `.gitattributes`, by determinism (a conflict is resolved by re-running the
  emitter, never by hand — the rule `_moc-changes.md` already follows), and by `emit --check`.

## Related
- Implemented by: Track J Phase 1
- Relates to: [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]] /
  [[decisions/ADR-0009-plugin-root-resolution]] /
  [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]] /
  [[decisions/ADR-0018-reviewers-do-not-write-code]] /
  [[decisions/ADR-0015-the-machine-value-invariant]] /
  [[planning/h1-compliance-auditor]] / [[planning/j1-multi-host]]
