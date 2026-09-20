---
max_turns: 12
timeout_seconds: 300
allowed_tools: [Skill, "Bash(node:*)", "Bash(jq:*)"]
model: sonnet
runs: 3
---
/sdlc:start "Fix crash when the actions list is empty" --workflow=hotfix --dry-run
