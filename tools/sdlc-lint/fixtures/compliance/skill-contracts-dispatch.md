# Fixture skill — dispatch-scoped contracts

```sdlc-contract
id: 3b-1a-expertise-block
requires: agent_prompt
pattern: Stack expertise for
cardinality: every-dispatch
dispatch_scope: telemetry.expertise_blocks
since: 2026-09-07
```

A contract that names no scope while asking for one is rejected, not silently defaulted.

```sdlc-contract
id: scope-missing
requires: agent_prompt
pattern: Stack expertise for
cardinality: every-dispatch
since: 2026-09-07
```

A scope that is not a `telemetry.` path is rejected too.

```sdlc-contract
id: scope-malformed
requires: agent_prompt
pattern: Stack expertise for
cardinality: every-dispatch
dispatch_scope: expertise_blocks
since: 2026-09-07
```

An uncompilable pattern must fail for `agent_prompt` exactly as it does for `bash_match`.

```sdlc-contract
id: pattern-broken
requires: agent_prompt
pattern: "Stack expertise for ([a-z"
cardinality: every-dispatch
dispatch_scope: telemetry.expertise_blocks
since: 2026-09-07
```
