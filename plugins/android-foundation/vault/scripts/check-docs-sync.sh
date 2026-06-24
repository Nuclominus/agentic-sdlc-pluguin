#!/usr/bin/env bash
# Vault sync hook (PostToolUse).
# When production Kotlin is edited and a matching note in .obsidian-vault/ is missing,
# this hook auto-creates a STUB note from the appropriate template. Non-blocking.
# DocsWriter is responsible for filling stubs before PR.

set -u
FILE_PATH="${1:-}"
[[ -z "$FILE_PATH" ]] && exit 0

VAULT=".obsidian-vault"
TEMPLATES="$VAULT/_templates"

# If the vault isn't initialised yet, do nothing.
[[ ! -d "$VAULT" ]] && exit 0

# Skip test sources.
case "$FILE_PATH" in
  *Test.kt|*Spec.kt|*/src/test/*|*/src/androidTest/*) exit 0 ;;
esac

# Only act on production Kotlin sources inside feature modules or app.
case "$FILE_PATH" in
  feature/*/src/main/*.kt|feature/*/src/main/**/*.kt) ;;
  app/src/main/*.kt|app/src/main/**/*.kt) ;;
  *) exit 0 ;;
esac

DATE="$(date +%F)"

stub_from_template() {
  local template="$1" out="$2" title="$3"
  [[ ! -f "$template" ]] && return 0
  [[ -f "$out" ]] && return 0
  mkdir -p "$(dirname "$out")"
  # Use a different sed delimiter (|) so titles with slashes don't break.
  sed -e "s|{{title}}|${title}|g" \
      -e "s|{{date}}|${DATE}|g" \
      "$template" > "$out"
  echo "INFO: vault stub created: $out — DocsWriter must fill in" >&2
}

# --- feature module note ---
if [[ "$FILE_PATH" == feature/* ]]; then
  MOD="$(echo "$FILE_PATH" | sed 's|feature/\([^/]*\)/.*|\1|')"
  stub_from_template "$TEMPLATES/module.md" "$VAULT/modules/${MOD}.md" "$MOD"
fi

# --- screen note ---
BASENAME="$(basename "$FILE_PATH" .kt)"
if [[ "$BASENAME" == *Screen ]]; then
  stub_from_template "$TEMPLATES/screen.md" "$VAULT/screens/${BASENAME}.md" "$BASENAME"
fi

exit 0
