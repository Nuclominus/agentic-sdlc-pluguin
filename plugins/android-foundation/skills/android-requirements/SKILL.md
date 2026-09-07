---
name: android-requirements
description: Android requirements engineering — discovery, module-placement (DDD bounded contexts across :feature:<name>), risk assessment, phased roadmap, and the Android feature-analysis deliverable. Invoke before writing requirements, user stories, acceptance criteria, or an implementation plan for an Android project.
---

# android-requirements

What a business analyst needs that is specific to a **native Android (Kotlin, modular
`:feature:<name>`)** codebase. The generic BA process — how to ask questions, how to write a user
story, what an acceptance criterion is — belongs to the core `business-analyst` agent and is not
restated here. This skill adds the platform layer: where logic lives in an Android module graph,
what the Android deliverable must contain, and what to capture in the project's vault.

## Knowledge sourcing — before any analysis

`Read` from the project's Obsidian vault first; it is the single source of project knowledge:

- `.obsidian-vault/_moc-root.md` (always)
- `.obsidian-vault/architecture/dependency-graph.md` (the generated module graph) plus
  `.obsidian-vault/architecture/` (layering, DDD boundaries, ADRs)
- `.obsidian-vault/modules/<module>.md` per affected module, then follow its
  `depends_on` / `screens` / `flows` typed edges
- `.obsidian-vault/business-logic/<flow>.md` per affected flow
- `.obsidian-vault/navigation/routes.md` when UI is in scope

The vault is an **optional** module. When `.obsidian-vault/` is absent, skip these reads entirely
and go straight to the codebase and `docs/plans/{task_slug}/` — do not spend a turn checking whether
it exists; a `Glob`/`Read` that misses IS the check. Do not paraphrase from memory.

## 1. Requirements discovery (Android lens)

- Identify the core problem, the business value, and the target users.
- Determine success metrics and acceptance criteria.
- Uncover the non-functional requirements Android actually makes you pay for: cold-start and
  frame-time budgets, offline behaviour, process death and state restoration, permission prompts,
  minSdk reach, background-execution limits, and battery/data cost.

## 2. Technical analysis

- Identify affected modules using the `:feature:<name>` pattern.
- Assess integration points with existing features and third-party SDKs (networking, realtime,
  analytics, billing).
- Evaluate technical constraints and dependencies — including whether a new dependency is even
  addable (version catalog, minSdk floor, licence).
- Consider data flow, state management, and caching strategy.

## 3. Module placement — embedded DDD

Required whenever the task introduces a new domain model, a major structural change, or a
cross-module boundary.

- **Bounded contexts** — which `:feature:<name>` module owns each domain concept.
- **Aggregates, entities, value objects** — shared primitives go in the model module, not in a
  feature module that another feature would then have to depend on.
- **Repository contracts** — the interface is owned by the feature module; the implementation
  consumes the data/infra layer and is `internal`.
- **Dependency rule** — UI → feature (domain) → data/infra. A lower layer never imports an upper one.
- **Navigation routes** — follow the project's convention (e.g. type-safe `@Serializable` route
  types, never string routes).
- Match the project's existing layering, detected from the vault and the codebase. Do not introduce
  a wrapper layer the project does not use.

Put the outcome in a **Module Placement** section of the deliverable.

## 4. Risk & dependency assessment

- Technical risks with mitigations.
- Dependencies on the project's integrations (networking, realtime/backend, analytics, billing).
- Performance bottlenecks — main-thread work, large lists, image decoding, oversized recompositions.
- Security implications and data privacy (what PII the feature touches, where it lands at rest).

## 5. Implementation roadmap

- A phased, step-by-step plan; prioritise by dependency order and business value.
- Define analytics events if applicable.
- Estimate complexity in relative terms, never in hours.

## 6. Deliverable format

```
# Feature Analysis: [Feature Name]

## Executive Summary
[2–3 sentences: feature + business value]

## Requirements
### Functional Requirements
### Non-Functional Requirements

## User Stories
- As a [user type], I want [goal] so that [benefit]
[3–5 stories with acceptance criteria]

## Technical Approach
### Module Placement (include when domain design required)
- Owning module: :feature:<name>:<x>
- Consumes: :feature:<name>:<y>
- Rationale: [why this boundary]

### Architecture & Components
### UI Structure
[Screen(s), ViewModel, sealed State / Intent / Action, Navigation route]

### Domain Logic
[Repository / bounded context placement]

### Data Access
[Data sources, caching strategy]

### DI Module
[Module changes + dispatcher qualifiers]

### Analytics Events (if applicable)

## Implementation Plan
### Phase 1: Foundation
- [ ] Task 1

### Phase 2: Core Features
- [ ] Task 2

### Phase 3: Polish & Verification
- [ ] Task 3

## Testing Strategy
- Unit tests: [key areas to cover]
- Error paths: [list]

## Risks & Mitigations
| Risk | Impact | Probability | Mitigation |

## Open Questions
```

## 7. Vault capture — architectural deltas

If the analysis introduces a new architectural decision, a cross-module boundary, or a domain model,
draft an ADR stub at `.obsidian-vault/architecture/adr-<NNNN>-<slug>.md` (copy
`.obsidian-vault/_templates/adr.md`) before the handoff. The documentation phase finalises it.
