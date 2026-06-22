#!/usr/bin/env bash
# PostToolUse(Edit|Write) wrapper → runs validate-kotlin.sh on the edited .kt file.
set -uo pipefail
payload=$(cat)
path=""
command -v jq >/dev/null 2>&1 && path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.path // empty')
[ -n "$path" ] && bash "${CLAUDE_PLUGIN_ROOT}/hooks/validate-kotlin.sh" "$path"
exit 0
