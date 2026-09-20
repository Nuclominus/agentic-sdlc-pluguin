---
adr: 25
status: accepted
date: 2026-09-20
supersedes: null
---

# ADR-0025 — A branch switch is a file operation, and the working tree is shared state

## Context

Two incidents three weeks apart cost working time to the same mechanism, and neither was a merge
conflict in the ordinary sense. A `git checkout` is not a change of label: it is a bulk write to
the working tree, and everything in that tree — including files git is not tracking on the branch
being left — is in its blast radius.

**Incident 1 — 2026-09-01, the eval suite vanished.** Work in progress on `evals/sdlc-dry-run`
needed fixes that had just landed on `develop`. Checking out `develop` to "get the updates"
deleted the eight case directories under `plugins/sdlc/evals/` from the working tree, because
`develop` does not carry them — they existed only in commit `fd83e5f` on the feature branch. The
next `claude plugin eval .` reported "No eval cases found" and scored nothing. The run was wasted;
the files were never at risk, because they were committed.

**Incident 2 — 2026-09-20, during #180/#181.** The fix was built in a throwaway worktree
(`.claude/worktrees/fix-180`) specifically to keep the feature branch out of the way. That worked
— the branch was never switched by the work. But the four edited files had been authored in the
*main* tree first and `cp`-ed across, and nobody reverted the originals. A concurrent
`checkout develop` from another terminal therefore met four dirty files instead of none. Git
merged them against a **stale local `develop`** (`2d1c18e`, predating the #178 prose tier that the
edits assumed), left `UU`/`DU` conflicts in the index, and carried off 37 of 57 eval files on the
way. Repair was manual: clear the unmerged paths, delete the file that the stale branch had never
heard of, switch back, verify 57/57 restored.

The common shape is worth naming, because the second incident is what the first one's lesson does
not cover:

- **Isolation is about files, not branches.** A worktree isolates the branch. It isolates the
  *files* only when the originals stop existing — a copy leaves two live versions of the same
  edit, and the one outside the worktree is the one with no branch protecting it.
- **A local branch ref is not its remote.** `develop` on disk is whatever it was last pulled to.
  Diffing against it, or landing on it, silently uses that stale tree.
- **The working tree is shared mutable state.** Another terminal, a hook, or another agent session
  can switch branches under work in progress. Treating the tree as privately owned is what turns
  someone else's routine checkout into this repository's conflict.

Nothing was lost in either incident, and that is not luck — it is that the work was committed and
pushed. That is the property to preserve, not the illusion that checkouts are safe.

## Decision

**To pick up new commits, merge into the branch you are on; never check out the other branch to
get them. And treat a working tree with uncommitted edits as unfit to be switched.**

- `git switch <feature-branch> && git merge develop` (fetch first). Never
  `git checkout develop` from a feature branch to refresh it.
- **After copying changes into a worktree, revert the originals immediately** —
  `git checkout -- <paths>` in the main tree. Editing directly in the worktree is better still;
  the copy step is what creates the second live version.
- **Fetch before trusting a local branch ref.** A diff or a merge against a stale local `develop`
  compares against a tree that no longer exists anywhere else.
- **Never switch branches while a background run reads the working tree.** An eval or pipeline run
  resolves `${CLAUDE_PLUGIN_ROOT}` live, so the swap changes the code underneath it mid-run — the
  run keeps going and its results are meaningless.
- Recovery, when a checkout has already removed files:
  `git restore --source=<feature-branch> -- <path>`. Verify by count against
  `git ls-tree -r --name-only <branch> -- <path>`, not by eye.

## Consequences

- The recovery path is only cheap while the work is committed and pushed. This decision therefore
  leans on the existing habit of committing before switching anything; an uncommitted tree turns a
  routine checkout into data loss rather than a repair.
- Untracked, ignored artifacts survive every checkout — in incident 2 the ten eval result runs
  under `plugins/sdlc/evals/results/` were the only thing never in danger. Ignored output is
  accidentally the safest thing in the tree, and genuinely valuable output should not depend on
  that accident.
- A worktree remains the right tool for building a change against `develop` without disturbing a
  feature branch; #181 was built that way and the branch survived. What it does not buy is
  permission to leave the main tree dirty.
- This is process, not code: nothing enforces it. The cost of the two incidents was a wasted eval
  run and a manual repair, which is the level at which a written rule is the proportionate
  response.

## Related
- Observed in: #177 (the eval suite whose cases vanished) and #181 (the worktree build whose
  originals were left behind). Neither PR implements this; both are where it was learned.
- Mirrors the agent memory `merge-develop-into-work-branch`, per
  [[decisions/ADR-0013-agent-memory-mirrors-into-the-vault]]. The vault note is the copy that
  counts; the memory carries the recall form.
- Relates to: [[decisions/ADR-0013-agent-memory-mirrors-into-the-vault]]
