---
pr: 73
date: 2026-07-26
author: Nuclominus
type: fix
plugins: [android-foundation, sdlc]
roadmap: null
files_changed: 36
---

# PR #73 — resolve plugin paths from the running install, not `~` (#70)

> `fix` · merged 2026-07-26 · by @Nuclominus

## Summary

The orchestrator discovered every plugin artifact by globbing a **literal** home path:

```
manifests = [ parse(f) for f in Glob("~/.claude/plugins/cache/**/manifest.yaml") ]
```

27 occurrences of that shape across 10 shipped files — foundation detection, workflow recipe
lookup, the model registry (tiers **and** pricing), runtime-dependency declarations, skill-path
fallbacks, the deps-preflight stamp. When `CLAUDE_CONFIG_DIR` points elsewhere (CI containers,
per-project configs, multi-version testing, the `bench/` harness), the pipeline read the
**operator's real home** while running under a different config tree.

This was caught, not theorised. The E2 campaign (#69) isolated two plugin builds via per-arm
`CLAUDE_CONFIG_DIR`, each with only `sdlc` enabled. Of nine identical headless runs against a plain
Kotlin/JVM specimen, eight ran the expected 5-phase vanilla pipeline and one — `a-4`, same arm, same
driver, same corpus — ran the **7-phase Android pipeline**, because `android-foundation` sat in the
operator's real cache, satisfied its `detect` block and outscored the vanilla default at
`priority: 300`. The scoring was right; the tree being globbed was not. 1 in 9, nondeterministic —
which is exactly why it survived normal use.

The fix names three roots and resolves them from the install that is actually running:

1. **A contract, `plugins/sdlc/PLUGIN-PATHS.md`** — `SDLC_PLUGIN_ROOT` (self-referential reads),
   `PLUGIN_CACHE_ROOT` (cross-plugin discovery), `CONFIG_DIR` (session/user state). Orchestrator
   **Step 0** resolves all three in one `Bash` call before any plugin read; commands and
   `workflows/RESOLVER.md` reference it rather than restating it.
2. **`${CLAUDE_PLUGIN_ROOT}` is ground truth** — the config dir is derived by truncating the running
   plugin's absolute path at `/plugins/cache/`, so it is correct by construction under any config
   dir. `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` only covers a plugin loaded from a local path.
3. **Two adjacent defects with the same root cause.** The cache holds side-by-side versions
   (`sdlc/1.9.0/`, `sdlc/1.10.0/`), so `**/sdlc/config/models.json` matched several registries and
   picked arbitrarily — a run could price itself against an install it was not executing; the
   registry and `aspects.yaml` are now `Read` from `{SDLC_PLUGIN_ROOT}` directly. And
   `tools/usage/usage.mjs` independently hard-coded `homedir()` for both the registry and the
   `projects/**` transcript root, giving transcript-derived cost the same bug in code rather than in
   prompt text — now an exported `claudeConfigDir()` resolving
   `CLAUDE_CONFIG_DIR` → `CLAUDE_PLUGIN_ROOT` → `$HOME`.
4. **A drift guard, `sdlc-lint plugin-paths`** — scans all shipped plugin text for home-anchored
   `.claude` paths in every spelling (`~`, `$HOME`, `${HOME}`), allowing only
   `${CLAUDE_CONFIG_DIR:-…}` (where a custom config dir still wins) plus an inline marker that
   requires a stated reason, and asserts the orchestrator still points at the contract. Wired into
   `sdlc-lint all`; reports 143/143 clean.

Plugin version 1.10.0 → 1.10.1.

## Changed areas

- [[components/sdlc]] — orchestrator Step 0, eight `commands/*.md`, `workflows/RESOLVER.md`, the
  `config/` registry reads, `tools/usage/usage.mjs`, and the new `plugin-paths` lint verb
- [[components/android-foundation]] — two transcript-path references (`android-aar` agent,
  `rules/workflow.md`) rewritten as config-dir-relative; no behavioural change to the plugin
- [[architecture/pipeline-orchestrator]] — path resolution is now a named step in the algorithm
  with three symbols the rest of the document (and every command) substitutes
- [[architecture/benchmark-e2-read-discipline]] — its "fix #70 first, or arm isolation is not
  isolation" design brief is now satisfied; the campaign's numbers predate this fix and are not
  comparable to anything measured after it

## Decisions & rationale

- [[decisions/ADR-0009-plugin-root-resolution]] — every runtime path resolves from the running
  install; a literal `~` in shipped plugin text is a lint failure.
- **Deliberately out of scope: enablement filtering.** Discovery still globs the *cache*, which
  holds every plugin ever installed under that config dir — enabled or not — so a cached-but-disabled
  foundation can still win selection. This change bounds the blast radius to one config tree; it does
  not close that gap. Folding it in would have required deciding where enablement lives
  (`installed_plugins.json` vs. per-project settings), whether a detected-but-disabled foundation
  should warn rather than be skipped, and what a local-path development checkout means — three open
  questions that do not belong in a bugfix. Filed as backlog **Track H1**.
- **Why a contract file rather than repeating the resolution in ten places:** the same three symbols
  are needed by the orchestrator, `RESOLVER.md` and eight commands. One definition plus a lint that
  fails on the old spelling is what keeps the next command author from reintroducing it — the same
  shape as the [[decisions/ADR-0008-read-discipline-contract]] guard.

## Planning

- Unblocks the E2 re-test precondition recorded in [[planning/backlog]] (Track E2): a re-run needs
  an orchestrator with #70 fixed, which this delivers. The remaining preconditions — a corpus with
  5–10× the fixed floor, and a design around peak prefix rather than totals — are unchanged.
- Opens [[planning/backlog]] **Track H1** (filter foundation discovery to *enabled* plugins).

---
_Auto-generated by `tools/brain-sync`. Frontmatter is machine-owned; prose below "Summary" is safe to enrich._
