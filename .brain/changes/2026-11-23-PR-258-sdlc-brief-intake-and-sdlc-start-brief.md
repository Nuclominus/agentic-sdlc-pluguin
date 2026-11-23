---
pr: 258
date: 2026-11-23
author: Nuclominus
type: feat
plugins: [android-foundation, sdlc]
roadmap: null
files_changed: 37
---

# PR #258 — /sdlc:brief intake and /sdlc:start --brief

> `feat` · merged 2026-11-23 · by @Nuclominus

## Summary

A pipeline run used to start from one line of `$ARGUMENTS`, so `business-analyst` had to guess
scope, constraints and what "done" means with nobody to ask. This PR adds an optional intake step
before the run. `/sdlc:brief` reads the project, interviews the user in rounds of numbered questions
with a recommended answer for each, and writes a six-section brief to `docs/briefs/<slug>.md`.
`/sdlc:start --brief=<path>` then takes the run's slug, narrative language and recipe-match text
from that brief's frontmatter instead of deriving them from free text. The skill knows nothing about
the orchestrator: it writes the file, prints the next command and stops.

## What changed

**sdlc resolver** (`plugins/sdlc/tools/resolve/`)
- **`brief.mjs`.** `readBrief` validates the file: inside the project (lexically and after
  `realpath`), a regular file, and frontmatter with `title`, `slug` and `narrative_language`
  (`uk` | `en`), all required. BOM and CRLF are tolerated. `--brief` counts only as a standalone
  token outside quotes, so a description that mentions the flag still runs.
- **Halts.** The resolver halts on `--brief` with a description, with `--resume` (pointing to
  `--resume=<slug>`), on the space form `--brief <path>`, and on an empty value. It also halts when
  `docs/plans/<slug>/.checkpoint/` already holds a run. It warns when the directory exists without
  checkpoints.
- **`briefArgs`.** It swaps the flag for the quoted title before workflow matching. Leading dashes
  and mid-word `--` runs are stripped from the match text only, so a title cannot smuggle a flag.
- **`slug.mjs`.** `slugify`, `briefOf`, `SLUG_RE` and `TOKEN_VALUE_FLAGS` move there unchanged.
- **`resolvePlan`.** It exposes `plan.brief: null | {path, title, slug, narrative_language}` and
  prints `📄 Brief: <path> → slug <slug>, narrative_language <lang>`.

**sdlc orchestrator** (`pipeline-orchestrator/SKILL.md`, `commands/start.md`)
- **Projection.** `plan.brief` is carried into CONTEXT on both the inline and the spilled-plan
  (`jq`) path.
- **Step 2.** With a brief set, Step 2 takes `task_slug` from it and copies the brief file into
  `_brief.md`. `narrative_language` comes from the frontmatter instead of the Cyrillic heuristic.
- **Resume.** Resume reads the language from the saved `_brief.md` frontmatter. A stale-resume
  "start fresh" keeps the existing `_brief.md` instead of overwriting it with `--resume=<slug>`.

**`/sdlc:brief` skill and command**
- **Context.** It reads README, CLAUDE.md and `.brain/` or `docs/`, plus one `Explore` sweep.
- **Interview.** It is bounded by Goal, Context, In scope / Out of scope, Constraints, Done looks
  like, and Open questions & risks. An early finish moves unresolved points to open questions. An
  abandoned interview writes nothing.
- **Output.** The title is always double-quoted in YAML, because unquoted `#`, `[` or a leading
  quote broke parsing.
- **Limits.** It writes only the brief, never touches git, and never runs `/sdlc:start`.
  `disallowed-tools: [Edit, NotebookEdit, Bash]` lasts only until the user's next message. After
  that, the instruction holds the limit.

**android-foundation**
- **`config-protection.sh`.** When `_brief.md` has frontmatter, the hook reads only the `title`, Goal
  and In-scope part of the brief to decide whether lint-config edits are in scope. Before this, a
  structured brief that merely said "do not relax detekt rules" would have unlocked the guard. A
  legacy one-line brief keeps the whole-file check.

**Eval.** `plugins/sdlc/evals/10-brief-dry-run` is the suite's first `case.yaml` case. It needs a
scaffold script to place the fixture, so run it with `--scaffold`. It pins `--workflow=hotfix`,
because auto-selection depends on the environment (the title also matches `debug`, and hotfix
abstains on a fresh branch per ADR-0040). Title matching is covered by unit tests instead.
`dist/antigravity` was regenerated in the same PR.

**Review history.** The per-task and whole-branch reviews, an automated security review and an
ultra review each found defects that would have shipped:
- the unquoted title;
- a directory path crashing;
- the space form silently becoming the description;
- a resumed `uk` run turning English;
- `plan.brief` lost on the spilled-plan path;
- the lint guard bypass;
- inherited checkpoints on a re-run.

All are fixed with tests.

**Not yet verified:** the interview itself on a real project. Per ADR-0042, that check is manual.

## Changed areas

- [[components/android-foundation]]
- [[components/sdlc]]

## Decisions & rationale

- [[decisions/ADR-0042-brief-intake-is-a-standalone-skill-not-an-agent]]: the decision this PR
  implements. Intake is a skill rather than an agent because a subagent cannot ask the user
  anything, and a main-thread agent is CLI-only. The `--brief` contract makes the slug, language and
  match text explicit machine values instead of heuristics.
- [[decisions/ADR-0029-one-ssot-emitted-host-packages]]: the skill is emitted to every host. Where
  `disallowed-tools` is missing, the restriction is the instruction alone.
- [[decisions/ADR-0033-lint-config-edits-are-gated-during-a-run]]: the guard whose brief-based
  bypass is narrowed to the task statement.
- [[decisions/ADR-0040-an-empty-diff-is-size-unknown]]: why the eval cannot rely on hotfix
  auto-selection on a fresh branch.

## Planning

- [[planning/roadmap]]: K1, standalone brief intake, is done in this PR. K2 (project Q&A,
  `/sdlc:ask`, ADR-0043) is next and depends on it.

---
_Auto-generated by `tools/brain-sync`. Frontmatter and the index are machine-owned; every prose section, Summary included, is meant to be enriched — but `sync --pr` rewrites the whole file, so enrich after running it._
