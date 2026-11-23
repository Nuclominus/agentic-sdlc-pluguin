#!/usr/bin/env bash
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_ROOT/plugins/sdlc/hooks/researcher-readonly-guard.sh"
fails=0

check() {  # $1 = agent_type ("" = none), $2 = command, $3 = expected exit
  local payload
  if [ -n "$1" ]; then
    payload=$(jq -n --arg a "$1" --arg c "$2" '{agent_type:$a,tool_input:{command:$c}}')
  else
    payload=$(jq -n --arg c "$2" '{tool_input:{command:$c}}')
  fi
  printf '%s' "$payload" | bash "$HOOK" >/dev/null 2>&1
  local code=$?
  if [ "$code" = "$3" ]; then echo "PASS: [$1] $2 -> $code"; else echo "FAIL: [$1] $2 expected $3 got $code"; fails=$((fails+1)); fi
}

check "" 'rm -rf build' 0
check "sdlc:project-researcher" 'git log --oneline -5' 0
check "project-researcher" 'gh pr view 12' 0
check "project-researcher" 'node "${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs" expertise --role project-researcher' 0
check "project-researcher" 'node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs expertise --role project-researcher' 0
check "project-researcher" 'git log; rm -rf build' 2
check "project-researcher" 'git log && touch x' 2
check "project-researcher" 'git log | tee x' 2
check "project-researcher" 'git show $(rm x)' 2
check "project-researcher" 'git diff --output=/tmp/x' 2
check "project-researcher" 'git grep -O foo' 2
check "project-researcher" 'git show --ext-diff HEAD' 2
check "project-researcher" 'git checkout main' 2
check "project-researcher" 'gh pr merge 12' 2
check "debugger" 'git checkout main' 0

stderr=$(printf '%s' '{"agent_type":"project-researcher","tool_input":{"command":"ls"}}' | bash "$HOOK" 2>&1 >/dev/null)
case "$stderr" in
  "project-researcher is read-only: allowed are git log|show|blame|diff|status|rev-parse|ls-files|grep, gh pr|issue view|list|diff, and the expertise bootstrap") echo "PASS: block message" ;;
  *) echo "FAIL: block message: $stderr"; fails=$((fails+1)) ;;
esac

[ "$fails" -eq 0 ] && echo "ALL PASS" || { echo "$fails FAILED"; exit 1; }
