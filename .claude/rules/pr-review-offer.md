# Rule — offer a review after opening a PR

Applies to work **on this repository** (the SDLC Marketplace codebase), not to the shipped plugin
behavior (the pipeline's `document-writer` opening PRs in end-user projects is out of scope).

## 1. Every PR you open ends with the question

Right after `gh pr create` (or any other PR creation) succeeds, and **before** you report the task
as done, ask the user whether they want a review of that PR. Do it in the same turn — the PR URL
and the question belong in one message, not two.

Ask with `AskUserQuestion` when the session is interactive. Offer these options, in this order:

1. **Review now, in this session** — you run `/code-review <PR#>` if that skill is available;
   otherwise you review the PR diff yourself (read-only: findings with `file:line`, no edits).
2. **Ultra review** — `/code-review ultra <PR#>` is user-triggered and billed; you cannot launch
   it. Say so and give the exact command for the user to run.
3. **No review** — stop after the PR link.

In a non-interactive session (headless, `-p`, a subagent) do not block on the question: print the
offer and the two commands in the final message instead.

## 2. What the answer does and does not authorize

- A "yes" authorizes the **review**, not the fixes. Report findings; apply them only when the user
  asks, and then as a new commit on the same branch.
- Never merge, rebase or force-push the PR as part of the review.
- Do not re-ask for a PR the user has already answered about, including after a follow-up push to
  the same branch. A brand-new PR gets a fresh question.
