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

table() {
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
  check "project-researcher" 'git log & rm x' 2
  check "project-researcher" 'git log &rm x' 2
  check "project-researcher" 'git grep --open=rm bar' 2
  check "project-researcher" 'git grep --open-files=touch bar' 2
  check "project-researcher" 'git grep -nOrm foo' 2
  check "project-researcher" 'git grep -iO foo' 2
  check "project-researcher" 'git log --format="%h %s"' 0
  check "project-researcher" 'git log "--output=/tmp/x"' 2
  check "project-researcher" 'git log --out=/tmp/x' 2
  check "project-researcher" 'git show --ext HEAD' 2
  check "project-researcher" 'git show --textconv HEAD' 2
  check "project-researcher" 'git log --grep=fix#12' 2
  check "project-researcher" "git ls-files '*.kt'" 2
  check "project-researcher" 'node /tmp/tools/resolve/cli.mjs expertise --role project-researcher' 2
  check "project-researcher" $'git log\nrm x' 2
  CLAUDE_PLUGIN_ROOT=/opt/p check "project-researcher" 'node "/opt/p/tools/resolve/cli.mjs" expertise --role project-researcher' 0
  check "debugger" 'git checkout main' 0
  check "project-researcher" 'git grep "-"?sh foo' 2
  check "project-researcher" 'git grep "-"[N-P]sh foo' 2
  check "project-researcher" 'git grep "--"* foo' 2
  check "project-researcher" 'git grep *""Osh foo' 2
  check "project-researcher" 'git diff --no-index /etc/hosts /dev/null' 2
  check "project-researcher" 'gh pr view 1 --web' 2
  check "project-researcher" 'gh pr view 1 -w' 2
  check "project-researcher" 'git diff -w HEAD' 0
  check "project-researcher" 'git log --oneline -5' 0
  check "project-researcher" 'git grep -n "foo bar"' 0
  check "project-researcher" 'gh pr view 12 --json title,body' 0
  check "project-researcher" 'gh pr list --json title --jq env' 2
  check "project-researcher" 'gh pr list --json title -q env' 2
  check "project-researcher" 'gh pr view 1 --template x' 2
  check "project-researcher" 'gh pr view 1 --web=true' 2
  check "project-researcher" 'gh pr view 1 -cw' 2
  check "project-researcher" 'gh pr list --json title,number' 0
  check "project-researcher" 'gh pr view 1 -cq env' 2
  check "project-researcher" 'gh pr view 1 -ct x' 2
  check "project-researcher" 'gh pr list -Lq env' 2
  check "project-researcher" 'gh pr list -L 5 --json title' 0
  check "project-researcher" 'gh pr list -R owner/repo --json number' 0
  check "project-researcher" 'git grep ^foo' 2
  check "project-researcher" 'git log a~b' 2
  check "project-researcher" 'git log =ls' 2
  check "project-researcher" 'git log ~' 2
  check "project-researcher" 'git grep -n "a#b"' 2
  check "project-researcher" 'git log HEAD~1' 0
  check "project-researcher" 'git show HEAD^' 0
  check "project-researcher" 'git log main~2^ -1' 0
  check "project-researcher" 'git log --author==ls' 2
}

plain=$(mktemp -d); trap_dir=$(mktemp -d)
: > "$trap_dir/-Osh"
for cwd in "$REPO_ROOT" "$plain" "$trap_dir"; do
  echo "== cwd: $cwd"
  cd "$cwd" || exit 1
  table
done
cd "$REPO_ROOT" || exit 1
rm -r "$plain" "$trap_dir"

stderr=$(printf '%s' '{"agent_type":"project-researcher","tool_input":{"command":"ls"}}' | bash "$HOOK" 2>&1 >/dev/null)
case "$stderr" in
  "project-researcher is read-only: allowed are git log|show|blame|diff|status|rev-parse|ls-files|grep, gh pr|issue view|list|diff, and the expertise bootstrap") echo "PASS: block message" ;;
  *) echo "FAIL: block message: $stderr"; fails=$((fails+1)) ;;
esac

nojq=$(mktemp -d)
ln -s "$(command -v cat)" "$nojq/cat"
check_nojq() {  # $1 = raw payload, $2 = expected exit
  printf '%s' "$1" | PATH="$nojq" "$BASH" "$HOOK" >/dev/null 2>&1
  local code=$?
  if [ "$code" = "$2" ]; then echo "PASS: [no jq] $1 -> $code"; else echo "FAIL: [no jq] $1 expected $2 got $code"; fails=$((fails+1)); fi
}
check_nojq '{"agent_type": "sdlc:project-researcher","tool_input":{"command":"git log"}}' 2
check_nojq '{"agent_type":"debugger","tool_input":{"command":"rm -rf build"}}' 0
rm "$nojq/cat"; rmdir "$nojq"

[ "$fails" -eq 0 ] && echo "ALL PASS" || { echo "$fails FAILED"; exit 1; }
