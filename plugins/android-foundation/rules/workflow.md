---
loaded_by: [orchestrator]
load_when: "Once at session start; on phase transitions."
---

# Agent Workflow Orchestration

## Pipeline DAG

```
Standard feature:
  android-ba → android-developer → (android-reviewer ⇄ android-developer, max 3 rounds)
                → [android-security ‖ android-tester] → android-qa → android-docs

Bug-fix (full gate):
  android-debugger → android-developer → (android-reviewer ⇄ android-developer, max 3 rounds)
           → [android-security ‖ android-tester] → android-qa
```

`[android-security ‖ android-tester]` = android-security and android-tester run **in parallel** — invoke both simultaneously.

After the pipeline ends, an **optional** retrospective step is available:
`sdlc:aar` (After Action Review) analyzes the run's metrics dashboard and
session transcript for token cost and agent cooperation and proposes approvable
workflow improvements. It is user-triggered, never automatic.

## Knowledge sourcing — applies to every step

`.obsidian-vault/` is the single source of project knowledge. Every agent, before
answering project-specific questions, MUST `Read` the relevant note(s) starting from
`.obsidian-vault/_moc-root.md`, then follow the note's **typed edges**
(`depends_on`/`screens`/`flows`/`adrs`) and the generated
`.obsidian-vault/architecture/dependency-graph.md`. See `${CLAUDE_PLUGIN_ROOT}/rules/documentation.md`.

## What counts as "non-trivial"

Enter plan mode for any task that meets ONE of:
- Touches ≥ 3 files.
- Introduces a new public API or exported component.
- Adds a new dependency.
- Involves an architectural decision or cross-module boundary.

## Core Principles

- **Simplicity First** — minimal impact. Only touch what's necessary.
- **No Laziness** — find root causes. No temporary fixes.
- **Never mark Done without proof** — diff, tests, or demonstration.
- After ANY user correction: capture as an ADR in `.obsidian-vault/architecture/` if architectural, otherwise as a memory.

## General Rules

- Enter plan mode for ANY non-trivial task (see definition above).
- If something goes sideways, STOP and re-plan — don't keep pushing.
- Use subagents to keep main context clean.
- Debug logs are session-only. Remove before Done. See `${CLAUDE_PLUGIN_ROOT}/rules/logging.md`.
- ALWAYS check vault impact when creating a PR.

## Handoff Contract

All agent-to-agent handoffs use the JSON envelope defined in `${CLAUDE_PLUGIN_ROOT}/rules/handoff.md`.
No free-form text handoffs.

---

## Step 1: android-ba

- `Read` `.obsidian-vault/_moc-root.md` and follow links to relevant modules / flows / ADRs.
- Analyze requirements; break down into user stories with acceptance criteria.
- Identify affected modules and dependencies (vault notes are the source).
- Output: Feature Analysis document + handoff envelope (`phase: ba`).
- Do NOT wait for user confirmation before invoking the next agent.

### android-ba → Architecture Decision?

If the task requires a new domain model, major structural change, or cross-module
boundaries: android-ba drafts an ADR stub in `.obsidian-vault/architecture/adr-<NNNN>-<slug>.md`
(from `_templates/adr.md`) and hands it off to android-developer for refinement.

---

## Step 2: android-developer

- Receive handoff from android-ba.
- `Read` `.obsidian-vault/modules/<module>.md` and `.obsidian-vault/architecture/` for invariants before writing code.
- Determine execution order and parallel groups.
- For each task: implement → verify build → hand off to android-reviewer.
- Output: code changes + handoff envelope per task (`phase: dev`).

### android-reviewer ⇄ android-developer Loop (max 3 rounds)

- android-reviewer returns findings → android-developer addresses all → re-verify build → re-hand off.
- After 3 rounds without LGTM: set `blockers: ["Review loop exceeded 3 rounds. Escalate to human."]` and stop.

### Crash recovery (any dispatched agent)

If a subagent (developer, reviewer, or any phase agent) dies on a **mid-response server error**:

1. **Resume FIRST.** Attempt `SendMessage` to the SAME `agentId` to continue where it stopped —
   its in-agent context is intact, so it finishes with a handful of tool calls instead of re-reading
   the whole task.
2. **Fall back to a fresh `Agent` only if resume fails.** A fresh agent must re-`Read` everything the
   crashed one had loaded, roughly doubling the phase's tokens.
3. **Record the mechanism** so telemetry stays honest — set the phase's `recovery` field to
   `sendmessage-resume` or `fresh-restart` (see `${CLAUDE_PLUGIN_ROOT}`-side orchestrator Step 5 /
   `schemas/checkpoint.schema.json`). Do NOT label a fresh-restart as a same-session resume.

Honest caveat: resume replays context, so the concrete saving is the redundant re-reads it avoids,
not a dramatic token cut — but it also preserves correctness (a fresh agent can diverge from the
crashed one's partial work).

---

## Step 2.5: android-reviewer

- Receive handoff from android-developer.
- `Read` `.obsidian-vault/architecture/` and `.obsidian-vault/modules/<module>.md` to verify diff respects invariants.
- Execute Review Dimensions (see `android-reviewer.md`). Security dimension is delegated to android-security — do NOT review security here.
- LGTM → proceed to next task / next phase.
- Changes requested → return to android-developer with findings.
- When ALL tasks LGTM'd: hand off to Step 3+4 in parallel.

---

## Steps 3 + 4: android-security ‖ android-tester (parallel)

Invoke both agents simultaneously in a single message.

### android-security

- Obfuscation: verify ProGuard/R8 rules cover new classes.
- Network: TLS enforced; no plain HTTP in production.
- Storage: sensitive data through DataStore + AndroidX Security Crypto; no plain SharedPreferences.
- Realtime: Parse / Pusher / Retrofit / WebRTC payload models validated at boundaries.
- Output: findings with severity ratings + handoff envelope (`phase: security`).

### android-tester

- Write unit tests for ViewModels / state stores and non-trivial business logic.
- Use MockK, Turbine, Robolectric where Android runtime required.
- See `${CLAUDE_PLUGIN_ROOT}/rules/testing.md` for patterns.
- Output: test files + handoff envelope (`phase: test`).

---

## Step 5: android-qa

- Verify user flows work on `devDebug` and `productionRelease` variants.
- Check UI consistency across supported screen sizes.
- Prerequisite: build APK (`./gradlew assembleDevDebug`) before handing off to android-qa.
- Test integration points (Parse LiveQuery, Pusher, Stream WebRTC, Play Billing paywall, Firebase events).
- Output: manual verification results + handoff envelope (`phase: qa`).

---

## Step 6: android-docs

- Write summary report of all changes.
- Update `.obsidian-vault/` per the SDLC triggers in `${CLAUDE_PLUGIN_ROOT}/rules/documentation.md`.

### Obsidian Vault SDLC Check (MANDATORY before PR)

Read `${CLAUDE_PLUGIN_ROOT}/rules/documentation.md` and verify the android-docs Definition of Done checklist:

- New :feature:<name> module → `.obsidian-vault/modules/<module>.md` exists and is filled (no `<!-- STUB -->` marker), linked from `_moc-modules.md`.
- New `@Composable` screen or `@Serializable` route → `.obsidian-vault/screens/<Name>.md` exists and is filled, `.obsidian-vault/navigation/routes.md` updated, linked from `_moc-screens.md`.
- New business flow → `.obsidian-vault/business-logic/<flow>.md` exists and is filled, linked from `_moc-flows.md`.
- Changed public Repository interface → corresponding `modules/<module>.md` Public API section updated.
- New dependency → relevant `stack/<area>.md` updated.
- Typed edges (`depends_on`/`screens`/`flows`/`adrs`) are path-qualified and resolve; `depends_on:` matches its prose mirror.
- Re-run `node .claude/scripts/gen-mermaid.mjs` so `architecture/dependency-graph.md` reflects new edges.
- Run `node .claude/scripts/validate-docs.mjs` — it must be clean, OR every finding is escalated. **Never rewrite a layer edge to make it pass.**

**STOP** if any vault item is missing, any stub marker remains, or `validate-docs.mjs` has unaddressed findings. Update vault FIRST, then `gh pr create`.

- Create PR: `[task_id] title`. Example: `[CRF-6] Search Filters`.
- Use `gh pr create` via GitHub CLI.
- No AI mentions, no change statistics, no test checklists in PR description.

**Model override for outward-facing docs work.** `android-docs` defaults to `model: haiku`, which is
fine for vault edits but unreliable for an outward `gh pr create` (PR prose) combined with a
cross-repo / submodule commit. When the docs phase does BOTH — creates a PR and commits a submodule
(e.g. a vault submodule) — escalate the docs agent to `sonnet` for that run. Note this in the run so
the one-off tier bump is intentional, not accidental.

---

## Step 7: AAR — After Action Review (optional, retrospective)

- Runs **only** when the user invokes `sdlc:aar` (via `/sdlc:aar`) after a cycle ends.
- A read-only `aar` analyst subagent reads the deterministic metrics dashboard
  (`tools/aar/metrics.mjs` over `docs/plans/{slug}/_telemetry.json`) for cost
  accounting and parses the session transcript JSONL
  (`${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<encoded-cwd>/<session>.jsonl`) for cooperation signals —
  the only durable record of the run, since handoff envelopes are not persisted.
- Produces findings bucketed into **agents / rules / settings / vault docs**, each
  with transcript evidence and a concrete proposed edit.
- The user multi-selects findings, reviews a diff per item, and approves; AAR
  edits only approved files. Never auto-applies. Settings edits require explicit
  confirmation (global CLAUDE.md).
- Never edits product code or code-derived vault content — workflow scope only.

---

## CI/CD Tasks

- Use **android-devops** for Gradle, signing, Play Store, ProGuard, Firebase Distribution.
- Use **android-cicd** for GitHub Actions workflow YAML changes.

---

## Gradle Task Probe Rule

If `./gradlew detekt` or `./gradlew ktlintCheck` returns "task not found" on the first attempt — skip that check. Do NOT retry under alternate names or inspect build files. One attempt only.
