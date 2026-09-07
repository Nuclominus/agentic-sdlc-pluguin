# Fixture skill — a dispatch-scoped contract on the wrong requires

`every-dispatch` evaluates the dispatch PROMPT, so it is meaningful only with `agent_prompt`.
Paired with anything else it would compile an unvalidated pattern at audit time.

```sdlc-contract
id: wrong-requires
requires: agent_dispatch
pattern: "foo("
cardinality: every-dispatch
dispatch_scope: telemetry.expertise_block_agents
since: 2026-09-07
```
