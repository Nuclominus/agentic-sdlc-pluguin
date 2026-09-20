---
adr: 23
status: accepted
date: 2026-09-20
supersedes: null
---

# ADR-0023 — A silent host still loaded the plugin

## Context

[[decisions/ADR-0022-a-path-loaded-plugin-is-its-own-install]] made a plugin loaded from a path a
member of the installs map, so that its own manifest, recipes, dependency declaration and skills
are discovered like any other install. Its decision 2 fixed the signal:

> **The module never volunteers its own location.** […] A harness that runs this code at all
> exports `CLAUDE_PLUGIN_ROOT`, because the skill's own `Bash` calls interpolate it into the path
> they execute. Absent it, no plugin was loaded to speak for.

That premise is false, and the counter-example is the very harness the ADR was written for.
Inside a `claude plugin eval` sandbox, a case granted `Bash(env:*)` prints:

```
CLAUDE_CONFIG_DIR=/private/tmp/e-XEfMQF/config
HOME=/private/tmp/e-XEfMQF/home
```

`CLAUDE_PLUGIN_ROOT` is unset while the plugin is plainly loaded — its skills fire in the same
runs. So every should-fire case of `plugins/sdlc/evals/` still ended at the #164 halt:

```
❌ Workflow 'default' not found.
   Available: (none)
```

A fix that keys the whole path-load discovery off one environment variable fixes the hosts that
export it and leaves the eval suite — the thing that found the bug — measuring nothing (issue
#173). Reproducible without the runner:

```bash
env -u CLAUDE_PLUGIN_ROOT HOME="$FAKE" CLAUDE_CONFIG_DIR="$FAKE/.claude" \
  node plugins/sdlc/tools/resolve/cli.mjs plan '"Add dark mode" --dry-run'
```

The concern behind decision 2 is real and survives this ADR: `ownPluginRoot()` names the checkout
for *every* caller, including a test fixture or a lint pass that imported the module without any
host loading the plugin. What was wrong was the conclusion — that the module must therefore stay
silent — rather than the observation.

## Decision

**The tree this module is executing from answers where the environment is silent, as a LAST
resort — never over a copy the consumer has of its own.**

1. **Rank, not veto.** `resolveSdlcRoot` order becomes: `CLAUDE_PLUGIN_ROOT` → the installed
   registry → **the self root** → the newest cached version. A consumer that installed the plugin
   keeps getting exactly what it installed, whatever checkout happens to be running the code; the
   self root speaks only where nobody else can. This is what keeps the repo's own 700-test suite
   honest: its synthetic worlds register an `sdlc@m` of their own, so the module's location never
   displaces the fixture.
   The gate is `registryListsSdlc(installs)` — **does the registry list this plugin at all**, not
   the stricter question `resolveSdlcRoot` asks of an entry (does its `installPath` carry
   `config/models.json`). Asking the two differently is a defect, not a nuance: a partial install
   then kept its entry for cross-plugin discovery while the self root took over the
   self-referential reads, so one run priced itself from the install and executed the checkout's
   recipe. A registry entry that cannot be read is a broken install — `/sdlc:doctor`'s problem,
   never a licence to substitute a tree the consumer never pointed at. (Found in review of the
   implementing PR, like decisions 4–6 of ADR-0022 before it.)
2. **A module running from `/plugins/cache/` has no self root.** `selfPluginRoot()` returns `null`
   there. That copy IS the install — offering it a second time as a path load is how one plugin
   becomes two `vanilla` foundations of equal priority, the nondeterminism ADR-0009 exists to
   remove.
3. **One tree for both halves.** `pathLoadedRoots(env, self)` takes the self root as an *offer*
   from the caller rather than defaulting to it, and `resolveProfile` makes that offer only when
   Step 0 already resolved `SDLC_PLUGIN_ROOT` from the same location
   (`sources.sdlc_plugin_root === "self"`). Self-referential reads (`config/**`, `tools/**`) and
   cross-plugin discovery can therefore never end up pointed at two different trees — the failure
   mode a plain fallback inside `pathLoadedRoots` would have introduced, pricing a run from the
   installed `config/models.json` while running the checkout's recipe.
4. **Provenance names it.** The new source is `self`, reported like every other root source, so a
   plan can say the answer came from the module's own location rather than from anything the
   consumer declared.

`ownPluginRoot()` also stops going through `new URL(...).pathname`, which hands back a
percent-encoded path: a checkout under `~/My Plugins/` resolved to a directory that does not
exist. Harmless while the function was an unused escape hatch; not harmless now that it is
load-bearing.

## Consequences

- `claude plugin eval plugins/sdlc` resolves the real plan, so the evals suite measures the
  orchestrator instead of eight identical Step 0 halts. The same holds for a bare
  `node tools/resolve/cli.mjs` against a checkout with no install anywhere.
- The escape hatch is no longer reachable by accident from a *consumer* machine: with the plugin
  installed, the registry answers first and the self root is never consulted.
- A developer with no install who runs a tool that merely imports these modules now has the
  checkout announced as a path-loaded plugin. That is the trade decision 2 refused; it is
  acceptable because the answer is *true* (this tree is the plugin that is running) and because
  ranking it below the registry bounds it to the case where there is no other answer at all.
- Decision 2 of ADR-0022 is amended, not withdrawn: the module still never *outranks* a declared
  install. Only the "stay silent" half is gone.
- The shell bootstrap in `PLUGIN-PATHS.md` ("How to resolve them") knows only
  `CLAUDE_PLUGIN_ROOT` → newest cache, so under a silent host it still resolves
  `SDLC_PLUGIN_ROOT` to the empty string. A shell snippet has no `import.meta.url`, but the skill
  running it is always told its own base directory, so the last resort there is that path with
  `/skills/<name>` trimmed — the same rule, stated for the reader rather than executed.
- The premise that made decision 2 look safe — "a harness that runs this code exports
  `CLAUDE_PLUGIN_ROOT`" — was never tested against a harness that does not. Worth remembering as
  the shape this class of assumption fails in: the environment is evidence when present, and
  nothing at all when absent.

## Related
- Implemented by: #173 fix. Follows: #164 / #166 (ADR-0022). Found by: the `plugins/sdlc/evals/`
  orchestrator suite, run under `claude plugin eval`.
- Relates to: [[decisions/ADR-0022-a-path-loaded-plugin-is-its-own-install]] /
  [[decisions/ADR-0009-plugin-root-resolution]] / [[components/sdlc]]
