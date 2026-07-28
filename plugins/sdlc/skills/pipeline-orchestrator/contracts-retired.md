# Retired step contracts

Machine-owned. Read by `sdlc-lint compliance` together with `SKILL.md`; **not** read by the
orchestrator at run time and not part of any procedure.

A contract lands here when the step it describes is replaced. It keeps its original `since` and
gains an `until`, so a run from its era is still audited against the procedure that was actually in
force — which is what keeps an already-published compliance rate reproducible after the procedure
changes. Runs dated after `until` record `na: retired` for it.

The H1 rule "contracts live next to the prose they describe" does not apply here: it exists so a
contract cannot drift from a step still being edited, and a retired contract describes a step that
no longer exists. Nothing in this file may be edited except to add a newly retired block.

## Replaced 2026-07-29 by `5b-finish` (H2)

Steps 5 and 5b used to mandate three separate invocations: the run-clock arithmetic, the cost
enrichment, and the HTML render. H1 measured the multi-step clock at 67% — the worst rate in the
set — against 87–100% for every single-command step. `run/cli.mjs finish` now does all three.

```sdlc-contract
id: 5-clock
requires: bash_match
pattern: date -u (-r |-d @)
cardinality: once-per-run
since: 2026-07-06
until: 2026-07-28
```

```sdlc-contract
id: 5b-0-enrich
requires: bash_match
pattern: usage/cli\.mjs"?\s+enrich
cardinality: once-per-run
since: 2026-07-07
until: 2026-07-28
```

```sdlc-contract
id: 5b-2-report
requires: bash_match
pattern: report/cli\.mjs"?\s+report
cardinality: once-per-run
since: 2026-07-03
until: 2026-07-28
```
