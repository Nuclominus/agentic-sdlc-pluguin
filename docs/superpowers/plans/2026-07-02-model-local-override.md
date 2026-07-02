# Project-local model tier overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each project reassign which model tier its SDLC agents run on via a `<project>/.claude/model.local.json` file, authored by a new `/sdlc:model-config` command, honored by both the enforcement hook and the orchestrator.

**Architecture:** A small JSON file (`default` + per-agent `agents{}` map) sits next to `.claude/sdlc.local.yaml`. Two runtime consumers resolve an agent's tier with the chain `agents[bare-name] → default → agent .md frontmatter → sonnet`: the `enforce-agent-model.sh` PreToolUse hook (so it doesn't revert overrides) and the `pipeline-orchestrator` SKILL (dispatch + telemetry). Valid tiers come from the registry (`opus | sonnet | haiku | fable`), so the file is correct by construction. Everything fails open.

**Tech Stack:** Bash + jq/python3 (hook), JSON Schema draft 2020-12, Markdown instruction docs (orchestrator SKILL, command), Python3/Bash test scripts.

## Global Constraints

- Valid tiers are EXACTLY `opus | sonnet | haiku | fable` — the `pipeline_tiers` in `plugins/sdlc/config/models.json` and the only values the `Agent` tool accepts. Never introduce a fifth tier here.
- Override file path: `<project_root>/.claude/model.local.json`, where `project_root = ${CLAUDE_PROJECT_DIR:-$(pwd)}` (hook) / the repo root (orchestrator, command).
- Resolution order (per agent), used identically by BOTH consumers: `agents[<bare-name>]` → `default` → agent `.md` frontmatter `model:` → `sonnet`.
- Bare agent name = the part after the last `:` in a possibly-namespaced agent name (`android-foundation:android-developer` → `android-developer`), mirroring the hook's `bare_name="${agent_name##*:}"`.
- **Fail-open everywhere:** missing file, malformed JSON, invalid tier value, or no JSON parser → behave exactly as today (frontmatter tier wins). Never abort a dispatch or the pipeline because of this optional file.
- The registry remains the SSOT for `tag → model_id + pricing`. This feature changes only WHICH tag an agent uses, never the tag→model_id/pricing mapping.
- The `/sdlc:model-config` helper is a **command** (`plugins/sdlc/commands/model-config.md`), matching `extension.md` / `init.md` — NOT a `skills/` directory.

---

### Task 1: JSON schema + schema-conformance test

**Files:**
- Create: `schemas/model-local.schema.json`
- Test: `tests/test-model-local-schema.py`

**Interfaces:**
- Produces: `schemas/model-local.schema.json` — draft-2020-12 schema with `default` (enum of the four tiers), `agents` (object whose values are that same enum), `additionalProperties: false`, no `required` keys. The `$id` is `https://github.com/Nuclominus/Agentic-SDLC-Pluguin/schemas/model-local.schema.json` (referenced by `$schema` in authored `model.local.json` files and by the command in Task 4).

- [ ] **Step 1: Write the failing test**

Create `tests/test-model-local-schema.py`. It derives the tier list FROM the schema (so the test tracks the schema) and checks structural guarantees plus a good/bad fixture:

```python
#!/usr/bin/env python3
"""Contract test for schemas/model-local.schema.json (no external deps)."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.path.join(HERE, "..", "schemas", "model-local.schema.json")

def fail(msg):
    print(f"FAIL: {msg}")
    sys.exit(1)

with open(SCHEMA_PATH) as f:
    schema = json.load(f)  # raises if the schema is not valid JSON

# Structural guarantees the design requires.
if schema.get("additionalProperties") is not False:
    fail("top-level additionalProperties must be false")
if "required" in schema and schema["required"]:
    fail("schema must not mark any key required")

tiers = schema["properties"]["default"]["enum"]
if sorted(tiers) != ["fable", "haiku", "opus", "sonnet"]:
    fail(f"default.enum must be the four pipeline tiers, got {tiers}")
agent_val = schema["properties"]["agents"]["additionalProperties"]["enum"]
if sorted(agent_val) != ["fable", "haiku", "opus", "sonnet"]:
    fail(f"agents value enum must be the four pipeline tiers, got {agent_val}")

def conforms(doc):
    """Minimal validation covering the constraints that matter for this file."""
    if not isinstance(doc, dict):
        return False
    for k in doc:
        if k not in ("$schema", "description", "default", "agents"):
            return False  # additionalProperties: false
    if "default" in doc and doc["default"] not in tiers:
        return False
    if "agents" in doc:
        if not isinstance(doc["agents"], dict):
            return False
        for v in doc["agents"].values():
            if v not in tiers:
                return False
    return True

good = {"$schema": "x", "default": "haiku", "agents": {"developer": "opus"}}
if not conforms(good):
    fail("valid example rejected")

bad_tier = {"default": "turbo"}
if conforms(bad_tier):
    fail("out-of-enum tier accepted")

bad_key = {"models": {"developer": "opus"}}
if conforms(bad_key):
    fail("unknown top-level key accepted")

if not conforms({}):
    fail("empty object should be valid")

print("PASS: model-local schema contract")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 tests/test-model-local-schema.py`
Expected: FAIL — `FileNotFoundError` / traceback because `schemas/model-local.schema.json` does not exist yet.

- [ ] **Step 3: Create the schema**

Create `schemas/model-local.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin/schemas/model-local.schema.json",
  "title": "SDLC Project-Local Model Tier Overrides",
  "description": "Schema for <project>/.claude/model.local.json — per-project reassignment of the model TIER each SDLC agent dispatches on. Resolution: agents[<bare-agent-name>] -> default -> agent .md frontmatter model: -> sonnet. Tiers are the pipeline_tiers from plugins/sdlc/config/models.json; only these values are accepted by the Agent tool. This file changes which tag an agent uses, never the tag->model_id/pricing mapping (that stays in the registry).",
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "description": { "type": "string" },
    "default": {
      "description": "Tier applied to every agent unless overridden in `agents`.",
      "enum": ["opus", "sonnet", "haiku", "fable"]
    },
    "agents": {
      "type": "object",
      "description": "Per-agent tier map. Keys are bare agent names (e.g. developer, android-developer); a namespaced key uses only the part after the last ':'.",
      "propertyNames": { "pattern": "^[a-z0-9][a-z0-9:-]*$" },
      "additionalProperties": {
        "enum": ["opus", "sonnet", "haiku", "fable"]
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 tests/test-model-local-schema.py`
Expected: `PASS: model-local schema contract`

- [ ] **Step 5: Commit**

```bash
git add schemas/model-local.schema.json tests/test-model-local-schema.py
git commit -m "feat(config): add model-local.schema.json for per-project tier overrides"
```

---

### Task 2: Enforcement hook honors the override

**Files:**
- Modify: `plugins/sdlc/hooks/enforce-agent-model.sh` (add `resolve_override_tier`, apply override before `declared_model=`, update header comment)
- Test: `tests/test-enforce-agent-model.sh`

**Interfaces:**
- Consumes: the resolution order + fail-open rules from Global Constraints; `project_root` and `bare_name` already computed in the hook (lines 57 and 64).
- Produces: `resolve_override_tier <project_root> <bare_name>` — echoes a tier string from `<project_root>/.claude/model.local.json` (`agents[<name>]` else `default`) or nothing; never errors.

- [ ] **Step 1: Write the failing test**

Create `tests/test-enforce-agent-model.sh`:

```bash
#!/usr/bin/env bash
# Tests the project-local override behavior of enforce-agent-model.sh.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_ROOT/plugins/sdlc/hooks/enforce-agent-model.sh"
fails=0

run_hook() {  # $1 = project dir, $2 = requested model  → prints hook stdout
    printf '{"tool_name":"Agent","tool_input":{"subagent_type":"developer","model":"%s"}}' "$2" \
        | CLAUDE_PROJECT_DIR="$1" CLAUDE_PLUGIN_ROOT="" bash "$HOOK"
}

# enforced tier = updatedInput.model if a correction was emitted, else the requested model
enforced_tier() {  # $1 = hook stdout, $2 = requested model
    local m; m=$(printf '%s' "$1" | jq -r '.hookSpecificOutput.updatedInput.model // empty' 2>/dev/null)
    [ -n "$m" ] && printf '%s' "$m" || printf '%s' "$2"
}

mk_project() {  # $1 = model.local.json contents (or "NONE")  → echoes project dir
    local d; d=$(mktemp -d)
    mkdir -p "$d/.claude" "$d/plugins/sdlc/agents"
    printf -- '---\nname: developer\nmodel: sonnet\n---\nbody\n' > "$d/plugins/sdlc/agents/developer.md"
    [ "$1" != "NONE" ] && printf '%s' "$1" > "$d/.claude/model.local.json"
    printf '%s' "$d"
}

check() {  # $1 = label, $2 = expected tier, $3 = actual tier
    if [ "$2" = "$3" ]; then echo "PASS: $1"; else echo "FAIL: $1 — expected '$2' got '$3'"; fails=$((fails+1)); fi
}

# 1. per-agent override wins over frontmatter (sonnet) → opus
p=$(mk_project '{"default":"haiku","agents":{"developer":"opus"}}')
check "per-agent override" "opus" "$(enforced_tier "$(run_hook "$p" sonnet)" sonnet)"

# 2. default applies when no per-agent entry (frontmatter sonnet) → haiku
p=$(mk_project '{"default":"haiku"}')
check "default fallback" "haiku" "$(enforced_tier "$(run_hook "$p" sonnet)" sonnet)"

# 3. invalid override value → fall back to frontmatter sonnet
p=$(mk_project '{"agents":{"developer":"turbo"}}')
check "invalid tier ignored" "sonnet" "$(enforced_tier "$(run_hook "$p" sonnet)" sonnet)"

# 4. no file → frontmatter sonnet enforced (requested opus → corrected to sonnet)
p=$(mk_project NONE)
check "missing file passthrough" "sonnet" "$(enforced_tier "$(run_hook "$p" opus)" opus)"

# 5. malformed JSON → fail open to frontmatter sonnet
p=$(mk_project '{ this is not json ')
check "malformed json fail-open" "sonnet" "$(enforced_tier "$(run_hook "$p" opus)" opus)"

[ "$fails" -eq 0 ] && { echo "ALL PASS"; exit 0; } || { echo "$fails FAILED"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/test-enforce-agent-model.sh`
Expected: FAIL — cases 1 and 2 fail (override not applied yet): "per-agent override — expected 'opus' got 'sonnet'" and "default fallback — expected 'haiku' got 'sonnet'". Cases 3–5 already pass.

- [ ] **Step 3: Add the `resolve_override_tier` function**

In `plugins/sdlc/hooks/enforce-agent-model.sh`, immediately AFTER the `is_valid_tier()` function (currently ends at line 26, before `allow()`), insert:

```bash
# Resolve a project-local per-agent tier override from
# <project_root>/.claude/model.local.json, if that OPTIONAL file exists and parses.
# Echoes a tier string (agents[<name>] preferred, else default) or nothing.
# Fails open (echoes nothing) on any error: missing file, bad JSON, or no parser.
resolve_override_tier() {
    # $1 = project_root, $2 = bare agent name
    local file="$1/.claude/model.local.json"
    [ -f "$file" ] || return 0
    if command -v jq >/dev/null 2>&1; then
        jq -r --arg a "$2" '.agents[$a] // .default // empty' "$file" 2>/dev/null
    elif command -v python3 >/dev/null 2>&1; then
        python3 -c "import json,sys
try:
    d=json.load(open(sys.argv[1]))
    print(d.get('agents',{}).get(sys.argv[2]) or d.get('default') or '')
except Exception:
    pass" "$file" "$2" 2>/dev/null
    fi
}
```

- [ ] **Step 4: Apply the override before enforcing**

In the same file, REPLACE this block (currently lines 103-104):

```bash
# Enforce the short tier name verbatim — the Agent tool rejects full model IDs.
declared_model="$tier"
```

with:

```bash
# ── apply optional project-local override ───────────────────────────────────
# A project may reassign an agent's tier via <project_root>/.claude/model.local.json
# (agents[<name>] preferred, else default). A VALID override replaces the frontmatter
# tier; any error or invalid value falls back to the frontmatter tier (fail-open).
# Diagnostics go to stderr so they never corrupt the JSON decision on stdout.
override_tier=$(resolve_override_tier "$project_root" "$bare_name")
if [ -n "$override_tier" ]; then
    if is_valid_tier "$override_tier"; then
        tier="$override_tier"
    else
        printf '[model-enforcement] ignoring invalid override tier "%s" for %s in .claude/model.local.json — using frontmatter "%s"\n' \
            "$override_tier" "$agent_name" "$tier" >&2
    fi
fi

# Enforce the short tier name verbatim — the Agent tool rejects full model IDs.
declared_model="$tier"
```

- [ ] **Step 5: Update the header comment**

In the same file, REPLACE the comment block at lines 16-20:

```bash
# This list MIRRORS `pipeline_tiers` in plugins/sdlc/config/models.json (the
# model registry / single source of truth) — keep the two in sync. The hook
# keeps its own inline copy on purpose: a PreToolUse hook must fail-open fast
# and must not depend on parsing a config file.
```

with:

```bash
# This list MIRRORS `pipeline_tiers` in plugins/sdlc/config/models.json (the
# model registry / single source of truth) — keep the two in sync. The hook
# keeps its own inline copy on purpose: a PreToolUse hook must fail-open fast.
# It ALSO reads an OPTIONAL per-project override, <project>/.claude/model.local.json
# (agents[<name>] > default), which takes precedence over the frontmatter tier —
# but MUST still fail open (fall back to frontmatter) if that file is absent,
# unparseable, or names an invalid tier.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bash tests/test-enforce-agent-model.sh`
Expected: `ALL PASS` (5 PASS lines, exit 0).

- [ ] **Step 7: Commit**

```bash
git add plugins/sdlc/hooks/enforce-agent-model.sh tests/test-enforce-agent-model.sh
git commit -m "feat(hooks): enforce project-local model.local.json tier overrides"
```

---

### Task 3: Orchestrator resolves the override (load + apply)

**Files:**
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md` (add sub-step 1b-models after line 551; extend Step 3b-3 at line 735)

**Interfaces:**
- Consumes: resolution order from Global Constraints; `CONTEXT` object already used throughout the SKILL.
- Produces: `CONTEXT.model_overrides = { default?, agents{} }`, read in Step 3b-3.

- [ ] **Step 1: Add the load sub-step**

In `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`, AFTER the `sdlc.local.yaml` fail-open paragraph that ends at line 551 (`Do not abort — local override is optional, plugin profile is always usable as fallback.`) and BEFORE `#### 1c. Build the canonical phase order` (line 553), insert:

```markdown
#### 1b-models. Load project-local model tier overrides from `<project>/.claude/model.local.json`

Check whether `<project_root>/.claude/model.local.json` exists.

If absent — set `CONTEXT.model_overrides = {}` and skip this sub-step silently.

If present — `Read` and parse it as JSON. Recognized top-level keys:

| Key | Type | Meaning |
|---|---|---|
| `default` | tier string | Tier applied to EVERY agent unless overridden in `agents`. |
| `agents` | object (bare agent name → tier string) | Per-agent tier override; highest precedence. |

Valid tiers are the registry `pipeline_tiers`: `opus | sonnet | haiku | fable`. Hold the parsed result as `CONTEXT.model_overrides = { default?, agents{} }`.

If parsing fails (invalid JSON, or a value that is not a valid tier), warn and treat the whole file as empty — the plugin/frontmatter tiers remain fully usable (fail-open):

```
⚠️ Failed to parse .claude/model.local.json: <error>. Continuing with agent frontmatter tiers.
```

🚨 **MUST PRINT VERBATIM** if any override is present (otherwise stay silent on this sub-step):

```
🔧 Model tier overrides loaded from .claude/model.local.json:
   default: <tier or "(none)">
   <agent>: <tier>        (one line per agents[] entry)
```
```

- [ ] **Step 2: Extend Step 3b-3 with the override precedence**

In the same file, REPLACE the first sentence of Step 3b-3 (line 735), which currently reads:

```markdown
**3b-3. Resolve model from agent frontmatter** — before spawning, resolve `{model_tier}` by reading the `model:` YAML field from the agent's `.md` file (`plugins/**/agents/{agent_name}.md`).
```

with:

```markdown
**3b-3. Resolve model (project override → frontmatter)** — before spawning, resolve `{model_tier}` by precedence (first hit wins): `CONTEXT.model_overrides.agents[<bare>]` where `<bare>` is the agent name after the last `:` (e.g. `android-foundation:android-developer` → `android-developer`) → `CONTEXT.model_overrides.default` → the `model:` YAML field from the agent's `.md` file (`plugins/**/agents/{agent_name}.md`) → `sonnet`. An override value that is not a valid tier (`opus|sonnet|haiku|fable`) is skipped with an inline warning and resolution falls through to the next source. The `enforce-agent-model.sh` hook applies this SAME override, so the resolved tier is not reverted at dispatch.
```

- [ ] **Step 3: Verify the edits are in place**

Run:
```bash
grep -n "1b-models" plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
grep -n "model_overrides.agents" plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
grep -n "Model tier overrides loaded from" plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
```
Expected: each grep returns at least one line (the load sub-step, the 3b-3 precedence, and the print block).

- [ ] **Step 4: Commit**

```bash
git add plugins/sdlc/skills/pipeline-orchestrator/SKILL.md
git commit -m "feat(orchestrator): resolve model.local.json tier overrides in dispatch"
```

---

### Task 4: `/sdlc:model-config` authoring command

**Files:**
- Create: `plugins/sdlc/commands/model-config.md`
- Test: reuse `tests/test-model-local-schema.py` conformance checker against a sample the command would write

**Interfaces:**
- Consumes: the schema from Task 1; the resolution order from Global Constraints.
- Produces: `/sdlc:model-config` command (auto-registered from `commands/`); writes/merges `<repo_root>/.claude/model.local.json`.

- [ ] **Step 1: Create the command file**

Create `plugins/sdlc/commands/model-config.md`:

```markdown
---
description: Configure per-project model tiers for SDLC agents step-by-step — writes .claude/model.local.json. Sets a project-wide default first, then optional per-agent overrides. Validates against the registry tiers; merges idempotently; never clobbers existing config.
argument-hint: "[--list]"
---

# /sdlc:model-config

Interactive helper to author `<repo_root>/.claude/model.local.json` — the per-project
reassignment of which model **tier** each SDLC agent dispatches on, **without editing any
plugin**. Both the enforcement hook (`enforce-agent-model.sh`) and the orchestrator
(Step 1b-models / 3b-3) resolve tiers as `agents[<bare-name>] → default → agent .md
frontmatter → sonnet`. This command only edits config — it never runs the pipeline.

## What this command does

1. **Repo root check.** `git rev-parse --show-toplevel` should match CWD; otherwise tell the
   user to `cd` there. Target file: `<repo_root>/.claude/model.local.json`. Create `.claude/` if absent.

2. **`--list` fast path.** If `$ARGUMENTS` contains `--list`: read the target file (if present)
   and print `default` plus the `agents` map as a table (`agent │ tier`). If the file is absent,
   print `No model overrides configured.` and stop.

3. **Discover valid choices** (so the user picks from real names/tiers, not free text):
   - **Tiers:** read `plugins/sdlc/config/models.json` (via `Glob ~/.claude/plugins/cache/**/sdlc/config/models.json`).
     Offer each tag in `pipeline_tiers`, annotated with its `model_id` and `pricing`
     (e.g. `haiku → claude-haiku-4-5-20251001  ($1/$5 per MTok)`).
   - **Agents:** `Glob ~/.claude/plugins/cache/**/agents/*.md`; the agent name is each file's
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

\`\`\`json
{
  "$schema": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin/schemas/model-local.schema.json",
  "default": "haiku",
  "agents": {
    "business-analyst": "sonnet",
    "security-analyst": "opus"
  }
}
\`\`\`

## Output

\`\`\`
🎛️  SDLC model tier overrides

Discovered: 11 agents, 4 tiers

default: haiku
agents:
  business-analyst   → sonnet
  security-analyst   → opus

Wrote: .claude/model.local.json

Next:
  /sdlc:start "<feature>"      # agents dispatch on these tiers (hook + orchestrator agree)
\`\`\`

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
```

Note: in the file you create, the three ` ``` ` fences shown above as `\`\`\`` must be written as normal triple-backtick fences.

- [ ] **Step 2: Verify a command-produced sample validates**

Create the sample the command documents and run the Task 1 checker against it:

```bash
python3 - <<'PY'
import json, sys, os
sys.path.insert(0, "tests")
# reuse the conformance logic by importing the module's helpers
import importlib.util
spec = importlib.util.spec_from_file_location("t", "tests/test-model-local-schema.py")
# the test module runs assertions on import; instead just re-check the sample inline:
schema = json.load(open("schemas/model-local.schema.json"))
tiers = schema["properties"]["default"]["enum"]
sample = {
  "$schema": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin/schemas/model-local.schema.json",
  "default": "haiku",
  "agents": {"business-analyst": "sonnet", "security-analyst": "opus"}
}
allowed = {"$schema","description","default","agents"}
assert set(sample) <= allowed, "unknown key"
assert sample["default"] in tiers
assert all(v in tiers for v in sample["agents"].values())
print("PASS: command sample conforms to schema")
PY
```
Expected: `PASS: command sample conforms to schema`

- [ ] **Step 3: Confirm the command auto-registers**

Run: `ls plugins/sdlc/commands/model-config.md && head -3 plugins/sdlc/commands/model-config.md`
Expected: the file exists and its frontmatter `description:` prints. (Commands under `commands/` are auto-discovered — no registration edit needed, matching `extension.md`.)

- [ ] **Step 4: Commit**

```bash
git add plugins/sdlc/commands/model-config.md
git commit -m "feat(commands): add /sdlc:model-config to author model.local.json"
```

---

### Task 5: Docs — README + CHANGELOG

**Files:**
- Modify: `plugins/sdlc/README.md` (add a "Project-local model tiers" section)
- Modify: `CHANGELOG.md` (add entries under `## [Unreleased]`)

**Interfaces:**
- Consumes: everything above. No code; documentation must match the shipped behavior exactly.

- [ ] **Step 1: Add the CHANGELOG entries**

In `CHANGELOG.md`, REPLACE the line `## [Unreleased]` (currently line 5, followed by a blank line) with:

```markdown
## [Unreleased]

### Added

- **Project-local model tier overrides `<project>/.claude/model.local.json`.** A project can reassign
  which tier each SDLC agent dispatches on — a `default` for all agents plus a per-agent `agents{}` map
  (`opus | sonnet | haiku | fable`). Resolution is `agents[<bare-name>] → default → agent .md
  frontmatter → sonnet`, applied identically by the `enforce-agent-model.sh` hook (so overrides are not
  reverted) and the orchestrator (new Step 1b-models; Step 3b-3). Validated by
  `schemas/model-local.schema.json`. Fail-open: a missing/malformed file or invalid tier falls back to
  the built-in frontmatter tiers. The registry stays the SSOT for tag→model_id+pricing — this only
  changes which tag an agent uses.
- **`/sdlc:model-config` command.** Interactive authoring of `.claude/model.local.json`: sources valid
  tiers from the registry, sets a project-wide default first, then optional per-agent overrides; merges
  idempotently and never clobbers existing config.
```

- [ ] **Step 2: Add the README section**

In `plugins/sdlc/README.md`, find the section documenting `sdlc.local.yaml` / the Project Extension Manifest (search for `sdlc.local.yaml`). Immediately AFTER that section (before the next `## ` heading), insert:

```markdown
## Project-local model tiers (`.claude/model.local.json`)

Each project can override which model **tier** its SDLC agents run on, without editing any plugin.
Create `<repo_root>/.claude/model.local.json` (or run `/sdlc:model-config`):

\`\`\`json
{
  "$schema": "https://github.com/Nuclominus/Agentic-SDLC-Pluguin/schemas/model-local.schema.json",
  "default": "haiku",
  "agents": {
    "business-analyst": "sonnet",
    "security-analyst": "opus"
  }
}
\`\`\`

- `default` — tier applied to every agent unless overridden.
- `agents` — per-agent override, keyed by bare agent name.
- Valid tiers: `opus | sonnet | haiku | fable` (the registry `pipeline_tiers`).

**Resolution (per agent):** `agents[<bare-name>]` → `default` → the agent's `.md` frontmatter `model:`
→ `sonnet`. Both the `enforce-agent-model.sh` hook and the orchestrator apply this same chain, so an
override is honored at dispatch and not reverted. A missing or malformed file, or an invalid tier, falls
back to the built-in tiers (fail-open). This changes only which tag an agent uses — the model registry
(`config/models.json`) remains the single source of truth for tag→model_id and pricing.

Author it interactively with `/sdlc:model-config` (default tier first, then optional per-agent), or
`/sdlc:model-config --list` to review the current mapping.
```

Note: write the two ` ``` ` fences shown as `\`\`\`` as normal triple-backtick fences.

- [ ] **Step 3: Verify the docs render the intended content**

Run:
```bash
grep -n "model.local.json" CHANGELOG.md plugins/sdlc/README.md
grep -n "sdlc:model-config" CHANGELOG.md plugins/sdlc/README.md
```
Expected: matches in both files for both terms.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md plugins/sdlc/README.md
git commit -m "docs: document model.local.json overrides and /sdlc:model-config"
```

---

## Self-Review

**Spec coverage:**
- File format `model.local.json` (`default` + `agents`) → Task 1 (schema) + used in all tasks. ✅
- Resolution order → Global Constraints + Task 2 (hook) + Task 3 (orchestrator). ✅
- Consumer 1 (hook) → Task 2. ✅
- Consumer 2 (orchestrator Step 1b load + 3b-3 apply) → Task 3. ✅
- `schemas/model-local.schema.json` → Task 1. ✅
- `sdlc:model-config` interactive skill (default-first, per-agent, idempotent) → Task 4 (as a command, matching repo convention — noted deviation from the spec's `skills/` path). ✅
- Tests (hook shell test + schema validation) → Task 1 + Task 2. ✅
- Docs (README, CHANGELOG, orchestrator cross-ref) → Task 3 (SKILL) + Task 5. ✅
- Out-of-scope items (registry remap, YAML folding, non-SDLC agents) → untouched. ✅

**Placeholder scan:** No TBD/TODO; all code and doc insertions are literal. ✅

**Type/name consistency:** `resolve_override_tier`, `CONTEXT.model_overrides` (`.default`, `.agents`), bare-name derivation, and the four tiers are used identically across Tasks 1–5. ✅
```
