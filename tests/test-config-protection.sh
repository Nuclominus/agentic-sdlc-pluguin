#!/usr/bin/env bash
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_ROOT/plugins/android-foundation/hooks/config-protection.sh"
fails=0

# Portable "N hours ago" as a `touch -t` timestamp: GNU `date -d`, falling back to BSD/macOS
# `date -v` (same portability split the hook's own mtime_epoch() needs for `stat -c`/`stat -f`).
backdate_ts() {
  date -v-"$1"H +%Y%m%d%H%M 2>/dev/null || date -d "-$1 hours" +%Y%m%d%H%M
}

mk_project() {  # $1 = brief contents, $2 = sealed?("yes"/"no"), $3 = hours-ago to backdate the
                # checkpoint dir's mtime (optional; omit for "just created" = now)  → echoes project dir
  local d; d=$(mktemp -d)
  mkdir -p "$d/docs/plans/task1/.checkpoint"
  printf '%s' "$1" > "$d/docs/plans/task1/_brief.md"
  [ "$2" = "yes" ] && touch "$d/docs/plans/task1/.checkpoint/_sealed"
  [ -n "${3:-}" ] && touch -t "$(backdate_ts "$3")" "$d/docs/plans/task1/.checkpoint"
  printf '%s' "$d"
}

mk_two_runs() {  # $1=older brief $2=older hours-ago $3=newer brief  → echoes project dir
                 # task1 = older (backdated), task2 = newer (just created, "now")
  local d; d=$(mktemp -d)
  mkdir -p "$d/docs/plans/task1/.checkpoint"
  printf '%s' "$1" > "$d/docs/plans/task1/_brief.md"
  touch -t "$(backdate_ts "$2")" "$d/docs/plans/task1/.checkpoint"

  mkdir -p "$d/docs/plans/task2/.checkpoint"
  printf '%s' "$3" > "$d/docs/plans/task2/_brief.md"
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

# Stale/abandoned run: checkpoint dir backdated past the 6h freshness window, unsealed, brief
# does not mention the tool. A pure seal-state check would still call this "active" and block
# forever; freshness-windowed detection must treat it as inactive and allow.
p=$(mk_project "Fix the dark mode toggle" "no" "8")
out=$(run_hook "$p/detekt.yml" "$p")
code=$(printf '%s' "$out" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
[ "$code" = "0" ] && echo "PASS: allowed (stale unsealed run past freshness window is not active)" || { echo "FAIL: expected 0 got $code"; fails=$((fails+1)); }

# Two simultaneously-active (both within the freshness window) unsealed runs: the older one's
# brief does NOT mention the tool, the newer one's DOES. The hook must read the MOST RECENT
# run's brief (allow), not the older one's (which would block) — regressing to "first
# directory in glob order" would pick task1 here and block incorrectly.
p=$(mk_two_runs "Fix the dark mode toggle" "1" "Tune detekt rules for the new module")
out=$(run_hook "$p/detekt.yml" "$p")
code=$(printf '%s' "$out" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
[ "$code" = "0" ] && echo "PASS: allowed (multi-run, most-recent brief mentions the tool)" || { echo "FAIL: expected 0 got $code"; fails=$((fails+1)); }

# Reverse of the above: the OLDER run's brief mentions the tool, the NEWER one's does not.
# Proves the hook picks only the single most-recent brief rather than allowing if ANY active
# run's brief happens to match.
p=$(mk_two_runs "Tune detekt rules for the new module" "1" "Fix the dark mode toggle")
out=$(run_hook "$p/detekt.yml" "$p")
code=$(printf '%s' "$out" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
[ "$code" = "2" ] && echo "PASS: blocked (multi-run, most-recent brief does not mention the tool)" || { echo "FAIL: expected 2 got $code"; fails=$((fails+1)); }

[ "$fails" -eq 0 ] && { echo "ALL PASS"; exit 0; } || { echo "$fails FAILURE(S)"; exit 1; }
