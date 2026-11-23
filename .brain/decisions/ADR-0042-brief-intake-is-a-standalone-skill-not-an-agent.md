---
adr: 42
status: accepted
date: 2026-11-23
supersedes: null
---

# ADR-0042 — Brief intake is a standalone skill, not an agent

## Context

A pipeline run starts from `$ARGUMENTS`. The orchestrator writes it verbatim to
`docs/plans/{task_slug}/_brief.md` (`pipeline-orchestrator/SKILL.md`, Step 1), and that file is the
SSOT task description every phase agent reads. The same string drives three machine values:
`task_slug` (lowercase, alphanumerics + dashes, max 40 chars), `narrative_language` (a
Cyrillic-majority heuristic), and the recipe `match` rules. A one-line request is a thin brief:
`business-analyst` has to guess scope, constraints and what "done" means on its own, inside the run,
with nobody to ask.

The gap is a step **before** the run: an optional intake that reads the project (code, `.brain/` or
other docs, README, CLAUDE.md), interviews the user, and leaves a real brief behind. It may write
that brief and nothing else.

The first shape considered was a new core agent (`brief-writer`). It fails on the one property the
step exists for:

| Container | Can ask the user questions | Can deny `Edit`/`Bash` | How it is started |
|---|---|---|---|
| Subagent (via `Agent`) | **no**: `AskUserQuestion` is removed from subagents; the only channel back is one final report | yes (`tools:`) | from any session |
| Main-thread agent (`claude --agent`, `agent` setting) | yes | yes (`tools:` applies) | a separate CLI session; not documented for the desktop app; host support unknown |
| Skill | yes | yes (`disallowed-tools`) | from any session, any host the package is emitted to |

(Claude Code docs, `sub-agents.md` and `skills.md`, read 2026-11-23. A skill's `allowed-tools` only
pre-approves tools; `disallowed-tools` is what restricts them.) None of the three can restrict the
**path** `Write` writes to, so that property does not separate them.

Wrapping an existing interview skill (`mattpocock-skills:grilling` / `grill-me`) was also
considered. Under [[decisions/ADR-0028-an-external-dependency-is-never-a-marketplace-entry]] such a
skill can only be a `policy: warn` runtime dependency with a fallback, which means two execution
paths whose behaviour depends on the user's install. Its stop condition (an empty design tree) is
also unbounded, while intake must stop when the brief is complete, or it drifts into the analysis
`business-analyst` owns.

## Decision

**Brief intake is a core skill, `/sdlc:brief`, that knows nothing about the orchestrator. It
interviews, writes `docs/briefs/<slug>.md`, prints the command to run next, and stops. The
orchestrator consumes the file through a `--brief=<path>` flag.**

1. **Container.** A skill in `plugins/sdlc/skills/brief/`, emitted to every host per
   [[decisions/ADR-0029-one-ssot-emitted-host-packages]]. On a host without `disallowed-tools`, the
   restriction is carried by the instruction alone.
2. **Restriction.** `disallowed-tools: [Edit, NotebookEdit, Bash]`. `Write` stays for the brief,
   `Agent` for `Explore`, and `Read`/`Glob`/`Grep` for reading. The restriction lasts only until
   the user's next message (Claude Code `skills.md`), so it guards the opening research turn, not
   the whole interview. Across the interview, "write only the brief" is an instruction, backed by
   the permission prompts the user sees in their own session. A
   marker-file `PreToolUse` gate was rejected: the skill runs under the user's eyes, and a stale
   marker after a crash would block unrelated work.
3. **Context.** The skill reads targeted files itself (README, `.brain/` or docs, CLAUDE.md) and
   dispatches a read-only `Explore` subagent for broad sweeps of the code, keeping the interview's
   context lean.
4. **Interview.** Rounds of numbered questions, each with a recommended answer grounded in what was
   read. The round format is written into `SKILL.md` itself, so there is no external dependency. The
   interview is bounded by the template: it ends when every section is filled or marked `n/a`.
5. **Template.** Six sections: **Goal**, **Context**, **In scope / Out of scope**, **Constraints**,
   **Done looks like** (high-level acceptance signals, not Gherkin), and **Open questions & risks**.
   Frontmatter: `title`, `slug`, `narrative_language` (`uk` | `en`). The brief is written in the
   language of the conversation.
6. **File.** `docs/briefs/<slug>.md`. The skill proposes the slug from the agreed title, using the
   orchestrator's algorithm, and the user confirms it. If the file exists, the user chooses: refine
   it (read it as the seed) or pick another slug. The skill never touches git or `.gitignore`.
7. **End.** The skill saves the file, prints a short summary (slug, language, number of open
   questions) and `/sdlc:start --brief=docs/briefs/<slug>.md`. It does not run that command.
8. **The `--brief` contract.** With `--brief=<path>`, the orchestrator takes `task_slug` from
   `slug`, applies the recipe `match` rules to `title`, takes `narrative_language` from the
   frontmatter instead of the heuristic, and copies the whole file into `_brief.md`. Combining
   `--brief` with a description or with `--resume` is an error. It combines with `--workflow` and
   `--dry-run`.
9. **Business analyst.** A brief is the `business-analyst` phase's input, not a reason to skip it.
   The brief settles what and why and where the edges are. BA still writes stories and acceptance
   criteria. Skipping BA stays the skip rule's decision.

Rejected alternatives: **a core agent** (a subagent cannot interview; a main-thread agent is
CLI-only and needs its own session); **an auto-invoked intake step inside `/sdlc:start`** (a
"request too vague" heuristic is the riskiest part and couples the skill to the run); **writing
straight to `docs/plans/<slug>/_brief.md`** (a pre-existing file would silently change what
`/sdlc:start` does); **a `recipe` frontmatter field** (it would make the skill know about recipes;
it can be added later).

## Consequences

- A run can start from a reviewed, structured brief instead of one line. That brief can also be
  edited by hand between intake and the run.
- The orchestrator gains one flag and an explicit source for three machine values, in line with
  machine contracts living in state rather than in prose heuristics. Plain `$ARGUMENTS` runs are
  unchanged.
- No new agent: the core roster of [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]]
  stays as it is, and so do the model registry and the host agent maps.
- Verification is split. An eval case covers `/sdlc:start --brief=<fixture> --dry-run` (slug,
  language and recipe come from the frontmatter). The skill itself is covered by the `doc-refs`
  lint and `emit --check`, since no skill-frontmatter lint exists. The interview itself is checked by hand on a real project, because a scripted interview tests the
  script, not the skill.
- The flag is spelled `--brief=<path>` because the resolver reads flags in the `--x=VALUE` form.
  It counts only as a standalone token outside quoted text, so a quoted description that mentions
  `--brief` stays a description. The round format is written in our own words rather than borrowed.
- A brief whose `docs/plans/<slug>/.checkpoint/` already holds checkpoints halts: a fresh run there
  would inherit the old run's completed phases on a later `--resume`. The user resumes or removes
  the directory; nothing is deleted automatically.
- Android's lint-config guard reads only the title, Goal and In scope of a structured `_brief.md`,
  so a Constraints or Out-of-scope mention of a linter does not unlock a config edit.

## Related
- Implemented by: #258
- Relates to: [[decisions/ADR-0018-reviewers-do-not-write-code]] (another role with deliberately
  narrow write access), [[decisions/ADR-0019-the-run-start-is-one-command]] (the run start the
  `--brief` flag extends), [[components/sdlc]]
