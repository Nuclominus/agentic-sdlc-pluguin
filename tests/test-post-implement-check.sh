#!/usr/bin/env bash
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_ROOT/plugins/android-foundation/hooks/post-implement-check.sh"
fails=0

run_hook() { printf '{"agent_type":"%s"}' "$1" | CLAUDE_PROJECT_DIR="$2" bash "$HOOK"; echo "EXIT:$?"; }

d=$(mktemp -d)  # no ./gradlew here — must fail open regardless of agent name
out=$(run_hook "sdlc:developer" "$d")
code=$(printf '%s' "$out" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
[ "$code" = "0" ] && echo "PASS: no gradlew → exit 0" || { echo "FAIL: expected 0 got $code"; fails=$((fails+1)); }

out=$(run_hook "sdlc:business-analyst" "$d")
code=$(printf '%s' "$out" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
[ "$code" = "0" ] && echo "PASS: non-developer agent → exit 0, no-op" || { echo "FAIL: expected 0 got $code"; fails=$((fails+1)); }

rm -rf "$d"

[ "$fails" -eq 0 ] && { echo "ALL PASS"; exit 0; } || { echo "$fails FAILURE(S)"; exit 1; }
