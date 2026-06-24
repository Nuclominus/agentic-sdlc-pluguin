---
description: List all stack profiles found in installed plugins, with priority and detection rules. Useful for verifying setup and debugging stack auto-detection.
argument-hint: ""
---

# /sdlc:list-stacks

List every `stack.md` and `framework.md` profile registered in installed plugins. Shows which platform profile would match the current project, plus which additive framework providers activate.

## What this command does

1. Use `Glob` to find all profiles:
   ```
   ~/.claude/plugins/cache/**/stack.md
   ~/.claude/plugins/cache/**/framework.md
   ```
2. For each profile found:
   - `Read` the file.
   - Parse the YAML frontmatter (`stack`, `priority`, `detect`, optional `additive`).
   - Evaluate `detect` rules against the current working directory:
     - `detect.any: ["*"]` → always matches.
     - `detect.all: [...]` → all sub-rules must match.
     - `file_exists: <path>` → check via `Glob` if file exists in project root.
     - `file_contains: { path, pattern }` → `Read` the file and run regex.
3. Print a table summarizing each profile.

## Output format

```
Stack profiles found:

  🎯 vanilla       priority=0     (always matches)              ← active fallback
  🎯 android       priority=300   matches: settings.gradle.kts

Additive framework providers:
  ➕ retrofit      additive       matches: libs.versions.toml contains retrofit

Active profile for this project: android (from android-foundation/stack.md)
Active frameworks: retrofit
Override with: /sdlc:start --stack=NAME "<feature>"  ·  toggle frameworks via .claude/sdlc.local.yaml
```

If no profiles found except vanilla:
```
Only the vanilla profile is registered. Install the Android Foundation plugin
(/plugin install android-foundation@agentic-sdlc) to add platform-specific agents.
```

## When to use

- After installing a new stack plugin — verify the profile is picked up.
- When `/sdlc:start` chose the wrong stack — debug detection rules.
- Before running a pipeline on a new project — confirm what will run.

## Instructions

Be concise. Print the table as plain text (no markdown table syntax — that renders poorly in chat). Mark the active profile with `← active`. If multiple profiles share the same priority and all match, mark them all and warn about ambiguity.
