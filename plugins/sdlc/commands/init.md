---
description: Initialize SDLC config for this project — detect the winning stack profile(s), scaffold .claude/sdlc.local.yaml, and optionally seed CLAUDE.md. Idempotent; never overwrites existing config.
argument-hint: "[--seed-claude-md]"
---

# /sdlc:init

One-time project setup. Detects the platform(s), writes a starter local-overrides file, and reports which profile(s) the pipeline will use. Replaces the old per-project setup skill. Generic and platform-agnostic — the scaffolded file uses only the neutral override fields.

## What this command does

1. **Repo root check.** `git rev-parse --show-toplevel` should match CWD; otherwise tell the user to `cd` there. Create `.claude/` if absent.

2. **Detect stack profiles.** Reuse Step 0b from `pipeline-orchestrator/SKILL.md`: `Glob ~/.claude/plugins/cache/**/manifest.yaml`, split by `kind`, evaluate each `kind: foundation` profile's `detect` rules against the project, resolve the winner per aspect + the PRIMARY profile. Print them and the PRIMARY profile's declared default `workflow:` (if any).

3. **Scaffold `.claude/sdlc.local.yaml` — IF ABSENT.** Never overwrite an existing file (print `exists — left untouched` and skip). When creating, write a commented starter template with the generic override fields and the detected default workflow noted:

   ```yaml
   # SDLC project overrides (generic — read by pipeline-orchestrator).
   # Uncomment and edit only what you need; delete the rest.

   # active_workflow: android-feature      # detected default for the PRIMARY profile; overrides the profile's declared workflow
   # Project-local recipes: drop custom workflow YAMLs in .claude/sdlc-workflows/<name>.yaml
   # (they shadow plugin recipes of the same name). Author them with /sdlc:workflow-config.

   # post_pipeline_checks:                 # REPLACES the profile's defaults entirely
   #   - "./gradlew testDebugUnitTest"
   #   - "./gradlew lintDebug"

   # phase_command_overrides:
   #   qa: "./gradlew connectedDebugAndroidTest"

   # extra_phase_prompts:
   #   development: "Follow our internal module-structure.md"

   # convention_skills_extra:
   #   - "local:our-conventions"

   # skip_phases:
   #   - security

   # extensions:                           # per-agent Skill mapping — no plugin edits needed
   #   skills:
   #     - skill: "superpowers:test-driven-development"
   #       agents: [android-developer]     # list of agent names, or "all"
   #       when: "before writing production code"
   #       policy: mandatory               # mandatory | recommended (default)
   ```

   Pre-fill the `active_workflow` comment with the PRIMARY profile's default workflow name so it is discoverable.

4. **(optional) `--seed-claude-md`.** If `CLAUDE.md` is absent, or present but has no SDLC section, append a short **managed block** documenting the pipeline and how to run it (`/sdlc:start "<feature>"`, `/sdlc:doctor`). Wrap it in `<!-- sdlc:begin -->` / `<!-- sdlc:end -->` markers and never duplicate — if the markers already exist, refresh between them, do not append a second block. Never touch content outside the markers.

5. **Report.** Print what was created vs skipped, the detected profile(s), and the next step.

## Output

```
🚀 SDLC init

Stack profiles:
  🎯 primary: android (priority=300) → default workflow: android-feature
  also installed: vanilla (0)

Wrote:
  ✅ .claude/sdlc.local.yaml  (starter template)
  ⏭️  CLAUDE.md                (not requested — pass --seed-claude-md)

Next:
  /sdlc:doctor                 # verify deps + host capability
  /sdlc:extension              # (optional) attach per-agent Skills to the pipeline
  /sdlc:start "Add a settings screen with a dark-mode toggle"
```

If `.claude/sdlc.local.yaml` already exists:

```
Wrote:
  ⏭️  .claude/sdlc.local.yaml  (exists — left untouched)
```

## Hard rules

- **Idempotent.** Create-if-absent only. Never overwrite `.claude/sdlc.local.yaml`; never clobber `CLAUDE.md` content outside the managed block.
- **Generic only.** The scaffolded file uses the platform-neutral override fields — no platform-specific block. Platform specifics are detected at runtime by the platform agents.
- **No pipeline run.** This command only scaffolds and reports; it does not invoke `/sdlc:start`.
- **Reuse, don't reimplement.** Detection delegates to Step 0b in `pipeline-orchestrator/SKILL.md`.

## When to use

- First time setting up a repo for the pipeline.
- After installing a stack plugin — confirm which profile wins and capture project overrides.
