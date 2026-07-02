#!/usr/bin/env bash
# Tests the project-local override behavior of enforce-agent-model.sh.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_ROOT/plugins/sdlc/hooks/enforce-agent-model.sh"
fails=0

run_hook() {  # $1 = project dir, $2 = requested model  → prints hook stdout
    printf '{"tool_name":"Agent","tool_input":{"subagent_type":"developer","model":"%s"}}' "$2" \
        | CLAUDE_PROJECT_DIR="$1" CLAUDE_PLUGIN_ROOT="" bash "$HOOK"
}

# enforced tier = updatedInput.model if a correction was emitted, else the requested model
enforced_tier() {  # $1 = hook stdout, $2 = requested model
    local m; m=$(printf '%s' "$1" | jq -r '.hookSpecificOutput.updatedInput.model // empty' 2>/dev/null)
    [ -n "$m" ] && printf '%s' "$m" || printf '%s' "$2"
}

mk_project() {  # $1 = model.local.json contents (or "NONE")  → echoes project dir
    local d; d=$(mktemp -d)
    mkdir -p "$d/.claude" "$d/plugins/sdlc/agents"
    printf -- '---\nname: developer\nmodel: sonnet\n---\nbody\n' > "$d/plugins/sdlc/agents/developer.md"
    [ "$1" != "NONE" ] && printf '%s' "$1" > "$d/.claude/model.local.json"
    printf '%s' "$d"
}

check() {  # $1 = label, $2 = expected tier, $3 = actual tier
    if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 — expected '$2' got '$3'"; fails=$((fails+1)); fi
}

# 1. per-agent override wins over frontmatter (sonnet) → opus
p=$(mk_project '{"default":"haiku","agents":{"developer":"opus"}}')
check "per-agent override" "opus" "$(enforced_tier "$(run_hook "$p" sonnet)" sonnet)"

# 2. default applies when no per-agent entry (frontmatter sonnet) → haiku
p=$(mk_project '{"default":"haiku"}')
check "default fallback" "haiku" "$(enforced_tier "$(run_hook "$p" sonnet)" sonnet)"

# 3. invalid override value → fall back to frontmatter sonnet
p=$(mk_project '{"agents":{"developer":"turbo"}}')
check "invalid tier ignored" "sonnet" "$(enforced_tier "$(run_hook "$p" sonnet)" sonnet)"

# 4. no file → frontmatter sonnet enforced (requested opus → corrected to sonnet)
p=$(mk_project NONE)
check "missing file passthrough" "sonnet" "$(enforced_tier "$(run_hook "$p" opus)" opus)"

# 5. malformed JSON → fail open to frontmatter sonnet
p=$(mk_project '{ this is not json ')
check "malformed json fail-open" "sonnet" "$(enforced_tier "$(run_hook "$p" opus)" opus)"

[ "$fails" -eq 0 ] && { echo "ALL PASS"; exit 0; } || { echo "$fails FAILED"; exit 1; }
