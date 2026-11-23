---
adr: 43
status: proposed
date: 2026-11-23
supersedes: null
---

# ADR-0043 — Project Q&A is a skill fronting a read-only researcher agent

## Context

People need to find their way around a project: its logic, its structure, why decisions were made.
Some of them work on it every day. Others touch it only indirectly: a stakeholder, a reviewer from
another team, a newcomer. Today the only option is an ad-hoc chat with whatever the session
happens to read. Nothing guarantees that the question is examined from every side, that claims are
traceable to a source, or that the answer is pitched at the asker's level.

The pipeline has no role for this. `debugger` explains a specific failure and prescribes a fix.
`business-analyst` writes requirements for something new. Both run inside a run. The built-in
`Explore` agent locates code but does not analyse it, and a question like "why is it built this
way" is answered by ADRs, the vault, PR descriptions and git history, not by the code alone.

The asker must be able to clarify, and a subagent cannot ask the user anything (`AskUserQuestion`
is removed from subagents; see [[decisions/ADR-0042-brief-intake-is-a-standalone-skill-not-an-agent]]
for the full comparison). The reading, on the other hand, is large, parallelisable and
benefits from a fixed procedure and fixed read-only rights. That is what subagents are good at.

## Decision

**Project Q&A is a core skill, `/sdlc:ask`, that clarifies the question, fans the research out to
one to three read-only `project-researcher` agents, and writes the answer itself.**

1. **Split of work.** The skill runs in the main session. It clarifies the question, queries any
   external MCP sources, dispatches researchers and writes the answer. The agent only researches.
   A main-thread agent (`claude --agent`) was rejected for the reasons in ADR-0042: CLI-only, and it
   needs a separate session.
2. **The agent.** `project-researcher` is a new core agent in `plugins/sdlc/agents/`, on demand
   only (not a pipeline phase and in no recipe). It runs on `model: sonnet` with `effort: medium`
   and has `tools: [Read, Glob, Grep, Bash, WebFetch, Skill]`.
   - `Bash` is for read-only `git log/show/blame` and `gh pr/issue view/list`.
   - `WebFetch` is for the documentation of libraries the project uses.
   - `Skill` lets the agent invoke a MANDATORY skill that a stack's `role_expertise` block names.
   - Read-only is enforced by a plugin-level `PreToolUse` hook that allowlists read-only git/gh
     commands for this agent. The hook identifies the caller by the documented `agent_type` field of
     the hook input (Claude Code `hooks.md`). Plugin agents cannot carry their own `hooks:`
     frontmatter (Claude Code `sub-agents.md`), which is why the hook is plugin-level.
     The hook allows only a strict character set and rejects write-capable option prefixes
     (`--o…`, `--ex…`, `--te…`, `-…O`), so syntax and option tricks fail closed.
   - MCP sources (Jira, Confluence, Notion) are not in the agent's tool list. Each user's MCP tool
     names differ, so the skill queries them, with the user's consent for that question, and passes
     the findings in as context.
3. **Stack expertise.** An optional `role_expertise.project-researcher` block, resolved like every
   other role ([[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]]). It is
   empty when a stack contributes none. `android-foundation` adds a short block: where
   `.obsidian-vault/` lives, how to read the `:feature:*` module graph, and where navigation and DI
   are wired.
4. **Clarification.** The skill asks only when the question is ambiguous, plus a single question
   about the audience (participant or outsider) when the wording does not show it. A clear question
   is answered straight away.
5. **Fan-out.** The skill splits the question into one to three sub-questions and dispatches that
   many researchers in parallel. **Structure** (what is where), **Rationale** (why: ADRs, vault,
   PRs, git) and **Behavior** (how it works: flows, tests, config) form the checklist that no aspect
   is missed, not a fixed count of three.
6. **Sources.** By default: code, the vault or `docs/`, ADRs, README, CLAUDE.md, git history, and PRs
   and issues through `gh` when available. External MCP sources need consent per question. Web
   search is only for third-party library documentation.
7. **Researcher report.** It is compact and not addressed to the end user:
   - **Findings**: each claim has a source and is marked `confirmed` or `inferred`;
   - **Gaps**: what was not found;
   - **Suggested visuals**: data for a table or diagram, not finished Mermaid.

   One author, the skill, writes all the prose and visuals, so the answer has one voice and one
   level.
8. **Answer.** It is written in the asker's language and pitched at their level. Sections:
   - **TL;DR**;
   - the answer by aspect, with tables and Mermaid diagrams where they help;
   - **Sources** (`file:line`, ADRs, PRs, commits);
   - **Assumptions & gaps**;
   - optional **Observations** (inconsistencies noticed, with no fix prescribed);
   - two or three suggested follow-up questions.

   Markdown tables and Mermaid render in chat, on GitHub and in Obsidian, so the format holds on
   every host.
9. **Follow-ups and persistence.** A follow-up is answered from what was already gathered. A new
   researcher is dispatched only for an aspect not yet covered. The answer is saved to
   `docs/answers/<slug>.md` only on request. The skill never touches git and declares
   `disallowed-tools: [Edit, NotebookEdit, Bash]`. That restriction lasts only until the user's next
   message, so across follow-ups the no-writes rule is carried by the instruction.
10. **Boundaries.** The agent explains how things are and why. A question that turns out to be a bug
    is routed to `debugger`, and a request for something new to `business-analyst`.
    `/sdlc:brief` keeps `Explore` for now. Switching it to `project-researcher` is a later, separate
    decision, once the agent has proven itself.

Rejected alternatives:
- **skill only, with `Explore`**: `Explore` locates but does not analyse, and the procedure and the
  read-only rights would live in prose.
- **a single researcher per question**: one context has to hold every aspect of a broad question,
  and the aspects it reaches last get the thinnest coverage.
- **always three fixed aspects**: it pays for three agents on a "where is X configured" question.
- **always writing a file**: most answers are read once.
- **an HTML report**: can be added later as an output format.

## Consequences

- The core roster grows by one read-only agent. Registration touches `on_demand_agents` in the sdlc
  manifest, the `coreRole` schema enum, the lint's `READ_ONLY_AGENTS`, and two test mirrors. The tier
  comes from the agent's own frontmatter, and `sonnet/medium` already maps on Antigravity
  ([[decisions/ADR-0029-one-ssot-emitted-host-packages]]), so the model registry is unchanged.
- Every answer is checkable: claims carry sources, and inferences are labelled as such.
- Cost scales with the question. A narrow question costs one `sonnet` researcher, a broad one three,
  and the main session pays for the synthesis. No pipeline run pays anything.
- Verification:
  - the roster lint covers the agent's frontmatter and its expertise slot;
  - an eval case runs the agent on this repo with a question that has a known answer ("why is
    brief intake a skill, not an agent") and checks that the report cites ADR-0042 and that every
    `file:line` it cites exists;
  - the skill's end-to-end answer is checked by hand on a real project.

## Related
- Implemented by: (pending)
- Relates to: [[decisions/ADR-0042-brief-intake-is-a-standalone-skill-not-an-agent]],
  [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]],
  [[decisions/ADR-0018-reviewers-do-not-write-code]], [[components/sdlc]],
  [[components/android-foundation]]
