#!/usr/bin/env bash
# PreToolUse(Edit|Write) hook: block edits to generated/dependency dirs.
set -uo pipefail
payload=$(cat)
path=""
if command -v jq >/dev/null 2>&1; then
  path=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.path // empty')
fi
case "$path" in
  */Pods/*|*/build/*|*/DerivedData/*)
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Refusing to edit generated/dependency artifact: %s"}}\n' "$path"
    exit 0 ;;
esac
printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'
exit 0
