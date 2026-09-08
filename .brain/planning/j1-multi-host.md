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

## The open risk, precisely

Everything shipped so far is text transformation, which a golden test settles. The unsettled question
is **dispatch semantics**: whether a subagent on this host can be handed a full per-phase brief and
return a ≤3K-char compact summary the orchestrator reads as `CONTEXT.{phase}_output`. That handoff is
the entire cost model. If it does not exist on a host, that host is not a port.

The spike is one prompt: dispatch two subagents in parallel, each writing a file and returning a
one-sentence summary, then report the dispatch tool name, the retrieval tool name, both summaries,
and whether both files exist. It could not be run from an automated session — headless mode
auto-denies the `command` permission and the auto-approve flag is not available to the agent — so it
is run by the operator.

Two further unknowns it should settle: whether `${CLAUDE_PLUGIN_ROOT}` (or any plugin-root variable)
is set for a hook command on this host, since the surviving `Stop`/`seal-run.sh` hook depends on it;
and whether `agy plugin import claude` makes even the two file moves unnecessary.

## Not in Phase 1

`usage/*` real backends, `/sdlc:report`, `/sdlc:aar`, `/sdlc:batch`, `android-foundation` and the
seven framework plugins, `SessionStart` hooks (the event does not exist on Antigravity), the two
external marketplace entries, and emitting `rules/` as host rules — they stay plain files an agent
reads by absolute path, which sidesteps the 12,000-char rules cap entirely.
