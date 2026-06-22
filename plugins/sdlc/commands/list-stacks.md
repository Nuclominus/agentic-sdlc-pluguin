---
description: List all stack profiles found in installed plugins, with priority and detection rules. Useful for verifying setup and debugging stack auto-detection.
argument-hint: ""
---

# /sdlc:list-stacks

List every `stack.md` profile registered in installed plugins. Shows which one would match the current project.

## What this command does

1. Use `Glob` to find all stack profiles:
   ```
   ~/.claude/plugins/cache/**/stack.md
   ```
2. For each profile found:
   - `Read` the file.
   - Parse the YAML frontmatter (`stack`, `priority`, `detect`).
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
  🎯 ios           priority=300   no match: Package.swift not present

Active profile for this project: android (from android-plugin/stack.md)
Override with: /sdlc:start --stack=NAME "<feature>"
```

If no profiles found except vanilla:
```
Only the vanilla profile is registered. Install a framework plugin
(e.g. /plugin install ios-plugin@agentic-sdlc) to add platform-specific agents.
```

## When to use

- After installing a new stack plugin — verify the profile is picked up.
- When `/sdlc:start` chose the wrong stack — debug detection rules.
- Before running a pipeline on a new project — confirm what will run.

## Instructions

Be concise. Print the table as plain text (no markdown table syntax — that renders poorly in chat). Mark the active profile with `← active`. If multiple profiles share the same priority and all match, mark them all and warn about ambiguity.
