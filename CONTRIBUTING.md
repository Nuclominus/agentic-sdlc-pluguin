# Contributing

This marketplace targets **native mobile only** (Android/Kotlin, iOS/Swift). Please keep
contributions within that scope — no web/server stack providers.

## Adding or changing a platform plugin

A platform plugin registers itself; it never edits the core. It contains:

```
<platform>-plugin/
├── .claude-plugin/plugin.json   ← dependencies: ["sdlc"]
├── stack.md                      ← stack, priority, aspects, detect (validates against schemas/stack.schema.json)
├── agents/<platform>-architect.md
├── skills/<name>/SKILL.md
└── hooks/                        ← format-on-stop + guard-paths
```

## Before opening a PR

- Validate JSON: every `plugin.json`, `hooks.json`, `runtime-dependencies.json`, and `marketplace.json`.
- Validate each `stack.md` frontmatter against `schemas/stack.schema.json`.
- `bash -n` every hook script.
- Keep agent frontmatter (`model`, `effort`, `tools`) stable — it is prompt-cache-sensitive.
- Builds stay CI-deferred: do not add `assembleDebug` / `xcodebuild` to in-pipeline post-checks.

## Core changes

Changes to `plugins/sdlc/**` affect every platform. See `CORE-TODO.md` for the planned mobile
retune (file_glob detection, MASVS security, QA/build philosophy). Discuss core changes in an issue first.

## Attribution

Derived from claude-sdlc (MIT). Preserve `NOTICE` and `LICENSE`.
