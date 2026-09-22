---
adr: 30
status: accepted
date: 2026-09-09
supersedes: null
---

# ADR-0030 — A project's SDLC files live in `.sdlc/`, not in a host's directory

## Context

Five files this marketplace owns lived in `<project>/.claude/`:

| File | What it decides |
|---|---|
| `sdlc.local.yaml` | extensions, per-agent skill mappings, cost-cap overrides, `heal_checks` |
| `model.local.json` | per-project model tiers |
| `sdlc-workflows/` | project-local recipes |
| `sdlc-lessons.md` | AAR lessons injected into the orchestrator's stable prefix |

`.claude/` is Claude Code's directory. Putting our files there was untidy while Claude Code was the
only host; it became wrong once the pipeline ran on others, and the operator said so plainly: a
Gemini host should not be reading configuration out of `.claude/`.

The wrongness is not aesthetic. Track J had just finished fixing two defects of exactly this shape —
project skills read from `<project>/.claude/skills` on a host that loads them from
`<workspace>/.agents/skills`, and plugin enablement merged from Claude Code's `settings.json` on a
host with its own. Both produced plausible wrong answers rather than errors. Our own files sitting
in the same directory made it harder to see which of those five belonged to the host and which
belonged to us.

## Decision

**They move to `<project>/.sdlc/`. One directory, host-neutral, no fallback read.**

1. **One directory, not one per host.** The obvious alternative was `.gemini/` on Antigravity,
   `.codex/` on Codex. Rejected because the CONTENT is host-neutral: extensions, skill mappings,
   agent bindings, cost caps and recipes mean the same thing everywhere, and
   [[decisions/ADR-0029-one-ssot-emitted-host-packages]] §6 deliberately keeps tier tags
   untranslated across hosts. Per-host copies would put the same fact in two places for any project
   that runs the pipeline on more than one CLI — the drift shape the model-registry split was
   corrected to avoid, arriving from the other direction.

   The registry split went the other way for the opposite reason, and the pair is the rule:
   **split what differs per host, share what does not.** Prices differ per provider and were split;
   a cost cap does not and is shared.

2. **No fallback read of the old location.** A dual lookup is the alias layer
   [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]] §5 deleted after six
   defects, and it would have to live in four separate readers. A project's files are migrated once,
   visibly, with the user's approval — the same answer ADR-0021 gave for the agent-name rename, and
   the same machinery (`tools/migrate`).

3. **But the old location is NOTICED.** A silent rename is its own defect: a cost cap left behind
   in `.claude/sdlc.local.yaml` simply stops capping, the skill mappings stop mapping, and the run
   looks entirely normal. So the resolver does not read the old path and does not ignore it either
   — it warns, names each file, and points at `/sdlc-doctor`. This is the same shape as the inert
   `model.local.json` on a baked-model host: state the gap, never substitute for it, never stay
   quiet about it.

4. **The move happens before the rename pass.** `/sdlc-doctor` relocates first, then rewrites stale
   agent names. The other order rewrites names inside a file that is about to move, leaving the
   moved copy stale.

5. **A destination that already exists is a conflict, never an overwrite.** A half-migrated project
   has stated an intent; the user's file at the destination is kept, the old one is left in place
   and reported. Identical to the rule `applyRenames` already follows for a config carrying both
   agent spellings.

## Consequences

- **Existing Claude Code projects break until doctor runs**, and that is the accepted cost of the
  no-alias rule. It is bounded and loud: every run names the files, every run says what to do, and
  nothing is deleted or rewritten without a yes.
- **The host/ours boundary is now visible in the filesystem.** `<project>/.claude/`,
  `<project>/.agents/` and their kin belong to whichever CLI is running; `<project>/.sdlc/` is ours
  on every host. A future host adds its own project paths to its descriptor
  (`workspace_skill_subdirs`, `project_settings_files`) and touches nothing here.
- **`enforce-agent-model.sh` moved with them.** It reads `model.local.json` directly, so it would
  otherwise have kept enforcing tiers from a file nothing else read.
- **One more thing to get wrong on a rename**: the path appears in prose across commands, skills,
  READMEs and docs as well as in code. Kept honest by `sdlc-lint` running over the emitted tree too,
  so a missed occurrence in shipped text fails the same gate as one in source.
- Historical change notes under `.brain/changes/` keep the old path verbatim. They record what a
  past PR did, and rewriting them would make the record wrong.

## Related
- Implemented by: Track J Phase 3
- Relates to: [[decisions/ADR-0029-one-ssot-emitted-host-packages]] /
  [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]] /
  [[decisions/ADR-0009-plugin-root-resolution]] / [[planning/j1-multi-host]]
