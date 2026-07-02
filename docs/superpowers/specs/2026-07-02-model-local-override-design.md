# Project-local model tier overrides (`model.local.json`) + `sdlc:model-config` skill

**Date:** 2026-07-02
**Status:** Approved (design)

## Problem

The tier each SDLC agent runs on is fixed in the plugin: it lives in each agent's
`.md` frontmatter (`model: <tag>`), enforced at dispatch by
`plugins/sdlc/hooks/enforce-agent-model.sh`. A project cannot change which model an
agent uses without editing plugin files. We want each project to declare its own
per-agent tier assignment — e.g. run the whole pipeline on `haiku` for a
cost-sensitive repo, with surgical exceptions — through a project-local file, plus
an interactive skill to author that file correctly.

## Scope

Per-agent **tier** override (which of `opus | sonnet | haiku | fable` an agent
dispatches on). NOT registry remapping and NOT pricing changes — the registry
(`plugins/sdlc/config/models.json`) remains the single source of truth for
`tag → model_id + pricing`. The override only changes *which tag* an agent uses; the
tag→model_id+pricing lookup is unchanged.

## Background: how model selection works today

- **Registry** `plugins/sdlc/config/models.json` — SSOT mapping a short `tag`
  (`opus`, `sonnet`, …) to a real `model_id` and `pricing`. `pipeline_tiers` lists
  the four tags the pipeline dispatches: `opus | sonnet | haiku | fable`. Used
  **only** for telemetry/cost accounting; the orchestrator loads it in Step 3d-0 via
  `Glob("~/.claude/plugins/cache/**/sdlc/config/models.json")`.
- **Per-agent tier** — each agent's `.md` frontmatter `model:` field. The
  orchestrator resolves it in Step 3b-3, prints it in 3b-2, and passes the SHORT tier
  verbatim to `Agent()` in 3c (the `Agent` tool rejects full model IDs).
- **Enforcement** — the `enforce-agent-model.sh` PreToolUse hook reads the agent
  `.md` frontmatter tier and *corrects* any `Agent()` dispatch back to that tier.

The critical consequence: **both** the orchestrator and the hook decide the tier
from the frontmatter. An override that only touched the orchestrator would be
silently reverted by the hook. Both must honor the same override file.

## The file: `<project>/.claude/model.local.json`

Lives alongside the existing `.claude/sdlc.local.yaml`. JSON (matches `models.json`;
also the format the hook can parse with its existing `jq`/`python3` dependency —
YAML is not reliably parseable in the hook).

```json
{
  "$schema": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin/schemas/model-local.schema.json",
  "default": "haiku",
  "agents": {
    "business-analyst": "sonnet",
    "security-analyst": "opus"
  }
}
```

- `default` (optional): tier applied to **every** agent unless a per-agent entry
  overrides it.
- `agents` (optional): per-agent tier map. Keys are **bare agent names**
  (`developer`, `qa-engineer`, `android-developer`). A namespaced key
  (`android-foundation:android-developer`) is accepted — only the part after the last
  `:` is used, mirroring the hook's `bare_name="${agent_name##*:}"`.
- Every tier value MUST be one of `opus | sonnet | haiku | fable` (the only values
  the `Agent` tool accepts).
- Both keys optional; `{}` is valid and behaves like no file.

### Resolution order (per agent)

`agents[<bare-name>]` → `default` → agent `.md` frontmatter `model:` → `sonnet`.

- An **invalid** tier value (not one of the four) is skipped with a warning;
  resolution falls through to the next source.
- A missing or malformed file → behave exactly as today (frontmatter wins). Every
  error path is **fail-open**, consistent with the rest of the codebase.

## Consumers to change (both, or the feature silently breaks)

### 1. `plugins/sdlc/hooks/enforce-agent-model.sh`

After extracting the frontmatter `tier`, look up an override in
`${project_root}/.claude/model.local.json` (project root =
`${CLAUDE_PROJECT_DIR:-$(pwd)}`, already computed). Order: `agents[bare_name]`, else
`default`. If a valid tier is found, it becomes the enforced `declared_model` instead
of the frontmatter tier; the correction/passthrough logic downstream is unchanged.

Strictly fail-open:
- File absent → use frontmatter tier (today's behavior).
- File present but invalid JSON, or override value not a valid tier → warn via
  `allow_warn`, use frontmatter tier.
- Neither `jq` nor `python3` available → skip the override lookup entirely (the hook
  already fails open in this case).

Update the top-of-file comment: the hook now reads an *optional* project override
file, but MUST fail open if it can't be parsed — it still must not *depend* on the
file existing.

Reuse the existing `jq`-preferred / `python3`-fallback pattern already in the hook.

### 2. `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`

- **Load once per run.** In Step 1b (next to the `sdlc.local.yaml` load), read
  `<project_root>/.claude/model.local.json` if present, parse, and hold as
  `CONTEXT.model_overrides = { default?, agents{} }`. Malformed → warn and treat as
  empty (fail-open). Print a `🔧 Model tier overrides loaded from
  .claude/model.local.json:` line listing the default and any per-agent entries when
  non-empty; stay silent otherwise.
- **Apply in Step 3b-3.** Change tier resolution to the chain above:
  `CONTEXT.model_overrides.agents[bare_name]` → `CONTEXT.model_overrides.default` →
  frontmatter `model:` → `sonnet`. The resolved tier is what 3b-2 prints, 3c
  dispatches, and 3d telemetry resolves against the registry for `model_id`/pricing.
  Invalid override value → warn inline, fall through.

## New artifacts

### `schemas/model-local.schema.json`

JSON Schema (draft 2020-12), consistent with `models.schema.json` /
`workflow.schema.json`:
- `type: object`, `additionalProperties: false`, no required keys.
- `default`: enum `["opus","sonnet","haiku","fable"]`.
- `agents`: object whose values are the same enum;
  `propertyNames.pattern = "^[a-z0-9][a-z0-9:-]*$"` (allows bare and namespaced keys).
- `$schema`, `description` string properties allowed.

### `sdlc:model-config` skill — interactive authoring

Plugin-owned skill under `plugins/sdlc/skills/model-config/SKILL.md`, user-invocable
as `/sdlc:model-config`. Parallels `sdlc:extension` (authors a local config file,
idempotent, never clobbers). Steps:

1. **Discover (silent).**
   - Load the registry `models.json` → valid tiers with their `model_id` + `pricing`
     (so choices show what each tier means and costs).
   - Discover installed agents via `Glob ~/.claude/plugins/cache/**/agents/*.md`
     (dev-checkout fallback: `plugins/**/agents/*.md`), reading each frontmatter
     `model:` as its current default tier. Present `agent → current tier`.
   - Read existing `.claude/model.local.json` if present (for merge).
2. **Default tier first.** Offer to set one project-wide `default` tier — each option
   annotated with its model + price — or skip (agents keep their frontmatter tiers).
3. **Per-agent, step by step (optional).** Ask whether to override specific agents.
   If yes, iterate each agent showing its current *effective* tier (existing override
   → default → frontmatter) and let the user pick a tier or keep it. Only entries
   that differ from the resolved default are written, keeping the file minimal.
4. **Write & validate.** Merge into the existing file without clobbering unrelated
   content, validate against `schemas/model-local.schema.json`, write, and print a
   summary of what changed. Idempotent — safe to re-run.

## Testing

- **Hook shell test** for `enforce-agent-model.sh`: synthetic Agent payload against a
  temp project dir, asserting the enforced tier for: per-agent hit, `default`
  fallback, invalid-tier value (falls back to frontmatter), missing file
  (passthrough), malformed JSON (passthrough).
- **Schema validation:** the example file validates; an out-of-enum tier fails.

## Docs

- Section in `plugins/sdlc/README.md` documenting `model.local.json` + the
  `/sdlc:model-config` skill and the resolution order.
- `CHANGELOG.md` entry.
- Cross-reference note in the pipeline-orchestrator SKILL where tier resolution is
  described.

## Out of scope (YAGNI)

- Registry remap / pricing override per project.
- Folding tier overrides into `sdlc.local.yaml`.
- Overriding tiers for non-SDLC agents outside the pipeline (the hook only acts on
  agents whose `.md` it can find; behavior there is unchanged).
