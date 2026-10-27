#!/bin/sh
# gradle-variant-check.sh — the flavor-aware Gradle gate behind android-foundation's
# `heal_checks` and `post_pipeline_checks` (issue #238, ADR-0039).
#
#   sh gradle-variant-check.sh compile   # :<module>:compile<Flavor>DebugKotlin, every module
#   sh gradle-variant-check.sh test      # :<module>:test<Flavor>DebugUnitTest, every module
#   sh gradle-variant-check.sh lint      # detekt / ktlintCheck, whichever the build declares
#
# Runs from the project root (the orchestrator's cwd). The manifest names this file as
# "${CLAUDE_PLUGIN_ROOT}/scripts/gradle-variant-check.sh"; the resolver binds that token to THIS
# plugin's directory when it loads the manifest, because in the orchestrator's own Bash the
# variable belongs to the sdlc plugin.
#
# WHY NOT `./gradlew compileDebugKotlin`: a bare task name runs in every project that has it and
# fails only when NO project has it. An `:app` with product flavors has no `compileDebugKotlin`, so
# Gradle compiled the unflavored library modules, skipped `:app` without a word, and exited 0 —
# three real runs reported every gate green with zero `:app:` tasks executed. This script asks
# Gradle which variant tasks each module really has, then names them project-qualified
# (`:app:compileDevDebugKotlin`), which Gradle refuses to skip: a missing task is an error.
#
# Variant choice per module: the flavor named by `default_variant` in .sdlc/sdlc.local.yaml when
# the module has it, else the unflavored task, else the alphabetically first flavor. A module with
# no candidate task (pure JVM, no Kotlin) is not a target. NO target at all is a FAILURE, never a
# vacuous pass — that silence is the defect this script exists to remove.
#
# Exit codes: Gradle's own; 1 when no module has a target task; 64 on bad usage; 127 when
# ./gradlew is absent (the orchestrator's "tool unavailable on this host" SKIP).
#
# The task listing costs one Gradle configuration pass, so it is cached in
# .gradle/sdlc-variant-check/tasks.txt, keyed on a checksum of every build script, settings file,
# gradle.properties, version catalog and convention-plugin source. heal_checks runs after every
# guarded dispatch; the cache keeps that at one listing per build-file change, not one per check.
set -u

mode="${1:-}"
case "$mode" in
  compile|test|lint) ;;
  *) echo "usage: gradle-variant-check.sh compile|test|lint" >&2; exit 64 ;;
esac

if [ ! -x ./gradlew ]; then
  echo "gradle-variant-check: ./gradlew not found in $(pwd) — tool unavailable on this host" >&2
  exit 127
fi

# ---- default_variant (optional) -------------------------------------------------------------
# A top-level scalar in .sdlc/sdlc.local.yaml: `default_variant: devDebug` (or `dev`). Only the
# flavor part matters — every gate here is a Debug gate — so a trailing `Debug` is dropped and the
# first letter upper-cased to match Gradle's task-name spelling.
want=""
if [ -f .sdlc/sdlc.local.yaml ]; then
  want=$(sed -n 's/^default_variant:[[:space:]]*//p' .sdlc/sdlc.local.yaml | head -n 1 \
    | sed -e 's/[[:space:]]#.*$//' -e 's/^["'\'']//' -e 's/["'\'']*[[:space:]]*$//' -e 's/[Dd]ebug$//')
  if [ -n "$want" ]; then
    want=$(printf '%s' "$want" | awk '{ print toupper(substr($0, 1, 1)) substr($0, 2) }')
  fi
fi

# ---- task listing (cached) ------------------------------------------------------------------
fingerprint() {
  {
    find . \( -name .git -o -name build -o -name .gradle -o -name node_modules \) -prune -o -type f \
      \( -name 'settings.gradle' -o -name 'settings.gradle.kts' -o -name 'build.gradle' \
         -o -name 'build.gradle.kts' -o -name 'gradle.properties' -o -name '*.versions.toml' \) -print
    find . \( -name .git -o -name build -o -name .gradle -o -name node_modules \) -prune -o -type f \
      \( -path '*/buildSrc/*' -o -path '*/build-logic/*' \) \
      \( -name '*.kt' -o -name '*.kts' -o -name '*.gradle' \) -print
  } 2>/dev/null | LC_ALL=C sort -u | while IFS= read -r f; do
    printf '%s\n' "$f"
    cat "$f"
  done | cksum | awk '{ print $1 "-" $2 }'
}

cache_dir=.gradle/sdlc-variant-check
cache="$cache_dir/tasks.txt"
key=$(fingerprint)
tasks=""
if [ -f "$cache" ] && [ "$(head -n 1 "$cache")" = "# $key" ]; then
  tasks=$(tail -n +2 "$cache")
else
  listing=$(./gradlew -q --console=plain tasks --all 2>&1)
  status=$?
  if [ "$status" -ne 0 ]; then
    printf '%s\n' "$listing" >&2
    echo "gradle-variant-check: listing the build's tasks failed (exit $status)" >&2
    exit "$status"
  fi
  # First token of each report line; only the names this script can select are kept.
  tasks=$(printf '%s\n' "$listing" | awk '{ print $1 }' \
    | grep -E '(^|:)(compile[A-Za-z0-9]*DebugKotlin|test[A-Za-z0-9]*DebugUnitTest|detekt|ktlintCheck)$' \
    | LC_ALL=C sort -u)
  if mkdir -p "$cache_dir" 2>/dev/null; then
    { printf '# %s\n' "$key"; printf '%s\n' "$tasks"; } > "$cache" 2>/dev/null || true
  fi
fi

# ---- lint -----------------------------------------------------------------------------------
if [ "$mode" = "lint" ]; then
  # Bare names on purpose: the lint sweep is meant to run in every module that declares the task,
  # and listing them first means Gradle can no longer fail on a name NO module declares.
  lint=""
  for t in detekt ktlintCheck; do
    printf '%s\n' "$tasks" | grep -Eq "(^|:)$t\$" && lint="$lint $t"
  done
  if [ -z "$lint" ]; then
    echo "WARN: gradle-variant-check: lint SKIPPED — this build declares neither detekt nor ktlintCheck"
    exit 0
  fi
  echo "gradle-variant-check: lint →$lint"
  # shellcheck disable=SC2086
  exec ./gradlew --console=plain --continue $lint
fi

# ---- compile / test: one project-qualified variant task per module ----------------------------
if [ "$mode" = "compile" ]; then prefix="compile"; suffix="DebugKotlin"; else prefix="test"; suffix="DebugUnitTest"; fi

selected=$(printf '%s\n' "$tasks" | awk -v pre="$prefix" -v suf="$suffix" -v want="$want" '
  {
    n = split($0, parts, ":"); name = parts[n]
    if (name !~ ("^" pre "[A-Za-z0-9]*" suf "$")) next
    module = substr($0, 1, length($0) - length(name))   # "app:" / "core:data:" / "" (root)
    flavor = substr(name, length(pre) + 1, length(name) - length(pre) - length(suf))
    if (!(module in seen)) { seen[module] = 1; order[++count] = module }
    has[module, flavor] = 1
    if (flavor != "" && (!(module in first) || flavor < first[module])) first[module] = flavor
  }
  END {
    for (i = 1; i <= count; i++) {
      m = order[i]
      if (want != "" && ((m, want) in has)) f = want
      else if ((m, "") in has) f = ""
      else f = first[m]
      if (want != "" && f != want && f != "")
        printf "WARN: default_variant %s has no task in :%s — using flavor %s\n", want, m, f > "/dev/stderr"
      print ":" m pre f suf
    }
  }')

if [ -z "$selected" ]; then
  echo "FAIL: gradle-variant-check: no module declares a ${prefix}<Flavor>${suffix} task — nothing would be checked." >&2
  echo "      Name the tasks explicitly with heal_checks / post_pipeline_checks in .sdlc/sdlc.local.yaml." >&2
  exit 1
fi

selected=$(printf '%s\n' "$selected" | tr '\n' ' ')
echo "gradle-variant-check: $mode → $selected"
# shellcheck disable=SC2086
exec ./gradlew --console=plain --continue $selected
