#!/usr/bin/env bash
# Stop hook: seal a finished SDLC run that the orchestrator did not seal itself.
#
# Track H6. H1 measured the orchestrator at 82.3% on its own mandated steps; H2 collapsed
# the run tail into one command, which makes it one chance to deviate instead of three,
# but a command is still a command someone has to type. This is the net under that.
#
# EXIT 0, ALWAYS. For `Stop`, exit code 2 does not mean "error" — it BLOCKS the agent from
# stopping and feeds stderr back as an instruction. A sealing net that can trap a user in a
# loop is worse than no net. Hence: no `set -e`, and every external call guarded.
#
# The hook contains no procedure of its own: it decides only whether to call `seal-stale`,
# which is idempotent through .checkpoint/_sealed (ADR-0014, ADR-0016).
set -uo pipefail

payload=$(cat 2>/dev/null || true)

# Project root: the env var Claude Code sets, else the payload's cwd, else here.
project_root="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$project_root" ] && command -v jq >/dev/null 2>&1; then
    project_root=$(printf '%s' "$payload" | jq -r '.cwd // empty' 2>/dev/null)
fi
[ -n "$project_root" ] || project_root=$(pwd)

plans="${project_root}/docs/plans"
[ -d "$plans" ] || exit 0

# Cheap pre-filter, so the overwhelmingly common case costs no process spawn: is there any
# run directory that is not already sealed? A plain shell loop on purpose — `find -newermt`
# is a GNU/BSD portability trap, and removing that class of hazard is what ADR-0014 bought.
candidate=0
for d in "$plans"/*/; do
    [ -f "${d}_telemetry.json" ]     || continue
    [ -f "${d}.checkpoint/_sealed" ] && continue
    candidate=1
    break
done
[ "$candidate" -eq 1 ] || exit 0

command -v node >/dev/null 2>&1 || exit 0
cli="${CLAUDE_PLUGIN_ROOT:-}/tools/run/cli.mjs"
[ -f "$cli" ] || exit 0

out=$(cd "$project_root" && node "$cli" seal-stale --json 2>/dev/null) || exit 0
[ -n "$out" ] || exit 0

# Surface what happened. On this path the WARN: lines `finish` emits have no reader — the
# orchestrator is not here to echo them — so a silent net would hide exactly the unpriced
# run and the undetected cap breach that ADR-0012 exists to make loud.
if command -v jq >/dev/null 2>&1; then
    msg=$(printf '%s' "$out" | jq -r '
        if (.sealed | length) == 0 then empty
        else "[sdlc] sealed by Stop hook: " + ((.sealed | map(.run)) | join(", "))
             + ((.sealed | map(.warnings[]?))
                | if length == 0 then "" else "\n" + join("\n") end)
        end' 2>/dev/null)
    [ -n "$msg" ] && jq -n --arg m "$msg" '{"systemMessage":$m}'
fi
exit 0
