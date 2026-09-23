#!/usr/bin/env bash
# Smoke test for `tools/run/cli.mjs resume-check` — the CLI surface for ADR-0031's two
# --resume safety gates (branch mismatch, staleness). Mirrors tests/test-enforce-agent-model.sh.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO_ROOT/plugins/sdlc/tools/run/cli.mjs"
fails=0
d=$(mktemp -d)
trap 'rm -rf "$d"' EXIT
mkdir -p "$d/.checkpoint"
cat > "$d/.checkpoint/_run.json" <<'EOF'
{"task_slug":"t","workflow":"default","branch_name":"feature/x","resolved_phases":[{"name":"development","kind":"plain"}]}
EOF
echo '{"phase":"development","status":"completed","completed_at":"2026-01-01T00:00:00Z"}' > "$d/.checkpoint/development.json"

out=$(node "$CLI" resume-check "$d" --branch develop --json)
echo "$out" | grep -q '"branchOk":false' && echo "PASS: branch mismatch detected" || { echo "FAIL: branch mismatch not detected: $out"; fails=$((fails+1)); }

out=$(node "$CLI" resume-check "$d" --branch feature/x --json)
echo "$out" | grep -q '"branchOk":true' && echo "PASS: matching branch passes" || { echo "FAIL: matching branch rejected: $out"; fails=$((fails+1)); }

[ "$fails" -eq 0 ] && { echo "ALL PASS"; exit 0; } || { echo "$fails FAILURE(S)"; exit 1; }
