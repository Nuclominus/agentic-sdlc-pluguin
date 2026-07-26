---
adr: 9
status: accepted
date: 2026-07-26
supersedes: null
---

# ADR-0009 — Plugin paths resolve from the running install, never from `~`

## Context

The orchestrator discovered every plugin artifact by globbing a **literal** home path:

```
manifests = [ parse(f) for f in Glob("~/.claude/plugins/cache/**/manifest.yaml") ]
```

27 occurrences of that shape across 10 shipped files covered foundation detection, workflow recipe
lookup, the model registry (tiers *and* pricing), runtime-dependency declarations, skill-path
fallbacks, and the deps-preflight stamp. When `CLAUDE_CONFIG_DIR` points somewhere else — CI
containers, per-project configs, multi-version testing, the `bench/` harness — the pipeline read the
**operator's real home** while running under a different config tree, silently mixing two plugin
trees within one run.

This was caught, not theorised. The E2 benchmark campaign (#69) isolated two plugin builds via
per-arm `CLAUDE_CONFIG_DIR`, each with exactly one plugin enabled (`sdlc@agentic-sdlc`). Of nine
identical headless runs against the same plain Kotlin/JVM specimen, eight ran the expected 5-phase
vanilla pipeline and one — `a-4`, same arm, same driver, same corpus — ran the **7-phase Android
pipeline**, because `android-foundation` was present in the operator's real cache, satisfied its
`detect` block, and outscored the vanilla default at `priority: 300`. Selection scoring was correct;
the tree being globbed was not. Observed rate 1 in 9, nondeterministic — which is precisely why it
survived normal use. Recorded as issue #70; the campaign's real yield, since its headline A/B result
was null ([[decisions/ADR-0008-read-discipline-contract]] Validation).

Two aggravating factors surfaced while fixing it. The cache holds **several versions of one plugin
side by side** (`sdlc/1.9.0/`, `sdlc/1.10.0/`), so a `**/sdlc/config/models.json` glob matched more
than one registry and picked arbitrarily — a run could price itself against an install it was not
executing. And `plugins/sdlc/tools/usage/usage.mjs` independently hard-coded `homedir()` for both
the registry and the `projects/**` transcript root, so transcript-derived cost had the same defect
in code, not just in prompt text.

## Decision

**Every runtime path resolves from the install that is actually running. A literal `~` in shipped
plugin text is a lint failure.**

1. **Three named roots, one definition.** `plugins/sdlc/PLUGIN-PATHS.md` is the contract:
   `SDLC_PLUGIN_ROOT` (this plugin's own root — self-referential reads), `PLUGIN_CACHE_ROOT`
   (cross-plugin discovery), `CONFIG_DIR` (session/user state). Orchestrator **Step 0** resolves all
   three in one `Bash` call before any plugin read; commands and `workflows/RESOLVER.md` reference
   the same contract rather than restating it.
2. **`${CLAUDE_PLUGIN_ROOT}` is ground truth, `CLAUDE_CONFIG_DIR` is the fallback.** The config dir
   is derived by truncating the running plugin's absolute path at `/plugins/cache/`, so it is right
   by construction under any config dir. `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` only covers a plugin
   loaded from a local path; the `sort -V`-newest cached `sdlc` is then recovered explicitly.
3. **Self-referential reads stop globbing.** `config/models.json` and `config/aspects.yaml` are
   `Read` from `{SDLC_PLUGIN_ROOT}` directly — which also closes the side-by-side-versions ambiguity.
4. **The same rule in code.** `usage.mjs` gained an exported `claudeConfigDir()` honoring
   `CLAUDE_CONFIG_DIR` → `CLAUDE_PLUGIN_ROOT` → `$HOME`, used for both the registry and the
   transcript root.
5. **Mechanical drift guard.** A `plugin-paths` verb in `tools/sdlc-lint`
   (`lib/plugin-paths.mjs`) scans all shipped plugin text for home-anchored `.claude` paths in every
   spelling (`~`, `$HOME`, `${HOME}`), with one legal exception — `${CLAUDE_CONFIG_DIR:-…}`, where a
   custom config dir still wins — and an inline escape-hatch marker requiring a stated reason. It
   also asserts the orchestrator still points at the contract. Wired into `sdlc-lint all`
   (`143/143 clean`) and CI. Same shape as the `read-discipline` guard from ADR-0008.

## Consequences

- Two runs of the same command on the same project under the same config dir now take the same
  pipeline. The nondeterminism the campaign hit is gone at its source.
- Any non-default `CLAUDE_CONFIG_DIR` is now honored throughout — CI, per-project configs,
  multi-version testing, and `bench/`. E2's re-run precondition ("run on an orchestrator with issue
  #70 fixed") is met; the campaign's numbers predate the fix and are not comparable to future ones.
- Cost accounting prices against the registry of the install that ran, not whichever cached copy a
  glob happened to reach first.
- **Enablement is still not consulted.** Discovery globs the *cache*, which holds every plugin ever
  installed under that config dir, enabled or not — so a cached-but-disabled plugin can still win
  foundation selection. This fix bounds the blast radius to one config tree; it does not close the
  gap. Tracked in [[planning/backlog]] as a separate design question, since filtering to enabled
  plugins requires reading `installed_plugins.json` and deciding what "enabled" means for a
  foundation a project legitimately detects.
- Cost of the guard: an extra `Bash` call per run at Step 0, and one more lint verb to keep green.

## Related
- Implemented by: #70 fix (this change). Found by: #69 (E2 benchmark campaign).
- Relates to: [[decisions/ADR-0008-read-discipline-contract]] / [[components/sdlc]] /
  [[architecture/benchmark-e2-read-discipline]] / [[planning/backlog]]
