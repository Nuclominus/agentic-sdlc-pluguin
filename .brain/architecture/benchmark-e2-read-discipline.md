---
source: bench/RESULTS.md
---

# Benchmark — E2 read-discipline campaign (2026-07-26)

> The first full application of the `bench/` instrument. Result: **the effect could not be
> measured.** The campaign's lasting value is the noise floor it established and the two defects it
> exposed, not the delta it was built to find. Decision it validates (negatively):
> [[decisions/ADR-0008-read-discipline-contract]].

## What was asked

Does the read-discipline contract added in #68 reduce prompt-cache cost? Arm A = `sdlc@1.9.1`
(no contract), arm B = `sdlc@1.10.0` (contract in the orchestrator's stable prefix).

## How it was run

| | |
|---|---|
| Runs | 20 — 10 per arm |
| Order | `A B A B A B A B A B A B A B A B A B A B` (strict alternation) |
| Mode | headless, `claude -p --permission-mode bypassPermissions` |
| Isolation | per-arm `CLAUDE_CONFIG_DIR` (`/Users/roman/bench-env/arm-{a,b}`), marketplace ref-pinned, `autoUpdate: false` |
| Specimen | `bench/reference-app` — 67 Kotlin files, 256,273 chars, 64,069 tokens, corpus ratio 3.05 |
| Task | `bench/task.md` (hashed into every run manifest) |
| Gap | 60 s between runs, constant |
| Concurrency | none — sequential, because concurrent runs share a server-side prompt cache and would warm each other's prefix |
| Cost | $7.55 total, ≈$0.38/run |
| Driver | `bench/run-campaign.sh` · Raw: `bench/results-headless/` · Record: `bench/RESULTS.md` |

Strict alternation is what keeps anything that drifts over hours — machine load, cache warmth,
network — from correlating with arm. `compare.mjs` verifies it and warns if broken; it did not warn.

## Result — no measurable effect

Corrected for composition (`a-4` excluded, see *Defects* below):

| metric | arm A (n=9) | arm B (n=10) | delta |
|---|---|---|---|
| cache-read median | 979,820 | 875,481.5 | **−10.65%** |
| cache-read spread | 64.2% | 55.6% | — |
| peak-prefix median | 35,822 | 32,449 | −9.4% |
| peak-prefix range | 30,366..58,184 (92%) | 27,990..37,191 (33%) | — |
| turns median | 53 | 51.5 | −2.8% |

The −10.65% sits well inside a 64.2% within-arm spread. Read as runs accumulated:

```
n=1     −22.7%      n=5/6   +9.9%
n=3     +22.6%      n=6     +6.8%
n=4/5    −5.5%      n=7     −4.0%
                    n=9/10 −10.65%
```

The sign reversed four times and the magnitude shrank as the standard error shrank. That is the
shape of a null, not of an effect emerging. **The 3-run pilot had already said STOP at 42% spread;
the 20-run campaign confirmed the pilot rather than overturning it.**

### The one asymmetry — a hypothesis, not a finding

Arm B's peak prefix never exceeded **37,191** across 10 runs; arm A exceeded it twice (`a-8` 58,184,
`a-9` 51,571). Arm B's peak spread was 33% against arm A's 92%. The direction matches what the
contract targets — the *ceiling*, not the middle.

Under a null of exchangeable peaks, the chance that the top two of the 19 vanilla runs both land in
arm A is (9/19)·(8/18) ≈ **21%**. One experiment in five produces this by chance. Filed as the
design brief for a follow-up, not as evidence.

### A structure that appeared and then dissolved

At n=7, arm B looked bimodal — three runs at 46–47 turns / ~700–760k and four at 53–61 turns /
~1.0–1.08M, with nothing between. `b-8` then landed at 50 turns / 818,408, in the gap. The clean
separation was an artefact of seven draws from a skewed distribution. Recorded because the
intermediate reading was wrong in an instructive way: **structure seen at small n is the default
failure mode of this instrument, not an exception to it.**

## The noise floor — the most reusable output

Within-arm run-to-run spread on total cache-read, **identical arm, identical task, identical
specimen, identical machine**, was **55.6%–64.2%**. Peak prefix varied 33%–92%. Turn counts ran
46–64 on the same 5-phase pipeline.

Consequences for every future Track E experiment:

- **A single run proves nothing.** Two runs of the same configuration routinely differ by more than
  any optimisation we are likely to ship.
- **Any claim of an improvement below ~50% is unverifiable by this instrument at n≈10.** Before
  designing an experiment, ask whether the expected effect can clear that bar. If not, do not spend
  the money — or change what is measured.
- **`compare.mjs`'s `recommendN` thresholds are miscalibrated.** They map <10% spread → N=3,
  <25% → N=4, ≥25% → STOP. Reality was 2.5× the STOP threshold. The advice to stop was right; the
  ladder below it is fiction at these magnitudes.
- **Medians, not means; and report the spread beside every median.** A number that outlives its
  spread becomes folklore.

## Defects the campaign exposed

1. **Config-dir leak — issue #70 (the highest-value output of the whole campaign).**
   `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md:207` globs a hard-coded
   `~/.claude/plugins/cache/**` instead of honouring `CLAUDE_CONFIG_DIR`, so stack detection reads
   the operator's real plugin tree. One run in 20 (`a-4`) discovered `android-foundation` there and
   ran a **7-phase Android pipeline** — `android-ba → android-developer → android-reviewer →
   android-security → android-tester → android-qa → android-docs` — inside an arm where only
   `sdlc` was enabled. 27 occurrences across 10 files; the same hard-coded path also resolves
   `models.json` (tiers **and pricing**), workflow recipes, and skill-path fallbacks. Discovery also
   never consults `enabledPlugins`, which is why a disabled plugin can win foundation selection at
   all. See [[architecture/pipeline-orchestrator]].
2. **`compare.mjs` counts composition mismatches into the median.** A run with a different phase
   count is reported in the `phases per-run` line but still enters the statistics. It should be
   dropped like a flagged run. `a-4` had to be excluded by hand.
3. **`run-campaign.sh` wall-clock counter stalls.** The poll loop counts `sleep 10` iterations,
   which freeze while the machine sleeps; `b-1` counted 840 s against 1,817 s of real time. Token
   counts are unaffected, but the per-run timeout is looser than declared. Use `date +%s` deltas.
4. **The account session limit truncates unattended campaigns.** Runs 8–10 of both arms failed on
   the first pass (`You've hit your session limit`). The driver's skip-if-harvested logic let the
   campaign resume after reset with no repeated spend — that property is what saved $3 and three
   hours, and every future driver should have it.

## What the numbers are not

They describe a delta between two arms of one experiment — same specimen, same task, same scripted
conditions, same machine. They are **not** a statistical result: at 10 runs per arm no significance
test is reachable. They are **not** comparable to the 101k-peak / 6.65M-cache-read figure in
[[planning/backlog]], which came from a 7-phase production run on a different codebase measured by
a different tool for a different purpose.

## Design brief for the next attempt

- Corpus with addressable surface **5–10× the fixed floor**, not 3×. This specimen gave read
  discipline the least room to act on; a null here does not transfer to a 500k-token codebase.
- Measure **peak prefix**, not totals — that is where the only structure appeared, and it is what
  the contract actually targets.
- Fix issue #70 first, or arm isolation is not isolation. **Done** —
  [[decisions/ADR-0009-plugin-root-resolution]]; the numbers above predate the fix and are not
  comparable to anything measured after it.
- Budget for the noise floor above when choosing N, instead of trusting `recommendN`.

## Related
- Validates (negatively): [[decisions/ADR-0008-read-discipline-contract]]
- Instrument: [[planning/backlog]] (Track E — benchmark harness)
- Touches: [[architecture/pipeline-orchestrator]] / [[components/sdlc]]
- Visual twin: `bench/report/e2.html` (#75) — bilingual chart report rebuilt from the raw runs,
  assertion-checked against `bench/RESULTS.md` at build time
