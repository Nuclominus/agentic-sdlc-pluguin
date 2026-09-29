---
description: Re-sync the Android CLI skill matrix with Google's upstream catalog — refresh upstream metadata, triage new skills with the maintainer's approval, regenerate the tables, and open a PR. Repo-maintainer command; not shipped in any plugin.
argument-hint: "[--catalog <dir>] [--version <v>]"
---

# /android-skills-sync

Keeps `plugins/android-foundation/skill-sets/android-skills.yaml` (the per-role skill matrix,
ADR-0036) in step with Google's `android/skills` catalog. The script does the bookkeeping; the one
decision it cannot make — **which role gets a new skill** — is yours, and nothing is assigned
without your yes.

The script never deletes a row and never assigns a role on its own. A new skill lands as
`unassigned: "TRIAGE — …"`, and `sdlc-lint skill-sets` fails until every TRIAGE marker is gone, so
an unfinished sync cannot merge.

## Steps

0. **Preflight.**
   - `git status --short` must be clean (stage-specific, never `git add -A`: other work may be in
     the tree). `git fetch origin`.
   - Branch from develop: `git switch -c chore/android-skills-sync-<YYYY-MM-DD> origin/develop`.

1. **Get a current catalog.** Pick ONE source and say which you used:
   - **The CLI's clone** (default, `~/.android/cli/skills`). Measured 2026-09-29: `android skills
     list|find|--help` do NOT refresh it; the clone moves with the CLI itself. `android update`
     upgrades the CLI binary, so **ask before running it**. Then read `~/.android/cli/skills/version`.
   - **A fresh checkout** (no CLI needed, no machine state changed):
     `git clone --depth 1 https://github.com/android/skills "$TMPDIR/android-skills"`, and pass
     `--catalog "$TMPDIR/android-skills"`. A checkout has no `version` file, so also pass
     `--version <short sha or the CLI's version>`.
   - `$ARGUMENTS`, when given, is passed through to steps 2–3 unchanged.

2. **Diff.** `node tools/sdlc-lint/scripts/skill-sets.mjs diff $ARGUMENTS`.
   If it prints `in sync`, stop: there is nothing to do.

3. **Refresh.** `node tools/sdlc-lint/scripts/skill-sets.mjs refresh $ARGUMENTS`.
   It rewrites only the lines it owns (`source.catalog_version`, `synced_at`, each
   `upstream_path` / `upstream_updated`) and appends new skills as TRIAGE. `git diff` the YAML and
   show the user the result.

4. **Triage — one decision per skill, each approved.** For every entry the diff listed:
   - **`+` added (TRIAGE):** read its `SKILL.md` in the catalog. Propose a category (the TRIAGE
     note names the candidates) and roles **within that category's `roles` guard**, each with a
     policy (`recommended` unless the trigger fires on essentially every dispatch of the role) and a
     dispatch-scoped `when` (never "the first …" without "this dispatch"). Add `applies_if` when the
     skill only matters for a library (`{ dependency: <maven coord> }`) or a file shape. Or propose
     `unassigned: "<real reason>"`. Ask with `AskUserQuestion`; apply only what the user approves.
   - **`-` removed upstream:** propose deleting the row, or keeping it `unassigned` with a reason.
     Ask. Never delete without a yes — it changes what roles are told.
   - **`~` re-dated:** read the upstream change. If its scope moved (it now covers something a
     role's `when` does not), propose the `when` edit; otherwise nothing.
   - **`→` moved:** already handled by refresh; confirm the category still fits.
   - A category that must widen (a role outside its guard needs the skill) is a deliberate edit to
     `categories.<id>.roles` — call it out separately; it widens scope for every skill in it.

5. **Render and verify.**
   - `node tools/sdlc-lint/scripts/skill-sets.mjs render` (regenerates `android-skills.md` and the
     README block).
   - `node tools/sdlc-lint/cli.mjs all` — must be clean; a remaining TRIAGE fails here.
   - `npm test --prefix tools/sdlc-lint`, `node tools/sdlc-lint/cli.mjs emit`,
     `node tools/brain-sync/cli.mjs check --vault .brain`.

6. **Version and changelog.** Bump `android-foundation` by a patch in
   `plugins/android-foundation/.claude-plugin/plugin.json` (marketplace entries carry no
   per-plugin version; the marketplace version moves only with `/release`). Add a
   CHANGELOG `[Unreleased]` line naming the catalog version and each skill added, removed or
   re-scoped.

7. **Optionally update this machine.** Offer `android skills update --all` (or `android skills add
   <id> --agent=claude-code` for a new skill) so the maintainer's own install matches the matrix.
   Ask first; it changes the user's skills directory.

8. **Commit and PR.** Stage the specific paths (the YAML, `android-skills.md`, the README, the
   version files, CHANGELOG, `dist/`), commit, push, `gh pr create --base develop`. In the PR body
   list every triage decision with its reason. Then offer the user a review (repo rule).

## Never

- Assign, delete or re-scope a row without an explicit approval for that row.
- Hand-edit `android-skills.md` or the README block — they are generated.
- Run `android update` or `android skills update` without asking.
