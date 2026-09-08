---
description: Author the Project Extension Manifest step-by-step — add per-agent Skill mappings to .claude/sdlc.local.yaml interactively. Validates skill/agent names; merges idempotently; never clobbers existing config.
argument-hint: "[--list]"
---

# /sdlc:extension

Interactive helper to build the **Project Extension Manifest** — the `extensions.skills` block in
`.claude/sdlc.local.yaml` that attaches Skills to agents **without editing any plugin**. The
orchestrator injects these into pipeline phase agents (Step 3b-1a) and on-demand agents self-read
them; see the root README "Project Extension Manifest". This command only edits config — it never
runs the pipeline.

## What this command does

1. **Repo root check.** `git rev-parse --show-toplevel` should match CWD; otherwise tell the user to
   `cd` there. Note the target file: `<repo_root>/.claude/sdlc.local.yaml`. Create `.claude/` if absent.

2. **`--list` fast path.** If `$ARGUMENTS` contains `--list`: read the target file (if present), print
   the current `extensions.skills` rows as a table (`skill │ agents │ policy │ when`), and stop. If the
   file or block is absent, print `No extensions configured.` and stop.

3. **Discover valid choices** (so the user picks from real names, not free text). Resolve
   `{PLUGIN_CACHE_ROOT}` first per `plugins/sdlc/PLUGIN-PATHS.md` — never glob a literal `~`:
   - **Agents:** `Glob {SDLC_PLUGIN_ROOT}/agents/*.md` — since ADR-0021 the core is the only plugin
     that ships agents, so a marketplace-wide glob would only ever find this one directory; the agent name is each file's
     frontmatter `name:` (fall back to the filename without `.md`). Also offer the literal `"all"`.
   - **Skills:** `Glob {PLUGIN_CACHE_ROOT}/**/skills/*/SKILL.md`; the id is
     `{plugin_dir}:{skill_dir}`. If `mcp__skills__list_skills` is available, prefer it and normalize to
     the same `{plugin}:{skill}` form. De-duplicate and sort both lists.

4. **Gather one mapping** (use `AskUserQuestion`; loop to add more — see step 6):
   1. **Skill** — present the discovered skill ids as options (most relevant first). Allow a custom
      `{plugin}:{skill}` value via "Other". Warn (do not block) if the chosen id isn't in the discovered
      set — it may be from an uninstalled plugin (the orchestrator downgrades those to best-effort
      `recommended`).
   2. **Agents** — multi-select from the discovered agent names plus `"all"`. If `"all"` is chosen,
      ignore any individually-selected agents and store the string `"all"`.
   3. **When** — short free-text hint (e.g. "before implementing Compose UI"); optional, may be empty.
   4. **Policy** — `recommended` (default) or `mandatory`.

5. **Validate the mapping** (graceful — warn, let the user confirm or re-pick):
   - Skill id must be `<plugin>:<skill>` shape (one colon, non-empty halves).
   - At least one agent (or `"all"`). Drop unknown agent names with a warning.
   - `policy` ∈ {`recommended`, `mandatory`}; otherwise default to `recommended`.

6. **Confirm & merge — idempotent, non-destructive.**
   - Show the row that will be written and ask: **add another / write & finish / cancel**.
   - On **write**: read the existing file (if any), preserving ALL other keys and comments. Locate the
     top-level `extensions:` → `skills:` list (create it if missing). **Append** each new row. If a row
     with the same `skill` AND the same `agents` set already exists, **update it in place** (refresh
     `when`/`policy`) instead of adding a duplicate. Never reorder or drop unrelated content.
   - **Overlap guard:** if the new row names a `skill` that an existing row ALSO targets for one or
     more of the same agents (e.g. existing `agents: "all"` vs. new `agents: [developer]`),
     warn the user — at runtime the orchestrator dedupes such overlaps to one line per skill (strictest
     policy wins, 3b-1a), so the extra row only adds noise. Offer to merge into the existing row instead.
   - If the file did not exist, create it with a one-line header comment and just the `extensions:` block.

7. **Report.** Print the final `extensions.skills` table and the next step.

## YAML shape written

```yaml
extensions:
  skills:
    - skill: "superpowers:test-driven-development"
      agents: [developer]            # list of agent names, or the string "all"
      when: "before writing production code"
      policy: mandatory                # mandatory | recommended
```

## Output

```
🧩 SDLC extension manifest

Discovered: 12 agents, 6 skills (3 plugins)

Added mapping:
  skill:   superpowers:test-driven-development
  agents:  [developer]
  when:    before writing production code
  policy:  mandatory

Wrote: .claude/sdlc.local.yaml  (extensions.skills: 1 row total)

Current extensions.skills:
  skill                                     │ agents              │ policy      │ when
  superpowers:test-driven-development        │ developer           │ mandatory   │ before writing production code

Next:
  /sdlc:start "<feature>"      # the orchestrator will inject these per agent
```

## Hard rules

- **Non-destructive.** Merge into the existing `.claude/sdlc.local.yaml`; never overwrite or drop
  unrelated keys/comments. Same `skill`+`agents` ⇒ update in place, never duplicate.
- **Generic only.** This writes the platform-neutral `extensions.skills` schema — no platform-specific
  knowledge. Any installed plugin's skills/agents are valid targets.
- **Validate, don't block.** Unknown skills/agents produce warnings, not hard failures — an
  uninstalled extension skill is downgraded to best-effort `recommended` by the orchestrator at runtime.
- **No pipeline run.** This command only authors config.
- **Reuse, don't reimplement.** Skill discovery lives in `tools/resolve/deps.mjs` (`enumerateSkills`); agent tier selection is `pipeline-orchestrator` Step 3b-3.

## When to use

- Adding a project-specific Skill requirement for one or more agents without forking a plugin.
- Reviewing (`--list`) or adjusting the current per-agent skill mappings.
