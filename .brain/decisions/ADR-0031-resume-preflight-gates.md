---
adr:
status: accepted
date: 2026-09-23
supersedes: null
---

# ADR-0031 — Resume preflight: branch and staleness gates

## Context

`commands/start.md` documents an explicit Non-goal: "`--resume` does NOT restore repository
state. It trusts the workspace and the code on disk; if git moved under the completed phases,
that is the operator's responsibility." In practice this means resuming a run after switching
branches silently applies completed-phase context (checkpoints, `_brief.md`) to whatever tree
happens to be checked out, with no signal that anything is wrong — and resuming a run whose
checkpoints are hours or days old gets no different treatment than resuming one from five
minutes ago.

A comparison with the competing plugin `AratKruglik/claude-sdlc` found it does not have this gap:
it HALTs `--resume` outright on a branch mismatch, and it gates a >6h-old run behind an
interactive resume/start-fresh/abort choice before continuing.

## Decision

Add both gates as one advisory command, matching this codebase's own "one command resolves it,
orchestrator only echoes" pattern (ADR-0019) instead of inlining bash logic into the prompt:

- `resumePreflight({ runPath, checkpointDir, currentBranch, nowMs, maxAgeMs })` in
  `plugins/sdlc/tools/run/reentry.mjs`, mirrored (re-exported, not duplicated — matching how
  `tools/sdlc-lint/lib/resume.mjs` already re-exports `resolveWorkspace`/`computeReentry`) into
  `tools/sdlc-lint/lib/resume.mjs`. It reports `{ branchOk, runBranch, currentBranch, stale,
  ageMs, newestCheckpointPath }` and never gates anything itself.
- `_run.json` gains two optional fields (`schemas/run.schema.json`): `branch_name`, recorded at
  **3-checkpoint-init** via `git branch --show-current` *after* Step 2 item 5's worktree
  resolution (recording it before would capture the orchestrator's own starting branch instead of
  the run's actual one), and `written_at`.
- `node tools/run/cli.mjs resume-check <slug-or-dir> --branch <name> [--max-age-hours N] [--json]`
  exposes it as a CLI query, exit 0 always — an advisory report, not a gate, the same split
  `resolve/cli.mjs plan` already has from the halt decision that reads its output.
- The pipeline-orchestrator SKILL.md's Resume mode (item 2b, between the existing "workspace
  missing" HALT and the `_brief.md` read) is the actual gate: **HALT** on `branchOk === false`,
  printing the exact `git checkout` remedy; **ask** resume/start-fresh/abort on `stale === true`
  when interactive, or **start fresh** automatically (with a stderr `WARN:`) when
  `CONTEXT.headless_mode` is true.
- Staleness is computed from the newest `mtimeMs` among checkpoint files (excluding `_run.json`,
  which is written once at run start and would otherwise mask genuine staleness) via Node's
  `fs.statSync` rather than shell `stat`/`find -newermt`, for the same GNU/BSD portability reason
  `hooks/seal-run.sh` already documents.

## Consequences

- A `_run.json` written before this ADR has no `branch_name`. `resumePreflight` treats that as
  `runBranch: null` and `branchOk: true` unconditionally — fail-open, a documented risk rather
  than a defect: an old run cannot regress into a HALT it never had, but it also gets no branch
  protection until it is next fully re-run.
- This closes the specific "resume onto the wrong branch" risk: `--resume` now HALTs before
  applying completed-phase context to a tree that never produced it.
- `commands/start.md`'s Non-goal paragraph remains true in spirit — `--resume` still does not
  *restore* repository state, it only refuses to proceed silently when the state looks wrong.

## Related
- Implemented by: this change (PR not yet opened at commit time — task review runs first; the
  brain-sync follow-up should backfill the PR number here once it merges).
- Relates to: [[decisions/ADR-0019-the-run-start-is-one-command]]
