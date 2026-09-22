#!/usr/bin/env bash
# Stop hook: format Kotlin. Fails open (never blocks the turn).
set -uo pipefail
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" || exit 0
if [ -x ./gradlew ]; then
  ./gradlew ktlintFormat >/dev/null 2>&1 || ./gradlew detekt --auto-correct >/dev/null 2>&1 || true
fi
exit 0
