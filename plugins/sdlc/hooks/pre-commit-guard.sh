#!/usr/bin/env bash
# PreToolUse(Bash) hook — blocks committing/pushing staged secrets and blocks `--no-verify`.
#
# Modeled on android-foundation/hooks/git-guard.sh's shape (same matcher, same fail-open
# philosophy, same exit-2-blocks contract). This one is stack-neutral: it ships in the core
# sdlc plugin because secret hygiene applies to every stack, not just Android.
#
# Scope: new leaks in the diff about to be committed/pushed, not repository history — a key
# committed before this hook existed is out of scope by design; this is a net, not a scanner.
#
# Exit 2 → blocks, stderr surfaces to the agent. Exit 0 → proceed. Fails open: any condition
# it cannot evaluate is not a violation.
set -uo pipefail

payload=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

# ── 1. --no-verify is always denied on commit/push, independent of file contents ──────────
# Strip quoted substrings before flag-scanning, so --no-verify mentioned inside a commit
# message string (or any other quoted argument) isn't mistaken for the flag itself.
scan_cmd=$(printf '%s' "$cmd" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")
if printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+(commit|push)\b' \
   && printf '%s' "$scan_cmd" | grep -qE '(^|[[:space:]])--no-verify\b'; then
  {
    echo "HOOK BLOCKED — --no-verify is not allowed."
    echo "Pre-commit/pre-push hooks exist to catch problems before they leave your machine;"
    echo "skipping them is a decision for a human to make explicitly outside an agent session."
    echo "Re-run without --no-verify, or ask the operator to run this command themselves."
  } >&2
  exit 2
fi

# Only continue past this point for commit/push/pr-create (the same three publishing
# commands git-guard.sh gates).
printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])(git([[:space:]]+-[^[:space:]]+)*[[:space:]]+(commit|push)|gh[[:space:]]+pr[[:space:]]+create)\b' || exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -n "$root" ] || exit 0
cd "$root" 2>/dev/null || exit 0

files=""
if printf '%s' "$cmd" | grep -qE '[[:space:]]commit\b'; then
  files=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null)
else
  upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)
  if [ -n "$upstream" ]; then
    files=$(git diff --name-only --diff-filter=ACM "${upstream}...HEAD" 2>/dev/null)
  else
    base=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)
    [ -n "$base" ] && files=$(git diff --name-only --diff-filter=ACM "${base}...HEAD" 2>/dev/null)
  fi
fi
[ -n "$files" ] || exit 0

# ── 2. Secret patterns — high-confidence only, to keep false positives near zero ──────────
report=$(mktemp) || exit 0
trap 'rm -f "$report"' EXIT
bad=0

check_file() {  # $1 = path
  [ -f "$1" ] || return 0
  local content
  content=$(cat "$1" 2>/dev/null) || return 0

  printf '%s' "$content" | grep -qE 'AKIA[0-9A-Z]{16}' && \
    { printf '  %s  ✗ AWS access key ID pattern\n' "$1" >>"$report"; bad=1; }

  printf '%s' "$content" | grep -qE -- '-----BEGIN ((RSA|EC|OPENSSH|DSA) )?PRIVATE KEY-----' && \
    { printf '  %s  ✗ private key block\n' "$1" >>"$report"; bad=1; }

  printf '%s' "$content" | grep -qEi '(api[_-]?key|secret|token|password)["'"'"']?\s*[:=]\s*["'"'"'][A-Za-z0-9+/_=-]{20,}["'"'"']' && \
    { printf '  %s  ✗ assigned key/secret/token/password literal (20+ chars)\n' "$1" >>"$report"; bad=1; }
}

while IFS= read -r f; do
  [ -n "$f" ] || continue
  check_file "$f"
done <<< "$files"

[ "$bad" -eq 0 ] && exit 0

{
  echo "HOOK BLOCKED — likely secret(s) in the change about to be committed/pushed"
  echo
  cat "$report"
  echo
  echo "This only scans the diff being committed/pushed, not repository history."
  echo "If this is a false positive (a test fixture, a rotated/dummy key), remove the pattern"
  echo "match or move the value to an untracked file; do not silence this with --no-verify."
} >&2
exit 2
