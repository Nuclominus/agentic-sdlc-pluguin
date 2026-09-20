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
   **Amended by [[decisions/ADR-0023-a-silent-host-still-loaded-the-plugin]]** — the premise is
   false: `claude plugin eval` loads the plugin and exports nothing. The module may now name its
   own tree, but only as a LAST resort, ranked below the installed registry (issue #173).
3. **Merge into `installs`, not into each consumer.** `mergePathLoaded(installs, roots)` in
   `manifests.mjs` is applied once, in `resolveProfile`. Manifest loading, recipe discovery
   (`workflow.mjs`), dependency aggregation and skill enumeration (`deps.mjs`) all iterate
   `installs` and need no knowledge of path loads at all. One concept, four fixes.
4. **A path load REPLACES every registered copy of the same plugin, keeping the first one's key.**
   Two roots of one plugin would both be read, and two `vanilla` foundations of equal priority make
   stack detection a coin toss decided by iteration order — the same class of nondeterminism
   ADR-0009 was written to remove. *Every* copy, not just the first: one plugin installed from two
   marketplaces is two keys, and replacing one while the other still points at its own tree
   reproduces the tie. Keeping the first one's *registered key* is what makes the replacement safe:
   every `declared_by` / `plugin:skill` label stays the name it was, and a version the checkout does
   not declare stays the version the registry knew. Displaced paths are reported as `WARN`s, never
   dropped silently.
5. **Identity for replacement must be DECLARED, never guessed.** A root's name comes from
   `.claude-plugin/plugin.json`. A root without one still resolves — as a plugin of its own, under
   `<dirname>@path`, never as a replacement for somebody else's entry. The directory-name fallback
   would otherwise let a checkout in a directory called `superpowers` take over `superpowers@obra`,
   and the dependency preflight would look for that plugin's skills in the wrong tree and report
   them missing.
6. **A path load is enabled by the act of being loaded.** `enabledPlugins` governs the *registered*
   install, and the replacement inherits the registered key — so a `false` there followed the key
   onto the checkout and vetoed it. Disabling the installed copy before running the checkout with
   `--plugin-dir` is the natural setup, so this is not a corner case: it restored the exact halt
   this ADR exists to remove. The harness was pointed at the directory explicitly; nothing in a
   settings file outranks that. `withPathLoadedEnabled` states the rule once, because **four**
   consumers apply the veto — and fixing only the manifest layer left recipes and the dependency
   declaration still vetoed, which halts the run just as dead.

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
  is not a reason to ignore a manifest that is plainly there — but that guessed name can only name
  a NEW entry, never claim an existing one.
- **There is no longer a way to disable a path-loaded plugin from settings.** Unloading it means
  not pointing the harness at it. That is the correct trade — the alternative is a flag that
  silently restores the original bug — but it is a real loss of a knob, stated here so the next
  person does not rediscover it as a surprise.
- Decisions 4, 5 and 6 all came out of the review of the implementing PR rather than the design.
  Each is a case where the first implementation did the locally reasonable thing (`find` the match,
  trust the directory name, honour the veto) and broke the property the ADR was written to
  establish. Worth remembering as the shape this class of fix fails in.
- The blind spot ADR-0009 left in `PLUGIN-PATHS.md` is now stated there rather than implied: the
  running plugin is a member of the discovery set, not only the subject of self-referential reads.

## Related
- Implemented by: #164 fix (this change). Found by: the `plugins/sdlc/evals/` orchestrator suite.
- Amended by: [[decisions/ADR-0023-a-silent-host-still-loaded-the-plugin]] (decision 2)
- Relates to: [[decisions/ADR-0009-plugin-root-resolution]] / [[decisions/ADR-0019-the-run-start-is-one-command]] /
  [[components/sdlc]]
