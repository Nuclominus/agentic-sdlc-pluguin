#!/usr/bin/env bash
# android-cli-check.sh (ADR-0036): the states it distinguishes, and that it always exits 0.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_ROOT/plugins/android-foundation/hooks/android-cli-check.sh"
fails=0
# An explicit template: BSD mktemp ignores TMPDIR without one. A setup failure must abort the test,
# never fall through to an empty path — the "silent" cases would then pass for the wrong reason.
tmp() { mktemp -d "${TMPDIR:-/tmp}/android-cli-check.XXXXXX" || { echo "FAIL: mktemp"; exit 1; }; }

android_project() { local d; d=$(tmp) || exit 1; touch "$d/settings.gradle.kts"; printf '%s' "$d"; }
fake_bin() {  # a PATH dir holding an executable `android`
  local d; d=$(tmp) || exit 1; printf '#!/bin/sh\nexit 0\n' > "$d/android"; chmod +x "$d/android"; printf '%s' "$d"
}
# PATH without any real `android`: only the directories the hook itself needs.
BASE_PATH="/usr/bin:/bin"

run() {  # $1 project  $2 extra PATH (may be empty)  $3 config dir  → output + EXIT:<code>
  CLAUDE_PROJECT_DIR="$1" CLAUDE_CONFIG_DIR="$3" PATH="${2:+$2:}$BASE_PATH" bash "$HOOK"; echo "EXIT:$?"
}
check() {  # $1 name  $2 output  $3 grep pattern ("" = expect silence)
  if ! printf '%s' "$2" | grep -q 'EXIT:0'; then echo "FAIL: $1 — did not exit 0"; fails=$((fails+1)); return; fi
  local body; body=$(printf '%s' "$2" | grep -v '^EXIT:')
  if [ -z "$3" ]; then
    if [ -z "$body" ]; then echo "PASS: $1"; else echo "FAIL: $1 — expected silence, got: $body"; fails=$((fails+1)); fi
  else
    if printf '%s' "$body" | grep -q "$3"; then echo "PASS: $1"; else echo "FAIL: $1 — missing /$3/ in: $body"; fails=$((fails+1)); fi
  fi
}

cfg=$(tmp) || exit 1
check "non-Android project is silent" "$(run "$(tmp)" "" "$cfg")" ""
check "no binary → recommends the CLI, policy warn" "$(run "$(android_project)" "" "$cfg")" "policy \`warn\`"
check "binary, no skills → recommends skills add" "$(run "$(android_project)" "$(fake_bin)" "$cfg")" "android skills add --all"
# `android init` alone installs android-cli and nothing else — still not the catalog.
mkdir -p "$cfg/skills/android-cli" && touch "$cfg/skills/android-cli/SKILL.md"
check "binary + android-cli only (android init) → recommends skills add" "$(run "$(android_project)" "$(fake_bin)" "$cfg")" "android skills add --all"
mkdir -p "$cfg/skills/android-intent-security" && touch "$cfg/skills/android-intent-security/SKILL.md"
check "binary + catalog (skills add) → silent" "$(run "$(android_project)" "$(fake_bin)" "$cfg")" ""
# The plugin-marketplace route installs no bare dirs; the install record is the evidence.
pcfg=$(tmp) || exit 1
mkdir -p "$pcfg/plugins" && printf '{"plugins":{"android-skills@android-skills":[{}]}}\n' > "$pcfg/plugins/installed_plugins.json"
check "binary + catalog (plugin install) → silent" "$(run "$(android_project)" "$(fake_bin)" "$pcfg")" ""

if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILED"; exit 1; fi
