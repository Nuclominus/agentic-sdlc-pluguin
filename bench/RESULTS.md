# E2 read-discipline benchmark — campaign result

**Date:** 2026-07-26 · **Arms:** A = `sdlc@1.9.1` (no contract) · B = `sdlc@1.10.0` (PR #68 contract)
**Condition:** headless (`claude -p --permission-mode bypassPermissions`), arm-isolated via `CLAUDE_CONFIG_DIR`
**N:** 10 per arm · **Run order:** `A B A B A B A B A B A B A B A B A B A B` (strict alternation)
**Inter-run gap:** 60 s, constant · **Specimen:** `bench/reference-app` (67 Kotlin files, 64,069 tokens, ratio 3.05)
**Total cost:** $7.55 · **Driver:** `bench/run-campaign.sh` · **Raw:** `bench/results-headless/`

## Verbatim `compare.mjs` output

```
arm a  n=10
  cache-read  median 993,935  range 812,137..1,333,334  spread 64.2%
  peak-prefix median 35,873.5  range 30,366..58,184
  turns       median 53
  phases      per-run 5, 5, 5, 5, 7, 5, 5, 5, 5, 5 (a run count mismatch means the difference may be composition, not the thing under test)
arm b  n=10
  cache-read  median 875,481.5  range 697,117..1,084,970  spread 55.6%
  peak-prefix median 32,449  range 27,990..37,191
  turns       median 51.5
  phases      per-run 5, 5, 5, 5, 5, 5, 5, 5, 5, 5 (a run count mismatch means the difference may be composition, not the thing under test)

verdict (engineering judgement, not a statistical test): no measurable effect at this task size: the -11.9% difference is within the observed 64.2% run-to-run spread
E2 DoD (<60k peak prefix): arm b median 32,449, range 27,990..37,191
```

No provenance or run-order warnings were emitted. No run was dropped as flagged.

## Corrected for composition

`a-4` ran a **7-phase Android pipeline** instead of the 5-phase vanilla one — see issue #70 — so it
did strictly more work than every other run and is excluded below. `compare.mjs` reports the
mismatch but does not exclude it; that is a defect in the instrument, recorded in the "known
defects" section.

| metric | arm A (vanilla, n=9) | arm B (n=10) | delta |
|---|---|---|---|
| cache-read median | 979,820 | 875,481.5 | **−10.65%** |
| cache-read spread | 64.2% | 55.6% | — |
| peak-prefix median | 35,822 | 32,449 | −9.4% |
| peak-prefix range | 30,366..58,184 (92%) | 27,990..37,191 (33%) | — |
| turns median | 53 | 51.5 | −2.8% |

## Conclusion

**No measurable effect on total cache-read.** The −10.65% arm difference sits well inside a 64.2%
within-arm spread. The intermediate readings taken as the campaign accumulated were:

```
n=1   −22.7%
n=3   +22.6%
n=4/5  −5.5%
n=5/6  +9.9%
n=6    +6.8%
n=7    −4.0%
n=9/10 −10.65%
```

The sign reversed four times. The magnitude shrank as n grew, which is what a null looks like
under a shrinking standard error — not an effect emerging.

**The one structural asymmetry** is the peak-prefix ceiling: across 10 runs arm B never exceeded
**37,191**, while arm A exceeded it twice (`a-8` 58,184, `a-9` 51,571). Arm B's peak spread is
33% against arm A's 92%. The direction matches what the contract targets — peak prefix, not
totals.

This is **not** evidence. Under a null of exchangeable peaks, the chance that the top two of the
19 vanilla runs both land in arm A is (9/19)·(8/18) ≈ **21%**. One run in five would produce this
pattern by chance. It is worth a follow-up designed around peaks, not a claim.

**E2 DoD (<60k peak prefix) is met by both arms**, including arm A without the contract
(worst case 58,184). On this specimen the threshold does not discriminate, so it cannot serve as
the acceptance criterion it was written to be.

**Recommendation:** do not attach a number to PR #68. The contract is defensible on its own terms —
it costs nothing, and arm B is at worst neutral on every metric measured — but this instrument
cannot show that it works at this task size.

## Known defects found during the campaign

1. **Config-dir leak — issue #70.** The orchestrator globs a hard-coded `~/.claude/plugins/cache/**`
   instead of the active `CLAUDE_CONFIG_DIR`. Observed once in 20 runs (`a-4`), which selected
   `android-foundation` from the operator's real cache and ran a 7-phase pipeline. Also affects
   `models.json` (tiers + pricing), workflow recipes, and skill-path fallbacks.
2. **`compare.mjs` does not exclude composition mismatches.** A run with a different phase count is
   reported in the `phases per-run` line but still enters the median. It should be dropped like a
   flagged run.
3. **`run-campaign.sh` wall-clock counter under-reports.** The poll loop counts `sleep 10`
   iterations, which stall while the machine sleeps; `b-1` counted 840 s against 1817 s of real
   time. Measurement is unaffected (token counts do not depend on wall clock) but the per-run
   timeout is looser than declared. Use `date +%s` deltas instead.
4. **Session limit truncates unattended campaigns.** Runs 8–10 of both arms failed on the first
   pass with `You've hit your session limit`; the driver's skip-if-harvested logic let them be
   resumed after reset with no repeated spend.

## Caveats attached to these numbers

They describe a delta between two arms of this specific experiment — same specimen, same task,
same scripted conditions, same machine. They are **not** a statistical result: at 10 runs per arm
no significance test is reachable. They are **not** comparable to the 101k-token figure in
`.brain/planning/backlog.md`, which came from a 7-phase production run on a different codebase
measured by a different tool.
