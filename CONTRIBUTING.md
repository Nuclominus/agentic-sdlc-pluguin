# Contributing

This marketplace is **Android-centric** (Android/Kotlin). Please keep contributions within that
scope — no web/server stack providers.

> **Fastest path:** run the **`sdlc:create-pluguin`** skill — a step-by-step wizard that scaffolds a
> schema-valid plugin (framework or foundation): identity, functional aspect from the taxonomy,
> `manifest.yaml`, drafted phase injections + a conventions skill, marketplace registration, and
> validation. The sections below document the same structure for hand-authoring.

There are now two kinds of plugin:

- **Stack providers** (like `android-foundation`) — register a stack via `manifest.yaml`
  (`kind: foundation`), own the pipeline phases, and ship the specialized agent roster.
- **Additive framework providers** (like `retrofit-plugin`) — register a framework library via
  `manifest.yaml` (`kind: framework`, same schema). They are **enrich-only**: they
  contribute a convention skill + phase-prompt injections + ProGuard keep rules + post-checks, ship
  **no agents**, and own **no phases**. The orchestrator auto-detects them and merges their
  enrichments into the active flow.

## Adding or changing a stack-provider plugin

A stack provider registers itself; it never edits the core. It contains:

```
<stack>-plugin/
├── .claude-plugin/plugin.json   ← dependencies: ["sdlc"]
├── manifest.yaml                 ← kind: foundation — stack, priority, aspects, detect (validates against schemas/manifest.schema.json)
├── agents/<stack>-*.md
├── skills/<name>/SKILL.md
└── hooks/                        ← format-on-stop + guard-paths
```

## Adding or changing an additive framework plugin

An additive framework provider also registers itself without editing the core. It contains:

```
<framework>-plugin/
├── .claude-plugin/plugin.json   ← dependencies: ["sdlc"]
├── manifest.yaml                 ← kind: framework — enriches_aspect, dependency (validates against schemas/manifest.schema.json)
├── skills/<name>/SKILL.md        ← convention skill
└── rules/snippets/               ← phase-prompt injections + ProGuard keep rules
```

## Before opening a PR

- Validate JSON: every `plugin.json`, `hooks.json`, `runtime-dependencies.json`, and `marketplace.json`.
- Validate each `manifest.yaml` against `schemas/manifest.schema.json` (e.g. `npx check-jsonschema --schemafile schemas/manifest.schema.json plugins/*/manifest.yaml`).
- `bash -n` every hook script.
- Keep agent frontmatter (`model`, `effort`, `tools`) stable — it is prompt-cache-sensitive.
- Builds stay CI-deferred: do not add `assembleDebug` / `assembleRelease` to in-pipeline post-checks.

## Core changes

Changes to `plugins/sdlc/**` affect every platform. See `CORE-TODO.md` for the planned mobile
retune (file_glob detection, MASVS security, QA/build philosophy). Discuss core changes in an issue first.

## Attribution

Derived from claude-sdlc (MIT). Preserve `NOTICE` and `LICENSE`.
