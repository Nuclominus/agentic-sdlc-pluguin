# AAR report format (`report.md`)

Return EXACTLY these sections, compact. No raw transcript dumps.

## 1. Metrics dashboard

Render from `metrics_json`: total cost (+ cap status), wall-clock, cache-hit
ratio, tokens (input/output/cached). A `by_phase` table (phase · agent · model ·
status · cost). A `by_model` line (cost + unpriced count). Note QA iterations,
cap breach, post-check failures if any.

## 2. Top token consumers

The `top_consumers` list (label · total tokens · cost), heaviest first.

## 3. Findings

Bucketed. Only buckets with findings appear. Each finding is a row:

**agents / rules / settings** (+ **vault-docs** only if the active profile has a
vault):

| target file | evidence | proposed change | expected benefit | severity |
|-------------|----------|-----------------|------------------|----------|

- `target file` — exact path (and line range where known).
- `evidence` — the transcript/metrics fact that motivates it. No evidence → no
  finding.
- `severity` — high / medium / low.

## 4. What went well

2–5 bullets — reinforce good cooperation the run showed (kept under cap, real
parallelism, clean verification).

## 5. Highest-leverage summary

ONE line: the single change with the best cost/quality payoff.

## Lessons candidates

For each finding worth persisting, provide a ONE-LINE lesson (imperative,
project-general) the skill can append to `.claude/sdlc-lessons.md` on approval —
e.g. `- Dispatch security ‖ test in one message; the last run serialized them.`
