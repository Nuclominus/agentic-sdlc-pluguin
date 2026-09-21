---
max_turns: 12
timeout_seconds: 300
allowed_tools: [Skill, Read, "Bash(node:*)", "Bash(jq:*)"]
model: sonnet
runs: 3
---
/sdlc:start "Додати темну тему в налаштуваннях" --stack=vanilla --dry-run
