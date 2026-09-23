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
- Scope is strictly an **active** SDLC run, where active means both **unsealed** and **fresh**:
  `docs/plans/<slug>/.checkpoint/` present, `.checkpoint/_sealed` absent, AND the checkpoint
  directory (or a file inside it) touched within the last 6 hours — the same freshness window
  ADR-0031's `resumePreflight()` uses by default. A run that has already been sealed, or one
  that was abandoned/crashed before ever writing `_telemetry.json` (so `seal-run.sh`'s own
  seal-stale mechanism never sealed it) and has simply gone stale, both mean the hook never
  engages. A manual edit outside a pipeline run is therefore never blocked, which is what keeps
  this from becoming a project-wide annoyance. When several run directories are simultaneously
  fresh, the hook uses only the single most-recently-touched one's `_brief.md` — never the
  first one encountered in glob order, and never an OR across all of them.
- Bypass: a case-insensitive substring match for
  `detekt|ktlint|checkstyle|editorconfig|lint config|linter config` against the active run's own
  `_brief.md`. If the brief names the tool, the edit is allowed — the run is presumed to
  genuinely be about that config.
- Fails open on every uncertain path: no `jq` on `PATH`, no target path in the payload, no
  `docs/plans` directory, no active run, no `_brief.md` to read, an unreadable `_brief.md` even
  when it exists, or an ambiguous "which run is active" call (a tie between two equally-fresh
  candidates, or a freshness check that `stat` itself cannot evaluate). Exit 2 (block) only
  fires when every one of the conditions above is affirmatively true.

## Consequences

- **Android-specific.** Lands in `android-foundation`, not core `sdlc`, because the set of
  protected filenames is stack knowledge, not something the pipeline core can express
  generically — matching the placement of `kotlin-guard.sh` and `format-on-stop.sh`.
- **Claude-Code-only for now**, the same host-parity caveat ADR-0032 documents for
  `pre-commit-guard.sh` (ADR-0031 is not a hook and carries no such caveat itself, only the
  6h freshness default this hook reuses): no Antigravity or Codex equivalent exists yet, and
  Antigravity's host descriptor already drops `PreToolUse`/`Edit|Write` hooks of this shape
  where that event isn't observed to fire.
- **Freshness-windowed, not pure seal-state.** The original design treated any unsealed
  checkpoint directory as "active," on the assumption that this mirrored `seal-run.sh`'s own
  detection loop. It did not: `seal-run.sh`'s `seal-stale` only seals a run that has
  `_telemetry.json`, is unsealed, and is within its own age check, so a run abandoned before
  ever writing `_telemetry.json` (or simply old) never gets sealed and would have stayed
  "active" under the pure seal-state check forever — blocking an unrelated manual config edit
  indefinitely with no SDLC run actually in progress. The check is now freshness-windowed: a
  candidate run counts as active only if its `.checkpoint/` (directory entry or any file
  inside it) was touched within the last 6 hours, computed via a small portable
  `mtime_epoch()` helper (`stat -c` on GNU, falling back to `stat -f` on BSD/macOS — the same
  GNU/BSD split `seal-run.sh` avoids for `find -newermt`, avoided here the same way). When
  multiple candidates are simultaneously fresh, the hook picks the single most-recently-touched
  one's `_brief.md`, not the first one encountered in glob/filesystem order (previously
  alphabetical, and therefore capable of reading and bypass-checking against the wrong run's
  brief). A tie between equally-fresh candidates, or a freshness check `stat` cannot evaluate,
  fails open rather than guessing.
- **Readability fail-open.** If the active run's `_brief.md` exists but is unreadable by the
  time the bypass check runs (permissions, a race), the hook now checks `[ -r "$active_brief" ]`
  explicitly and exits 0 (allow) rather than letting `grep`'s non-zero exit fall through to the
  BLOCK branch — an unreadable brief is an evaluation failure, not evidence the bypass didn't
  match.
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
- Implemented by: #210
- Relates to: [[decisions/ADR-0032-commit-hygiene-is-a-deterministic-hook]] /
  [[decisions/ADR-0031-resume-preflight-gates]] /
  [[decisions/ADR-0014-the-run-tail-is-one-command]]
