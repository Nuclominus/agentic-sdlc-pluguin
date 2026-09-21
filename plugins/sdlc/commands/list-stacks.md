---
description: List all stack profiles found in installed plugins, with priority and detection rules. Useful for verifying setup and debugging stack auto-detection.
argument-hint: ""
---

# /sdlc:list-stacks

List every `manifest.yaml` profile registered in installed plugins. Shows which foundation (`kind: foundation`) would match the current project, plus which frameworks (`kind: framework`) activate.

## What this command does

1. Resolve `{PLUGIN_CACHE_ROOT}` per `plugins/sdlc/PLUGIN-PATHS.md` (orchestrator Step 0), then use
   `Glob` to find all profiles — the active config dir's cache, never a literal `~`:
   ```
   {PLUGIN_CACHE_ROOT}/**/manifest.yaml
   ```
2. For each manifest found:
   - `Read` / parse the YAML.
   - Read the fields (`kind`, `stack`, `priority`, `detect`, `enriches_aspect`, `hosts_aspects`).
   - **Expand a foundation's embedded `frameworks:` array (ADR-0026).** Since the framework
     plugins were folded into their hosting foundation there are **no standalone
     `kind: framework` manifests left in this marketplace** — every framework provider is a row
     under a foundation's `frameworks:` key, and a command that only looked for `kind: framework`
     documents would list none at all. Treat each row as a framework record: `stack`,
     `enriches_aspect`, `dependency`. A row is *active* when the hosting foundation won, its
     `enriches_aspect` is in that foundation's `hosts_aspects`, and its `dependency` coordinate is
     found in one of the foundation's `framework_detection` paths (version catalog first, then
     module build files).
   - For `kind: foundation`, evaluate `detect` rules against the current working directory:
     - `detect.any: ["*"]` → always matches.
     - `detect.all: [...]` → all sub-rules must match.
     - `file_exists: <path>` → check via `Glob` if file exists in project root.
     - `file_contains: { path, pattern }` → `Read` the file and run regex.
3. **Read `<project>/.claude/sdlc.local.yaml`, if it exists, for `frameworks.disable`** (ADR-0027).
   A framework whose `stack` id is listed there is detected but **held back** from the run, so
   listing it as active would contradict the pipeline's own active-profiles banner — which is
   exactly what this command exists to let a user check. Mark such a row `← suppressed` and leave
   it out of the `Active frameworks:` line. `enable` is not a supported key; if one is present,
   say so (it warns on every run and activates nothing).
4. Print a table summarizing each profile.

## Output format

```
Stack profiles found:

  🎯 vanilla       priority=0     (always matches)              ← active fallback
  🎯 android       priority=300   matches: settings.gradle.kts

Additive framework providers:
  ➕ retrofit      framework      enriches: network · matches: libs.versions.toml contains retrofit
  ➖ ktor          framework      enriches: network · matches: libs.versions.toml contains ktor   ← suppressed

Active profile for this project: android (from android-foundation/manifest.yaml)
Active frameworks: retrofit   (ktor suppressed by .claude/sdlc.local.yaml frameworks.disable)
Override with: /sdlc:start --stack=NAME "<feature>"  ·  suppress a framework via frameworks.disable in .claude/sdlc.local.yaml
```

Drop the parenthetical and the `➖` row entirely when nothing is suppressed — the common case is a
project with no `frameworks:` block at all, and a note about an override nobody wrote is noise.

If no profiles found except vanilla:
```
Only the vanilla profile is registered. Install the Android Foundation plugin
(/plugin install android-foundation@agentic-sdlc) to add platform-specific agents.
```

## When to use

- After installing a new stack plugin — verify the profile is picked up.
- When `/sdlc:start` chose the wrong stack — debug detection rules.
- Before running a pipeline on a new project — confirm what will run.
- After adding `frameworks.disable` — confirm the framework really is held back.

## Instructions

Be concise. Print the table as plain text (no markdown table syntax — that renders poorly in chat). Mark the active profile with `← active`. If multiple profiles share the same priority and all match, mark them all and warn about ambiguity.
