# Fixture skill — the mandatory-skill gate

```sdlc-contract
id: 3b-1a-mandatory-skill
requires: agent_skill
pattern: MANDATORY — invoke `([^`]+)`
cardinality: every-mandate
dispatch_scope: telemetry.expertise_block_agents
since: 2026-09-07
```

A mandate contract must capture the skill id, or it has nothing to compare against.

```sdlc-contract
id: no-capture
requires: agent_skill
pattern: MANDATORY — invoke
cardinality: every-mandate
dispatch_scope: telemetry.expertise_block_agents
since: 2026-09-07
```
