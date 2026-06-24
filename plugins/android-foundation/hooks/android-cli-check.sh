#!/usr/bin/env bash
# android-foundation SessionStart advisory: if this is an Android project and the optional
# Android CLI (`android`) is not installed, print a non-blocking note. Fails open.
# This keeps ALL Android-CLI logic inside android-foundation — the core orchestrator never sees it.
set -uo pipefail
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
# Only advise for Android projects (mirror stack.md detection — cheap check).
if ! ls "$root"/settings.gradle.kts "$root"/settings.gradle >/dev/null 2>&1; then
  exit 0
fi
if command -v android >/dev/null 2>&1; then
  exit 0   # present — nothing to say
fi
cat <<'MSG'
[android-foundation] Optional: Android CLI (`android`) not found on PATH.
  Android agents can use it for native tooling (emulator/run, screen/layout, sdk, docs, studio bridge).
  It is OPTIONAL — the pipeline runs without it. To enable:
    • Download: https://developer.android.com/tools/agents
    • android update
    • android init        # installs the `android-cli` agent skill
MSG
exit 0
