---
description: Interview the user about a rough idea and write a structured task brief to docs/briefs/<slug>.md, ready for /sdlc:start --brief. Writes only the brief; never runs the pipeline.
argument-hint: "[rough idea]"
---

# /sdlc:brief

Pre-run intake. Invoke the **`sdlc:brief`** skill.

- `[rough idea]` (optional) — the idea to shape. Omitted → the skill asks for it.

The skill reads the project (README, CLAUDE.md, docs, a code sweep), interviews you in rounds of
numbered questions with a recommended answer for each, writes `docs/briefs/<slug>.md` (Goal,
Context, In scope / Out of scope, Constraints, Done looks like, Open questions & risks), and prints
`/sdlc:start --brief=docs/briefs/<slug>.md`. It writes nothing else, never touches git, and never
starts the run.
