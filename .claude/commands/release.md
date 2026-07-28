---
description: Cut a marketplace release — bump the marketplace version on develop and fast-forward the release branch (the stable @release install channel). Repo-maintainer command; not shipped in any plugin.
argument-hint: "[patch|minor|major|X.Y.Z]"
---

# /release

Moves the stable install channel forward. Users who added the marketplace with
`/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin@release` install and update from the
`release` branch; this command is the only thing that moves it. The flow: bump the top-level
`version` in `.claude-plugin/marketplace.json` on `develop`, then fast-forward `release` to that
commit and tag it.

Never run any step with `--force`. Every push here must be a fast-forward; if one is rejected,
stop and report — do not retry.

## Steps

0. **Preflight.**
   - `git fetch origin --tags`
   - Verify `origin/release` exists. If not, stop: it is created once with
     `git push origin origin/develop:refs/heads/release`, and the operator should confirm the cut
     point first.
   - `git log --oneline origin/release..origin/develop` — the commits this release would ship.
     If empty, stop: nothing to release.
   - `git log --oneline origin/develop..origin/release` — must be empty. If not, `release` has
     diverged from `develop` and a fast-forward is impossible; stop and report the divergent
     commits. Do not attempt to fix this inside the command.

1. **Compute the new version.**
   - Current version: `git show origin/develop:.claude-plugin/marketplace.json`, field `version`.
   - Argument `$ARGUMENTS`: an explicit `X.Y.Z`, or a bump keyword `patch` | `minor` | `major`.
     Default when empty: `patch`.
   - Validate: strict `X.Y.Z` semver, strictly greater than the current version.

2. **Per-plugin version check (warn-only gate).** For each directory in `plugins/*` that has
   changes in `origin/release..origin/develop`, compare its `.claude-plugin/plugin.json`
   `version` between the two refs. If a plugin's content changed but its version did not, list
   those plugins in the confirmation below — installed copies of an explicitly-versioned plugin
   may not pick up the update while its version stands still. The fix (bumping that plugin's
   version) belongs in a normal PR to `develop`, not in this command.

3. **Confirm with the user.** A release is outward-facing — always confirm before pushing
   anything. Show: current → new version, the commit list from step 0, and any warnings from
   step 2. Offer: proceed / cancel (and, if step 2 warned, a "cancel to bump plugin versions
   first" framing).

4. **Bump commit on develop.** Work in a temporary worktree so the operator's checkout and
   current branch are untouched:
   - `git worktree add "$CLAUDE_JOB_DIR/tmp/release-wt" --detach origin/develop` (fall back to
     `$(mktemp -d)/release-wt` when `CLAUDE_JOB_DIR` is unset).
   - In the worktree, edit only the top-level `"version"` value in
     `.claude-plugin/marketplace.json`.
   - Commit as `chore(release): vX.Y.Z`.
   - `git push origin HEAD:develop`. If rejected (branch protection, or new commits landed on
     `develop` since the fetch), remove the worktree, report, and stop — nothing has moved yet.
     This direct chore push deliberately skips the PR + brain-sync heartbeat: a version bump
     carries no knowledge worth a change note.

5. **Fast-forward release and tag.** Using the bump commit's SHA:
   - `git push origin <sha>:release` (fast-forward by construction after step 0).
   - In the worktree: `git tag -a vX.Y.Z -m "Release vX.Y.Z" <sha>` then
     `git push origin vX.Y.Z`.

6. **Cleanup and report.** `git worktree remove` the temp worktree. Then print a short summary:
   new version, released SHA, the shipped commit list, tag name, and a reminder that `@release`
   users receive it on their next `/plugin marketplace update` (or auto-update), while `develop`
   users are unaffected.

## Failure rule

If any push in steps 4–5 fails, leave the remote exactly as it is, remove the temp worktree,
and report precisely which of the three refs (develop bump, release, tag) moved and which did
not. A partially-applied release is resumed by re-running `/release` with the same explicit
`X.Y.Z` — step 0 and the version validation make re-runs safe.
