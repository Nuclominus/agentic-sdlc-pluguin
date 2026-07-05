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
Step 2  · Generate task slug, prepare workspace
Step 3  · Execute each phase: look up agent (winner/PRIMARY) → build prompt (base + injected + prior summary)
          → spawn agent → save COMPACT summary
Step 4  · Run post-pipeline checks
Step 5  · Telemetry + final summary (stack used, additive frameworks, phases, cost, PR link)
```

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
