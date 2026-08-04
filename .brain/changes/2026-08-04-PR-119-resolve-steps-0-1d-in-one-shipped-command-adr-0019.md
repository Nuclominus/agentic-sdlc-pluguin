---
pr: 119
date: 2026-08-04
author: Nuclominus
type: feat
plugins: [android-foundation, sdlc]
roadmap: null
files_changed: 28
---

# PR #119 — resolve Steps 0→1d in one shipped command (ADR-0019)

> `feat` · merged 2026-08-04 · by @Nuclominus

## Summary

Implements [ADR-0019](.brain/decisions/ADR-0019-the-run-start-is-one-command.md) — the
resolution half. `SKILL.md` is **not touched in this PR**: the command exists, is tested and is
measured, but the 926 lines of prose it replaces come out separately, so a regression in either
half is attributable.

## Changed areas

- [[components/sdlc]] — eleven new modules under `tools/resolve/`, all dependency-free because the
  plugin ships no `package.json`. `tools/sdlc-lint/lib/detect.mjs` and `lib/load.mjs` become
  re-export shims, ending the double implementation `SKILL.md:234` documented.
- [[components/android-foundation]] — only its `runtime-dependencies.json`, which now declares the
  six superpowers skills its own agents mandate (see *What it corrected*).

## What shipped

One command performing what Steps 0 → 1d described in prose:

```
node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs plan --dry-run
real 0.77
```

**0.77 seconds** for roots, dependency preflight, detection, diff signals, profile merge, project
overrides, model tiers, workflow resolution, skip-rules and the cost cap — against a measured median
of **24 turns / 14 tool calls / $1.31** for the same work as prose.

Two things had to be reimplemented because the plugin can depend on nothing: YAML (the `yaml`
package) and workflow schema validation (`ajv`). That is a second implementation of one contract —
precisely what [[decisions/ADR-0019-the-run-start-is-one-command]] exists to *remove* — so each is
allowed only under a **differential gate** that runs both implementations over the same inputs in CI
and requires agreement. The YAML gate earned its place immediately, catching three defects review
had not, including blank lines counted as continuation progress, which silently turned
`enabled: true` into the string `"true"` in nine files.

## What it corrected

Five defects, none of them the thing being built. Each was found by *running* a step rather than
reading it — which is the whole argument of [[planning/h-instruction-fidelity]]:

1. **`thinking-deeply` never existed.** Declared in `runtime-dependencies.json` since `Initial
   commit`; present in no version of superpowers. Three consecutive runs across both consumer
   projects recorded `deps_preflight: {superpowers: {status: "available", missing_skills: []}}`.
2. **The preflight stamp could not go stale.** Its documented invalidation triggers are
   `/sdlc:doctor`, `--force-preflight` and a `block` abort — *a dependency changing underneath it is
   not one of them*. Six weeks of a green preflight for a dependency that was never fully
   satisfiable. Now keyed to the versions it was computed against.
3. **The dependency declaration was inverted.** `sdlc` declared two skills none of its own agents
   use; `android-foundation`, where all six mandates live, declared an empty array — `brainstorming`,
   the BA phase's core discipline, was claimed by nobody. Split per plugin. *Found by a question
   about the fix, not by the instrument: the tooling narrowed the question far enough that the real
   answer became visible, and did not produce it.*
4. **The cache holds every version ever installed.** A glob returns them all at equal `priority`,
   and the winner is filesystem order. So the command does not glob — `installed_plugins.json`
   carries the exact `installPath`.
5. **Two `[object Object]` defects** — an over-eager aspect map and a parallel member that did not
   fan out. Invisible to the unit fixtures; found by running against a real project, which is why
   `plan.test.mjs` now builds a synthetic consumer on disk instead.

Three corrections to the prose itself, made in code: Step 0c hard-coded `origin/main`, which
**neither consumer project uses**; Step 0's `SDLC_PLUGIN_ROOT` fallback version-sorted a cache full
of stale copies; Step 0a's FS fallback globbed the plugin cache only and was blind to
`{CONFIG_DIR}/skills` and `{PROJECT}/.claude/skills`.

## Decisions & rationale

- **[[decisions/ADR-0019-the-run-start-is-one-command]]** (`proposed`) — implemented here in its
  resolution half. Specification: [[planning/h5-d2-start-resolution-command]].
- The manifest root is a **parameter**, not a constant: `tree` (marketplace checkout — CI, fixtures,
  the dev lint) versus `installed` (the production path). Conflating them is not a theoretical
  mistake; it produced a wrong answer during the ADR's own pre-implementation checks.
- The boundary that cannot be crossed is **reported, not hidden**: `skills_source` says whether the
  skill list came from the harness or the filesystem, and `fs_blind_to` names what a filesystem
  answer cannot account for. An honest partial answer beats a confident wrong one.

## Planning

- _No roadmap item tagged._ Advances **Track H** ([[planning/h-instruction-fidelity]]) via H5's
  Direction 2 — the largest measured lever in the track at ~11.8% of run cost.
- Closes the long-standing *Track H — plugin discovery correctness* item in [[planning/backlog]]:
  `enabledPlugins` is finally consulted, merged across scopes, with **absent ≠ disabled** (measured,
  not assumed — both consumer projects list only three unrelated plugins in project settings while
  `sdlc@agentic-sdlc` appears solely in the user map, so the opposite rule would switch the pipeline
  off entirely).
- **Still open, and it is the number that decides the ADR:** whether the start window falls from 24
  turns to the projected 2–3. That needs real runs on the collapsed prose (#121).

---
_Auto-generated by `tools/brain-sync`. Frontmatter is machine-owned; prose below "Summary" is safe to enrich._
