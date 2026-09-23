#!/usr/bin/env bash
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_ROOT/plugins/sdlc/hooks/pre-commit-guard.sh"
fails=0

run_hook() {  # JSON-escapes $1 so a command containing a quoted commit message stays valid JSON.
  local escaped
  escaped=$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$escaped" | bash "$HOOK"
  echo "EXIT:$?"
}

check_blocked() {  # $1 label, $2 command
  out=$(run_hook "$2")
  code=$(printf '%s' "$out" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
  [ "$code" = "2" ] && echo "PASS: $1 (blocked)" || { echo "FAIL: $1 — expected exit 2, got $code"; fails=$((fails+1)); }
}
check_allowed() {  # $1 label, $2 command
  out=$(run_hook "$2")
  code=$(printf '%s' "$out" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
  [ "$code" = "0" ] && echo "PASS: $1 (allowed)" || { echo "FAIL: $1 — expected exit 0, got $code"; fails=$((fails+1)); }
}

check_blocked "no-verify on commit" 'git commit --no-verify -m x'
check_blocked "no-verify on push"   'git push --no-verify'
check_allowed "unrelated bash command" 'ls -la'
check_allowed "commit with no staged files" 'git commit -m x'
check_allowed "no-verify text inside a quoted commit message" 'git commit -m "please dont use --no-verify here"'
check_blocked "-n as its own flag on commit"     'git commit -n -m x'
check_blocked "-n bundled with -m on commit"     'git commit -nm x'
check_allowed "-n substring inside a quoted commit message" 'git commit -m "see section -n for details"'
check_allowed "-n on push is --dry-run, not --no-verify" 'git push -n'

[ "$fails" -eq 0 ] && { echo "ALL PASS"; exit 0; } || { echo "$fails FAILURE(S)"; exit 1; }
