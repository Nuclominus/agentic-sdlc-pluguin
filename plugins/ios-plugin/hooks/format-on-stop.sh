#!/usr/bin/env bash
# Stop hook: format Swift. Fails open (never blocks). No-op off macOS / if tools absent.
set -uo pipefail
[ "$(uname)" = "Darwin" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$root" || exit 0
command -v swiftformat >/dev/null 2>&1 && swiftformat . >/dev/null 2>&1 || true
command -v swiftlint   >/dev/null 2>&1 && swiftlint --fix --quiet >/dev/null 2>&1 || true
exit 0
