---
pr: 260
date: 2026-11-23
author: Nuclominus
type: feat
plugins: [android-foundation, sdlc]
roadmap: null
files_changed: 58
---

# PR #260 — /sdlc:ask-me project Q&A with a read-only researcher agent

> `feat` · merged 2026-11-23 · by @Nuclominus

## Summary

People who need to understand a project, whether they work on it every day or only touch it as a
stakeholder, reviewer or newcomer, had no role for it: `debugger` explains a failure,
`business-analyst` writes requirements, and the built-in `Explore` locates code without explaining
why it is built that way. This PR adds project Q&A. `/sdlc:ask-me` runs the `sdlc:ask` skill. The
skill routes bugs and features elsewhere, clarifies only an ambiguous question, and splits it into
one to three sub-questions (Structure / Rationale / Behavior). It dispatches that many read-only
`project-researcher` agents in parallel and writes one sourced answer at the asker's level. The
answer has a TL;DR, the answer by aspect with tables and Mermaid, Sources, Assumptions & gaps,
optional Observations, and follow-ups. The researcher's read-only promise is enforced by a hook,
not just stated.

## What changed

**`project-researcher` agent** (`plugins/sdlc/agents/`)
- **Role.** A new on-demand, read-only core role (sonnet, medium) with tools `Read, Glob, Grep,
  Bash, Skill`. It has no network tool, so injected repo content cannot exfiltrate through it. It
  is dispatched only by `sdlc:ask`.
- **Report contract.** Findings, each sourced and marked `confirmed` or `inferred`, plus Gaps and
  Suggested visuals. It writes no prose for the user and prescribes no fixes.
- **Registration.** `on_demand_agents`, the `coreRole` schema enum, lint `READ_ONLY_AGENTS`, test
  mirrors, and the 13-agent roster in the docs.

**Read-only guard** (`plugins/sdlc/hooks/researcher-readonly-guard.sh`, its test script, CI step)
- **Scope.** A plugin `PreToolUse` Bash hook keyed on the documented `agent_type` field. Plugin
  agents cannot carry their own `hooks:`.
- **Checks, in order.**
  1. An exact expertise-bootstrap match.
  2. A strict character allowlist that rejects shell syntax, glob characters and zsh-pattern
     characters.
  3. `set -f`, then per-token checks on quote-stripped tokens. These refuse write-capable option
     prefixes (`--o…`, `--ex…`, `--te…`, with a few exact read options exempt), clustered `-O`,
     `--no-index`, `gh --jq/--template/--web` and clustered gh `q`/`t`/`w`.
  4. A verb allowlist.
- **jq.** Without jq, or on a payload jq cannot parse, the researcher is denied outright.
  Antigravity drops the hook, so the instruction alone applies there.
- **Review hardening.** Reviews reproduced real bypasses that wrote or deleted files or executed
  code: a single `&`, `git grep --open=<cmd>` (git accepts long-option prefixes), bundled `-nO<cmd>`,
  glob expansion of a planted `-Osh` file, `gh … --jq env`, and zsh `extendedglob` / `=cmd` forms.
  Each one is pinned in the tests, which run from three working directories.

**`sdlc:ask` skill + `/sdlc:ask-me` command**
- **Dispatch.** The skill always dispatches at least one researcher, however small the project.
  Direct reads are only the fallback when dispatch is impossible.
- **External sources.** MCP sources (Jira, Confluence, Notion) are queried only with consent for
  that question. Third-party library docs are fetched by the skill. Both reach researchers as
  `external_findings` and can be cited by link.
- **Writes.** The answer is saved to `docs/answers/<slug>.md` only on request. The skill never
  touches git, and `disallowed-tools` keeps Bash out of the skill.
- **Command name.** The command was renamed from `ask` to `ask-me` so it no longer shares a name
  with the skill. Sharing the name let the command shadow the skill body. `/sdlc:brief` now points
  question-askers to `/sdlc:ask-me`.

**android-foundation.** A `role_expertise.project-researcher` block: read `.obsidian-vault/` first,
then the `:feature:*` module map, `@Serializable` routes and DI modules. It uses the Glob tool rather
than shell globs.

**Eval `plugins/sdlc/evals/11-ask-cites-adr`.** The eval sandbox starts empty, so a scaffold builds a
small fixture git repo whose ADR-0001 is the only source of the "why". The graders check four things:
the researcher was dispatched, ADR-0001 is cited, the answer has a TL;DR and no files were written,
and the sources are real. Two unscored diagnostics, `fired` and `skill-body-loaded`, tell "skill not
invoked" apart from "skill skipped dispatch".
- **Before the rename.** Some runs answered in about 22 s without a researcher.
- **After the rename.** With-arm 1.00 in 3 of 3 runs with every diagnostic green. The baseline
  scored 0.50: no TL;DR and no real sources. At n = 3 this confirms the rename rather than proves it.

`dist/antigravity` was regenerated in the same PR.

**Not yet verified.** An end-to-end answer on a real project. Per ADR-0043 this check is manual.

## Changed areas

- [[components/android-foundation]]
- [[components/sdlc]]

## Decisions & rationale

- [[decisions/ADR-0043-project-qa-is-a-skill-fronting-a-read-only-researcher-agent]]: the decision
  this PR implements. A skill clarifies and writes the answer, because a subagent cannot ask the
  user anything. Read-only researcher agents do the parallel reading under a fixed procedure and
  fixed rights.
- [[decisions/ADR-0042-brief-intake-is-a-standalone-skill-not-an-agent]]: the same skill-versus-agent
  analysis. `/sdlc:brief` and `/sdlc:ask-me` now point users to each other.
- [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]]: why the agent lives in
  the core and its Android knowledge in the foundation's `role_expertise`.
- [[decisions/ADR-0018-reviewers-do-not-write-code]]: the read-only-role precedent this agent
  follows. Here a hook enforces it.
- [[decisions/ADR-0032-commit-hygiene-is-a-deterministic-hook]]: the deterministic-hook precedent
  for the guard, including its jq handling (here inverted to deny).

## Planning

- [[planning/roadmap]]: K2, project Q&A, is done in this PR. It follows K1, brief intake, from #258.

---
_Auto-generated by `tools/brain-sync`. Frontmatter and the index are machine-owned; every prose section, Summary included, is meant to be enriched — but `sync --pr` rewrites the whole file, so enrich after running it._
