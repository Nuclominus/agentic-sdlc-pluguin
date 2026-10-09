---
description: Update the model registry — add or retire models, move a dispatched tier to a new model, refresh per-model pricing, and carry the change through tests, docs, ADR and the Antigravity host map. Repo-maintainer command; not shipped in any plugin.
argument-hint: "[<tier|model-id> ...]"
---

# /models-sync

Keeps `plugins/sdlc/config/models/<host>.yaml` — the registry that maps a tier `tag` to a
`model_id` and prices every model (ADR-0029, prefer-registry-SSOT) — in step with what the
providers actually ship and charge. The registry is the only place a model id or rate is edited;
README, PLUGIN-PATHS and the orchestrator link to it. This command is the checklist around that one
edit, so a tier move does not leave the estimator test, the ADR or `dist/` behind.

It does **not** touch a project's `.sdlc/model.local.json` — that is the user-facing
`/sdlc:model-config`, which picks among tiers and is unaffected by a tier moving to a new model.

**Never invent a rate or a model id.** Every number written must come from a source you name in the
commit (the provider's pricing page, the `claude-api` skill's model table, or `agy models` for
Antigravity), with the date read. If you cannot confirm one, stop and ask — an unpriced model yields
`cost_usd: null`, which is honest; a guessed price silently falsifies every cost report.

## Steps

0. **Preflight.** `git status --short` (stage specific paths, never `git add -A`; other work may be
   in the tree). `git fetch origin`; branch from develop:
   `git switch -c chore/models-<what>-<YYYY-MM-DD> origin/develop`.

1. **Establish the target.** Ask (`AskUserQuestion`) only for what `$ARGUMENTS` leaves open:
   - **Which change?** (a) *move a tier* to a new model (e.g. `sonnet` → a newer id);
     (b) *add a model* (reference/pin-only, or a new tier); (c) *reprice* an existing model;
     (d) *retire* a model.
   - **Which host?** `claude.yaml` (default) or `antigravity.yaml`.
   - Gather facts from a named source: model id, input / cached-input / output USD per MTok,
     any intro-pricing expiry date. Note quirks — cached rate is not always 10% of input (Opus 5.5
     and Fable/Mythos 5.1 differ), and an intro price needs its end date in a comment.

2. **Edit the registry** (`plugins/sdlc/config/models/<host>.yaml`):
   - **Move a tier:** repoint the dispatched tag's `model_id`/`pricing`, and **keep the old id as a
     pin-only entry** (`tag: <family>-<ver>`) in the reference block. Removing it silently
     un-prices every recorded run that named it. Precedent: ADR-0035 (opus 5.5), ADR-0038 (sonnet 5.5).
   - **Add:** new tags go in the reference block unless they are being dispatched.
   - **Retire:** only after confirming no run history needs it; default to keeping it pin-only.
   - Adding a tag to `pipeline_tiers` also requires the mirrored `is_valid_tier` list in
     `plugins/sdlc/hooks/enforce-agent-model.sh` — the two must match. Changing the tier *set* is
     a design change: write an ADR and ask first.
   - Update expiring-price comments (`INTRODUCTORY, through <date>`) while here.
   - `estimation_baselines` were *measured* on a model. After a tier move, mark the tier
     PROVISIONAL in the comment above them (it was measured on the old id); do not edit the numbers
     without real runs.

3. **Carry it through** (the files the last tier moves touched — grep to confirm none were missed):
   - `tools/sdlc-lint/test/usage.test.mjs`: the `TIER_MODEL` expectation, and
     `MEASURED_ON[<tier>] = "<old id>"` for a moved tier (the drift test prices the baseline at the
     model it was measured on).
   - `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`: the example `_telemetry.json` `model`
     string, when it names the moved tier's old id.
   - **Antigravity map** (`tools/sdlc-lint/hosts/antigravity.json` `models.map`) only for a change
     on that host; verify ids with `agy models` and bump `verified_on`.
   - `grep -rn "<old-id>" --include=*.md --include=*.yaml --include=*.json --include=*.mjs . `
     excluding `bench/`, `.brain/changes/`, `dist/` — anything left is either a legitimate
     pin-only reference or a stale copy to link instead of restate.

4. **Record it.** A tier move or a new tier is a non-trivial decision: add
   `.brain/decisions/ADR-NNNN-<slug>.md` (shape of `ADR-0038`) **and its row in
   `.brain/decisions/_moc-decisions.md` in the same commit** (`check` fails on an unlisted note).
   A pure reprice or a pin-only addition needs only the CHANGELOG line.

5. **Version and changelog.** Patch-bump `sdlc` in `plugins/sdlc/.claude-plugin/plugin.json` (the
   registry ships inside the plugin). Add a CHANGELOG `[Unreleased]` line: old → new, price change
   or "same price". Marketplace version moves only with `/release`.

6. **Verify.**
   - `npm test --prefix tools/sdlc-lint`
   - `node tools/sdlc-lint/cli.mjs all`
   - `node tools/sdlc-lint/cli.mjs emit` (regenerates `dist/`; `emit --check` is what CI runs)
   - `node tools/brain-sync/cli.mjs check --vault .brain`
   - Dry-run sanity: `/sdlc:start "<any change>" --dry-run` should price the moved tier at the new
     rate. Report the actual output of each command, including failures.

7. **Commit and PR.** Stage the specific paths (registry, test, SKILL.md, ADR + MOC, CHANGELOG,
   plugin.json, `dist/`). Commit message: `chore(models): <what>; bump sdlc to <ver>` with the
   price source in the body. `gh pr create --base develop`; list sources and read dates in the body
   (no `[[wikilinks]]` shorthand — write plain text or the full `[[decisions/ADR-NNNN-slug]]`).
   Then offer the user a review (repo rule). After merge, enrich the brain-sync follow-up PR and
   merge it **before** any next feature PR.

## Never

- Write a price or model id you did not read from a named source.
- Delete a model entry that recorded telemetry may still reference.
- Edit `pipeline_tiers` without the matching `enforce-agent-model.sh` change.
- Touch a project's `.sdlc/model.local.json` — that is `/sdlc:model-config`.
- Edit `dist/` by hand — it is `emit` output.
