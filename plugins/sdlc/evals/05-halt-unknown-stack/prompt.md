---
max_turns: 12
timeout_seconds: 300
allowed_tools: [Skill, "Bash(node:*)", "Bash(jq:*)"]
model: sonnet
runs: 3
---
/sdlc:start "Add offline sync" --stack=flutter --dry-run
