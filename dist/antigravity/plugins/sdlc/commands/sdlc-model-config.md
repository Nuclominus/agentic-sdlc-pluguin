---
description: Configure per-project model tiers for SDLC agents step-by-step — writes .claude/model.local.json. Sets a project-wide default first, then optional per-agent overrides. Validates against the registry tiers; merges idempotently; never clobbers existing config.
argument-hint: "[--list]"
---

# /sdlc:model-config

Interactive helper to author `<repo_root>/.claude/model.local.json` — the per-project
reassignment of which model **tier** each SDLC agent dispatches on, **without editing any
plugin**. Both the enforcement hook (`enforce-agent-model.sh`) and the orchestrator
(`tools/resolve/profile.mjs` → `parseModelOverrides`, then Step 3b-3) resolve tiers as `agents[<bare-name>] → default → agent .md
frontmatter → sonnet`. This command only edits config — it never runs the pipeline.

## What this command does

1. **Repo root check.** `git rev-parse --show-toplevel` should match CWD; otherwise tell the
   user to `cd` there. Target file: `<repo_root>/.claude/model.local.json`. Create `.claude/` if absent.

2. **`--list` fast path.** If `$ARGUMENTS` contains `--list`: read the target file (if present)
   and print `default` plus the `agents` map as a table (`agent │ tier`). If the file is absent,
   print `No model overrides configured.` and stop.

3. **Discover valid choices** (so the user picks from real names/tiers, not free text). Resolve
   `{SDLC_PLUGIN_ROOT}` / `{PLUGIN_CACHE_ROOT}` first per `plugins/sdlc/PLUGIN-PATHS.md` — never
   glob a literal `~`:
   - **Tiers:** `Read {SDLC_PLUGIN_ROOT}/config/models.json` (the running install's own registry —
     a `**` glob would also match other cached versions of this plugin).
     Offer each tag in `pipeline_tiers`, annotated with its `model_id` and `pricing`
     (e.g. `haiku → claude-haiku-4-5-20251001  ($1/$5 per MTok)`).
   - **Agents:** `Glob {SDLC_PLUGIN_ROOT}/agents/*.md` — since ADR-0021 the core is the only plugin
     that ships agents, so a marketplace-wide glob would only ever find this one directory; the agent name is each file's
     frontmatter `name:` (fall back to filename without `.md`); record its frontmatter `model:` as
     the current default tier. De-duplicate and sort.

4. **Set the default tier FIRST** (use `AskUserQuestion`): "Set a project-wide default tier for all
   agents?" — options are the discovered tiers (each showing model + price) plus "Skip (keep each
   agent's built-in tier)". If a tier is chosen, it becomes `default`.

5. **Per-agent overrides (optional).** Ask "Override specific agents?" If yes, iterate the discovered
   agents. For each, show its current EFFECTIVE tier (existing override → default just chosen →
   frontmatter) and offer the tiers plus "Keep". Record only agents the user sets to a tier that
   differs from the resolved `default` (keeps the file minimal; an entry equal to `default` is dropped).

6. **Confirm & merge — idempotent, non-destructive.** Show the resulting `default` + `agents` and ask
   **write & finish / cancel**. On write: read the existing file (if any), preserving `$schema`/
   `description`; set `default` (or remove it if the user skipped), and merge `agents` entries (update
   in place, drop entries the user set to "Keep"/removed). Never touch unrelated content. If the file
   did not exist, create it with the `$schema` pointer:
   `"$schema": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin/schemas/model-local.schema.json"`.

7. **Validate & report.** Ensure every written tier is one of `pipeline_tiers`; if the user somehow
   supplied an invalid one via "Other", warn and re-ask. Print the final table and the next step.

## JSON shape written

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

## Output

```
🎛️  SDLC model tier overrides

Discovered: 11 agents, 4 tiers

default: haiku
agents:
  business-analyst   → sonnet
  security-analyst   → opus

Wrote: .claude/model.local.json

Next:
  /sdlc:start "<feature>"      # agents dispatch on these tiers (hook + orchestrator agree)
```

## Hard rules

- **Non-destructive.** Merge into the existing `.claude/model.local.json`; never overwrite or drop
  unrelated keys. Same agent ⇒ update in place, never duplicate.
- **Tiers from the registry only.** Valid values are `pipeline_tiers` from `models.json`
  (`opus|sonnet|haiku|fable`) — never invent a tier.
- **Default first, then per-agent.** Offer the project-wide default before per-agent overrides.
- **Minimal file.** Drop per-agent entries equal to the chosen `default`.
- **No pipeline run.** This command only authors config.
- **Reuse, don't reimplement.** Agent/registry discovery mirrors `pipeline-orchestrator` Step 3b-3 / 3d-0
  and `/sdlc:extension`.

## When to use

- Running the SDLC pipeline on a cheaper (or pricier) tier for a specific project.
- Reviewing (`--list`) or adjusting the current per-agent tier assignments.
