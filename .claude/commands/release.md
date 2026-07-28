---
description: Cut a marketplace release — refresh the roadmap board, bump the marketplace version on develop, fast-forward the release branch (the stable @release install channel), tag it, and publish the GitHub release. Repo-maintainer command; not shipped in any plugin.
argument-hint: "[patch|minor|major|X.Y.Z]"
---

# /release

Moves the stable install channel forward. Users who added the marketplace with
`/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin@release` install and update from the
`release` branch; this command is the only thing that moves it. The flow: refresh the roadmap
board and promote the changelog, bump the top-level `version` in
`.claude-plugin/marketplace.json` on `develop`, fast-forward `release` to that commit, tag it, and
publish the GitHub release from the tag.

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
   - `gh auth status` — step 7 publishes the GitHub release, so fail here rather than after the
     refs have moved. If `gh` is missing or unauthenticated, stop.

1. **Compute the new version.**
   - Current version: `git show origin/develop:.claude-plugin/marketplace.json`, field `version`.
   - Argument `$ARGUMENTS`: an explicit `X.Y.Z`, or a bump keyword `patch` | `minor` | `major`.
     Default when empty: `patch`.
   - Validate: strict `X.Y.Z` semver, strictly greater than the current version. The one
     exception is a resume — an explicit `X.Y.Z` equal to the current version, when step 0 showed
     the bump commit already on `develop` and `release`/the tag lagging behind. In that case skip
     the file edits in step 3 and the commit in step 5, and continue from whichever of steps 6–7
     has not run — reading the release notes from the `## [X.Y.Z]` section already committed on
     `develop`.
   - `gh release view vX.Y.Z` — if a GitHub release already exists for this version, stop and
     report. Resuming a run that never reached step 7 is fine; re-publishing an existing release
     is not, and editing it is a manual call.

2. **Per-plugin version check (warn-only gate).** For each directory in `plugins/*` that has
   changes in `origin/release..origin/develop`, compare its `.claude-plugin/plugin.json`
   `version` between the two refs. If a plugin's content changed but its version did not, list
   those plugins in the confirmation below — installed copies of an explicitly-versioned plugin
   may not pick up the update while its version stands still. The fix (bumping that plugin's
   version) belongs in a normal PR to `develop`, not in this command.

3. **Stage the release commit in a temp worktree.** Work in a temporary worktree so the
   operator's checkout and current branch are untouched:
   - `git worktree add "$CLAUDE_JOB_DIR/tmp/release-wt" --detach origin/develop` (fall back to
     `$(mktemp -d)/release-wt` when `CLAUDE_JOB_DIR` is unset).

   Then, inside the worktree, prepare three files — nothing is committed or pushed yet:

   a. **Roadmap board.** Run `node roadmap/generate.mjs`. It rewrites only the SEED block in
      `roadmap/index.html` from the `.brain/planning/roadmap.md` table, and prints either
      `already in sync` or `wrote N items`. `.brain/planning/roadmap.md` is the hand-curated vault
      SSOT — never edit it here; if the board and the table disagree about an item's status, that
      is a vault edit for a normal PR. Note the resulting `git diff --stat` for the confirmation.

   b. **Changelog promotion.** In `CHANGELOG.md`:
      - If a `## [X.Y.Z]` section already exists (pre-promoted in a PR, or a resumed release),
        leave the file untouched and use that section's body as the release notes.
      - Else, if `## [Unreleased]` has a non-empty body: rename that heading to
        `## [X.Y.Z] — YYYY-MM-DD` (date from `date +%F`, never guessed) and insert a fresh, empty
        `## [Unreleased]` above it. The promoted body is the release notes.
      - Else (`## [Unreleased]` is empty): leave the file untouched; the release notes fall back
        to the shipped commit list from step 0.

   c. **Version bump.** Edit only the top-level `"version"` value in
      `.claude-plugin/marketplace.json`.

   Finally, compose the release notes into a file under the same temp root (e.g.
   `<tmp>/release-notes.md`) and pick a title: `vX.Y.Z — <short summary>` (≤ ~60 chars, drawn
   from the changelog section's lead paragraph and dominant change), or a bare `vX.Y.Z` when the
   body is only the commit list.

4. **Confirm with the user.** A release is outward-facing — always confirm before pushing
   anything. Show: current → new version, the commit list from step 0, any warnings from step 2,
   the roadmap board delta from 3a (or "already in sync"), whether `CHANGELOG.md` is being
   promoted, and the GitHub release title + notes that step 7 will publish. Offer: proceed /
   cancel (and, if step 2 warned, a "cancel to bump plugin versions first" framing).

5. **Bump commit on develop.** In the worktree:
   - Stage exactly the files touched in step 3 — `.claude-plugin/marketplace.json`, and
     `roadmap/index.html` / `CHANGELOG.md` only if they actually changed. Never `git add -A`.
   - Commit as `chore(release): vX.Y.Z`.
   - `git push origin HEAD:develop`. If rejected (branch protection, or new commits landed on
     `develop` since the fetch), remove the worktree, report, and stop — nothing has moved yet.
     This direct chore push deliberately skips the PR + brain-sync heartbeat: a version bump,
     a regenerated board and a changelog promotion carry no knowledge worth a change note.

6. **Fast-forward release and tag.** Using the bump commit's SHA:
   - `git push origin <sha>:release` (fast-forward by construction after step 0).
   - In the worktree: `git tag -a vX.Y.Z -m "Release vX.Y.Z" <sha>` then
     `git push origin vX.Y.Z`.

7. **Publish the GitHub release.** From the tag pushed in step 6:
   - `gh release create vX.Y.Z --verify-tag --title "<title>" --notes-file <tmp>/release-notes.md`
   - `--verify-tag` aborts if the tag never reached the remote, so a half-applied release cannot
     produce a dangling GitHub release. Do not pass `--draft`; do not pass `--prerelease` unless
     the version carries a pre-release suffix. GitHub marks the newest semver release as
     `Latest` on its own.
   - Report the release URL.

8. **Cleanup and report.** `git worktree remove` the temp worktree. Then print a short summary:
   new version, released SHA, the shipped commit list, tag name, GitHub release URL, and a
   reminder that `@release` users receive it on their next `/plugin marketplace update` (or
   auto-update), while `develop` users are unaffected.

## Failure rule

If any push or publish in steps 5–7 fails, leave the remote exactly as it is, remove the temp
worktree, and report precisely which of the four artifacts (develop bump, `release` branch, tag,
GitHub release) moved and which did not. A partially-applied release is resumed by re-running
`/release` with the same explicit `X.Y.Z` — step 0, the version validation and the
already-published check in step 1 make re-runs safe, and step 3's changelog branch is idempotent
(an already-promoted `## [X.Y.Z]` section is reused, not re-promoted).
