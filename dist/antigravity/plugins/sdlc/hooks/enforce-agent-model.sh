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

# ADR-0021 renamed the agent roster and ships NO aliases: this hook resolves the name it is given,
# and a name that matches no agent file falls open (below) exactly as any non-SDLC agent does.
# Migrating a project's model.local.json is `/sdlc:doctor`'s job, not a lookup fallback here —
# a translation that has to agree with the dispatch name, the resolver and the orchestrator is
# four copies of one map, and every place they disagreed was a defect.

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
    if command -v jq >/dev/null 2>&1; then
        jq -r --arg a "$2" '(.agents[$a] // ""), (.default // "")' "$file" 2>/dev/null
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c "import json,sys
try:
    d=json.load(open(sys.argv[1]))
    print(d.get('agents',{}).get(sys.argv[2]) or '')
    print(d.get('default') or '')
except Exception:
    pass" "$file" "$2" 2>/dev/null
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
# (e.g. sdlc:developer), but the file on disk is just "<agent>.md".
# Strip the plugin prefix before building the search path.
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

# The core ships every dispatched agent (ADR-0021), so the direct probe answers first and costs a
# stat; `find` stays as the fallback for a plugin laid out differently, and `-print -quit` stops it
# at the first hit instead of walking every cached plugin version to completion.
md_path=""
if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/agents/${bare_name}.md" ]; then
    md_path="${CLAUDE_PLUGIN_ROOT}/agents/${bare_name}.md"
else
    for root in "${search_roots[@]}"; do
        [ -d "$root" ] || continue
        md_path=$(find "$root" -path "*/agents/${bare_name}.md" -print -quit 2>/dev/null)
        [ -n "$md_path" ] && break
    done
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
[ "$requested_model" = "$declared_model" ] && { allow; exit 0; }

# ── correction needed ───────────────────────────────────────────────────────
mkdir -p "$(dirname "$log_path")"
ts=$(date -u +"%Y-%m-%dT%H:%M:%S+00:00")
printf '[%s] CORRECTED agent=%s requested=%s enforced=%s\n' \
    "$ts" "$agent_name" "${requested_model:-absent}" "$declared_model" >> "$log_path"

# Build corrected output — jq path preferred, python3 fallback
corrected_msg="[model-enforcement] CORRECTED ${agent_name}: ${requested_model:-absent} → ${declared_model}"
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
