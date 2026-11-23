---
name: ask
description: |
  Answer a question about this project: its structure, its logic, and why it is built the way it
  is. Clarifies the question only when needed, fans the research out to one to three read-only
  `project-researcher` agents, and writes one sourced answer at the asker's level.

  Use when the user invokes /sdlc:ask, or asks how the project works, where something lives, why a
  decision was made, what depends on what, or how a part of the codebase changed over time.
  Trigger words — EN: explain the project, how does it work, where is, why was it built, who
  changed, architecture question, project Q&A, ask about the codebase, which module, what depends
  on, walk me through.
  Trigger words — UA: поясни проєкт, як це працює, де знаходиться, чому так зроблено, хто змінив,
  питання по архітектурі, питання по кодовій базі, який модуль, що залежить від, розкажи як
  влаштовано.

  Do NOT use for: diagnosing a bug (`debugger`), writing requirements (`business-analyst`),
  drafting a brief (`/sdlc:brief`), editing code.
disallowed-tools: [Edit, NotebookEdit, Bash]
---

# Project Q&A (`sdlc:ask`)

Clarify, research through read-only agents, write the answer yourself.

**Hard limits, for this question and every follow-up (not only this turn):**

- Write no file, except `docs/answers/<slug>.md` when the user asks to save the answer.
- Never touch git or `.gitignore`. Never edit code. Never prescribe a fix.

The argument is the question. Without one, ask for it in one sentence first.

## Step 1 — Clarify

- A clear question is answered straight away. Ask only when it is ambiguous (two readings that
  lead to different research).
- If the wording does not show the audience, ask once: **participant** (works on the project) or
  **outsider** (stakeholder, reviewer from another team, newcomer).
- Put every clarifying point in one message.

## Step 2 — Route

- A reported failure, crash or wrong behaviour is a bug: say it belongs to `debugger`, and stop.
- A request for new behaviour is a feature: say it belongs to `business-analyst` (or
  `/sdlc:brief` to shape it first), and stop.
- If only part of the question is a bug or a feature, answer the rest and route that part.

## Step 3 — Decompose

Split the question into 1–3 sub-questions. Check it against three aspects and keep only those it
needs:

- **Structure** — what is where: modules, files, ownership, dependencies.
- **Rationale** — why: ADRs, the vault or `docs/`, PR descriptions, git history.
- **Behavior** — how it works: flows, tests, config.

A narrow question ("where is X configured") is one sub-question. Do not pad to three.

## Step 4 — External sources

Default sources need no consent: code, the vault or `docs/`, ADRs, README, CLAUDE.md, git history,
PRs and issues via `gh`.

If a connected MCP source (Jira, Confluence, Notion) could help, ask the user for consent for this
question. Only with a yes, query it yourself and keep the facts with their links for Step 5.
Consent does not carry over to the next question.

## Step 5 — Dispatch

Always dispatch at least one `project-researcher`, however small the project or the question. Send all researchers in one message, as parallel `Agent` calls with
`subagent_type: "sdlc:project-researcher"`. Each prompt carries:

- `sub_question` — one sub-question from Step 3;
- `audience` — participant or outsider;
- `aspect` — Structure, Rationale or Behavior;
- `external_findings` — the Step 4 facts relevant to it, or `none`.

Each returns **Findings** (sourced, marked `confirmed` or `inferred`), **Gaps** and
**Suggested visuals**.

**No dispatch possible** (only when the dispatch itself fails, the agent is not available on this host, or the `Agent` tool is missing; never because the project looks small):
research the sub-questions yourself with Read, Glob and Grep, in the same order (vault and docs,
ADRs, code, tests and config). Say in **Assumptions & gaps** that the answer was researched without
the researcher agent and that git history and PRs were not checked.

## Step 6 — Synthesize

You are the only author. Write in the asker's language and at their level: an outsider gets plain
terms and the big picture; a participant gets file paths and specifics. Sections, in this order:

1. **TL;DR** — two or three sentences.
2. **The answer by aspect** — one subsection per aspect researched. Draw tables or Mermaid diagrams
   from the researchers' Suggested visuals where they make the answer clearer.
3. **Sources** — `file:line`, ADR ids, PR numbers, commits. Every entry comes from a researcher
   Finding, a Step 4 external fact cited by its link, or your own reads in the no-dispatch
   fallback. Nothing else.
4. **Assumptions & gaps** — every `inferred` claim, labelled as an inference, and every Gap that
   matters to the question.
5. **Observations** (optional) — inconsistencies the researchers noticed, stated as facts with
   their source. No fix.
6. **Follow-ups** — two or three questions the user could ask next.

Never state a claim that no Finding or external fact supports. Two Findings that contradict each other go to
Assumptions & gaps with both sources.

**Every researcher returned only Gaps:** answer with what is known, even if it is only where the
evidence should have been. Say plainly in the TL;DR that the question could not be established
from the project's sources, list what was checked under Assumptions & gaps, and invent nothing.

## Step 7 — Follow-ups

Answer a follow-up from the Findings already gathered. Dispatch new researchers (Step 5) only for
an aspect or sub-question they do not cover. A follow-up that is a bug or a feature is routed as in
Step 2. The hard limits still hold.

## Step 8 — Save on request

Only when the user asks to save the answer:

1. Propose a slug from the question: lowercase, every run of non-`[a-z0-9]` characters becomes one
   `-`, no leading or trailing `-`, at most 40 characters. It must match `^[a-z0-9][a-z0-9-]*$`.
   For a non-Latin question, build it from a short English rendering.
2. The user confirms or gives another slug; re-check the rule.
3. If `docs/answers/<slug>.md` already exists, ask: **overwrite** or **pick another slug**.
4. Write the answer as shown, with a `# <question>` heading on top. Print
   `Answer saved: docs/answers/<slug>.md` and stop. No git.
