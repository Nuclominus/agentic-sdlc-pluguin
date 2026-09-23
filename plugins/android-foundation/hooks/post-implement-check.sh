#!/usr/bin/env bash
# SubagentStop hook — after the developer/tester subagent finishes, run a lint/typecheck pass
# and surface the result. NEVER blocks (no exit 2): an unbounded retry loop from a hard block
# is a worse failure than a missed lint pass (same principle as hooks/seal-run.sh).
#
# Result delivery: for SubagentStop, plain stdout only reaches Claude Code's internal debug
# log — never the transcript, never the orchestrator (ADR-0034). So this hook ALSO writes its
# result to the active run's own checkpoint state,
# docs/plans/{slug}/.checkpoint/_post-implement-check.json, which is the mechanism the
# orchestrator's Step 3e actually reads. The stdout lines below are kept only for local
# debugging (they land in the debug log, harmless).
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

result_status="pass"
issues=0
if [ "$status" -eq 0 ]; then
  printf '[post-implement-check] ktlint/detekt: PASS\n'
  result_status="pass"
else
  # Distinguish "the tooling isn't configured" from "it ran and found real issues". Gradle
  # validates the whole requested task graph before executing anything, so an unresolvable
  # task name in `ktlintCheck detekt` aborts immediately with this message — it never gets far
  # enough to report an actual lint issue. Treat that as "skipped", not "fail" (finding: a
  # project without the ktlint/detekt Gradle plugins configured was getting a false FAIL).
  if printf '%s' "$out" | grep -qF "not found in root project"; then
    result_status="skipped"
    printf '[post-implement-check] ktlint/detekt: SKIPPED (task not found — plugin not configured)\n'
  else
    issues=$(printf '%s' "$out" | grep -cE '\.kt:[0-9]+' || true)
    issues="${issues:-0}"
    result_status="fail"
    printf '[post-implement-check] ktlint/detekt: FAIL (%s issue(s) — see gradle output for detail)\n' "$issues"
  fi
fi

# --- Write the result to the active run's checkpoint state -----------------------------------
# This is the mechanism the orchestrator's Step 3e actually reads (see header comment + ADR-0034).
plans="${root}/docs/plans"
if [ -d "$plans" ]; then
  # Inline copy of config-protection.sh's freshness-windowed "most recently touched, unsealed
  # run" detection. Kept inline rather than extracted to a shared helper: no two hooks in this
  # repo source a common file today, and this fix stays minimal/low-risk this late in the
  # series. Mirrors the same 6h window ADR-0031's resumePreflight() uses.
  freshness_window_secs=$((6 * 3600))
  now=$(date +%s 2>/dev/null)
  if [ -n "$now" ]; then
    mtime_epoch() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }

    active_dir=""
    newest_touch=-1
    tie=0
    for d in "$plans"/*/; do
      cp_dir="${d}.checkpoint"
      [ -d "$cp_dir" ] || continue
      [ -f "${cp_dir}/_sealed" ] && continue

      touched=$(mtime_epoch "$cp_dir")
      while IFS= read -r f; do
        [ -n "$f" ] || continue
        m=$(mtime_epoch "$f")
        [ -n "$m" ] || continue
        if [ -z "$touched" ] || [ "$m" -gt "$touched" ]; then
          touched="$m"
        fi
      done < <(find "$cp_dir" -type f 2>/dev/null)

      [ -n "$touched" ] || continue                            # unevaluable — not a candidate
      age=$(( now - touched ))
      [ "$age" -ge 0 ] || continue                              # clock skew — unevaluable
      [ "$age" -le "$freshness_window_secs" ] || continue       # stale — not active
      [ -f "${d}_brief.md" ] || continue

      if [ "$touched" -gt "$newest_touch" ]; then
        newest_touch="$touched"
        active_dir="$cp_dir"
        tie=0
      elif [ "$touched" -eq "$newest_touch" ]; then
        tie=1
      fi
    done

    # Two candidate runs equally fresh: which is "the" active run is genuinely ambiguous —
    # fail open (no state file) rather than guess, same rule config-protection.sh applies.
    if [ "$tie" -eq 0 ] && [ -n "$active_dir" ] && [ -d "$active_dir" ]; then
      at=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
      tmp="${active_dir}/._post-implement-check.json.tmp.$$"
      if jq -n --arg status "$result_status" --argjson issue_count "${issues:-0}" \
           --arg tool "ktlint+detekt" --arg at "${at:-}" \
           '{status: $status, issue_count: $issue_count, tool: $tool, at: $at}' \
           > "$tmp" 2>/dev/null; then
        mv -f "$tmp" "${active_dir}/_post-implement-check.json" 2>/dev/null
      else
        rm -f "$tmp" 2>/dev/null
      fi
    fi
  fi
fi

exit 0
