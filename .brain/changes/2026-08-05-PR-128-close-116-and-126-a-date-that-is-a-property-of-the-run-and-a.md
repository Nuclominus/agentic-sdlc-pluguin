---
pr: 128
date: 2026-08-05
author: Nuclominus
type: fix
plugins: []
roadmap: null
files_changed: 9
---

# PR #128 — close #116 and #126 — a date that is a property of the run, and a --json that always parses

> `fix` · merged 2026-08-05 · by @Nuclominus

## Summary

Both open issues. Neither breaks a build; both quietly hand a caller a wrong or unreadable answer, which is the worse failure.

## Changed areas

- _Repo-level change (no plugin under `plugins/` touched)._ `tools/sdlc-lint/lib/compliance.mjs`
  (the date chain), `lib/compliance-report.mjs` (the undated rendering), `cli.mjs` (repeatable
  `--runs`, one error envelope).
- **Vault, in the same PR:** [[planning/backlog]] and [[planning/h1-compliance-auditor]] mark the
  defect done; [[planning/h-instruction-fidelity]] and [[planning/h5-prompt-surface]] carry
  re-measured figures, because both quoted numbers computed from the copy this fix removes the
  need for.

## #116 — the run date came from `mtime`

`runDate()` fell back to `statSync(_telemetry.json).mtimeMs`. **mtime is not a property of a run** —
copying, restoring, archiving or syncing rewrites it — and the run date decides every `predates`
verdict and therefore every contract's denominator. A `cp -R` without `-p` while merging two corpora
moved three published rates by up to 37 points, `5b-finish` from 100% to 63%. That is the number
gating the H4 decision, and both outputs looked equally healthy.

Four content-derived links replaced it, each ordered for a stated reason: telemetry `started_at` →
`.checkpoint/_started_at` (the ADR-0014 anchor, exact) → the oldest checkpoint's `completed_at`
(model-typed, so weaker — but about *this* run, which is why it outranks the next) → the owning
session transcript's first message (harness-written, but it dates the *session*, and a resumed
session can start days before the run it later performs).

No link resolves → `na: undated` for every contract. An undated run contributes to no rate, which
is visible; a misdated one contributes to all of them, which is not.

The compounding half mattered as much: `--runs` took only the first glob, so auditing two corpora as
one population *required* copying trees together — the operation that triggered the bug. It is
repeatable now, and the acceptance test is the literal reproduction (`cpSync` restamps mtime as
`cp -R` did; the verdicts must not move).

## #126 — `--json` wrote nothing on some error paths

`cli.mjs <verb> --json | jq` returned a parse error rather than a diagnosis, so a caller could not
tell *"the tool failed"* from *"the tool had nothing to say"* — the same shape as #121's `halt`
travelling on a channel nobody read. Surveying it before filing corrected the framing given in
review: `report`, `rollup` and `resume` already emitted the envelope, so this was an
**inconsistency across five paths, not a convention**.

The table test is the fix that matters. `compliance` set the stderr-only pattern and `start-window`
reproduced it *by copying*; without a per-verb assertion that `--json` parses on every exit code a
verb can return, the next verb does the same.

## What review found — both defects were in the fix

1. **`firstTranscriptTime` still depended on mtime.** `resolveRunSessions` sorts sessions by mtime,
   and the fix took the *first* session's first timestamp — so a chain documented as "never from the
   filesystem" rested on it at link 4, wearing its own comment as cover. It keeps the earliest
   timestamp across all sessions now, which is order-independent.
2. **An undated run rendered as `✓`.** All-`na` leaves the deviation list empty, so a run scored
   against *nothing* printed the tick a fully compliant run gets. "Both outputs look equally
   healthy" — the sentence #116 was filed over — reproduced one level up by the fix for it.

## Re-measurement (2026-08-05, in place, no copying)

29 auditable runs; **26 dated from `started_at`, 3 from the checkpoint anchor, 0 undated**. The
three anchor-dated runs are exactly the ones that used to be `date-inferred`.

| | 2026-08-04 (`cp -Rp`) | 2026-08-05 (in place) |
|---|---|---|
| auditable | 28 | **29** (Citrus 9 → 10) |
| `5b-finish` | 100% · n=5 | 100% · n=**6** |
| `3d-1b-phase-cost` | 67% · n=9 | **60%** · n=10 |
| live overall | 92.9% | **91.9%** |
| parlor alone | 90.0% | **90.0%** |

**The H4 decision does not move**: 91.9% still clears the gate's own *"above ~90%"* wording, and its
sample-size half is still unmet at six runs against the ~10 asked for.

The 1-point drop is **not** the mtime bug resurfacing — the `cp -Rp` merge preserved mtimes and was
right. It is one added Citrus run failing `3d-1b`. Parlor alone reproducing to the decimal is the
check that establishes it.

## Decisions & rationale

- _No ADR._ Two instrument-correctness fixes; they change no design, only whether the instruments
  tell the truth.
- **The real fix in both cases is a test, not a line of code.** Both defects shipped green and were
  found by hand in the output months later. `#116` gets the copy-reproduction test; `#126` gets the
  per-verb JSON table. Without those, the same shape returns via the next corpus merge and the next
  verb added.
- **Vault correction in the same PR**, per `.claude/rules/second-brain.md` §1: the two planning
  notes quoted figures derived from the very copy this change removes the need for. Leaving them for
  a follow-up would have left the H4 gate reading off a number no tool could reproduce.

## Planning

- Closes the *Track H-audit* item in [[planning/backlog]] and the mtime follow-up in
  [[planning/h1-compliance-auditor]].
- Filed **#129** — coverage gaps the review judged follow-up-sized: happy-path JSON shape for both
  verbs, `aggregate`'s rate arithmetic, a direct `resolveRunSessions` test, and a multi-session
  fixture (its whole reason for existing is the resumed case, and every fixture is single-session).

---
_Auto-generated by `tools/brain-sync`. Frontmatter is machine-owned; prose below "Summary" is safe to enrich._
