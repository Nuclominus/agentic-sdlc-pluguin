#!/usr/bin/env bash
# Issue #238 / ADR-0039 — plugins/android-foundation/scripts/gradle-variant-check.sh must run the
# real variant tasks in a flavored project, keep a non-flavored project unchanged, and FAIL rather
# than pass when nothing would be checked. A fake ./gradlew stands in for Gradle: it answers
# `tasks --all` from listing.txt, logs every other invocation to gradlew.log, and exits with the
# code in exit_code (default 0). Every case runs under each available POSIX shell (sh, dash).
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO_ROOT/plugins/android-foundation/scripts/gradle-variant-check.sh"
fails=0

pass() { echo "PASS [$SH]: $1"; }
fail() { echo "FAIL [$SH]: $1"; fails=$((fails+1)); }

# make_project <listing lines...> — a fresh project root with a fake gradlew.
make_project() {
  local d; d=$(mktemp -d)
  printf '%s\n' "$@" > "$d/listing.txt"
  cat > "$d/gradlew" <<'EOF'
#!/usr/bin/env bash
here="$(cd "$(dirname "$0")" && pwd)"
case " $* " in
  *" tasks "*) echo "listed" >> "$here/listings.log"; cat "$here/listing.txt"; exit 0 ;;
esac
echo "$*" >> "$here/gradlew.log"
exit "$(cat "$here/exit_code" 2>/dev/null || echo 0)"
EOF
  chmod +x "$d/gradlew"
  echo 'include(":app")' > "$d/settings.gradle.kts"
  printf '%s' "$d"
}

# run_check <dir> <mode> — prints combined output, then EXIT:<code>.
run_check() { (cd "$1" && "$SH" "$SCRIPT" "$2" 2>&1); echo "EXIT:$?"; }
exit_of() { printf '%s' "$1" | grep -o 'EXIT:[0-9]*' | cut -d: -f2; }
gradle_args() { cat "$1/gradlew.log" 2>/dev/null; }

FLAVORED=(
  "app:compileDevDebugKotlin - Compiles the devDebug kotlin."
  "app:compileProductionDebugKotlin - Compiles the productionDebug kotlin."
  "app:compileDevDebugUnitTestKotlin"
  "app:compileDevReleaseKotlin"
  "app:testDevDebugUnitTest - Run unit tests for the devDebug build."
  "app:testProductionDebugUnitTest - Run unit tests for the productionDebug build."
  "app:testDevReleaseUnitTest"
  "core:data:compileDebugKotlin"
  "core:data:testDebugUnitTest"
  "core:data:compileReleaseKotlin"
)
PLAIN=(
  "app:compileDebugKotlin"
  "app:compileDebugAndroidTestKotlin"
  "app:testDebugUnitTest"
  "core:compileDebugKotlin"
  "core:testDebugUnitTest"
)

shells=(sh)
command -v dash >/dev/null 2>&1 && shells+=(dash)

for SH in "${shells[@]}"; do
  # --- non-flavored project: same coverage as the old bare `compileDebugKotlin`, now qualified
  d=$(make_project "${PLAIN[@]}")
  out=$(run_check "$d" compile)
  [ "$(exit_of "$out")" = "0" ] && [ "$(gradle_args "$d")" = "--console=plain --continue :app:compileDebugKotlin :core:compileDebugKotlin" ] \
    && pass "non-flavored compile → every module's compileDebugKotlin" \
    || fail "non-flavored compile ran: $(gradle_args "$d") / $out"
  rm -rf "$d"

  d=$(make_project "${PLAIN[@]}")
  out=$(run_check "$d" test)
  [ "$(gradle_args "$d")" = "--console=plain --continue :app:testDebugUnitTest :core:testDebugUnitTest" ] \
    && pass "non-flavored test → every module's testDebugUnitTest" \
    || fail "non-flavored test ran: $(gradle_args "$d")"
  rm -rf "$d"

  # --- flavored :app (the #238 project shape): the app's variant task MUST be named
  d=$(make_project "${FLAVORED[@]}")
  out=$(run_check "$d" compile)
  [ "$(exit_of "$out")" = "0" ] && [ "$(gradle_args "$d")" = "--console=plain --continue :app:compileDevDebugKotlin :core:data:compileDebugKotlin" ] \
    && pass "flavored compile → :app:compileDevDebugKotlin (first flavor) + unflavored library" \
    || fail "flavored compile ran: $(gradle_args "$d") / $out"
  rm -rf "$d"

  d=$(make_project "${FLAVORED[@]}")
  out=$(run_check "$d" test)
  [ "$(gradle_args "$d")" = "--console=plain --continue :app:testDevDebugUnitTest :core:data:testDebugUnitTest" ] \
    && pass "flavored test → :app:testDevDebugUnitTest" \
    || fail "flavored test ran: $(gradle_args "$d")"
  rm -rf "$d"

  # --- default_variant picks the flavor, in either spelling, comments and quotes tolerated
  for spelling in 'productionDebug' '"production"  # the store flavor'; do
    d=$(make_project "${FLAVORED[@]}")
    mkdir -p "$d/.sdlc"; printf 'heal_checks: []\ndefault_variant: %s\n' "$spelling" > "$d/.sdlc/sdlc.local.yaml"
    out=$(run_check "$d" compile)
    [ "$(gradle_args "$d")" = "--console=plain --continue :app:compileProductionDebugKotlin :core:data:compileDebugKotlin" ] \
      && pass "default_variant: $spelling → :app:compileProductionDebugKotlin" \
      || fail "default_variant: $spelling ran: $(gradle_args "$d")"
    rm -rf "$d"
  done

  # --- an unknown default_variant falls back visibly, never silently
  d=$(make_project "${FLAVORED[@]}")
  mkdir -p "$d/.sdlc"; echo 'default_variant: staging' > "$d/.sdlc/sdlc.local.yaml"
  out=$(run_check "$d" compile)
  printf '%s' "$out" | grep -q "WARN: default_variant Staging has no task in :app:" \
    && [ "$(gradle_args "$d")" = "--console=plain --continue :app:compileDevDebugKotlin :core:data:compileDebugKotlin" ] \
    && pass "unknown default_variant → WARN + first flavor" \
    || fail "unknown default_variant: $(gradle_args "$d") / $out"
  rm -rf "$d"

  # --- a single-project build (root project is the Android module) → root-qualified task
  d=$(make_project "compileDebugKotlin - Compiles the debug kotlin." "testDebugUnitTest")
  out=$(run_check "$d" compile)
  [ "$(gradle_args "$d")" = "--console=plain --continue :compileDebugKotlin" ] \
    && pass "root-project module → :compileDebugKotlin" \
    || fail "root-project compile ran: $(gradle_args "$d")"
  rm -rf "$d"

  # --- nothing to check is a FAILURE, and Gradle is never asked to build anything
  d=$(make_project "app:compileReleaseKotlin" "lib:compileKotlin" "help")
  out=$(run_check "$d" compile)
  [ "$(exit_of "$out")" = "1" ] && [ -z "$(gradle_args "$d")" ] && printf '%s' "$out" | grep -q "^FAIL:" \
    && pass "no variant task anywhere → exit 1, no build" \
    || fail "no-target case: exit $(exit_of "$out"), ran: $(gradle_args "$d")"
  rm -rf "$d"

  # --- a failing variant task fails the check
  d=$(make_project "${FLAVORED[@]}")
  echo 1 > "$d/exit_code"
  out=$(run_check "$d" compile)
  [ "$(exit_of "$out")" = "1" ] && pass "failing compile task → non-zero exit" || fail "failing compile exited $(exit_of "$out")"
  rm -rf "$d"

  # --- a broken build (the listing itself fails) fails the check
  d=$(make_project "${PLAIN[@]}")
  sed -i.bak 's/exit 0 ;;/exit 3 ;;/' "$d/gradlew"
  out=$(run_check "$d" compile)
  [ "$(exit_of "$out")" = "3" ] && [ -z "$(gradle_args "$d")" ] \
    && pass "listing failure → its exit code, no build" || fail "listing failure exited $(exit_of "$out")"
  rm -rf "$d"

  # --- lint: no `|| true` — a configured linter can fail; an absent one is a VISIBLE skip
  d=$(make_project "${PLAIN[@]}")
  out=$(run_check "$d" lint)
  [ "$(exit_of "$out")" = "0" ] && [ -z "$(gradle_args "$d")" ] && printf '%s' "$out" | grep -q "^WARN: .*lint SKIPPED" \
    && pass "no detekt/ktlintCheck → WARN skip, exit 0" || fail "lint-absent case: $out"
  rm -rf "$d"

  d=$(make_project "${PLAIN[@]}" "app:detekt" "core:detekt" "app:ktlintCheck")
  echo 1 > "$d/exit_code"
  out=$(run_check "$d" lint)
  [ "$(exit_of "$out")" = "1" ] && [ "$(gradle_args "$d")" = "--console=plain --continue detekt ktlintCheck" ] \
    && pass "configured lint that fails → non-zero exit" || fail "lint-fail case: exit $(exit_of "$out"), ran: $(gradle_args "$d")"
  rm -rf "$d"

  # --- the task listing is cached, and invalidated by a build-file change
  d=$(make_project "${PLAIN[@]}")
  run_check "$d" compile >/dev/null; run_check "$d" test >/dev/null
  n1=$(wc -l < "$d/listings.log" | tr -d ' ')
  echo 'android { flavorDimensions += "env" }' > "$d/build.gradle.kts"
  run_check "$d" compile >/dev/null
  n2=$(wc -l < "$d/listings.log" | tr -d ' ')
  [ "$n1" = "1" ] && [ "$n2" = "2" ] && pass "listing cached, re-listed after a build-file change" \
    || fail "cache: listings after 2 runs=$n1, after edit=$n2"
  rm -rf "$d"

  # --- no gradlew → 127, the orchestrator's tool-unavailable SKIP
  d=$(mktemp -d)
  out=$(run_check "$d" compile)
  [ "$(exit_of "$out")" = "127" ] && pass "no gradlew → exit 127" || fail "no-gradlew exited $(exit_of "$out")"
  out=$(run_check "$d" bogus)
  [ "$(exit_of "$out")" = "64" ] && pass "bad mode → exit 64" || fail "bad mode exited $(exit_of "$out")"
  rm -rf "$d"
done

[ "$fails" -eq 0 ] && echo "ALL PASS" || { echo "$fails FAILURE(S)"; exit 1; }
