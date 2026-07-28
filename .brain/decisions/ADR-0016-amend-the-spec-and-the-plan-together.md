---
adr: 16
status: accepted
date: 2026-07-28
supersedes: null
---

# ADR-0016 — Amend the spec and the plan together

## Context

Mirrored into the vault under [[decisions/ADR-0013-agent-memory-mirrors-into-the-vault]]; the
finding dates from 2026-07-25 and had lived only in agent memory until then.

Across the E2 run (8 tasks, PR #68), **every** fix round traced to a defect in the plan/spec text
that had been authored up front — never to an implementer deviating from it. Four instances:

- `checkAnchor` used a first-occurrence `indexOf`, while the real target file quoted the delimiter
  in prose three lines above the real one — the check could never pass.
- A contract bullet blurred "quoted in your prompt" into "Read by you".
- "Verify from the `Edit` tool result" silently dropped a correctness guarantee, because that
  result echoes only the edited hunk.
- A suppression regex `\s*\S` matched the `-` of the closing `-->`.

The pattern generalised on the H1 run (PR #101): the plan specified `plugin_version` as a Step 5
write into a schema that turned out to validate a different file, and specified contract patterns
pinned to one shell-quoting spelling. Both surfaced only when the code met the real tree.

**Why it happens:** plan code is written against imagined inputs. It first meets reality when a task
points it at the actual tree — which in a TDD-ordered plan is often two or three tasks after it was
written. Plan defects are therefore the *expected* outcome of planning, not a sign of bad planning.

## Decision

Budget for plan amendments as normal work, and when amending:

1. **When a reviewer flags plan-mandated text, assume the reviewer is right.** Ask which governs —
   the skill requires it — but expect to amend rather than to defend.
2. **Amend the spec AND the plan in one commit.** Separately, they drift, and someone later trusts
   the wrong file.
3. **Order tasks so tooling is built against fixtures first**, then pointed at the real tree, then
   the tree is cleaned, then it becomes a gate. This keeps `sdlc-lint all` green at every commit and
   surfaces plan-vs-reality mismatches early instead of at the end.
4. **Verify reported facts rather than ledgering them.** An implementer once fabricated a 40-char
   SHA in its report — correct 7-char prefix, invented remainder. Require SHAs copied from
   `git rev-parse HEAD`, and check claims before they enter a record.

## Consequences

- A run that produces no plan amendments is the surprising case, not the healthy one.
- Review findings are read as information about the plan, not as implementer error — which keeps
  the fix at the level where it actually belongs.
- Rule 3 costs an extra ordering constraint on every plan, and buys a green tree at every commit.
- Rule 4 slows down ledgering slightly and is non-negotiable: an unverified fact in a record is
  worse than an absent one.

## Related
- Mirrored under: [[decisions/ADR-0013-agent-memory-mirrors-into-the-vault]]
- The E2 run this came from: [[architecture/benchmark-e2-read-discipline]],
  [[decisions/ADR-0008-read-discipline-contract]]
- Implemented by: #68, #101
