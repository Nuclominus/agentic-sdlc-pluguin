---
adr: 13
status: accepted
date: 2026-07-28
supersedes: null
---

# ADR-0013 — Agent memory mirrors into the vault

## Context

Two knowledge stores now exist for this repository, and only one of them is the SSOT.

`.brain/` is the vault: version-controlled, reviewable in a PR, visible to every contributor and
to every future session ([[decisions/ADR-0003-session-recorder-run-journal]] and the
`second-brain.md` rule establish it as the source of truth). Alongside it, the agent keeps a
private file-based memory outside the repository, recalled automatically at session start.

That second store has been accumulating findings that exist **nowhere else**. An audit on
2026-07-28 across twelve memories found one — the lesson that in subagent-driven development here
every review finding traced to a defect in the authored plan rather than to an implementer — held
only in agent memory, with no representation in the vault. It had been true and useful for three
days and was invisible to anyone reading the repository.

This is the failure mode the vault rule exists to prevent, arriving through a side door. A finding
that lives only in agent memory is: not reviewable, not versioned with the code it describes, lost
if the memory directory is cleared, and unavailable to a contributor who is not this agent. It also
decays silently — memories are point-in-time observations, and nothing in the repo contradicts one
that has gone stale.

## Decision

**Everything written to agent memory is also written into `.brain/`.** Memory may be a
faster-to-recall index; it may never be the only copy.

Placement follows the vault's existing shape rather than a new section:

| memory `type` | vault home |
|---|---|
| `project` — a measured result, a state of ongoing work | `planning/` (or `architecture/` when it describes how the system works) |
| `feedback` — a durable working convention | `decisions/` as an ADR, per the "non-trivial decisions get an ADR" rule |
| `reference` — pointers to external resources | the note whose topic it serves |
| `user` — who the user is | **not** mirrored; this is about the person, not the project |

The mirror is not a copy-paste. The vault note carries the full reasoning and the evidence; the
memory carries the short recall form plus how to apply it. Where both exist, **the vault wins** — a
memory that contradicts the vault is stale by definition and should be corrected or deleted.

## Consequences

- Writing a memory is now a two-file operation, and the vault half is the one that gets reviewed.
  The cost is real and deliberate: it is the same cost that makes `.brain/` trustworthy.
- `user`-type memories stay private, which keeps personal preferences out of a shared repository.
- Backfill: the 2026-07-28 audit found exactly one uncovered memory, mirrored as
  [[decisions/ADR-0016-amend-the-spec-and-the-plan-together]]. The rest were already represented in
  `planning/`, `architecture/` or `changes/`.
- A stale memory is now falsifiable — the vault note is version-controlled next to the code, so a
  reader can date the claim instead of trusting it.
- This does not make memory redundant. Recall at session start is what memory buys; the vault is
  read deliberately, not automatically.

## Related
- Vault as SSOT: the `second-brain.md` rule; [[planning/_moc-planning]]
- Mirrored by this decision: [[decisions/ADR-0016-amend-the-spec-and-the-plan-together]]
- Same "one store must be authoritative" reasoning applied to cost:
  [[decisions/ADR-0005-transcript-derived-cost]]
