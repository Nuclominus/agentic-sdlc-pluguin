---
adr: 33
status: accepted
date: 2026-09-23
supersedes: null
---

# ADR-0033 — Lint/format config edits are gated during a run

## Context

The competing plugin `claude-sdlc` denies edits to `eslint.config.*`/`ruff.toml`/`phpstan.neon`/
etc. during a pipeline run unless the run's own task is explicitly about that config — closing
the failure mode where an agent under QA pressure quietly loosens the linter instead of fixing
the code it is flagging. Its bypass check keys on a `references/task-type-patterns.json`
classifier: a small taxonomy of task types (bugfix, feature, config-change, …) matched against
the task description.

This repo has no equivalent classifier, and inventing one only for this single gate is
disproportionate: the run's `_brief.md` is already the SSOT description of what the run is for
(read at Step 2 of the pipeline, and by `pre-commit-guard.sh`'s sibling hooks for other
decisions). A substring check against that same file gets the same practical bypass — "this run
is genuinely about the lint config" — without adding a second source of truth to keep in sync.

"What counts as a lint/format config file" is stack-specific knowledge — a `detekt.yml` or
`.editorconfig` means something only in a Kotlin/Android context — so this follows the same
placement reasoning as `kotlin-guard.sh` and `format-on-stop.sh`: it lands in `android-foundation`,
not core `sdlc`.

## Decision

Add `plugins/android-foundation/hooks/config-protection.sh`, a `PreToolUse`/`Edit|Write` hook
registered alongside (not replacing) `guard-paths.sh` in the same matcher block:

- Matches on the target file's **basename** — `.editorconfig`, `detekt.yml`, `.detekt.yml`,
  `checkstyle.xml` — so a file nested under `config/detekt/` and one at the repo root are both
  caught the same way. Anything else falls through immediately (exit 0).
- Scope is strictly an **active, unsealed** SDLC run: the same detection loop `seal-run.sh`
  already uses (`docs/plans/<slug>/.checkpoint/` present, `.checkpoint/_sealed` absent). No
  active run at all — including a run that has already been sealed — means the hook never
  engages. A manual edit outside a pipeline run is therefore never blocked, which is what keeps
  this from becoming a project-wide annoyance.
- Bypass: a case-insensitive substring match for
  `detekt|ktlint|checkstyle|editorconfig|lint config|linter config` against the active run's own
  `_brief.md`. If the brief names the tool, the edit is allowed — the run is presumed to
  genuinely be about that config.
- Fails open on every uncertain path: no `jq` on `PATH`, no target path in the payload, no
  `docs/plans` directory, no active run, no `_brief.md` to read. Exit 2 (block) only fires when
  every one of the conditions above is affirmatively true.

## Consequences

- **Android-specific.** Lands in `android-foundation`, not core `sdlc`, because the set of
  protected filenames is stack knowledge, not something the pipeline core can express
  generically — matching the placement of `kotlin-guard.sh` and `format-on-stop.sh`.
- **Claude-Code-only for now**, same host-parity caveat as ADR-0031 and ADR-0032: no Antigravity
  or Codex equivalent exists yet, and Antigravity's host descriptor already drops
  `PreToolUse`/`Edit|Write` hooks of this shape where that event isn't observed to fire.
- **Bypass-scoping tradeoff, accepted deliberately.** The substring match is coarse: a brief that
  mentions "migrate away from checkstyle" (i.e., a task about *removing* the tool, not tuning it)
  would also satisfy the bypass and allow the edit, even though loosening the config isn't really
  what that task is about. This is accepted because the failure direction is asymmetric with
  Task 2's secret/`--no-verify` guard: the worst case here is an unwanted **allow** (a config
  edit that proceeds when a tighter check might have blocked it), not a wrongful **block** that
  stops legitimate work. A false allow is bounded by the fact that the edit still goes through
  code review before merge; a false block would instead hard-stop an unrelated task with no
  workaround except restating the brief. Given that asymmetry, keeping the check as a simple,
  auditable substring match (rather than building keyword exclusion lists that would themselves
  need maintenance) is the better trade.
- Anyone hitting an unwanted allow or block can restate the run's `_brief.md` to describe the
  task more precisely and restart the run, or ask the operator to make the edit directly.

## Related
- Implemented by: this change (PR not yet opened at commit time).
- Relates to: [[decisions/ADR-0032-commit-hygiene-is-a-deterministic-hook]] /
  [[decisions/ADR-0031-resume-preflight-gates]] /
  [[decisions/ADR-0014-the-run-tail-is-one-command]]
