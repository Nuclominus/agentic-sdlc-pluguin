#!/usr/bin/env bash
# PreToolUse(Edit|Write) hook — protects lint/format config files from being loosened
# mid-run. Scoped to an ACTIVE SDLC run only: a manual edit outside a pipeline run is never
# blocked, so this cannot become a project-wide annoyance (Review Focus, plan phase 3).
#
# Fails open: no active run, no readable _brief.md, an ambiguous "which run is active" call,
# or an unreadable target path all fall through to exit 0. Exit 2 blocks with a stderr
# message; never edits anything itself.
set -uo pipefail

payload=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
target=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null) || exit 0
[ -n "$target" ] || exit 0

base=$(basename "$target")
case "$base" in
  .editorconfig|detekt.yml|.detekt.yml|checkstyle.xml) ;;
  *) exit 0 ;;
esac

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
plans="${root}/docs/plans"
[ -d "$plans" ] || exit 0

# Portable mtime-in-epoch-seconds: GNU `stat -c`, falling back to BSD/macOS `stat -f` (the
# same GNU/BSD portability hazard `seal-run.sh` documents for `find -newermt`, avoided the
# same way — no `find -newermt`). Empty output means "could not be evaluated"; every caller
# below treats that as a reason to skip the candidate, never to block.
mtime_epoch() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null
}

now=$(date +%s 2>/dev/null) || exit 0
[ -n "$now" ] || exit 0

# Is an SDLC run currently ACTIVE? "Active" is freshness-windowed, not just seal-state:
# seal-run.sh's own seal-stale mechanism only seals a run that has _telemetry.json, is
# unsealed, AND is within its own age check — a run abandoned before ever writing
# _telemetry.json (or just old) never gets sealed, and a pure "unsealed = active" check would
# therefore treat it as active forever. Mirror the same 6h freshness window ADR-0031's
# resumePreflight() uses (maxAgeMs default 6 * 3600 * 1000), computed here from the newest
# mtime under the run's .checkpoint/ — the directory entry itself, or any file inside it,
# whichever is newer, so a checkpoint dir that was just created but has no files yet still
# counts as freshly touched.
freshness_window_secs=$((6 * 3600))

active_brief=""
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
    active_brief="${d}_brief.md"
    tie=0
  elif [ "$touched" -eq "$newest_touch" ]; then
    tie=1
  fi
done

# Two candidate runs equally fresh at the observed maximum: which one is "the" active run is
# genuinely ambiguous. Fail open rather than guess.
[ "$tie" -eq 0 ] || exit 0
[ -n "$active_brief" ] || exit 0

# Bypass: the run's own brief names the tool this config file belongs to. An unreadable brief
# (permissions, race between the check above and here) must also fail open, not fall through
# to the BLOCK branch below.
[ -r "$active_brief" ] || exit 0
if grep -qiE 'detekt|ktlint|checkstyle|editorconfig|lint config|linter config' "$active_brief" 2>/dev/null; then
  exit 0
fi

{
  echo "HOOK BLOCKED — editing a lint/format config file during an SDLC run: $target"
  echo
  echo "The active run's brief ($active_brief) does not mention detekt/ktlint/checkstyle/"
  echo "editorconfig, so this looks like an attempt to loosen the linter rather than fix the"
  echo "code it is flagging. If this task genuinely is about the lint config, restate that in"
  echo "the feature description and restart the run, or ask the operator to make this edit."
} >&2
exit 2
