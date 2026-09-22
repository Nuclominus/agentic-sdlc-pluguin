#!/usr/bin/env bash
# PreToolUse(Bash) hook — gates `git commit`, `git push` and `gh pr create` on the
# logging rule (rules/logging.md, ADR-0020).
#
# Why this exists: kotlin-guard.sh is PostToolUse(Edit|Write), so it only ever sees
# files Claude edited through those tools. Anything arriving another way — a hand
# edit, a sed in Bash, a merge, a rebase, a cherry-pick — reaches the commit
# unchecked. This is that net.
#
# Exit 2 → blocks the command, stderr surfaces to the agent. Exit 0 → proceed.
# Fails open: any condition it cannot evaluate is not a violation.
set -uo pipefail

payload=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

# Only gate the three publishing commands.
printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])(git([[:space:]]+-[^[:space:]]+)*[[:space:]]+(commit|push)|gh[[:space:]]+pr[[:space:]]+create)\b' || exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -n "$root" ] || exit 0
cd "$root" 2>/dev/null || exit 0

# ── Which files? ───────────────────────────────────────────────────────────────
files=""
if printf '%s' "$cmd" | grep -qE '[[:space:]]commit\b'; then
  files=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)
else
  # push / pr create — everything this branch adds over its base
  upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)
  if [ -n "$upstream" ]; then
    files=$(git diff --name-only --diff-filter=ACM "${upstream}...HEAD" 2>/dev/null)
  else
    base=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)
    [ -n "$base" ] && files=$(git diff --name-only --diff-filter=ACM "${base}...HEAD" 2>/dev/null)
  fi
fi
[ -n "$files" ] || exit 0

checker="${CLAUDE_PLUGIN_ROOT:-$(dirname "$0")/..}/hooks/validate-logging.sh"
[ -f "$checker" ] || exit 0

report=$(mktemp) || exit 0
trap 'rm -f "$report"' EXIT
bad=0

while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in *.kt) ;; *) continue ;; esac
  [ -f "$f" ] || continue
  if ! bash "$checker" "$f" 2>>"$report"; then
    bad=1
  fi
done <<< "$files"

# ── Cross-file: a variant DI provider missing its counterpart (§1 rule 3) ──────
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in */src/debug/*) ;; *) continue ;; esac
  case "$(basename "$f")" in *Module*.kt|*Di*.kt) ;; *) continue ;; esac
  counterpart=${f//\/src\/debug\//\/src\/release\/}
  if [ ! -f "$counterpart" ]; then
    {
      printf '  %s\n' "$f"
      printf '    %s  ✗ %s\n' "$f" "DI provider has no release-variant counterpart"
      printf '        → %s\n' "add $counterpart binding the implementation directly — a provider in only one source set breaks the other variant's graph, and a debug-only build cannot see it (§1 rule 3)"
    } >>"$report"
    bad=1
  fi
done <<< "$files"

[ "$bad" -eq 0 ] && exit 0

{
  echo "HOOK BLOCKED — logging rule violations in the code you are about to publish"
  echo
  cat "$report"
  echo
  echo "Rule: \${CLAUDE_PLUGIN_ROOT}/rules/logging.md (ADR-0020)."
  echo "Nothing was edited — these are reported, not auto-cleaned: the fix for a"
  echo "misplaced trace is to move it into a Development* decorator, which is a"
  echo "refactor, and deleting a legitimately-placed log is itself a violation."
  echo "Fix them, re-stage, then re-run the command."
} >&2
exit 2
