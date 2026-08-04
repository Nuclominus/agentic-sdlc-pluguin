---
status: planned
---

# H5 D2 — the run start is one command

> Implementation spec for [[decisions/ADR-0019-the-run-start-is-one-command]], which is Direction 2
> of [[planning/h5-prompt-surface]]. Goal: replace the 926 judgement-free lines of `SKILL.md`
> Steps 0 → 1d, and the ~34 orchestrator turns they cost, with one shipped command.
> See [[planning/_moc-planning]].

## What is being replaced

| step | `SKILL.md` lines | what it does | deterministic? |
|---|---|---|---|
| 0 | 52–79 | resolve plugin roots (`CONFIG_DIR`, `PLUGIN_CACHE_ROOT`, `SDLC_PLUGIN_ROOT`) | yes |
| 0a | 80–232 | dependency preflight: skill enumeration, per-dep status, policy enforcement, cache stamp | yes, **except** the two boundaries below |
| 0b | 233–400 | foundation + framework detection, per-aspect winner, profile merge | yes — and already coded in `detect.mjs` |
| 0c | 401–473 | skip-rule analysis from `git diff --numstat` | yes |
| 1 | 474–709 | parse profiles, `sdlc.local.yaml` overrides, `model.local.json` tiers, workflow resolution | yes |
| 1d | 710–988 | cost-cap resolution, `--dry-run` plan preview | yes |

**926 lines, 36.5% of the file, ~14.1k tokens.** Measured cost of the model executing them:
median **24 turns / 14 tool calls / $1.31 = 11.8% of run cost** (range 8.5–17.2%) on the nine runs
carrying `plugin_version`. That is the *collapsible* part only; the full start window is 34 turns /
$2.05 / 17.0%, and the difference is Step 2's workspace creation, which stays.

## Verified before implementation (2026-08-04)

Four checks run against the real corpora, no code written and nothing committed.

**1. The window really is resolution.** Every tool call in the newest run's start window
(`implement-cit-491`, 35 turns, 22 calls), classified:

| turns | calls | what | verdict |
|---|---|---|---|
| t3–t28 | **18** | plugin roots · deps cache + headless probe · manifest glob · `aspects.yaml` · 2 foundation manifests · detect signals · 4 framework manifests · dependency grep · `sdlc.local.yaml` · `model.local.json` · `sdlc-lessons.md` · 2 × `git diff`/`rev-parse` · workflow glob · 3 × workflow recipe reads | **collapsible** |
| t1 | 1 | `Skill(sdlc:pipeline-orchestrator)` | stays |
| t31–t33 | 3 | `mkdir .checkpoint` + `_started_at`, `Write _brief.md`, `Write _run.json` | stays (Step 2) |
| t35 | — | `Task(android-foundation:android-ba)` | first dispatch |

Not one of the 18 requires judgement. Every one is a read of a file or a `git` fact.

**2. The split, over the whole cohort.** Boundary = the first `Bash` writing
`.checkpoint/_started_at`:

| | Steps 0 → 1d | Step 2 |
|---|---|---|
| turns | median **24** (16–36) | median 7 |
| calls | median **14** (9–20) | median 4 |
| cost | median **$1.31** | median $0.45 |
| % of run | median **11.8%** (8.5–17.2%) | ~4% |

**This corrected the ADR's headline number from ~17% to ~11.8%**, and its turn projection from
"34 → 4–6" to "24 collapsible turns → 2–3, whole window ~10". The first draft priced the entire
window as if all of it collapsed.

**3. The same procedure costs 16–36 turns.** Nine runs, most on one project, executing one
deterministic procedure with a **2.2× spread** (9–20 tool calls). This is the determinism argument
with evidence, and it is independent of cost: a function of files on disk should not vary at all.

**4. The existing implementation is viable as the canonical one.** `sdlc-lint detect` passes
**5/5 fixtures**, and `resolveStack()` on both real projects returns `foundation: android,
priority: 300` with `additive: [dagger, retrofit, room, workmanager]` for Citrus — **exactly** what
`_telemetry.json` records for `implement-cit-491`, `s8-teardown` and `s5-presence`.

For parlor it additionally returns `datastore-proto`, which no real run resolved. **This is not a
prose defect — it is a source-of-manifests defect in the check itself.** `loadManifests()` globs
`plugins/**/manifest.yaml` from the *marketplace working tree*, which contains
`datastore-proto-plugin`; the consumer's cache does not have it installed. The prose was right. See
*Open questions* for the two constraints this imposes.

## Shape

```
node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs plan \
  [--stack <name>] [--workflow <name>] [--dry-run] [--skills <csv>] [--json]
```

One invocation, `once-per-run`, exit `0` on success. Paths resolve against the **consumer's**
project cwd; only the script itself is loaded from the plugin root — the same convention
`plugins/sdlc/tools/run/cli.mjs` already follows.

### Output contract

Two channels, deliberately separated so the orchestrator never composes a value:

1. **`stdout` (with `--json`): the resolved plan.** A single JSON object. Everything Step 2 and
   Step 3 need, and everything Step 5 records:

   ```
   {
     roots:        { config_dir, plugin_cache_root, sdlc_plugin_root },
     deps_preflight: { <plugin>: { status, missing_skills, policy, install_command, fallback_note } },
     skills_source: "mcp" | "fs-glob",
     stack:        { primary_profile, active_profiles[], additive_profiles[], profile_source, priority },
     skip_rules:   { applied[], signals: { added_loc, deleted_loc, files_changed } },
     workflow:     { name, source, resolved_phases[] },
     models:       { <agent>: <tier> },
     cost_cap:     { value, source },
     prints:       [ "…", "…" ],
     halt:         null | { code, message }
   }
   ```

2. **`prints[]`: the verbatim blocks, pre-composed.** Every `🚨 MUST PRINT VERBATIM` block the
   replaced steps owe the user — the dependency-preflight block, the active-profiles contract print,
   the workflow auto-selection line, the cost-cap override line — arrives as a finished string. The
   orchestrator echoes the array in order. It never fills a placeholder, which is
   [[decisions/ADR-0015-the-machine-value-invariant]] applied to prose rather than to arithmetic.

### `HALT` becomes a non-zero exit

Aspect ties, unknown/ambiguous workflow, invalid recipe, schema failures: exit non-zero, message on
`stderr`, verbatim from the wording `SKILL.md` and `RESOLVER.md` specify today. A `block`-policy
dependency abort is a non-zero exit carrying the machine-readable JSON that `0a-4` already defines
for headless mode.

### `--dry-run`

Prints the resolved-plan preview and exits `0` without creating a workspace. Today this is prose
telling the model to compose a preview from values it just resolved; afterwards the process that
holds those values prints it.

## The two boundaries, and why they cost no turns

A node process cannot do everything the model can. Both exceptions are real, both are narrow.

**`mcp__skills__list_skills` — harness state, not disk state.** Which skills are *loaded* is known
to the harness, not to the filesystem. The command runs the FS-glob fallback that `0a-2` already
documents and reports `skills_source: "fs-glob"`. When the orchestrator holds the authoritative
list, it may pass `--skills <csv>` in the same invocation. This is the permitted direction of
[[decisions/ADR-0015-the-machine-value-invariant]]: the model supplies state no machine on disk can
observe; it never supplies a value a machine already holds.

**`mcp__plugins__suggest_plugin_install` — a tool call.** Fires only on a `block`-policy abort. The
command emits the payload and exits non-zero; the orchestrator makes at most one further call, on a
path that terminates the run. It cannot affect the median.

Neither boundary adds a turn to a successful run.

## Code layout

```
plugins/sdlc/tools/resolve/
  cli.mjs        # the only unit that prints; arg parsing, exit codes
  roots.mjs      # Step 0
  deps.mjs       # Step 0a (fs-glob enumeration, status, policy, cache stamp)
  detect.mjs     # Step 0b — the CANONICAL detection/attachment implementation
  skiprules.mjs  # Step 0c
  profile.mjs    # Step 1 (profile merge, sdlc.local.yaml, model.local.json, workflow resolution)
  caps.mjs       # Step 1d
  plan.mjs       # composes the JSON + prints[]; no I/O of its own
```

`tools/sdlc-lint/lib/detect.mjs` becomes a re-export shim over
`plugins/sdlc/tools/resolve/detect.mjs`, following the template `lib/resume.mjs` already sets over
`plugins/sdlc/tools/run/reentry.mjs`. The existing `detect` fixtures keep passing unchanged — that
is the migration's own regression test, and if they need editing, the port is wrong.

**Dependency-free**, like `tools/run/`. `detect.mjs` currently imports `tinyglobby`; the shipped copy
must drop it for `node:fs` walking, or the plugin acquires a runtime dependency it has never had.

## What `SKILL.md` keeps

Steps 0 → 1d collapse to roughly 30 lines:

1. The invocation, inside a `sdlc-contract` block so H1 can measure it
   (`id: 0-resolve`, `requires: bash_match`, `cardinality: once-per-run`).
2. Echo `prints[]` in order.
3. Carry the JSON into `CONTEXT`.
4. On non-zero exit: print `stderr` and stop. Do not improvise a resolution.
5. The two boundary notes (`--skills`, the install-suggestion call).

Point 4 is the whole degraded path, and it is deliberately not a fallback procedure. Keeping the 926
lines as a shadow copy "just in case" would forfeit the entire saving and reintroduce the drift the
shim exists to prevent.

## What this must NOT do

- **Do not move the 926 lines to a just-in-time fragment.** A fragment the orchestrator must read
  mid-run is a new skippable step; that shape measures 40–67%. Delete, do not relocate.
- **Do not touch the per-phase base prompts** (196 lines, 4.9% of the prefix). Moving them converts
  ~$0.04/run into a once-per-phase read — the worst-measured shape in the corpus.
- **Do not touch `=== STABLE PREFIX ===`** ([[decisions/ADR-0008-read-discipline-contract]]).
- **Do not claim this closes the H4 gate.** Separate lever; see the ADR's *Explicit limits*.

## Definition of Done

1. `node ${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs plan --json` reproduces, on at least three
   fixture projects, the same `primary_profile` / `active_profiles` / `additive_profiles` /
   `resolved_phases` / `cost_cap` that the prose procedure produces today.
2. The existing `sdlc-lint detect` fixtures pass through the shim **unmodified**.
3. `SKILL.md` loses ~926 lines; the remaining start procedure is one contract-carrying invocation.
4. `node --test` green in `tools/sdlc-lint/` and for the new module.
5. **The start window re-measured on ≥3 real runs**, split at the `_started_at` boundary so the
   collapsible part is priced on its own: expected **2–3 turns** for Steps 0 → 1d against the
   current median of 24, and ~10 for the whole window against the current 34. Method and script:
   [[planning/h5-prompt-surface]] Measurement 1 plus the split above. This is the DoD that decides
   whether the ADR's estimate held — publish the number even if it is bad, as the pre-implementation
   check already did once.
6. `sdlc-lint compliance` shows the new `0-resolve` contract with a real denominator, and no
   pre-existing rate falls.

## Open questions

- **The manifest root must be a parameter** (from check 4). The shipped command resolves from
  `PLUGIN_CACHE_ROOT`; the dev/CI shim resolves from the marketplace working tree. `loadManifests()`
  hard-codes `plugins/**/manifest.yaml` relative to a root and must gain a cache-shaped mode, or the
  shim and the shipped code will disagree on production input while every fixture passes.
- **Enabled vs. merely cached** is now on the critical path. Globbing the cache reaches every plugin
  ever installed under that config dir; `enabledPlugins` is never consulted. This is the open
  *Track H — plugin discovery correctness* item in [[planning/backlog]]. The prose has the same
  defect, so this is not a regression — but it is the obvious place to close it.
- **`datastore-proto` declares `dependency: androidx.datastore`**, which also matches
  `androidx.datastore:datastore-preferences` — a preferences-only project (parlor is one) would
  falsely attach the proto framework the moment that plugin is installed. Latent today because the
  plugin is not in the cache. Verify the coordinate's intent before the command makes attachment
  deterministic and therefore reliably wrong.
- **Does the cache stamp survive?** `0a` has a fast-path cache with its own invalidation rules. A
  single-process resolution may be fast enough that the cache is dead weight — measure before
  porting it.
- **Where does `--stack` disambiguation live** when an aspect tie halts? Today the user re-runs with
  a flag; that stays, but the error text must name the exact flag and the tied stacks.
- **Should `0-resolve` carry `applies_when`** to stay `na` on `--resume` runs, which re-enter at
  Step 2 and legitimately never resolve? Probably yes, or resume runs will read as misses.

## Related

- The decision: [[decisions/ADR-0019-the-run-start-is-one-command]]
- The measurement that sized it: [[planning/h5-prompt-surface]]
- The same collapse at the other end: [[decisions/ADR-0014-the-run-tail-is-one-command]]
- The instrument that must not regress: [[planning/h1-compliance-auditor]]
- Parent track: [[planning/h-instruction-fidelity]]
- Subject of the change: [[architecture/pipeline-orchestrator]] / [[components/sdlc]]
