---
adr: 34
status: accepted
date: 2026-09-23
supersedes: null
---

# ADR-0034 — Phase-boundary lint feedback, never blocking

## Context

The competing plugin `claude-sdlc` runs the stack's linter/typecheck once, right after the
architect/developer phase, and routes a failure back as a retry hint — catching cheap
style/type problems before QA and Security spend tokens reviewing output that would just get
rejected on style grounds anyway. This repo's only equivalents today are `format-on-stop.sh`
(auto-fixes at session `Stop`, i.e. only once the whole turn ends, and only ever *fixes*, never
reports) and Step 4's post-pipeline checks (only once, at the very end of the entire run).
Neither gives per-phase feedback close to where the code was written.

## Decision

Add `plugins/android-foundation/hooks/post-implement-check.sh`, a `SubagentStop` hook:

- Reads `agent_type` from the event payload, strips any `<plugin>:` prefix, and no-ops for any
  bare name other than `developer`/`tester`.
- No-ops if `./gradlew` is not executable at `CLAUDE_PROJECT_DIR` (or `pwd` as a fallback root).
- Otherwise runs `./gradlew ktlintCheck detekt`, classifies the result as `pass` / `fail` /
  `skipped` (the last when the Gradle output shows the requested tasks don't exist in this
  project — i.e. the ktlint/detekt Gradle plugins aren't configured — rather than a real lint
  failure), and both prints one stdout line for local debugging AND writes the result as JSON to
  `docs/plans/{active_run_slug}/.checkpoint/_post-implement-check.json`
  (`{"status", "issue_count", "tool", "at"}`). The active run is located with the same
  freshness-windowed "most recently touched, unsealed run" detection `config-protection.sh`
  established (ADR-0033), inlined here rather than shared (no two hooks in this repo source a
  common helper file).
- **Never blocks.** No `exit 2` path exists in this hook at all — it always exits 0, regardless
  of the Gradle result. An unbounded hook-level retry loop is a worse failure mode than a missed
  lint pass, the same principle `seal-run.sh` already states for its own scope.
- The signal is wired into the orchestrator's *existing* Step 3e validation
  (`plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`) rather than becoming a second,
  competing gate: if the state file for a phase reports `status: "fail"`, 3e treats that the
  same as any other validation failure, so the retry conversation happens once, in one place.

## Consequences

- **Confirmed payload field: `agent_type`, not `subagent_type`.** Before this task started, the
  controller fetched Claude Code's current hooks documentation (code.claude.com/docs/en/hooks)
  and confirmed the `SubagentStop` payload carries `agent_type` at the top level (e.g.
  `sdlc:developer`), not nested and not named `subagent_type`. The shipped hook reads
  `.agent_type` accordingly; the brief's original draft (written before that confirmation)
  assumed `subagent_type` and needed exactly one line changed once the real field was known.
- **`SubagentStop` cannot block, by platform design — not by this hook's own restraint.** The
  same documentation states the exit-code-2 behavior for `SubagentStop` is "No effect" (it is
  listed as an event that cannot block). This hook's "never exit 2" rule is therefore not a
  style choice this implementation could have made differently; there is no blocking pathway
  available on this event at all. The design is correct regardless, since the intent was
  fail-open even before that was confirmed to also be the platform's only option.
- **Correction (final review): plain stdout does NOT surface to the transcript for
  `SubagentStop`.** The original version of this bullet claimed "plain stdout is documented to
  always surface to the transcript for every hook event" — that was wrong, and was the
  controller's own error in an earlier iteration of this task. Per Claude Code's hooks docs, for
  most events (including `SubagentStop`) stdout goes only to the internal debug log; the
  documented exceptions where plain-text stdout is added as visible context are
  `UserPromptSubmit`, `UserPromptExpansion`, `SessionStart`, and `PostModelSwitch` —
  `SubagentStop` is not one of them. `systemMessage` is also not reliably usable here: the docs
  describe its delivery for `SubagentStop` specifically as event-specific/unconfirmed, unlike
  those four exceptions. Because of this, the hook's stdout line alone was NEVER reaching the
  orchestrator or the user — the Step 3e wiring described above did nothing until this fix added
  the `_post-implement-check.json` state-file write, which is the actual delivery mechanism.
  Stdout is kept only as a harmless local-debugging aid.
- **Android-specific, Claude-Code-only**, same caveat as ADR-0031/0032/0033: no Antigravity or
  Codex equivalent exists yet for this hook shape.
- A missed detection window exists in principle (the hook fires once, at `SubagentStop`, not
  continuously); this is accepted for the same reason `format-on-stop.sh` accepts it — the cost
  of running Gradle continuously outweighs catching a mid-turn transient lint state.
- **This runs a real Gradle invocation on every `developer`/`tester` `SubagentStop`, not once
  per pipeline run.** An aspect-aware development phase fires it once per aspect, and a
  review/remediation loop fires it again on every round — so on a multi-aspect feature with a
  few review iterations this can mean a double-digit number of `ktlintCheck detekt` invocations
  for a single pipeline run. No debouncing or caching is implemented (future work); this is
  documented here as an accepted, repeated cost rather than a one-time one.

## Related
- Implemented by: #211.
- Relates to: [[decisions/ADR-0033-lint-config-edits-are-gated-during-a-run]] /
  [[decisions/ADR-0032-commit-hygiene-is-a-deterministic-hook]] /
  [[decisions/ADR-0010-self-healing-micro-loop]]
