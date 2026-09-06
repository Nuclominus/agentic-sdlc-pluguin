#!/usr/bin/env bash
# PreToolUse hook: enforce declared model on every Agent() dispatch.
#
# Claude Code sends a JSON payload on stdin:
#   { "tool_name": "Agent",
#     "tool_input": { "subagent_type": "...", "model": "...", ... } }
#
# Requires jq (preferred) or python3 for JSON parsing.
# Fails open (allow) if neither is available.
set -uo pipefail

# The Agent tool's `model` field accepts the SHORT tier name only
# (sonnet|opus|haiku|fable) — NOT the full model ID. Validate the declared
# tier and enforce it verbatim. Full model IDs (claude-opus-4-8, …) are used
# only for telemetry/cost accounting in the orchestrator, never for dispatch.
#
# This list MIRRORS `pipeline_tiers` in plugins/sdlc/config/models.json (the
# model registry / single source of truth) — keep the two in sync. The hook
# keeps its own inline copy on purpose: a PreToolUse hook must fail-open fast.
# It ALSO reads an OPTIONAL per-project override, <project>/.claude/model.local.json.
# Resolution mirrors the orchestrator: agents[<name>] → default → frontmatter tier.
# A present-but-invalid value at a given source is SKIPPED (falls through to the
# next source, it does NOT abort resolution). The hook MUST still fail open (fall
# back to frontmatter) if the file is absent, unparseable, or every candidate is
# invalid.
is_valid_tier() {
    case "$1" in
        opus|sonnet|haiku|fable) return 0 ;;
        *)                       return 1 ;;
    esac
}

# ADR-0021 — the android-foundation roster moved into the core. The legacy names survive one
# release as aliases: a model.local.json still keyed by `android-developer` applies to
# `developer`, and a dispatch of a deleted `android-*` agent resolves its successor's tier.
# MIRRORS plugins/sdlc/tools/resolve/aliases.mjs — keep the two lists in sync.
legacy_canonical() {  # $1 = bare agent name → prints the core successor, or nothing
    case "$1" in
        android-ba)        echo "business-analyst" ;;
        android-developer) echo "developer" ;;
        android-reviewer)  echo "reviewer" ;;
        android-security)  echo "security-analyst" ;;
        android-tester)    echo "tester" ;;
        android-qa)        echo "qa-engineer" ;;
        android-docs)      echo "document-writer" ;;
        android-debugger)  echo "debugger" ;;
        android-devops)    echo "devops" ;;
        android-cicd)      echo "cicd" ;;
        android-aar)       echo "aar-analyst" ;;
        *)                 ;;
    esac
}
legacy_name_for() {  # $1 = core agent name → prints its legacy alias, or nothing
    case "$1" in
        business-analyst) echo "android-ba" ;;
        developer)        echo "android-developer" ;;
        reviewer)         echo "android-reviewer" ;;
        security-analyst) echo "android-security" ;;
        tester)           echo "android-tester" ;;
        qa-engineer)      echo "android-qa" ;;
        document-writer)  echo "android-docs" ;;
        debugger)         echo "android-debugger" ;;
        devops)           echo "android-devops" ;;
        cicd)             echo "android-cicd" ;;
        aar-analyst)      echo "android-aar" ;;
        *)                ;;
    esac
}

# Read the two OPTIONAL project-local tier candidates from
# <project_root>/.claude/model.local.json: the per-agent value (agents[<name>])
# on line 1, the default value on line 2 (each empty if absent). Fails open —
# prints nothing on any error: missing file, bad JSON, or no JSON parser.
# Validation and fall-through are the caller's job (an invalid per-agent value
# must fall through to default, matching the orchestrator's resolution order).
resolve_override_candidates() {
    # $1 = project_root, $2 = bare agent name
    local file="$1/.claude/model.local.json"
    [ -f "$file" ] || return 0
    # An explicit core key beats its legacy alias whatever the file order (ADR-0021); the
    # alias is consulted only when the core key is absent. `legacy` may be empty — jq then
    # looks up `.agents[""]`, which is null, so the fallthrough is harmless.
    local legacy; legacy=$(legacy_name_for "$2")
    if command -v jq >/dev/null 2>&1; then
        jq -r --arg a "$2" --arg l "$legacy" '((.agents[$a] // .agents[$l]) // ""), (.default // "")' "$file" 2>/dev/null
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c "import json,sys
try:
    d=json.load(open(sys.argv[1]))
    agents=d.get('agents',{})
    print(agents.get(sys.argv[2]) or (sys.argv[3] and agents.get(sys.argv[3])) or '')
    print(d.get('default') or '')
except Exception:
    pass" "$file" "$2" "$legacy" 2>/dev/null
    fi
}

allow() {
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'
}

allow_warn() {
    # $1 = message (must not contain double-quotes)
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"},"systemMessage":"%s"}\n' "$1"
}

payload=$(cat)

# ── detect JSON tool ────────────────────────────────────────────────────────
if command -v jq >/dev/null 2>&1; then
    tool_name=$(printf '%s' "$payload" | jq -r '.tool_name // empty')
    agent_name=$(printf '%s' "$payload" | jq -r '.tool_input.subagent_type // empty')
    requested_model=$(printf '%s' "$payload" | jq -r '.tool_input.model // empty')
elif command -v python3 >/dev/null 2>&1; then
    tool_name=$(printf '%s' "$payload"      | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_name',''))")
    agent_name=$(printf '%s' "$payload"     | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('subagent_type',''))")
    requested_model=$(printf '%s' "$payload" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('model',''))")
else
    allow_warn "[model-enforcement] neither jq nor python3 found — model enforcement skipped"
    exit 0
fi

# ── only intercept Agent tool ───────────────────────────────────────────────
[ "$tool_name" = "Agent" ] || { allow; exit 0; }
[ -n "$agent_name" ]       || { allow; exit 0; }

project_root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
log_path="${project_root}/docs/plans/_model-enforcement.log"

# ── find agent .md ──────────────────────────────────────────────────────────
# Agent names dispatched from plugins are namespaced as "<plugin>:<agent>"
# (e.g. android-plugin:android-developer), but the file on disk is just
# "<agent>.md". Strip the plugin prefix before building the search path.
bare_name="${agent_name##*:}"

# Search order: installed plugin root → sibling plugins (marketplace layout) → dev checkout fallback
search_roots=()
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    search_roots+=(
        "${CLAUDE_PLUGIN_ROOT}"
        "$(dirname "${CLAUDE_PLUGIN_ROOT}")"
        "$(dirname "$(dirname "${CLAUDE_PLUGIN_ROOT}")")"
    )
fi
search_roots+=( "${project_root}/plugins" )

find_agent_md() {  # $1 = bare agent name → prints the first matching agents/<name>.md, or nothing
    local root found
    for root in "${search_roots[@]}"; do
        [ -d "$root" ] || continue
        found=$(find "$root" -path "*/agents/$1.md" 2>/dev/null | head -1)
        [ -n "$found" ] && { printf '%s' "$found"; return 0; }
    done
    return 0
}

md_path=$(find_agent_md "$bare_name")

# ADR-0021: a deleted legacy agent resolves to its core successor — allowed, warned, and the
# successor's tier enforced. Only when the legacy file is genuinely gone: while it still ships
# (the one-release migration window) it is dispatched as-is, so an Android run stays identical.
rename_note=""
if [ -z "$md_path" ]; then
    canon=$(legacy_canonical "$bare_name")
    if [ -n "$canon" ]; then
        md_path=$(find_agent_md "$canon")
        if [ -n "$md_path" ]; then
            rename_note="[model-enforcement] agent '${bare_name}' was renamed to '${canon}' (android-foundation 2.x ships no agents, ADR-0021) — dispatch '${canon}'"
            bare_name="$canon"
        fi
    fi
fi

if [ -z "$md_path" ]; then
    allow_warn "[model-enforcement] agent '${agent_name}' .md not found — skipping model check (non-SDLC agent?)"
    exit 0
fi

# ── extract model tier from frontmatter ─────────────────────────────────────
# awk counts --- delimiters; f==1 means inside the frontmatter block
tier=$(awk '/^---$/{f++; next} f==1 && /^model:/{print $2; exit}' "$md_path")

if [ -z "$tier" ]; then
    allow_warn "[model-enforcement] agent '${agent_name}' has no model: in frontmatter — skipping"
    exit 0
fi

if ! is_valid_tier "$tier"; then
    allow_warn "[model-enforcement] unknown tier '${tier}' for agent '${agent_name}' — skipping"
    exit 0
fi

# ── apply optional project-local override ───────────────────────────────────
# Resolution matches the orchestrator: agents[<name>] → default → frontmatter tier.
# A present-but-invalid value is SKIPPED (falls through); any error falls back to
# the frontmatter tier (fail-open). Diagnostics go to stderr so they never corrupt
# the JSON decision on stdout.
override_per_agent=""
override_default=""
{ IFS= read -r override_per_agent; IFS= read -r override_default; } < <(resolve_override_candidates "$project_root" "$bare_name")

override_tier=""
if [ -n "$override_per_agent" ]; then
    if is_valid_tier "$override_per_agent"; then
        override_tier="$override_per_agent"
    else
        printf '[model-enforcement] ignoring invalid agents override "%s" for %s in .claude/model.local.json — falling through\n' \
            "$override_per_agent" "$agent_name" >&2
    fi
fi
if [ -z "$override_tier" ] && [ -n "$override_default" ]; then
    if is_valid_tier "$override_default"; then
        override_tier="$override_default"
    else
        printf '[model-enforcement] ignoring invalid default override "%s" in .claude/model.local.json — using frontmatter "%s" for %s\n' \
            "$override_default" "$tier" "$agent_name" >&2
    fi
fi
[ -n "$override_tier" ] && tier="$override_tier"

# Enforce the short tier name verbatim — the Agent tool rejects full model IDs.
declared_model="$tier"

# ── already correct → passthrough ──────────────────────────────────────────
if [ "$requested_model" = "$declared_model" ]; then
    if [ -n "$rename_note" ]; then allow_warn "$rename_note"; else allow; fi
    exit 0
fi

# ── correction needed ───────────────────────────────────────────────────────
mkdir -p "$(dirname "$log_path")"
ts=$(date -u +"%Y-%m-%dT%H:%M:%S+00:00")
printf '[%s] CORRECTED agent=%s requested=%s enforced=%s\n' \
    "$ts" "$agent_name" "${requested_model:-absent}" "$declared_model" >> "$log_path"

# Build corrected output — jq path preferred, python3 fallback
corrected_msg="[model-enforcement] CORRECTED ${agent_name}: ${requested_model:-absent} → ${declared_model}"
[ -n "$rename_note" ] && corrected_msg="${rename_note}; ${corrected_msg}"
if command -v jq >/dev/null 2>&1; then
    updated_input=$(printf '%s' "$payload" | jq --arg m "$declared_model" '.tool_input | .model = $m')
    jq -n \
        --argjson ui "$updated_input" \
        --arg msg "$corrected_msg" \
        '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":$ui},"systemMessage":$msg}'
else
    updated_input=$(printf '%s' "$payload" \
        | python3 -c "
import json, sys
d = json.load(sys.stdin)
ti = d.get('tool_input', {})
ti['model'] = '${declared_model}'
print(json.dumps(ti))
")
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":%s},"systemMessage":"%s"}\n' \
        "$updated_input" "$corrected_msg"
fi
