#!/usr/bin/env bash
# SubagentStop hook — after the developer/tester subagent finishes, run a lint/typecheck pass
# and surface the result. NEVER blocks (no exit 2): an unbounded retry loop from a hard block
# is a worse failure than a missed lint pass (same principle as hooks/seal-run.sh).
set -uo pipefail

payload=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
agent=$(printf '%s' "$payload" | jq -r '.agent_type // empty' 2>/dev/null) || exit 0
bare="${agent##*:}"
case "$bare" in
  developer|tester) ;;
  *) exit 0 ;;
esac

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" 2>/dev/null || exit 0
[ -x ./gradlew ] || exit 0

out=$(./gradlew ktlintCheck detekt 2>&1)
status=$?
if [ "$status" -eq 0 ]; then
  printf '[post-implement-check] ktlint/detekt: PASS\n'
else
  issues=$(printf '%s' "$out" | grep -cE '\.kt:[0-9]+' || true)
  printf '[post-implement-check] ktlint/detekt: FAIL (%s issue(s) — see gradle output for detail)\n' "${issues:-?}"
fi
exit 0
