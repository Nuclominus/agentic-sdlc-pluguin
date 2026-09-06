#!/usr/bin/env bash
# Checks one production .kt file against rules/logging.md (ADR-0020).
# Exit 2 → violations printed to stderr. Exit 0 → clean.
#
# Reports only. The correct fix for most findings is a refactor (move the trace
# into a Development* decorator), which no script can apply safely — so this
# never edits a file.
set -uo pipefail

file="${1:-}"
[ -n "$file" ] || exit 0
[ -f "$file" ] || exit 0
case "$file" in *.kt) ;; *) exit 0 ;; esac

# Test sources are exempt — see rules/logging.md "Test sources are exempt".
case "$file" in
  *Test.kt|*Spec.kt|*/src/test/*|*/src/androidTest/*|*/src/commonTest/*) exit 0 ;;
esac

findings=()

# scan <regex> <message> <fix>
scan() {
  local re="$1" msg="$2" fix="$3" no text
  while IFS=: read -r no text; do
    [ -n "$no" ] || continue
    # skip comment lines
    case "$text" in
      *[!\ ]*) ;;
      *) continue ;;
    esac
    printf '%s' "$text" | grep -qE '^[[:space:]]*(//|\*|/\*)' && continue
    findings+=("$no|$msg|$fix")
  done < <(grep -nE "$re" "$file" 2>/dev/null)
}

# ── Tier 1 — forbidden constructs (net for files that never passed Edit|Write) ──
scan '\bprintln[[:space:]]*\(' \
  "'println(' in a production source" \
  "route it through the project's logging facade"

scan '(^|[^A-Za-z0-9_.])Log\.[deiwv][[:space:]]*\(' \
  "'android.util.Log.*' in a production source" \
  "route it through the project's logging facade"

scan '\.printStackTrace[[:space:]]*\(' \
  "'.printStackTrace()' in a production source" \
  "logger.e(throwable) { \"…\" } — and handle or propagate, never log-and-swallow"

# ── Tier 2 — ADR-0020 ──────────────────────────────────────────────────────────
scan '\b(log|logger|Logger)[[:space:]]*\.[[:space:]]*[divwe][[:space:]]*\([[:space:]]*"' \
  'eager message construction — the string is built even when the line is dropped' \
  'pass a lambda: logger.d { "…" }'

# if (BuildConfig.DEBUG) / if (isDebugBuild) wrapping a log call, this line or the next
while IFS=: read -r no _; do
  [ -n "$no" ] || continue
  if sed -n "${no},$((no + 1))p" "$file" 2>/dev/null |
       grep -qE '\b(log|logger|Logger)[[:space:]]*\.[[:space:]]*[divwe]\b'; then
    findings+=("$no|hand-rolled debug guard around a log call|drop the guard — the facade already gates by severity in release (§2)")
  fi
done < <(grep -nE 'if[[:space:]]*\([[:space:]]*(BuildConfig\.DEBUG|isDebugBuild)[[:space:]]*\)' "$file" 2>/dev/null)

# Development* decorator outside a development source set
case "$file" in
  */src/debug/*|*/src/dev/*|*/src/development/*|*/src/debugMain/*) ;;
  *)
    case "$(basename "$file")" in
      Development*.kt)
        findings+=("1|Development* decorator outside a development source set|move it to src/debug/ — it must not compile into the release artifact (§1)")
        ;;
    esac
    scan '^[[:space:]]*(internal[[:space:]]+|private[[:space:]]+|public[[:space:]]+)?class[[:space:]]+Development[A-Z]' \
      'Development* decorator declared in a shipping source set' \
      'move it to src/debug/ — it must not compile into the release artifact (§1)'
    ;;
esac

[ ${#findings[@]} -eq 0 ] && exit 0

printf '  %s\n' "$file" >&2
while IFS= read -r f; do
  no=${f%%|*}; rest=${f#*|}; msg=${rest%%|*}; fix=${rest#*|}
  printf '    %s:%s  ✗ %s\n' "$file" "$no" "$msg" >&2
  printf '        → %s\n' "$fix" >&2
done < <(printf '%s\n' "${findings[@]}" | sort -t'|' -k1,1n)
exit 2
