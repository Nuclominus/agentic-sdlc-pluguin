---
source: ARCHITECTURE.md
---

# Pipeline Orchestrator

> Migrated from `ARCHITECTURE.md`. See [[architecture/_moc-architecture]].

## 5. Pipeline orchestrator (the one core skill)

`plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` is the heart of the system. Its algorithm:

```
Step 0a · External plugin dependency preflight (optional: superpowers, security-guidance)
Step 0b · Detect profiles via Glob of manifest.yaml (split by kind)
          · per-aspect winner resolution (kind: foundation)
          · 0b-frameworks: resolve ADDITIVE_PROFILES (+ frameworks.enable/disable override)
Step 0c · Skip-rule analysis (cost optimization for trivial changes)
Step 1  · 1a Merge active profiles (winner + PRIMARY + ADDITIVE) → 1b project-local overrides → 1c phase order
Step 2  · Generate task slug, prepare workspace (+ capture write-once real start clock → .checkpoint/_started_at)
Step 3  · Execute each phase: look up agent (winner/PRIMARY) → build prompt (base + injected + prior summary)
          → spawn agent → save COMPACT summary
Step 4  · Run post-pipeline checks
Step 5  · Telemetry + final summary (measured wall_clock_seconds from Step 2 clock; stack, frameworks, phases, cost, PR link)
Step 5b · Render HTML run-report
Step 6  · Close the session: dispatch `session-recorder` → append entry to docs/plans/_journal.md
```

**Run clock (Step 2 + Step 5).** Step 2 records a write-once epoch anchor
`docs/plans/{slug}/.checkpoint/_started_at`; Step 5 computes `wall_clock_seconds` = now − start and
renders `started_at`/`completed_at` from it. This measured timing (not an estimate) flows into
`_telemetry.json` and therefore into `report` / `rollup` / `aar`. See
[[decisions/ADR-0003-session-recorder-run-journal]].

**Session close (Step 6).** The orchestrator's built-in closer dispatches the `session-recorder`
agent, which appends one short (~20–30 word) newest-first entry — `date · slug · note · elapsed ·
cost · phase count` — to the cumulative journal `docs/plans/_journal.md`. It always runs (every
stack/workflow), is skipped under `--dry-run`, and is best-effort (never fails the run). It is NOT a
workflow phase, so it takes no `agents_per_phase` binding.

The orchestrator prints the active profiles verbatim, including an `additive:` line, so the user can
verify which frameworks activated.

---

## 6. Agents (cost-tiered)

The five core fallbacks live in `plugins/sdlc/agents/`; the Android roster lives in
`plugins/android-foundation/agents/`. Model/effort follow the "cost of mistakes" principle.

| Agent | Plugin | Model | Effort | Why |
|---|---|---|---|---|
| business-analyst | sdlc | opus | high | Requirements errors cascade through every phase. |
| developer | sdlc | sonnet | medium | Vanilla fallback (non-Android projects). |
| qa-engineer | sdlc | sonnet | medium | Clear criteria; hard 3-attempt cap. |
| security-analyst | sdlc | opus | high | Threat model; read-only. |
| document-writer | sdlc | haiku | low | Structured output from known facts. |
| session-recorder | sdlc | haiku | low | Built-in run closer (Step 6): ~30-word journal entry from telemetry. Not a phase. |
| **android-ba / android-developer / android-reviewer / android-security / android-tester / android-qa / android-docs** | android-foundation | opus→haiku | per role | The specialized roster that wins the `android` aspect (see the plugin README). |

Framework providers ship **no agents** — they enrich the prompts the agents above receive.

Model tier is enforced at dispatch by `plugins/sdlc/hooks/enforce-agent-model.sh` (a PreToolUse hook
that reads `model:` from the agent frontmatter and rewrites the Agent call).

---

## 7. Hooks

| Hook | Plugin | Event | Purpose |
|---|---|---|---|
| `enforce-agent-model.sh` | sdlc | PreToolUse(Agent) | Pin each agent to its declared model tier. |
| `kotlin-guard` → `validate-kotlin.sh` | android-foundation | PostToolUse(Edit\|Write) | Block non-negotiable patterns (`!!`, `runBlocking`, `println`, `Log.*`) in production Kotlin. |
| `format-on-stop.sh` | android-foundation | Stop | ktlint/detekt format. Fails open. |
| `guard-paths.sh` | android-foundation | PreToolUse(Edit\|Write) | Deny edits to `build/`, `.gradle/`. |
| `android-cli-check.sh` | android-foundation | SessionStart | Optional Android CLI advisory (non-blocking). |

---

## 9. Practical usage

```bash
# Install
/plugin marketplace add Nuclominus/Agentic-SDLC-Pluguin
/plugin install android-foundation@agentic-sdlc     # pulls sdlc core as a dependency
/plugin install retrofit-plugin@agentic-sdlc        # optional; auto-activates when Retrofit is detected

# Status
/sdlc:doctor            # preflight + host-capability report + active frameworks
/sdlc:list-stacks       # 🎯 android (settings.gradle[.kts] + *.kt) · ➕ retrofit (additive)

# Run
/sdlc:start "Add a settings screen with dark-mode toggle"
# → Detected: android → android-developer (Sonnet) for development; retrofit additive (if present)
# → BA (Opus) → Dev → Review(⇄Dev) → [Security ‖ Test] → QA → Docs
# → Post-pipeline: detekt + testDebugUnitTest + compileDebugKotlin
```

Toggle frameworks per project in `.claude/sdlc.local.yaml`:

```yaml
frameworks:
  enable: [retrofit]    # force-on even if detection missed it
  disable: [dagger]     # suppress even if detected
```
