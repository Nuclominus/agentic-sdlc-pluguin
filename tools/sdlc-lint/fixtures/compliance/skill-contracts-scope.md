# Fixture skill — the off-matrix skill audit (ADR-0037)

```sdlc-contract
id: 3b-1a-skill-scope
requires: agent_skill_scope
cardinality: every-skill-call
dispatch_scope: telemetry.expertise_block_agents
since: 2026-09-29
```

A scope contract judges against the recorded matrix; a pattern would read as if it matched text.

```sdlc-contract
id: scope-with-pattern
requires: agent_skill_scope
pattern: anything
cardinality: every-skill-call
dispatch_scope: telemetry.expertise_block_agents
since: 2026-09-29
```
