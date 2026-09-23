---
adr: 32
status: accepted
date: 2026-09-23
supersedes: null
---

# ADR-0032 — Commit hygiene is a deterministic hook, not a prompted step

## Context

The `developer` and `document-writer` agents are instructed, in prose, not to stage secrets and
not to bypass pre-commit/pre-push hooks with `--no-verify`. That instruction is a *prompted*
step, and H1 measured overall compliance with mandated prompted steps at 82.3% — a number that
says nothing about the miss rate specifically for "did an agent stage a key" or "did an agent
reach for `--no-verify` when a hook it didn't understand failed." A staged secret or a
`--no-verify` commit is a low-frequency, high-cost failure mode (a leaked credential, a broken
invariant shipped silently): exactly the shape of risk a probabilistic instruction cannot close
to zero, no matter how the prompt is worded.

A comparison with the competing plugin `AratKruglik/claude-sdlc` found it does not rely on
prompting for this: its `pre-commit-guard.sh` denies staged secrets and `--no-verify`
deterministically, as a `PreToolUse`/`Bash` hook. This codebase already has the identical shape
for a different concern — `plugins/android-foundation/hooks/git-guard.sh` gates
`commit`/`push`/`gh pr create` on the logging rule (ADR-0020), fails open on any condition it
cannot evaluate, and blocks with exit 2 plus a stderr report.

## Decision

Add `plugins/sdlc/hooks/pre-commit-guard.sh`, modeled directly on `git-guard.sh`'s shape (same
matcher, same fail-open philosophy, same exit-2-blocks contract), but placed in the **core**
`sdlc` plugin rather than in `android-foundation` — secret hygiene and `--no-verify` are not
Android-specific, they apply to every stack the pipeline runs on.

- Registered as a second `PreToolUse` group in `plugins/sdlc/hooks/hooks.json`, matcher `Bash`,
  alongside the existing `matcher: "Agent"` entry (`enforce-agent-model.sh`).
- `--no-verify` on `git commit`/`git push` is denied unconditionally, independent of file
  contents — it is a rule about the *act*, not the diff.
- Staged secrets are scanned only on `git commit` (staged files), `git push` and
  `gh pr create` (files added over the upstream/`origin/HEAD` base) — the same file-selection
  logic `git-guard.sh` already uses for the same three commands.
- Secret patterns are high-confidence only, to keep false positives near zero: an AWS access key
  ID (`AKIA[0-9A-Z]{16}`), a PEM private key block, and an assigned
  `api_key`/`secret`/`token`/`password` literal of 20+ characters. Anything murkier is a false
  positive tax on every future commit and was left out deliberately.
- The private-key pattern is written as `-----BEGIN ((RSA|EC|OPENSSH|DSA) )?PRIVATE KEY-----`
  rather than the empty-trailing-alternation form `(RSA |EC |OPENSSH |DSA |)` — the latter is
  rejected by at least one grep implementation actually in use on a contributor's machine
  (`grep: empty (sub)expression`), which would silently fail open on every private-key check
  while also printing that error to stderr on every gated commit, matching or not. The optional-
  group form is equivalent and portable.
- The hook fails open on every uncertain path: no `jq` on `PATH`, malformed JSON, an empty
  command, not inside a git repository, no staged/diff files, no `mktemp` available. Any
  condition it cannot evaluate is not treated as a violation.

## Consequences

- **Diff-scoped only, not a history scanner.** A key committed before this hook shipped is out
  of scope by design; this is a net for new leaks about to be published, not a repository audit.
  The stderr report says so explicitly so a false-positive fix doesn't get reached for
  `--no-verify` instead.
- **Claude-Code-only for now.** No Antigravity or Codex hook equivalent exists yet. Antigravity's
  host descriptor (`tools/sdlc-lint/hosts/antigravity.json`) already drops every `Bash`-matcher
  `PreToolUse` hook (`git-guard.sh` included) because that event was not observed to fire in
  print mode on the measured CLI version and the host declares no Claude-tool-name map — the
  same automatic drop applies to `pre-commit-guard.sh`, and `emit`'s dropped-hooks report is the
  place that stays honest about it, not a silent gap.
- **This closes a specific, low-frequency but high-cost gap**: an agent staging a secret or
  reaching for `--no-verify` under time pressure now hits a deterministic denial instead of
  depending on the 82.3%-measured prompted-step compliance rate.
- Anyone hitting a false positive (a test fixture, a rotated/dummy key) removes the matching
  pattern or moves the value to an untracked file — the report says this explicitly, and says
  not to reach for `--no-verify` instead, since that would defeat both denials at once.

## Related
- Implemented by: this change (PR not yet opened at commit time).
- Relates to: [[decisions/ADR-0031-resume-preflight-gates]] /
  [[decisions/ADR-0020-logging-lives-in-a-development-artifact]] /
  [[decisions/ADR-0029-one-ssot-emitted-host-packages]]
