# How the system works

This document shows the moving parts of the Agentic SDLC marketplace and how a run flows through them.
The diagrams are Mermaid (rendered natively by GitHub).

## 1. Orchestration flow

What happens when you run `/sdlc:start "<feature>"`.

```mermaid
flowchart TD
    U["/sdlc:start &quot;feature&quot;"] --> P0a["Step 0a — dependency preflight<br/>aggregate runtime-dependencies.json across all plugins (cached)"]
    P0a --> P0b["Step 0b — detect stack<br/>glob **/stack.md, evaluate detect rules<br/>(file_exists / file_contains / file_glob / nested any-all)"]
    P0b --> RES["resolve winner per aspect + PRIMARY profile"]
    RES --> P1["Step 1 — resolve workflow<br/>--workflow= &gt; sdlc.local.yaml &gt; profile.workflow &gt; default"]
    P1 --> P2["Step 2 — task slug + docs/plans/&lt;slug&gt;/ workspace"]
    P2 --> P3["Step 3 — execute phases in order"]
    P3 --> P4["Step 4 — post_pipeline_checks + _telemetry.json"]

    P3 -. each phase .-> AG["dispatch agents_per_phase[phase]<br/>aspect-aware phases fan out per aspect<br/>compact summary returned; detail to 0X-phase.md"]
```

The core is **platform-agnostic**: it never hardcodes the phase set, the agents, or any platform standard.
Platform plugins supply all of that through their `stack.md` profile and `workflows/`.

## 2. Stack Provider Pattern

```mermaid
flowchart LR
    subgraph CORE["sdlc (core, platform-agnostic)"]
      ORC["pipeline-orchestrator skill<br/>generic control flow:<br/>phases, review-loops, parallel groups"]
      WF["generic workflows<br/>default / bugfix / hotfix / refactor / docs-only"]
      FB["fallback agents (vanilla)"]
    end
    subgraph AND["android-plugin (aspect: android)"]
      AST["stack.md<br/>workflow: android-feature"]
      AAG["11 android-* agents"]
      AWF["android-feature / android-bugfix workflows"]
    end
    subgraph IOS["ios-plugin (aspect: ios)"]
      IST["stack.md"]
      IAG["ios-architect (+ skeleton)"]
    end
    AST -. registers .-> ORC
    IST -. registers .-> ORC
    AWF -. discovered by glob .-> ORC
    ORC -. dispatches .-> AAG
    ORC -. dispatches .-> IAG
```

A platform plugin **registers** itself by shipping a `stack.md` (detection + phase→agent map + default workflow)
and, optionally, its own `workflows/`. The core discovers everything by globbing `**/stack.md` and
`**/workflows/*.yaml` — it is never edited to add a platform.

## 3. The Android pipeline (workflow `android-feature`)

```mermaid
flowchart LR
    BA["business_analysis<br/>android-ba (Opus)"] --> DEV["development<br/>android-developer (Sonnet)<br/>plan → approve → implement"]
    DEV --> REV{"review<br/>android-reviewer (Sonnet)"}
    REV -->|changes requested, max 3| DEV
    REV -->|approved| SEC
    REV -->|approved| TEST
    subgraph PAR["parallel group — one message, two Agent calls"]
      SEC["security<br/>android-security (Opus)<br/>MASVS / MASTG"]
      TEST["test<br/>android-tester (Sonnet)<br/>MockK / Turbine / Kover"]
    end
    SEC --> QA["qa<br/>android-qa (Sonnet)<br/>Compose UI Test / Maestro / a11y"]
    TEST --> QA
    QA --> DOCS["documentation<br/>android-docs (Haiku)<br/>PR + optional vault"]
```

- **review** is a *loop phase*: if `android-reviewer` requests changes, the orchestrator re-runs
  `development` (implement pass only — the plan was already approved) with the review findings injected,
  up to 3 rounds, then escalates to the user.
- **[security ‖ test]** is a *parallel group*: both agents are dispatched in a single message and must
  return before `qa` begins.
- On-demand agents (not in the pipeline; invoke directly): `android-debugger`, `android-devops`,
  `android-cicd`, `android-aar`.

## 4. Model tiers (cost discipline)

| Tier | Model | Agents |
|------|-------|--------|
| high | Opus | `android-ba`, `android-security` |
| medium | Sonnet | `android-developer`, `android-reviewer`, `android-tester`, `android-qa`, on-demand agents |
| low | Haiku | `android-docs` |

Tiers are declared in each agent's frontmatter `model:`/`effort:` and enforced by the core
`enforce-agent-model.sh` hook.

## 5. Artifacts a run produces

```
docs/plans/<task-slug>/
├── _brief.md                       # the task brief
├── 01-business-analysis.md
├── 02-development-plan.md          # plan pass (approval gate)
├── 02-development.md               # implement pass
├── 03-review.md                    # verdict (+ loop rounds)
├── 04-security.md                  # MASVS/MASTG findings
├── 04-test.md                      # unit/integration report
├── 05-qa.md                        # E2E/UI report
├── 06-documentation.md             # PR description
└── _telemetry.json                 # per-phase tokens / cost / skips
```

See [`WALKTHROUGH.md`](WALKTHROUGH.md) for a full end-to-end run of these phases on a real task.
