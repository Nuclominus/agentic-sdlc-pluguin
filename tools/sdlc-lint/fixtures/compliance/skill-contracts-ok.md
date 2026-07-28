# Fixture skill

Some prose that is not a contract.

```bash
echo "this fenced block must be ignored"
```

```sdlc-contract
id: 5b-0-enrich
requires: bash_match
pattern: usage/cli\.mjs enrich
cardinality: once-per-run
since: 2026-07-07
```

More prose.

```sdlc-contract
id: 6-journal
requires: agent_dispatch
pattern: session-recorder
cardinality: once-per-run
since: 2026-07-06
applies_when:
  - telemetry.headless_mode == false
```
