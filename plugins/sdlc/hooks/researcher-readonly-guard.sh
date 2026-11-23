#!/usr/bin/env bash
# PreToolUse(Bash) hook — confines the project-researcher subagent to read-only git/gh and its expertise bootstrap.
# Exit 2 blocks (stderr reaches the agent); fails open when jq is missing or input is unreadable.
set -uo pipefail

payload=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
agent=$(printf '%s' "$payload" | jq -r '.agent_type // empty' 2>/dev/null) || exit 0
[ "${agent##*:}" = "project-researcher" ] || exit 0
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0

deny() {
  echo "project-researcher is read-only: allowed are git log|show|blame|diff|status|rev-parse|ls-files|grep, gh pr|issue view|list|diff, and the expertise bootstrap" >&2
  exit 2
}

case "$cmd" in
  *';'*|*'&&'*|*'|'*|*'>'*|*'<'*|*'`'*|*"\$("*|*$'\n'*) deny ;;
esac
printf '%s' "$cmd" | grep -qE -- '--output|--ext-diff|--open-files-in-pager|(^|[[:space:]])-O' && deny

printf '%s' "$cmd" | grep -qE '^git (log|show|blame|diff|status|rev-parse|ls-files|grep)( |$)' && exit 0
printf '%s' "$cmd" | grep -qE '^gh (pr|issue) (view|list|diff)( |$)' && exit 0
printf '%s' "$cmd" | grep -qE '^node "?[^ "]*/tools/resolve/cli\.mjs"? expertise --role project-researcher$' && exit 0
deny
