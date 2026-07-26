# Plugin path resolution — the contract

Every path the pipeline reads at runtime must be resolved from the **install that is actually
running**, never from a literal `~`. A hard-coded home-relative plugin cache path reads the
operator's real home even when `CLAUDE_CONFIG_DIR` points somewhere else — silently mixing two
plugin trees within one run (issue #70: a foundation that was not enabled in the active config dir
won stack detection and changed the whole pipeline).

This file is the single source of truth for the three roots. `pipeline-orchestrator/SKILL.md`
Step 0, `workflows/RESOLVER.md`, and every `commands/*.md` that globs plugin files resolve them
this way.

---

## The three roots

| Symbol | What it points at | Use it for |
|---|---|---|
| `SDLC_PLUGIN_ROOT` | this plugin's own installed root (`.../plugins/cache/<marketplace>/sdlc/<version>`) | **self-referential** reads: `config/models.json`, `config/aspects.yaml`, `tools/**`, `runtime-dependencies.json` |
| `PLUGIN_CACHE_ROOT` | the cache root holding **every** installed plugin (`<CONFIG_DIR>/plugins/cache`) | **cross-plugin discovery**: `**/manifest.yaml`, `**/workflows/*.yaml`, `**/runtime-dependencies.json`, `**/skills/*/SKILL.md` |
| `CONFIG_DIR` | the active Claude config dir — `${CLAUDE_CONFIG_DIR:-~/.claude}` | session/user state: the deps-preflight stamp, `projects/**` session transcripts |

`SDLC_PLUGIN_ROOT` is not `PLUGIN_CACHE_ROOT/**`-globbed on purpose. The cache can hold **several
versions of the same plugin side by side** (`sdlc/1.9.0/`, `sdlc/1.9.1/`); a `**` glob for
`sdlc/config/models.json` matches all of them and picks arbitrarily. The running plugin knows its
own root — read from it directly.

---

## How to resolve them

One `Bash` call, once per run, before any plugin glob:

```bash
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
case "${CLAUDE_PLUGIN_ROOT:-}" in
  */plugins/cache/*) CFG="${CLAUDE_PLUGIN_ROOT%%/plugins/cache/*}" ;;
esac
SDLC="${CLAUDE_PLUGIN_ROOT:-}"
if [ -z "$SDLC" ]; then   # harness did not export it — find the newest cached sdlc
  M=$(find "$CFG/plugins/cache" -path '*/sdlc/*config/models.json' 2>/dev/null | sort -V | tail -1)
  [ -n "$M" ] && SDLC=$(dirname "$(dirname "$M")")
fi
printf 'CONFIG_DIR=%s\nPLUGIN_CACHE_ROOT=%s/plugins/cache\nSDLC_PLUGIN_ROOT=%s\n' "$CFG" "$CFG" "$SDLC"
```

Order matters: `${CLAUDE_PLUGIN_ROOT}` — the absolute path of the plugin whose skill is executing —
is ground truth, so the config dir is derived from it by truncating at `/plugins/cache/`.
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}` is only the fallback for the case where the harness did not
export `CLAUDE_PLUGIN_ROOT` (a plugin loaded from a local path rather than the cache); in that case
`SDLC_PLUGIN_ROOT` is recovered from the cache, `sort -V`-newest so a stale side-by-side version
loses. If it still comes back empty, fall back to `{PLUGIN_CACHE_ROOT}/**/sdlc/config/<file>` and
say so in the run log rather than silently pricing against an unknown registry.

Hold the three values in `CONTEXT` and substitute them into every subsequent `Glob`/`Read` path.
`Glob` does **not** expand environment variables — pass the resolved absolute path, not the
`${...}` literal.

---

## Writing paths in plugin text

- ✅ `Glob {PLUGIN_CACHE_ROOT}/**/manifest.yaml` — resolved symbol.
- ✅ `Read {SDLC_PLUGIN_ROOT}/config/models.json` — self-referential.
- ✅ `node "${CLAUDE_PLUGIN_ROOT}/tools/usage/cli.mjs"` — inside `Bash`, where the shell expands it.
- ✅ `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/...` — prose describing a config-dir-relative path.
- ❌ `~/.claude/plugins/cache/**/manifest.yaml` — reads the operator's home. This is issue #70. <!-- plugin-paths: ok — the counter-example this contract exists to forbid -->
- ❌ `$HOME/.claude/plugins/...` unguarded — same defect, different spelling. <!-- plugin-paths: ok — the counter-example this contract exists to forbid -->

Enforced by `node tools/sdlc-lint/cli.mjs plugin-paths` (part of `all`, run in CI). A line that
genuinely must carry a literal home path can be exempted with an explicit reason on that line or
the line above:

```
<!-- plugin-paths: ok — <why this one is really home-relative> -->
```

---

## Known gap — enablement is not consulted

Discovery globs the **cache**, which holds every plugin ever installed under that config dir,
enabled or not. A cached-but-disabled plugin can therefore still win foundation selection. Fixing
the root resolution bounds the blast radius to one config tree but does not close this; it is
tracked separately in `.brain/planning/backlog.md`.
