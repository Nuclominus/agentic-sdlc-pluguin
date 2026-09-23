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

# --- State-file-writing fixtures ------------------------------------------------------------
# Each fixture is a fresh project root with an "active run": docs/plans/testrun/.checkpoint/
# (unsealed, freshly touched) + docs/plans/testrun/_brief.md, plus a fake ./gradlew standing in
# for the real one. This is the minimal setup the hook's inlined freshness-window detection
# requires to consider a run "active" and pick a write location.

make_active_run_fixture() {
  local root="$1"
  mkdir -p "$root/docs/plans/testrun/.checkpoint"
  : > "$root/docs/plans/testrun/_brief.md"
}

state_file() { printf '%s/docs/plans/testrun/.checkpoint/_post-implement-check.json' "$1"; }

have_jq=0
command -v jq >/dev/null 2>&1 && have_jq=1

if [ "$have_jq" -eq 1 ]; then
  # Case: gradlew succeeds → status "pass", state file written.
  d=$(mktemp -d)
  make_active_run_fixture "$d"
  cat > "$d/gradlew" <<'EOF'
#!/usr/bin/env bash
echo "BUILD SUCCESSFUL in 1s"
exit 0
EOF
  chmod +x "$d/gradlew"
  run_hook "sdlc:developer" "$d" >/dev/null
  sf=$(state_file "$d")
  if [ -f "$sf" ] && [ "$(jq -r .status "$sf" 2>/dev/null)" = "pass" ]; then
    echo "PASS: gradlew succeeds → state file status=pass"
  else
    echo "FAIL: expected state file with status=pass at $sf"; fails=$((fails+1))
  fi
  rm -rf "$d"

  # Case: gradlew fails with real lint issues → status "fail", state file written.
  d=$(mktemp -d)
  make_active_run_fixture "$d"
  cat > "$d/gradlew" <<'EOF'
#!/usr/bin/env bash
cat <<'OUT'
> Task :ktlintCheck FAILED
src/main/kotlin/Foo.kt:12:5: Missing newline at end of file
src/main/kotlin/Bar.kt:5:1: Unused import
OUT
exit 1
EOF
  chmod +x "$d/gradlew"
  run_hook "sdlc:developer" "$d" >/dev/null
  sf=$(state_file "$d")
  if [ -f "$sf" ] && [ "$(jq -r .status "$sf" 2>/dev/null)" = "fail" ] && [ "$(jq -r .issue_count "$sf" 2>/dev/null)" = "2" ]; then
    echo "PASS: gradlew reports real lint issues → state file status=fail, issue_count=2"
  else
    echo "FAIL: expected state file with status=fail, issue_count=2 at $sf"; fails=$((fails+1))
  fi
  rm -rf "$d"

  # Case: ktlint/detekt tasks don't exist in this project (plugin not configured) → status
  # "skipped", NOT "fail". Reproduces the reviewer-found false-FAIL: Gradle validates the whole
  # requested task graph before running anything, so an unresolvable task name aborts
  # immediately with this message, with a non-zero exit, and never reports a real lint issue.
  d=$(mktemp -d)
  make_active_run_fixture "$d"
  cat > "$d/gradlew" <<'EOF'
#!/usr/bin/env bash
echo "FAILURE: Build failed with an exception."
echo ""
echo "* What went wrong:"
echo "Task 'ktlintCheck' not found in root project 'app'."
exit 1
EOF
  chmod +x "$d/gradlew"
  run_hook "sdlc:developer" "$d" >/dev/null
  sf=$(state_file "$d")
  if [ -f "$sf" ] && [ "$(jq -r .status "$sf" 2>/dev/null)" = "skipped" ]; then
    echo "PASS: ktlint/detekt tasks not found → state file status=skipped (not fail)"
  else
    echo "FAIL: expected state file with status=skipped at $sf"; fails=$((fails+1))
  fi
  rm -rf "$d"
else
  echo "SKIP: jq not available — skipping state-file fixture tests"
fi

[ "$fails" -eq 0 ] && { echo "ALL PASS"; exit 0; } || { echo "$fails FAILURE(S)"; exit 1; }
