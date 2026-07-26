#!/usr/bin/env bash
# Drive the full headless benchmark campaign: N runs per arm, strictly
# alternating (a b a b ...), strictly sequential.
#
# Sequential is not a convenience — concurrent runs share a server-side prompt
# cache, so two runs in flight would warm each other's prefix and confound the
# very metric this harness measures.
#
# Resumable: a run whose result JSON already exists is skipped, so the script
# can be re-launched after an interruption without repeating paid work.
set -uo pipefail

REPO="/Users/roman/Developer/Agentic-SDLC-Pluguin"
N="${N:-10}"                              # runs per arm
GAP="${GAP:-60}"                          # inter-run gap, seconds — constant for the whole campaign
RUN_TIMEOUT="${RUN_TIMEOUT:-3600}"        # per-run wall-clock cap, seconds
export BENCH_SCRATCH_ROOT="${BENCH_SCRATCH_ROOT:-/Users/roman/bench-scratch-headless}"

RESULTS="$REPO/bench/results-headless"    # separate dir: never pool with the interactive pilot
ARCHIVE="$REPO/bench/archive-headless"
LOG="$REPO/bench/campaign.log"
TASK="$REPO/bench/task.md"

mkdir -p "$RESULTS" "$ARCHIVE" "$BENCH_SCRATCH_ROOT"

say() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }

TASK_TEXT="$(cat "$TASK")"

say "campaign start: N=$N per arm, gap=${GAP}s, per-run timeout=${RUN_TIMEOUT}s"
say "scratch=$BENCH_SCRATCH_ROOT"
say "results=$RESULTS"
say "archive=$ARCHIVE"

for i in $(seq 1 "$N"); do
  for arm in a b; do
    cfg="/Users/roman/bench-env/arm-$arm"
    scratch="$BENCH_SCRATCH_ROOT/$arm-$i"

    if [ -f "$RESULTS/$arm-$i.json" ]; then
      say "SKIP $arm-$i (already harvested)"
      continue
    fi
    rm -rf "$scratch"

    say "--- $arm-$i prepare"
    if ! CLAUDE_CONFIG_DIR="$cfg" node "$REPO/bench/prepare.mjs" \
         --arm "$arm" --run "$i" --gap "$GAP" >>"$LOG" 2>&1; then
      say "FAIL $arm-$i prepare — skipping this run"
      continue
    fi

    say "--- $arm-$i run"
    (
      cd "$scratch" || exit 1
      CLAUDE_CONFIG_DIR="$cfg" claude -p --permission-mode bypassPermissions \
        "/sdlc:start \"$TASK_TEXT\"" >>"$LOG" 2>&1
    ) &
    pid=$!
    waited=0
    while kill -0 "$pid" 2>/dev/null; do
      sleep 10
      waited=$((waited + 10))
      if [ "$waited" -ge "$RUN_TIMEOUT" ]; then
        say "TIMEOUT $arm-$i after ${waited}s — killing"
        kill -9 "$pid" 2>/dev/null
        break
      fi
    done
    wait "$pid" 2>/dev/null
    rc=$?
    say "--- $arm-$i claude exited rc=$rc after ~${waited}s"

    say "--- $arm-$i harvest"
    if CLAUDE_CONFIG_DIR="$cfg" node "$REPO/bench/harvest.mjs" \
         --arm "$arm" --run "$i" --results "$RESULTS" --archive "$ARCHIVE" >>"$LOG" 2>&1; then
      say "OK   $arm-$i harvested"
    else
      say "FAIL $arm-$i harvest (scratch archived to $ARCHIVE/$arm-$i.tar.gz)"
    fi

    rm -rf "$scratch"
    sleep "$GAP"
  done
done

say "campaign done — $(ls -1 "$RESULTS"/*.json 2>/dev/null | wc -l | tr -d ' ') result file(s)"
say "compare with: node bench/compare.mjs --results bench/results-headless"
