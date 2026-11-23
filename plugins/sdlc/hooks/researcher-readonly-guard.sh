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

tail_args=' expertise --role project-researcher'
# shellcheck disable=SC2016
for root in '${CLAUDE_PLUGIN_ROOT}' "${CLAUDE_PLUGIN_ROOT:-}"; do
  [ -n "$root" ] || continue
  [ "$cmd" = "node \"$root/tools/resolve/cli.mjs\"$tail_args" ] && exit 0
  [ "$cmd" = "node $root/tools/resolve/cli.mjs$tail_args" ] && exit 0
done

# Allowlist, not denylist: any shell metacharacter, newline or tab fails closed.
case "$cmd" in
  ''|*[!A-Za-z0-9\ _./:=@,+%^~#\"\'-]*) deny ;;
esac

# Git accepts unique long-option prefixes, so deny whole prefixes of the write-capable options.
set -f
is_gh=0
case "$cmd" in "gh "*) is_gh=1 ;; esac
for tok in $cmd; do
  tok=${tok//\"/}
  tok=${tok//\'/}
  case "$tok" in
    --oneline) ;;
    --no-index) deny ;;
    --web|-w) [ "$is_gh" -eq 1 ] && deny ;;
    --o*|--ex*|--te*) deny ;;
    --*) ;;
    -*O*) deny ;;
  esac
done

printf '%s' "$cmd" | grep -qE '^git (log|show|blame|diff|status|rev-parse|ls-files|grep)( |$)' && exit 0
printf '%s' "$cmd" | grep -qE '^gh (pr|issue) (view|list|diff)( |$)' && exit 0
deny
