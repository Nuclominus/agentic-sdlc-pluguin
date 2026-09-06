#!/usr/bin/env bash
# Tests the project-local override behavior of enforce-agent-model.sh.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_ROOT/plugins/sdlc/hooks/enforce-agent-model.sh"
fails=0

TMPDIRS=()
cleanup() { [ "${#TMPDIRS[@]}" -eq 0 ] || rm -rf "${TMPDIRS[@]}"; }
trap cleanup EXIT

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
    TMPDIRS+=("$d")
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

# 6. invalid per-agent value WITH a valid default → falls through to default (haiku)
p=$(mk_project '{"default":"haiku","agents":{"developer":"turbo"}}')
check "invalid per-agent falls through to default" "haiku" "$(enforced_tier "$(run_hook "$p" sonnet)" sonnet)"

# 7. invalid default (no per-agent entry) → falls back to frontmatter sonnet
p=$(mk_project '{"default":"turbo"}')
check "invalid default falls back to frontmatter" "sonnet" "$(enforced_tier "$(run_hook "$p" sonnet)" sonnet)"

# ── ADR-0021: legacy android-* names survive one release as aliases ─────────────────────────────

run_hook_as() {  # $1 = project dir, $2 = subagent_type, $3 = requested model → prints hook stdout
    printf '{"tool_name":"Agent","tool_input":{"subagent_type":"%s","model":"%s"}}' "$2" "$3" \
        | CLAUDE_PROJECT_DIR="$1" CLAUDE_PLUGIN_ROOT="" bash "$HOOK" 2>/dev/null
}

# 8. a model.local.json still keyed by the legacy name applies to the core agent → opus
p=$(mk_project '{"agents":{"android-developer":"opus"}}')
check "legacy model.local.json key honored" "opus" "$(enforced_tier "$(run_hook "$p" sonnet)" sonnet)"

# 9. an explicit core key beats its alias, whatever the file order → haiku
p=$(mk_project '{"agents":{"android-developer":"opus","developer":"haiku"}}')
check "explicit core key beats legacy alias" "haiku" "$(enforced_tier "$(run_hook "$p" sonnet)" sonnet)"

# 10. dispatching a deleted legacy agent: allowed, warned, and the successor's tier enforced
p=$(mk_project NONE)
out=$(run_hook_as "$p" "android-foundation:android-developer" opus)
check "legacy dispatch name resolves to the core agent's tier" "sonnet" "$(enforced_tier "$out" opus)"
msg=$(printf '%s' "$out" | jq -r '.systemMessage // empty')
case "$msg" in
    *"renamed to 'developer'"*) echo "PASS: legacy dispatch name warns about the rename" ;;
    *) echo "FAIL: legacy dispatch name warns about the rename — got '$msg'"; fails=$((fails+1)) ;;
esac

[ "$fails" -eq 0 ] && { echo "ALL PASS"; exit 0; } || { echo "$fails FAILED"; exit 1; }
