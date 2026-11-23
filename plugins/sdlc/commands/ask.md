---
description: Answer a question about the project — structure, logic, why it is built this way — from read-only research, with every claim sourced. Writes nothing unless you ask to save the answer.
argument-hint: "<question>"
---

# /sdlc:ask

Project Q&A. Invoke the **`sdlc:ask`** skill.

- `<question>` — what you want to know. Omitted → the skill asks for it.

The skill clarifies only an ambiguous question (plus who the answer is for, when unclear), splits
it into one to three sub-questions across Structure / Rationale / Behavior, dispatches that many
read-only `project-researcher` agents in parallel, and writes one answer: TL;DR, the answer by
aspect, Sources, Assumptions & gaps, optional Observations, suggested follow-ups. External MCP
sources (Jira, Confluence, Notion) are queried only with your consent for that question. It saves
`docs/answers/<slug>.md` only on request and never touches git. Bugs go to `debugger`, new
features to `business-analyst`.
