---
adr: 22
status: accepted
date: 2026-09-20
supersedes: null
---

# ADR-0022 — A path-loaded plugin is its own install

## Context

[[decisions/ADR-0009-plugin-root-resolution]] split every runtime read in two: **self-referential**
reads (`config/**`, `tools/**`) resolve from `SDLC_PLUGIN_ROOT`, **cross-plugin discovery**
(manifests, `workflows/*.yaml`, `runtime-dependencies.json`, `skills/*/SKILL.md`) resolves from the
installed registry. The split is right, and it has a blind spot: a plugin's *own* manifest, recipes
and dependency declaration are self-referential facts that are read through the cross-plugin path,
because they are the same files a consumer discovers in any other plugin.

That costs nothing while the plugin is installed. It costs the whole run when it is not.
`claude --plugin-dir plugins/sdlc`, `claude plugin eval plugins/sdlc` and every development
checkout load the plugin from a directory that is in no cache and in no `installed_plugins.json`,
so discovery finds nothing — including the plugin doing the discovering. The halt (issue #164):

```
🔌 Dependency preflight: no external dependencies declared.
❌ Workflow 'default' not found.
   Available: (none)
```

`default.yaml` sits next to the code printing that line. With `--stack=vanilla` the halt reads
"no installed foundation declares that stack", of a stack that ships in the very plugin reporting
it. The failure is invisible in normal use, which is why it survived: a populated cache masks it
completely. It surfaced only when the `plugins/sdlc/evals/` suite ran the orchestrator through the
eval runner, which loads the plugin under test from its path — all six should-fire cases halted at
Step 0.

Three call sites had to be blind at once for this to happen, and fixing them one at a time would
have left the fourth (skill enumeration) to be found later by the same route.

## Decision

**A plugin loaded from a path is folded into the installs map, and is then discovered like any
other install.**

1. **One signal: `CLAUDE_PLUGIN_ROOT` outside `/plugins/cache/`.** `roots.mjs` exposes
   `pathLoadedRoots(env)`. A root inside the cache is *not* a path load — it is registered, and
   installed discovery already has it with the right key, version and scope.
2. **The module never volunteers its own location.** `ownPluginRoot()` names the same directory
   under a real path load, but it names it under every *other* caller too — a test fixture, a lint
   pass, any tool importing the module out of the checkout — and would announce the checkout as an
   installed plugin to a consumer that never loaded it. A harness that runs this code at all
   exports `CLAUDE_PLUGIN_ROOT`, because the skill's own `Bash` calls interpolate it into the path
   they execute. Absent it, no plugin was loaded to speak for.
3. **Merge into `installs`, not into each consumer.** `mergePathLoaded(installs, roots)` in
   `manifests.mjs` is applied once, in `resolveProfile`. Manifest loading, recipe discovery
   (`workflow.mjs`), dependency aggregation and skill enumeration (`deps.mjs`) all iterate
   `installs` and need no knowledge of path loads at all. One concept, four fixes.
4. **A path load REPLACES the registered copy of the same plugin, keeping its key.** Two roots of
   one plugin would both be read, and two `vanilla` foundations of equal priority make stack
   detection a coin toss decided by iteration order — the same class of nondeterminism ADR-0009
   was written to remove. The tree being edited wins, because it is the code that is running.
   Keeping the *registered key* is what makes the replacement safe: an `enabledPlugins` entry that
   disables the plugin keeps disabling it, and every `declared_by` / `plugin:skill` label stays the
   name it was. The displaced path is reported as a `WARN`, never dropped silently.

## Consequences

- The development loop works without an install: `--plugin-dir`, `plugin eval` and a bare
  `node tools/resolve/cli.mjs` against a checkout all resolve the real plan. This is the
  precondition for the `plugins/sdlc/evals/` suite to measure anything at all.
- Dependency preflight tells the truth under a path load. In a bare checkout it now reports
  `superpowers` as degraded rather than "no external dependencies declared" — a downgrade in
  cheerfulness and an upgrade in accuracy.
- A developer running a checkout of a plugin they also have installed gets the checkout, and is
  told so. That is the intent; the `WARN` exists so it is never a surprise.
- Identity comes from `.claude-plugin/plugin.json`, the same file the harness reads. A root without
  one falls back to its directory name rather than being dropped — a fixture or a partial checkout
  is not a reason to ignore a manifest that is plainly there.
- The blind spot ADR-0009 left in `PLUGIN-PATHS.md` is now stated there rather than implied: the
  running plugin is a member of the discovery set, not only the subject of self-referential reads.

## Related
- Implemented by: #164 fix (this change). Found by: the `plugins/sdlc/evals/` orchestrator suite.
- Relates to: [[decisions/ADR-0009-plugin-root-resolution]] / [[decisions/ADR-0019-the-run-start-is-one-command]] /
  [[components/sdlc]]
