#!/usr/bin/env bash
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_ROOT/plugins/android-foundation/hooks/config-protection.sh"
fails=0

mk_project() {  # $1 = brief contents, $2 = sealed?("yes"/"no")  → echoes project dir
  local d; d=$(mktemp -d)
  mkdir -p "$d/docs/plans/task1/.checkpoint"
  printf '%s' "$1" > "$d/docs/plans/task1/_brief.md"
  [ "$2" = "yes" ] && touch "$d/docs/plans/task1/.checkpoint/_sealed"
  printf '%s' "$d"
}

run_hook() { printf '{"tool_name":"Edit","tool_input":{"file_path":"%s"}}' "$1" | CLAUDE_PROJECT_DIR="$2" bash "$HOOK"; echo "EXIT:$?"; }

p=$(mk_project "Fix the dark mode toggle" "no")
out=$(run_hook "$p/detekt.yml" "$p")
code=$(printf '%s' "$out" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
[ "$code" = "2" ] && echo "PASS: blocked (active run, unrelated brief)" || { echo "FAIL: expected 2 got $code"; fails=$((fails+1)); }

p=$(mk_project "Tune detekt rules for the new module" "no")
out=$(run_hook "$p/detekt.yml" "$p")
code=$(printf '%s' "$out" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
[ "$code" = "0" ] && echo "PASS: allowed (brief mentions detekt)" || { echo "FAIL: expected 0 got $code"; fails=$((fails+1)); }

p=$(mk_project "Fix the dark mode toggle" "yes")
out=$(run_hook "$p/detekt.yml" "$p")
code=$(printf '%s' "$out" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
[ "$code" = "0" ] && echo "PASS: allowed (run already sealed, not active)" || { echo "FAIL: expected 0 got $code"; fails=$((fails+1)); }

p=$(mk_project "Fix the dark mode toggle" "no")
out=$(run_hook "$p/app/src/main/kotlin/Foo.kt" "$p")
code=$(printf '%s' "$out" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
[ "$code" = "0" ] && echo "PASS: allowed (not a protected config file)" || { echo "FAIL: expected 0 got $code"; fails=$((fails+1)); }

[ "$fails" -eq 0 ] && { echo "ALL PASS"; exit 0; } || { echo "$fails FAILURE(S)"; exit 1; }
