#!/usr/bin/env bash
# PreToolUse(Edit|Write) hook — protects lint/format config files from being loosened
# mid-run. Scoped to an ACTIVE SDLC run only: a manual edit outside a pipeline run is never
# blocked, so this cannot become a project-wide annoyance (Review Focus, plan phase 3).
#
# Fails open: no active run, no _brief.md, or an unreadable target path all fall through to
# exit 0. Exit 2 blocks with a stderr message; never edits anything itself.
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

# Is there an SDLC run currently in progress? Same detection loop as seal-run.sh: a run dir
# with a checkpoint directory that has not been sealed.
active_brief=""
for d in "$plans"/*/; do
  [ -d "${d}.checkpoint" ] || continue
  [ -f "${d}.checkpoint/_sealed" ] && continue
  [ -f "${d}_brief.md" ] && active_brief="${d}_brief.md"
  break
done
[ -n "$active_brief" ] || exit 0

# Bypass: the run's own brief names the tool this config file belongs to.
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
