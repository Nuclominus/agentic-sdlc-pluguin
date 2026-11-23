---
name: brief
description: |
  Turn a rough idea into a structured task brief before a pipeline run. Reads the project,
  interviews the user in short rounds of numbered questions with a recommended answer for each,
  writes `docs/briefs/<slug>.md`, and prints the `/sdlc:start --brief=...` command to run next.

  Use when the user invokes /sdlc:brief, or wants to shape, scope or write down a feature, fix or
  change before starting the SDLC pipeline, or says the request is still vague.
  Trigger words — EN: write a brief, task brief, shape the task, scope this feature, interview me
  about the feature, prepare a task for the pipeline, brief intake.
  Trigger words — UA: напиши бриф, бриф задачі, сформулюй задачу, уточни скоуп, опитай мене про
  фічу, підготуй задачу для пайплайна.

  Do NOT use for: running the pipeline (that is /sdlc:start), answering questions about the
  project (that is /sdlc:ask-me), editing code.
disallowed-tools: [Edit, NotebookEdit, Bash]
---

# Brief intake (`sdlc:brief`)

Read the project, interview the user, write one brief file, print the next command, stop.

**Hard limits, until the brief is saved or the user abandons it (not only this turn):**

- The only file you create or change is `docs/briefs/<slug>.md`. Nothing else, no scratch files.
- Never touch git or `.gitignore`. Never edit code.
- Never run `/sdlc:start` or any other pipeline command. You print it; the user runs it.

The argument, if any, is the user's rough idea. Without one, ask for it in one sentence first.

## Step 1 — Read the project

1. Read directly: `README.md`, `CLAUDE.md`, and the docs vault (`.brain/` if present, else
   `docs/`) — only the notes relevant to the idea (architecture, decisions, roadmap).
2. Dispatch one `Explore` subagent for a broad code sweep: where the idea would land, what already
   exists nearby, which modules, tests and conventions it would touch. Ask for conclusions with
   file paths, not file dumps.
3. Do not ask the user anything the files already answer.

## Step 2 — Interview in rounds

Each round is one message:

- **Frontier** — one line: which brief sections are settled and which are still open.
- **Questions** — numbered, at most 5, each about one open point. Under each, a
  **Recommended:** answer grounded in what you read (cite the file or note), or in the user's
  earlier answers. Write "no basis — your call" when you have nothing to ground it on.
- **Reply hint** — one line: the user may answer by number, write "ok" to accept every
  recommendation, or reply "n/a" to drop a point.

After each reply, fold the answers into the draft and open the next round on what is still missing.
Ask about what and why, scope edges and constraints. Do not design the solution, write user
stories or acceptance criteria: that is the `business-analyst` phase's job.

The interview ends when every section of the template below is filled or marked `n/a`. Then show
the full draft once and ask for corrections before saving.

If the user asks to finish early ("just write it", "enough"), put every unresolved point under
**Open questions & risks**, mark empty sections `n/a`, then show the draft and save as normal. If
the user abandons before confirming the draft, write nothing.

## Step 3 — The template

```markdown
---
title: "<one-line title>"
slug: <slug>
narrative_language: <uk | en>
---

# <title>

## Goal
## Context
## In scope / Out of scope
## Constraints
## Done looks like
## Open questions & risks
```

- **Goal** — the outcome and why it matters, in two or three sentences.
- **Context** — what exists today and the files, notes or decisions it touches.
- **In scope / Out of scope** — two bullet lists; out-of-scope items are explicit.
- **Constraints** — technical, product, compatibility or deadline limits.
- **Done looks like** — high-level acceptance signals as bullets. No Gherkin.
- **Open questions & risks** — what the interview left unresolved; `n/a` if nothing.

## Step 4 — Slug

1. Propose a slug from the agreed title: lowercase, every run of non-`[a-z0-9]` characters becomes
   one `-`, no leading or trailing `-`, at most 40 characters. It must match
   `^[a-z0-9][a-z0-9-]*$`. For a non-Latin title, build it from a short English rendering.
2. The user confirms or gives another slug; re-check the rule.
3. If `docs/briefs/<slug>.md` already exists, ask: **refine it** (read it as the seed and re-open
   the interview on its gaps) or **pick another slug**.

## Step 5 — Write

Write `docs/briefs/<slug>.md` from the template. `title` is the agreed title, always in double
quotes, with any `"` or `\` inside it escaped as `\"` and `\\`; `slug` the confirmed
slug, `narrative_language` the conversation's language (`uk` for Ukrainian, `en` otherwise). The
body is written in that same language; the frontmatter keys and section headings stay as in the
template.

## Step 6 — End

Print, then stop:

```
Brief saved: docs/briefs/<slug>.md
  slug: <slug>   language: <uk|en>   open questions: <N>

Next: /sdlc:start --brief=docs/briefs/<slug>.md
```

`<N>` is the number of bullets under **Open questions & risks** (0 for `n/a`). Do not run the
command.
