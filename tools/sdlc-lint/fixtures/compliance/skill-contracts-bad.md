# Fixture skill — one error of each class

```sdlc-contract
id: dup
requires: bash_match
pattern: a
cardinality: once-per-run
since: 2026-07-01
```

```sdlc-contract
id: dup
requires: bash_match
pattern: b
cardinality: once-per-run
since: 2026-07-01
```

```sdlc-contract
id: unknown-requires
requires: telepathy
pattern: a
cardinality: once-per-run
since: 2026-07-01
```

```sdlc-contract
id: bad-regex
requires: bash_match
pattern: "a([b"
cardinality: once-per-run
since: 2026-07-01
```

```sdlc-contract
id: bad-since
requires: bash_match
pattern: a
cardinality: once-per-run
since: last Tuesday
```

```sdlc-contract
id: bad-condition
requires: bash_match
pattern: a
cardinality: once-per-run
since: 2026-07-01
applies_when:
  - telemetry.foo ~~ 3
```

```sdlc-contract
id: not-a-mapping
```
