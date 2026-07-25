# Benchmark harness — E2 read-discipline experiment

## Step 0 — freeze the environment

Verified 2026-07-25 (Task 1 of the benchmark-harness plan). This section is the
reproducible, deterministic procedure for isolating and switching the two
comparison arms. It writes no harness code — see later tasks for that.

### Arms

- **Arm A** — `sdlc@1.9.1`, plugin built from `Nuclominus/Agentic-SDLC-Pluguin@develop`.
- **Arm B** — `sdlc@1.10.0`, plugin built from `Nuclominus/Agentic-SDLC-Pluguin@feat/e2-read-discipline`
  (pushed; PR #68 open against `develop`).
- Discriminating fact: `skills/pipeline-orchestrator/SKILL.md` contains a
  "Read discipline:" paragraph in arm B, absent in arm A.

### Step 1 — record current state (informational baseline, not touched)

```bash
cat ~/.claude/plugins/known_marketplaces.json
ls ~/.claude/plugins/cache/agentic-sdlc/sdlc/
git -C ~/.claude/plugins/marketplaces/agentic-sdlc rev-parse HEAD
git -C ~/.claude/plugins/marketplaces/agentic-sdlc rev-parse --abbrev-ref HEAD
```

Observed at verification time: `agentic-sdlc` marketplace with `"autoUpdate": true`,
cache containing `1.9.0/` and `1.9.1/`, clone on `develop` at `9d1af30`. This matches
the plan's prediction exactly. **This live environment under `~/.claude/` is never
modified** by the procedure below — arms live in entirely separate config trees.

### Step 2 — isolation mechanism: `CLAUDE_CONFIG_DIR`

`CLAUDE_CONFIG_DIR` is honoured and is the arm-isolation mechanism (no need to fall
back to per-arm `HOME`). Proof: a plain `claude --version` does not touch it (version
lookup needs no config), but any command that reads/writes plugin or settings state
does. Minimal reproducer:

```bash
mkdir -p /tmp/bench-env-probe
CLAUDE_CONFIG_DIR=/tmp/bench-env-probe claude doctor
ls -a /tmp/bench-env-probe   # -> .claude.json, backups/ appear: dir is populated
```

Everything below points `CLAUDE_CONFIG_DIR` at an arm-specific directory instead of
`~/.claude`, so each arm gets its own `settings.json`, `plugins/known_marketplaces.json`,
`plugins/cache/`, and `plugins/marketplaces/` — fully independent of the user's real
configuration and of each other.

### Step 3 — build the two arm environments

Arm paths used (outside the repo, per the plan's explicit allowance):

- Arm A config dir: `/Users/roman/bench-env/arm-a`
- Arm B config dir: `/Users/roman/bench-env/arm-b`

Create each and add the marketplace **ref-pinned to the exact branch**, with
`autoUpdate` explicitly disabled:

```bash
# Arm A — develop
mkdir -p /Users/roman/bench-env/arm-a
CLAUDE_CONFIG_DIR=/Users/roman/bench-env/arm-a \
  claude plugin marketplace add "Nuclominus/Agentic-SDLC-Pluguin#develop"
CLAUDE_CONFIG_DIR=/Users/roman/bench-env/arm-a \
  claude plugin install sdlc@agentic-sdlc

# Arm B — feat/e2-read-discipline
mkdir -p /Users/roman/bench-env/arm-b
CLAUDE_CONFIG_DIR=/Users/roman/bench-env/arm-b \
  claude plugin marketplace add "Nuclominus/Agentic-SDLC-Pluguin#feat/e2-read-discipline"
CLAUDE_CONFIG_DIR=/Users/roman/bench-env/arm-b \
  claude plugin install sdlc@agentic-sdlc
```

Notes on things that are **not** exposed as CLI flags and had to be handled directly:

- `claude plugin marketplace add` has no `--ref`/`--branch` flag in its `--help`
  output, but the positional `<source>` argument accepts GitHub `owner/repo#branch`
  syntax and pins the clone to that ref (confirmed via `git rev-parse --abbrev-ref
  HEAD` in the resulting clone, and via the `"ref"` field recorded in
  `plugins/known_marketplaces.json`). This is more explicit/robust than relying on
  the repo's default branch (which happens to be `develop` today but isn't
  guaranteed to stay that way).
- `claude plugin marketplace add` has no `--no-auto-update` flag either. `autoUpdate`
  is a `settings.json` key, not a CLI flag: it lives at
  `extraKnownMarketplaces.agentic-sdlc.autoUpdate` (verified against the exact shape
  already present in the user's real `~/.claude/settings.json`, which has
  `autoUpdate: true` there). After running `marketplace add`, hand-edit each arm's
  **own, isolated** `settings.json` (never the user's) to set it to `false`:

  ```jsonc
  // <arm-dir>/settings.json
  {
    "extraKnownMarketplaces": {
      "agentic-sdlc": {
        "source": { "source": "github", "repo": "Nuclominus/Agentic-SDLC-Pluguin", "ref": "develop" },
        "autoUpdate": false
      }
    }
  }
  ```

  (`ref` is `"feat/e2-read-discipline"` in arm B's file.) This key is not mirrored
  into `plugins/known_marketplaces.json` by `marketplace add`/`list`/`doctor` — those
  only ever wrote `source` + `installLocation` + `lastUpdated` in this verification.
  That did not matter for stability: across 6 arm switches (below) with no
  `marketplace update` call and no live network refresh triggered, nothing drifted.
  `settings.json` (not the cache file) is the authoritative declaration.

### Step 4 & 5 — prove the arms differ and are stable

Ground-truth command:

```bash
grep -c "Read discipline:" <arm-dir>/plugins/cache/agentic-sdlc/sdlc/*/skills/pipeline-orchestrator/SKILL.md
```

**Observed counts differ from the plan's prediction** (`0` / `1`): arm B actually
returns **`2`**, not `1`, because `skills/pipeline-orchestrator/SKILL.md` also
contains a `<!-- DRIFT GUARD: the "Read discipline:" paragraph above is asserted by
tools/sdlc-lint/lib/read-discipline.mjs ... -->` comment that quotes the same phrase
literally (added by `tools/sdlc-lint` to keep the paragraph pinned in the stable
prefix). This is real environment drift since the plan was written, not an error in
this procedure — the grep still discriminates correctly (`0` vs. `>0`), it just isn't
exactly `1`. **Downstream tasks (esp. Task 7) should test `grep -c ... | grep -qv
'^0$'` or similar, not an exact-match on `1`.**

Installed versions confirmed via `claude plugin list` under each `CLAUDE_CONFIG_DIR`:
arm A → `sdlc@agentic-sdlc` v`1.9.1`; arm B → v`1.10.0`.

Stability check — switched `a → b → a → b → a → b` (3 full round trips), re-running
the grep and re-checking the marketplace clone's `git rev-parse HEAD` at every step,
with an intervening no-op `claude --version` call in each env between rounds to rule
out incidental state mutation:

| round | arm | grep count | marketplace SHA |
|---|---|---|---|
| 1 | A | 0 | `9d1af30dd2e82937d608445399283bf33f1b0de7` |
| 1 | B | 2 | `5770fb5945adb9f829590883a460ff7275c165f7` |
| 2 | A | 0 | `9d1af30dd2e82937d608445399283bf33f1b0de7` |
| 2 | B | 2 | `5770fb5945adb9f829590883a460ff7275c165f7` |
| 3 | A | 0 | `9d1af30dd2e82937d608445399283bf33f1b0de7` |
| 3 | B | 2 | `5770fb5945adb9f829590883a460ff7275c165f7` |

Perfectly stable — no drift in six switches. `autoUpdate: false` (declared in each
arm's own `settings.json`, see Step 3) held: no marketplace SHA ever moved.

### Result

Arm isolation and deterministic switching are **verified working** via
`CLAUDE_CONFIG_DIR`, with GitHub `owner/repo#branch` ref-pinning for the marketplace
source and a hand-set `autoUpdate: false` in each arm's isolated `settings.json`. The
user's real `~/.claude/` configuration was read-only throughout and was never
modified. The rest of the harness (Task 7 runbook) can build on this procedure
as-is, with one correction: the discriminating grep's expected arm-B count is `2`,
not `1` — check for non-zero, not for an exact literal count of `1`.

## Step 0.5 — power check

Before spending any money, confirm the specimen has enough surface area for the
comparison to be able to detect anything at all:

```bash
node -e "import('./bench/lib/corpus.mjs').then(m=>console.log(m.corpusStats('bench/reference-app')))"
```

**Verify**: the printed object reports `ok: true`. If it does not, stop — do not run
the benchmark. Fix the specimen (or the corpus thresholds) first; a run against an
underpowered specimen cannot answer the question this instrument exists to answer.

Then pre-warm Gradle once, in a throwaway copy, so run 1 does not silently pay for a
distribution/dependency download that no other run pays for:

```bash
cp -r bench/reference-app /tmp/bench-warm && cd /tmp/bench-warm && ./gradlew test && cd - && rm -rf /tmp/bench-warm
```

**Verify**: `./gradlew test` reports `BUILD SUCCESSFUL`. Once this has run, the Gradle
distribution and dependency caches are warm on this machine for every subsequent run.

## A known failure mode: "found N: ..." from `prepare.mjs`

`bench/prepare.mjs` requires the plugin cache under the active `CLAUDE_CONFIG_DIR` to
contain **exactly one** installed `sdlc` version. It refuses to guess which one is the
arm you mean, and dies instead:

```
prepare: expected exactly one installed sdlc version in <cacheDir>, found 2: 1.9.0, 1.9.1
```

**This is correct behaviour, not a bug.** A normal developer `~/.claude` accumulates
several installed versions over time (this machine currently has both `1.9.0` and
`1.9.1` cached) — that is a general-purpose config, not an arm, and `prepare.mjs` is
right to refuse it rather than silently pick one.

If you see this error, it means `prepare.mjs` was launched under the wrong (or no)
`CLAUDE_CONFIG_DIR`. **The fix is to launch under one of the arm-isolated config
directories built in Step 0** (e.g. `CLAUDE_CONFIG_DIR=/Users/roman/bench-env/arm-a`),
each of which holds exactly one pinned version. **Never** "fix" this by deleting
versions from your own real `~/.claude` cache — that is the developer's live
environment, not part of the experiment, and Step 0 is explicit that it must never be
modified.

## The run loop

Every run happens inside a Claude Code session launched under the arm's
`CLAUDE_CONFIG_DIR` (Step 0), from a plain shell with no other overrides:

```bash
node bench/prepare.mjs --arm a --run 1 --gap <seconds>
# launch Claude Code for arm a (per Step 0), cd to the printed scratch dir,
# run the printed /sdlc:start command, answer gates from bench/answers.md
node bench/harvest.mjs --arm a --run 1
```

- `--arm` is `a` or `b` — yours to choose per the run-order schedule below.
- `--run` is the 1-based run number **within that arm** — yours to choose; it must not
  collide with an existing, un-harvested scratch directory (`prepare.mjs` refuses to
  overwrite one).
- `--gap <seconds>` is the inter-run gap chosen once in Step 0 — the same value on
  every single invocation, for both arms, for the whole session (see below).

**Verify** after `prepare.mjs`: it prints `prepared arm <a> run <N>`, a `scratch:` path,
and the exact `/sdlc:start "..."` command to paste. Use that printed command verbatim —
it is built from `bench/task.md` so you never retype the task by hand.

**Verify** after `harvest.mjs`: it exits 0 and reports where it wrote the harvested
result. If it reports a provenance mismatch (recorded vs. live manifest fields
diverge), stop and investigate before trusting that run's numbers — it means the
environment changed between `prepare` and `harvest` (e.g. the wrong arm was launched,
or `CLAUDE_CONFIG_DIR` was not set for that shell).

While the Claude Code session runs, answer every approval gate and clarifying question
with the scripted response from `bench/answers.md`, verbatim. For anything not covered
there, answer with the single word `proceed` and note the deviation in that run's
report — the human answering questions is a variance source too, and the whole point
of scripting is to hold that source constant across every run and every arm.

## Run order

Pilot: `A B A`. After the pilot, interleave: `B A B A ...` up to N per arm. **Never**
run all of one arm followed by all of the other — anything that drifts over time
(machine load, network conditions, cache warmth, your own fatigue) would otherwise
correlate perfectly with arm and contaminate the comparison.

- **After the pilot** (`A B A`, 3 runs total): run `node bench/compare.mjs --pilot` and
  follow its recommendation before spending more money.
- **After N runs per arm**: run `node bench/compare.mjs` for the full comparison.

## The inter-run gap

Chosen once, in Step 0, for the whole session — not re-decided per run. Record the
value you chose and pass the identical `--gap <seconds>` to every `prepare.mjs`
invocation, for both arms, for the entire session. A gap that varies is one more
uncontrolled variable between runs.

## What the output is, and is not

`compare.mjs` reports **medians, ranges, and an engineering verdict** — enough to make
a directional call about whether arm B's read-discipline guidance helped. It is
**not a statistical result**: at the run counts this instrument uses (a handful per
arm), no significance test is reachable, and the report must never be read as if one
were behind it.

The numbers describe a **delta between the two arms of this specific experiment** —
same specimen, same task, same scripted answers, same machine. They are **not
comparable to the 101k-token figure** recorded from the downstream Android
application in `.brain/planning/backlog.md` (Track E baseline) — that figure came from
a real 7-phase production run on a different codebase, measured by a different tool,
for a different purpose. Never present this harness's output as if it validated or
updated that number.
