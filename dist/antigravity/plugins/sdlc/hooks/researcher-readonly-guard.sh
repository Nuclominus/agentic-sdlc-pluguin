#!/usr/bin/env bash
# PreToolUse(Bash) hook — confines the project-researcher subagent to read-only git/gh and its expertise bootstrap.
# Exit 2 blocks (stderr reaches the agent); without jq it denies the researcher outright, and fails open on unreadable input.
set -uo pipefail

deny() {
  echo "project-researcher is read-only: allowed are git log|show|blame|diff|status|rev-parse|ls-files|grep, gh pr|issue view|list|diff, and the expertise bootstrap" >&2
  exit 2
}

payload=$(cat)
if ! command -v jq >/dev/null 2>&1; then
  researcher_re='"agent_type"[[:space:]]*:[[:space:]]*"([^"]*:)?project-researcher"'
  [[ $payload =~ $researcher_re ]] && deny
  exit 0
fi
agent=$(printf '%s' "$payload" | jq -r '.agent_type // empty' 2>/dev/null) || exit 0
[ "${agent##*:}" = "project-researcher" ] || exit 0
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0

tail_args=' expertise --role project-researcher'
# shellcheck disable=SC2016
for root in '${CLAUDE_PLUGIN_ROOT}' "${CLAUDE_PLUGIN_ROOT:-}"; do
  [ -n "$root" ] || continue
  [ "$cmd" = "node \"$root/tools/resolve/cli.mjs\"$tail_args" ] && exit 0
  [ "$cmd" = "node $root/tools/resolve/cli.mjs$tail_args" ] && exit 0
done

# Allowlist, not denylist: any shell metacharacter, newline or tab fails closed.
case "$cmd" in
  ''|*[!A-Za-z0-9\ _./:=@,+%^~\"\'-]*) deny ;;
esac

# Git accepts unique long-option prefixes, so deny whole prefixes of the write-capable options.
set -f
is_gh=0
case "$cmd" in "gh "*) is_gh=1 ;; esac
# zsh extendedglob turns ^, ~ and a leading = into patterns, so only revision suffixes may carry them.
rev_re='^[A-Za-z0-9_./@-]*[A-Za-z0-9_]([~^][0-9]*)+$'
for tok in $cmd; do
  tok=${tok//\"/}
  tok=${tok//\'/}
  case "$tok" in
    [=~^]*|*==*) deny ;;
    *[~^]*) [[ $tok =~ $rev_re ]] || deny ;;
  esac
  if [ "$is_gh" -eq 1 ]; then
    case "$tok" in
      --jq|--jq=*|--template|--template=*|--web|--web=*|-q*|-t*) deny ;;
      --*) ;;
      -*w*) deny ;;
    esac
  fi
  case "$tok" in
    --oneline) ;;
    --no-index) deny ;;
    --o*|--ex*|--te*) deny ;;
    --*) ;;
    -*O*) deny ;;
  esac
done

printf '%s' "$cmd" | grep -qE '^git (log|show|blame|diff|status|rev-parse|ls-files|grep)( |$)' && exit 0
printf '%s' "$cmd" | grep -qE '^gh (pr|issue) (view|list|diff)( |$)' && exit 0
deny
