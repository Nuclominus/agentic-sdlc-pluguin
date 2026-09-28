#!/usr/bin/env bash
# android-foundation SessionStart advisory for the Android CLI and its skill catalog — a
# `policy: warn` runtime dependency (ADR-0036). Non-blocking, fails open, Android projects only.
# The authoritative per-skill check is the dependency preflight (and /sdlc:doctor); this hook only
# catches the two cheap, common cases at session start: no `android` binary, or no catalog skills.
# All Android-CLI knowledge stays inside android-foundation — the core never sees this script.
set -uo pipefail
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
# Only advise for Android projects (mirror stack.md detection — cheap check). Either settings file
# qualifies: `ls a b` exits non-zero when ANY operand is missing, which silenced this hook on every
# real project (they carry one of the two, never both).
if [ ! -f "$root/settings.gradle.kts" ] && [ ! -f "$root/settings.gradle" ]; then
  exit 0
fi
skills_dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
if command -v android >/dev/null 2>&1; then
  [ -f "$skills_dir/android-cli/SKILL.md" ] && exit 0   # binary + catalog present — nothing to say
  cat <<'MSG'
[android-foundation] Android CLI found, but its agent skills are not installed.
  Roles are assigned Google's Android skills (skill-sets/android-skills.yaml); without them the
  pipeline still runs, with those skills best-effort. To install:
    • android skills add --all --agent=claude-code
  /sdlc:doctor lists exactly which assigned skills are missing.
MSG
  exit 0
fi
cat <<'MSG'
[android-foundation] Recommended: Android CLI (`android`) not found on PATH.
  It is a runtime dependency with policy `warn` (like superpowers): the pipeline runs without it,
  but roles lose the CLI (emulator/run, screen/layout, sdk, docs, studio bridge) and Google's
  Android agent skills. To install:
    • Download: https://developer.android.com/tools/agents
    • android update
    • android init                                # installs the `android-cli` agent skill
    • android skills add --all --agent=claude-code
  /sdlc:doctor reports what is missing.
MSG
exit 0
