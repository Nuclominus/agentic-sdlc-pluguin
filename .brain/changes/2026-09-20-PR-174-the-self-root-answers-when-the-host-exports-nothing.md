---
pr: 174
date: 2026-09-20
author: Nuclominus
type: fix
plugins: [sdlc]
roadmap: null
files_changed: 8
---

# PR #174 — the self root answers when the host exports nothing

> `fix` · merged 2026-09-20 · by @Nuclominus

## Summary

Closes #173. Follow-up to #164 / #166: that fix made a path-loaded plugin a member of the installs
map, but keyed the whole discovery off one environment variable — and `claude plugin eval`, the
harness that found the original bug, loads the plugin and exports nothing. So every should-fire
case of `plugins/sdlc/evals/` still ended at the #164 halt, `Workflow 'default' not found.
Available: (none)`, with the recipe sitting next to the code printing it.

The tree this module is executing from now answers where the environment is silent, as a **last**
resort: `selfPluginRoot()` (null inside `/plugins/cache/` — that copy *is* the install), ranked
below the installed registry in `resolveSdlcRoot` under a new `self` provenance, and offered to
`pathLoadedRoots` by the caller rather than defaulting there. `ownPluginRoot()` moved to
`fileURLToPath`: `new URL(...).pathname` percent-encodes, so a checkout under `~/My Plugins/`
resolved to a directory that does not exist — harmless while the function was an unused escape
hatch, not harmless once it became load-bearing.

## Changed areas

- [[components/sdlc]] — `tools/resolve/{roots,plan}.mjs`; `PLUGIN-PATHS.md` restates the signal and
  its "How to resolve them" bootstrap gains the last resort it lacked (a shell snippet cannot ask
  where it is running from, so the skill's stated **Base directory** minus `/skills/<name>` is the
  rule, written for the reader rather than executed).
- [[architecture/pipeline-orchestrator]] — Step 0 now reads the registry *before* resolving the
  roots, because one question governs both halves of it.

## Decisions & rationale

- Implements [[decisions/ADR-0023-a-silent-host-still-loaded-the-plugin]], which amends decision 2
  of [[decisions/ADR-0022-a-path-loaded-plugin-is-its-own-install]]. ADR-0022 rejected
  `ownPluginRoot()` as a fallback on the premise that "a harness that runs this code at all exports
  `CLAUDE_PLUGIN_ROOT`". The eval sandbox falsifies exactly that premise — it dumps
  `CLAUDE_CONFIG_DIR` and `HOME` and nothing else, while the plugin's skills fire in the same runs.
  The *observation* behind decision 2 survives (the module names the checkout for every caller,
  including fixtures that never loaded the plugin); the conclusion — that it must therefore stay
  silent — did not.
- **Rank, not veto** is what makes the reversal safe. A consumer that installed the plugin keeps
  getting what it installed; the self root speaks only where nobody else can. That is also what
  keeps this repo's own 700-test suite honest: its synthetic worlds register an `sdlc@m`, so the
  module's location never displaces a fixture.
- The review of this PR found the defect that shape fails in — the same failure mode ADR-0022's
  own review found three times. The gate was `sources.sdlc_plugin_root === "self"`, but the registry
  branch behind it additionally requires `config/models.json` at the registered `installPath`. Two
  questions, two answers: a **partial** install kept its entry for cross-plugin discovery while the
  self root took over the self-referential reads, so a run priced itself from the install and
  executed the checkout's recipe. `registryListsSdlc(installs)` now asks the only question allowed
  to govern both halves — does the registry list this plugin at all — and a registry entry that
  cannot be read is a broken install, `/sdlc:doctor`'s problem, never a licence to substitute a tree
  nobody pointed at.
- Also raised in review and *declined*, recorded so it is not rediscovered as an oversight: dropping
  the cache guard so a cache-resident module with a corrupt `installed_plugins.json` could speak for
  itself. That contradicts acceptance criterion #2 of #173 verbatim, and a corrupt registry beside a
  cached install is a different failure.

## Planning

- Unblocks the `plugins/sdlc/evals/` orchestrator suite for real: #166 fixed the hosts that export
  `CLAUDE_PLUGIN_ROOT`, and the eval runner is not one of them. Acceptance item 3 of #173 —
  `claude plugin eval plugins/sdlc` with cases `01-slash-default`, `03-hotfix-recipe` and
  `06-forced-cyrillic` passing their `values` grader — is **still unrun**: it is billed, and the
  suite lives on `evals/sdlc-dry-run` rather than on `develop`.
- Verified instead, deterministically: the issue's `env -u CLAUDE_PLUGIN_ROOT` repro prints the full
  six-phase `default` preview (`~$4.38`, `Cap: $16.00 → WITHIN`), and a copy of the tree placed in a
  fake cache with a matching registry produces zero path-load warnings. 708 lint tests pass, 11 new.
- The residue of a review finding that did not become a code change: the shipped Step 0 line is
  `node "${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs"`, and under a silent host it only works
  because the skill prompt names the skill's base directory. The recorded trace
  (`evals/results/2026-09-20T08-42-11-205Z`, case `01-slash-default`) shows the model substituting
  the absolute path and reaching the resolver. Worth a hardened bootstrap eventually; documented in
  `PLUGIN-PATHS.md` for now.

---
_Auto-generated by `tools/brain-sync`. Frontmatter is machine-owned; prose below "Summary" is safe to enrich._
