---
status: in-progress
---

# J1 — Multi-host portability (Antigravity CLI, Codex CLI)

> Track J. Decision: [[decisions/ADR-0022-one-ssot-emitted-host-packages]]. See
> [[planning/_moc-planning]] and [[planning/roadmap]].

Ship the pipeline on two more agentic CLIs from one authoring surface. `plugins/**` stays the SSOT;
`sdlc-lint emit` renders `dist/<host>/`; `emit --check` gates the committed output.

## Host facts, as measured (not as documented)

Both hosts were probed on a live CLI. Where the docs and the binary disagreed, the binary won.

**Antigravity CLI (`agy` 1.1.27, probed 2026-09-08; re-verified on 1.1.28, 2026-09-09).**

The re-verification moved nothing: `agy plugin validate` reports the same six lines, and `agy models`
grew two older Flash generations (`gemini-3.7-flash-*`, `gemini-3.6-flash-*`) that the tier map does
not use, so every id it emits still exists.

| Question | Answer |
|---|---|
| Does an unmodified Claude plugin tree validate? | Yes, after moving `plugin.json` and `hooks.json` to the plugin root. `agy plugin validate` then reports 3 skills, 12 agents, 11 commands, 1 hook. |
| Are commands converted? | **By the host**, in memory — `commands: 11 processed (converted to skills)`. On disk they stay `commands/*.md`. |
| Is agent frontmatter translated? | No. Installed files are byte-identical to source (`diff` clean). |
| Agent file layout | Flat `agents/<name>.md` is accepted; the docs' `agents/<name>/agent.md` is not required. |
| Model vocabulary | Ids embed reasoning effort: `gemini-3.8-flash-high\|medium\|low`, `gemini-3.1-pro-high\|low`. Also lists `claude-sonnet-4-6`, `claude-opus-4-6-thinking`, `gpt-oss-120b-medium`. |
| Structural gate without a model call | `agy plugin validate <dir>` — zero tokens, CI-able. |
| Headless usage data | `agy -p --output-format json` returns `usage{input_tokens, output_tokens, thinking_tokens, cache_read_tokens, total_tokens}` plus `conversation_id` and `denied_actions[]`. |
| antigravity-cli#76 (stdout dropped on non-TTY) | Did **not** reproduce through a pipe with `--output-format json`. |
| Is `status` trustworthy? | **No, in both directions.** A run that produced nothing and had an action auto-denied reported `status: "SUCCESS"` with an empty `response`; the full pipeline run, which completed and sealed, reported `status: "ERROR"` because it hit `--print-timeout` while composing its closing message (898 s against a 15 m limit). Gate on `_telemetry.json`, never on `status` or exit code. |
| Print-mode timeout | Set it well past the pipeline's own wall clock: the sealed run took 539 s but `agy` stayed up 898 s finishing Step 6 and its final response. |
| Is `GEMINI_CONFIG_DIR` honoured? | **Nowhere.** Pointed at an empty directory, `agy plugin install` still installed under `$HOME/.gemini/config/plugins` and `agy plugin list` still listed from there. So an install cannot be isolated to a throwaway config dir, and every install is global. |
| Project instruction file | Both `GEMINI.md` and `AGENTS.md`, read hierarchically from the directory they sit in downward, deduplicated, no frontmatter support. Found in the binary's own bundled docs — zero tokens. `AGENTS.md` is therefore the seeding target: it is the one spelling that also works on Codex. |

**Codex CLI** — not yet probed; the CLI is not installed locally, which is Phase 2's first
prerequisite. From docs: subagents are TOML in `.codex/agents/`, dispatched via
`spawn_agent`/`wait_agent`, and **`fork_turns: "none"` is mandatory** or the spawn forks the parent's
whole history and rejects `agent_type`/`model` (openai/codex#20077). `plugin.json` has no `agents`
field (openai/codex#28491), so agent TOMLs ship as plain files plus an install skill. Codex sets
`CLAUDE_PLUGIN_ROOT` as a documented alias for `PLUGIN_ROOT` in hook command env.

## State

**Phase 1 is met.** A full vanilla pipeline ran end to end on `agy` 1.1.27 against a plain-Node
fixture (2026-09-09, slug `add-a-healthz-endpoint-that-returns-200`, 539 s sealed wall clock):

| Phase | Agent | Model as dispatched | Result |
|---|---|---|---|
| business_analysis | business-analyst | `gemini-3.1-pro-high` | completed, 1729-char summary |
| development | developer | `gemini-3.8-flash-medium` | completed (two-pass: plan + implement) |
| qa | qa-engineer | `gemini-3.8-flash-medium` | completed, 1 iteration |
| security | security-analyst | `gemini-3.1-pro-high` | completed, no Critical/High |
| remediation | — | — | **skipped by the gate**, as designed |
| documentation | document-writer | `gemini-3.8-flash-low` | completed |

What that proves beyond "it ran": the 1900-line orchestrator loaded and was followed on a foreign
host; Step 0 resolved in one command; `invoke_subagent` dispatch worked for every phase; compact
summaries came back and stayed inside the 3000-char budget (max 1729); every deliverable and
checkpoint landed at the right path; the conditional `gate: {after, min_severity}` evaluated and
skipped `remediation`; the run sealed itself (`sealed_by: "orchestrator"`); and Step 6's journal
entry rendered `$—`. The work product is real — `/healthz` implemented for GET/HEAD with 405 on
other methods, 18 tests written by the qa phase, all passing.

**The degradation contract behaved exactly as designed, with no new states.** Every phase carries
`cost_usd: null` (never 0) and `cap_gate_blind: true`; `cost_basis` is null; `report.html` renders
`unverified — run unpriced` and names all five blind phases.

- Emitter: `sdlc-lint emit [--host <id>|all]` + `emit --check`, wired into `all`. `dist/antigravity/`
  committed (80 files, 2 declared drops). Drift and orphan detection verified against a deliberate
  hand edit.
- Overlays: `3c`, `3c-crash`, `3b-3`, `3d-1`. The emitted body contains no `Agent` tool reference and
  no `subagent_type`.

## Follow-ups this run surfaced

- **`aar/metrics.mjs:88` reads `cap_status` without the `capVerified` guard** that
  `report/report.mjs:324` applies. On an unpriced run `_telemetry.json` records
  `cap_status: "within"` — an honest record of what enforcement *did* (it counted every null phase
  as $0), but a consumer that reads it without checking `cost_basis` presents a verdict as fact.
  The report is correct; AAR and rollup are not guarded. Phase 4, where cap verdicts come back.
- **Project-local recipes still live at `.claude/sdlc-workflows/`** on every host. Renaming that per
  host needs a doctor-migration story, so it was deliberately left alone rather than given a second
  lookup path.
- **`agy plugin install` merges rather than replaces** — after renaming files, uninstall first or the
  install keeps orphans the emitter would never produce.
- **`/sdlc-init`'s `--seed-claude-md` is still Claude-shaped** on every emitted package: the flag name
  and the target file are both `CLAUDE.md`. The host reads `AGENTS.md`, so seeding currently writes a
  file nothing loads. Fixing it needs the overlay mechanism extended from `skills/*/SKILL.md` to
  `commands/*.md`, which is why it is recorded here rather than patched in passing.
- **The "12,000 characters per rules file" cap** this track has been quoting is **unverified** — it
  came from documentation and is not findable in the binary. Nothing depends on it (our `rules/` ship
  as plain files an agent reads by absolute path), but it should not be repeated as measured.

## Phase 3 (Antigravity half) — met

The package went from the core alone to **all nine plugins**, 80 files to 192. The emitter needed no
new code, which is the repackager premise holding: a repackager does not care how many plugins it
repackages. What the phase is actually made of is the descriptor's `plugins` list going away — an
explicit list of all nine would be a second spelling of "every plugin" that a tenth could silently
contradict, so absent now means every `plugins/*/` with a `manifest.yaml`, and the gate is `emit`
failing loudly plus `emit --check` failing CI rather than a hand-maintained list.

Verified with zero model tokens: `agy plugin validate` green on all nine trees, and against an
Android fixture the resolver run out of the install picks the `android` profile (priority 300),
attaches `retrofit` from the version catalog, resolves the seven-phase `android-feature` recipe, and
renders every cross-plugin rule path absolute into `android-foundation` — so **ADR-0021's expertise
mechanism survives the port intact**.

**Widening the package is what found three resolver defects**, none of which errored; each produced a
plausible wrong answer, which is the shape [[decisions/ADR-0015-the-machine-value-invariant]] is
about.

1. The config dir took the env value *instead of* the default, so a developer who exported
   `GEMINI_CONFIG_DIR` got a resolver searching an empty directory while every sibling plugin sat in
   the default one — the foundation not found, and an Android project quietly running vanilla. The
   search is now a superset of both.
2. Sibling discovery never included the package's **own** root. It found it only when the install
   happened to sit under a search path — true of `agy plugin install`, false of running straight out
   of a checked-out `dist/` tree, which is how this project tests unreleased work. There the package
   shipped ten recipes and reported `Available: (none)`.
3. Fixing (2) exposed the third: discovery deduped by file *path*, which cannot see that two paths
   are one plugin. With the release installed and a branch checkout running, the run halted on
   `Workflow 'default' is ambiguous`, naming one plugin twice. Roots are now deduped by declared
   plugin identity, own package first — the code that is running owns the recipes it ships, and an
   installed copy of itself is shadowed rather than merged. Issue #70's two-trees-in-one-run failure,
   one layer out.

A fourth, smaller one: `sources.config_dir` reported `GEMINI_CONFIG_DIR` for a path that came from
`$HOME`. Provenance is the field a reader trusts when a path looks wrong.

**One test was a false green.** "An emitted package finds its own recipes" was passing by reading the
developer's real `~/.gemini` install rather than the tree under test — it asserted one thing and
measured another, and went on passing straight through defect (2). Every child-process test here now
redirects `$HOME`, and each new regression test was confirmed to fail with its fix reverted.

**The package now ships its own `INSTALL.md`**, generated from the descriptor. Claude Code's
marketplace manifest makes a nine-plugin tree installable in one line and Antigravity has no
analogue, so what replaces it is prose — which, shipped beside a generated tree, has to be generated
too or the first descriptor change makes it quietly wrong while `emit --check` stays green. It
carries the drops table, because ADR-0022 §4's "state the loss, do not substitute for it" is not
satisfied by a reason that lives only in a build log.

**One declared loss:** `android-foundation`'s `SessionStart` advisory about the optional `android`
CLI. This host has no `SessionStart`, and ADR-0022 §4 already settled what to do about a missing
event — state the gap, do not build a substitute, which is the compat shim the ADR exists to avoid.
Building one on `PreInvocation` would have been exactly that. The advisory is not lost anyway:
`/sdlc-doctor` already probes `android --version` on every host, so the check moves from automatic to
on-demand.

**Three more defects came out of running `--dry-run` against a real Android project**, all the same
shape: a Claude-only mechanism presented as active on a host that has none of it.

4. **The dependency preflight was blind.** `installed_plugins.json` is written only by Claude Code
   and FOUR consumers read plugins out of it; Phase 1 gave two of them an `extraRoots` seam and
   missed the other two. So the preflight reported "no external dependencies declared" while
   `android-foundation` declared two — a `policy: block` dependency would not have been caught at
   all, and seven mandatory skills were never reported as downgraded. Fixed by synthesizing the
   registry once where it is read, rather than threading a fifth `extraRoots` parameter: on a host
   with no registry, the package search **is** the registry.
5. **Every agent previewed as `sonnet`** — `resolveTier`'s hardcoded fallback, reached because
   frontmatter tiers were read through that same blind map. The dry run now names the models the
   Phase 1 live run actually dispatched, which is also independent corroboration of the model map.
6. **An unpriced run rendered a cap verdict.** A row with no estimation baseline priced to `null`,
   contributed 0 to the total, and the preview printed `~$0.00` under `Cap: $19.75 → WITHIN`. The
   headless line was worse, because CI gates on it: `estimated_cost_usd: 0` with
   `cap_estimate: "within"` passes an unpriced run as inside budget. This is
   [[decisions/ADR-0012-unpriced-runs-must-not-render-a-cap-verdict]] applied to the *pre-run*
   estimate, which had never been checked there — the plan flagged it as a residual and it was real.
   The useful part is the asymmetry: with any row unpriced the total is a lower bound, so `WITHIN` is
   unsupportable while `EXCEEDS` still holds. A partial estimate keeps the verdict that can be
   justified and labels its number as a floor.

7. **`.claude/model.local.json` was previewed as active while being completely inert.** Found in the
   operator's own project, which carries ten tier overrides. On this host the dispatch passes no
   model (the 3c overlay says so explicitly) and each agent file holds its model baked in at build
   time, and `enforce-agent-model.sh` — the mechanism that would rewrite the call — does not port.
   Yet the preview printed "Model tier overrides loaded" and `business-analyst (opus)` where
   `gemini-3.1-pro-high` would run. Neither applying the override (impossible) nor dropping it
   silently (hides a file the user wrote) is right, so the host declaration now carries `model_arg`
   and the resolver reports the file inert on every run. ADR-0022 §4 predicted this gap and said to
   declare it; §4's wording has been corrected, because it promised doctor would do the reporting and
   what shipped reports it at the moment it would otherwise mislead.

8. **Project-local paths were Claude Code's, on every host.** Raised by the operator. Project skills
   were read from `<project>/.claude/skills` while this host loads them from
   `<workspace>/.agents/skills` — so the resolver counted skills the CLI will never load (a mandated
   skill reading as satisfied when it is not) and missed every one it does. Plugin enablement was
   merged from `<project>/.claude/settings.json`, so a plugin disabled in Claude Code was silently
   dropped from detection on Antigravity, in projects that may not use Claude Code at all. Both are
   now declared per host; this one keeps no project settings file, and that empty list is an answer.
9. **A third-party plugin was invisible — a defect introduced by fix (4) itself.** The synthesized
   registry filtered on `manifest.yaml`, which is the *stack plugin* test, not the *is a plugin*
   test. `superpowers` installs with twelve skills and a `plugin.json` but no manifest, so the
   preflight reported all seven of its mandated skills missing while they were on disk and loadable.
   `installed_plugins.json` lists plugins of every kind, so a substitute admitting fewer is not one.
   Seven downgrades became one, and the survivor (`frontend-design`) is genuinely absent.

   The compounding matters more than the bug: fix (4) replaced a broad registry with a narrow
   substitute, and the narrowing was invisible for an hour because the only thing exercising it was
   a fixture with no third-party plugins installed. A synthesized replacement for a host facility
   must be checked against what the real one admitted, not only against what the new code needs.

10. **The synthesized registry dropped a duplicate in silence.** Surfaced by a doctor run on the
   operator's real machine, which reported three plugins installed at multiple paths. Claude Code's
   `readInstalledPlugins` records those conflicts and the resolver warns; the synthesized registry
   deduped by identity and said nothing — narrower than the facility it stands in for, the same
   mistake as (9) one layer along, and issue #70 is exactly one run reading two plugin trees. Now
   reported, naming the winner, its source, and every ignored path.

   Its own first fix was wrong in the way that matters most for a warning: the running package
   normally ALSO sits under a search path, so a naive identity check printed
   `sdlc is present at 2 paths` with the same directory as both winner and loser. A false alarm in
   the one channel that has to stay worth reading. Paths are canonicalized before anything is
   called a conflict.

**Then changed, on the operator's call:** those files moved to `<project>/.sdlc/`
([[decisions/ADR-0023-the-project-sdlc-directory-is-ours]]) — one host-neutral directory, no
fallback read, migrated once by `/sdlc-doctor`, with the old location noticed and reported on every
run so a cost cap left behind cannot silently stop capping. The reasoning below is why it is ONE
directory rather than one per host, which was the original proposal:

**Why not per-host:** `.claude/sdlc.local.yaml`, `.claude/model.local.json` and
`.claude/sdlc-workflows/`. Those are the SDLC's own files parked in the host's directory, not the
host's files, and their content is host-neutral — extensions, skill mappings, agent bindings, tier
tags (ADR-0022 §6 keeps tier tags untranslated across hosts). A per-host copy would put the same fact
in two places, which is the drift shape the registry split was corrected to avoid. Where they should
live was a rename with a doctor-migration story, and it is now ADR-0023. Note the pair with the
model-registry split, which went the other way: **split what differs per host, share what does
not.** Prices differ per provider and were split; a cost cap does not and is shared.

Worth naming as a pattern: **seven of the nine defects in this phase were a Claude-only mechanism
reading as present on a foreign host, and none of them threw.** `emit --check`, `agy plugin
validate`, 723 unit tests and a green `sdlc-lint all` caught none of them. Every one was found by
running the resolver against a real project and reading the output — which is the cheapest test in
this track and had not been part of it.

Still owed for Phase 3: a live Android run (the resolution is proven, the execution is not), the
headless smoke via `agy -p --output-format json`, and the `AGENTS.md` seeding above.

## The dispatch risk — settled for Antigravity

The question was whether a subagent here can take a full per-phase brief and return a compact
summary the orchestrator reads as `CONTEXT.{phase}_output`. That handoff is the entire cost model; a
host without it is not a port. Two subagents were dispatched in parallel on a live run
(conversation `9a5ccef4`, 81 s, `--dangerously-skip-permissions`, run by the operator because
headless mode auto-denies the `command` permission).

**It works, and the shape is simpler than assumed.**

| Question | Answer |
|---|---|
| Dispatch tool | `invoke_subagent` — the community-sourced name is correct |
| Parallel | Yes, both ran concurrently |
| Compact summary returned | Yes, both came back verbatim into the parent's context |
| Retrieval tool | **None.** A finished subagent pushes its message into the parent's context and execution resumes on its own |
| File side effects | Both files created |

The absence of a retrieval call matters for the overlay: this is closer to Claude Code's inline
`Agent` result than to Codex's `spawn_agent` + `wait_agent`, so the 3c overlay stays a one-call
shape. An overlay that added a wait step would be waiting for something that had already arrived.

**One anomaly, and it is a real constraint.** Both subagents wrote their file *twice* — into the
parent's cwd and into `~/.gemini/antigravity-cli/scratch/`. A subagent here has a scratch working
directory beside the parent's. Our phases write deliverables to `docs/plans/{slug}/0X-*.md` and the
orchestrator verifies them with `Glob` at step 3d, so a relative path that resolves into scratch
would produce an agent that did its work and a verification that says it did not. **Deliverable
paths handed to a phase must be absolute on this host.**

## Still open

- Whether `${CLAUDE_PLUGIN_ROOT}`, or any plugin-root variable, is set for a hook command here — the
  surviving `Stop`/`seal-run.sh` hook depends on it.
- Whether `agy plugin import claude` makes even the two file moves unnecessary.
- Whether per-phase cost can be attributed at all: the run envelope's `usage` looks aggregate
  (`cache_read_tokens: 418022` on a `num_turns: 1` run that dispatched two subagents), so this host
  may price per run rather than per phase. A Phase 4 question, recorded now so it is not discovered
  late.

## Not in Phase 1

`usage/*` real backends, `/sdlc:report`, `/sdlc:aar`, `/sdlc:batch`, `android-foundation` and the
seven framework plugins (all three delivered in Phase 3), `SessionStart` hooks (the event does not
exist on Antigravity), the two external marketplace entries, and emitting `rules/` as host rules —
they stay plain files an agent reads by absolute path, so no host rules cap applies to them.
