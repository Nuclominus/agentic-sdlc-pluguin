# fixture: every path resolved from the running install

1. `Glob {PLUGIN_CACHE_ROOT}/**/manifest.yaml` — cross-plugin discovery.
2. `Read {SDLC_PLUGIN_ROOT}/config/models.json` — self-referential.
3. `node "${CLAUDE_PLUGIN_ROOT}/tools/usage/cli.mjs"` — expanded by the shell.
4. The transcript lives at `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<cwd>/<session>.jsonl`.
5. The shell fallback is `CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"`.
6. Modifying `.claude/settings.json` in the project is unrelated and legal.
