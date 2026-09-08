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

**Antigravity CLI (`agy` 1.1.27, probed 2026-09-08).**

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
| Is `status` trustworthy? | **No.** A run that produced nothing and had an action auto-denied still reported `status: "SUCCESS"` with an empty `response`. Gate on `_telemetry.json`. |

**Codex CLI** — not yet probed; the CLI is not installed locally, which is Phase 2's first
prerequisite. From docs: subagents are TOML in `.codex/agents/`, dispatched via
`spawn_agent`/`wait_agent`, and **`fork_turns: "none"` is mandatory** or the spawn forks the parent's
whole history and rejects `agent_type`/`model` (openai/codex#20077). `plugin.json` has no `agents`
field (openai/codex#28491), so agent TOMLs ship as plain files plus an install skill. Codex sets
`CLAUDE_PLUGIN_ROOT` as a documented alias for `PLUGIN_ROOT` in hook command env.

## State

- **Phase 1 (Antigravity core, vanilla only) — emitter landed.** `sdlc-lint emit [--host <id>|all]`
  and `emit --check`, wired into `all`. `dist/antigravity/` committed: 78 files, 2 declared drops.
  `agy plugin validate` green on the emitted tree; drift and orphan detection both verified against
  a deliberate hand edit.
- **Open in Phase 1:** the live `/sdlc-start` run on a plain-Node fixture. Blocked on the dispatch
  spike below.

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
seven framework plugins, `SessionStart` hooks (the event does not exist on Antigravity), the two
external marketplace entries, and emitting `rules/` as host rules — they stay plain files an agent
reads by absolute path, which sidesteps the 12,000-char rules cap entirely.
