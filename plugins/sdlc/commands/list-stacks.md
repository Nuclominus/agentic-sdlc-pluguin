---
description: List all stack profiles found in installed plugins, with priority and detection rules. Useful for verifying setup and debugging stack auto-detection.
argument-hint: ""
---

# /sdlc:list-stacks

List every stack profile registered in installed plugins. Invoke the **`sdlc:list-stacks`** skill.

The skill: globs every `manifest.yaml`, evaluates each foundation's `detect` rules against the
current project, expands each foundation's embedded framework rows (ADR-0026), applies this
project's `frameworks.disable` (ADR-0027), and prints a plain-text table of what's registered vs.
what's active.
