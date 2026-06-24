---
loaded_by: [docs-writer, any-agent-on-commit-request]
load_when: "Only when about to commit, create a branch, or open a PR."
---

# Git & PR Rules

## Using git
- For each new task, create a separate branch. The name of the branch should be like the name of the task. Example: "CRF-13-implement-api-for-interlocutor-search-and-call-requests"

## Commit Rules

- **NEVER create commits automatically** — only commit when explicitly requested by the user
- **NEVER push to remote** without explicit user request
- **NEVER force push** or run destructive git commands without explicit approval
- When changes are ready, inform the user and wait for their instruction
- Always show `git diff` or `git status` to let the user review before committing

## Pull Request Descriptions

- **NEVER mention AI tools** (Claude, Copilot, Gemini, Firebander, etc.) in PR title or body
- **NEVER include change statistics** (file count, lines added/removed)
- **NEVER add test plan checklists** — there is no android-qa team to execute them
- Keep PR descriptions empty
