#!/usr/bin/env bash
# PostToolUse hook — validates .kt files for forbidden patterns.
# Exit 2 → Claude Code surfaces stderr to the agent.
# Exit 0 → clean.

file="${1:-}"

[[ "$file" == *.kt ]] || exit 0

# Exempt test sources
[[ "$file" == *Test.kt || "$file" == *Spec.kt ]] && exit 0
[[ "$file" == */src/test/* || "$file" == */src/androidTest/* ]] && exit 0

violations=()

# !! — match any !! then filter out !=, ==, !!, comments
if grep -qE '!!' "$file" 2>/dev/null && grep -E '!!' "$file" | grep -qvE '(!=|==|!!\.)'; then
    violations+=("'!!' (not-null assertion) forbidden — use ?: or requireNotNull()")
fi

if grep -qE '\brunBlocking\s*[({]' "$file" 2>/dev/null; then
    violations+=("'runBlocking' forbidden in production code")
fi

if grep -qE '\bprintln\s*\(' "$file" 2>/dev/null; then
    violations+=("'println' forbidden — use Kermit Logger")
fi

if grep -qE '^\s*Log\.[deiwv]\s*\(' "$file" 2>/dev/null; then
    violations+=("'android.util.Log.*' forbidden — use Kermit Logger")
fi

if grep -qE '\.printStackTrace\s*\(' "$file" 2>/dev/null; then
    violations+=("'printStackTrace' forbidden — use Logger.e(throwable) { … }")
fi

if [[ ${#violations[@]} -gt 0 ]]; then
    echo "HOOK BLOCKED: $file" >&2
    printf '  ✗ %s\n' "${violations[@]}" >&2
    exit 2
fi

exit 0
