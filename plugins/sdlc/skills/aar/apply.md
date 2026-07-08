# AAR apply contract (`apply.md`)

You (the main session) apply findings. The analyst never edits. **No auto-apply.**

## Selection

Present the findings and lessons candidates. Ask the user to multi-select which
to apply (e.g. by number). Nothing happens to unselected items.

## Tiered gate — by blast radius

### Tier 1 — Lessons (low-risk, always offered)

For each approved lesson candidate: append the one-line lesson to
`.claude/sdlc-lessons.md` (create the file with a `# SDLC lessons` header if
absent). Keep lines short and imperative; do not duplicate an existing line.
This file is injected verbatim into every future phase's prompt.

### Tier 2 — Agent / rule / process-doc edits (per-item diff approval)

For each approved finding targeting an agent, rule, or process doc:
1. `Read` the current target (grounding).
2. Show the user the exact diff you propose (before → after).
3. Apply it ONLY if they confirm that specific diff. Skipping one does not skip
   others.

### Tier 3 — `settings.json` (extra explicit confirm)

Editing `.claude/settings.json` (token/effort knobs) requires a SECOND explicit
confirmation beyond selection — restate what changes and why, and apply only on
an unambiguous yes. This honors the global "ask before self-modifying settings"
rule.

## After applying

- Summarize what was applied vs skipped.
- Confirm the durable report was written to `docs/plans/{slug}/_aar.md` (Step 5).
- Run `superpowers:verification-before-completion` discipline: confirm each
  edited file actually changed as intended before claiming done.
- Remind the user the lessons take effect on the next `/sdlc:start`.
