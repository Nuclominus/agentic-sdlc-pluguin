---
adr: 36
status: accepted
date: 2026-09-28
supersedes: null
---

# ADR-0036 — A skill catalog is a runtime dependency; a skill set is its matrix

## Context

Google's Android CLI (`android`) is more than a binary. `android skills` serves a catalog of agent
skills. On 2026-09-28 it held 25, catalog `1.0.16406183`. The local clone at `~/.android/cli/skills/`
is itself a Claude Code marketplace, with plugin `android-skills`. `android skills add` installs
each skill **bare-named** into the agent's skills directory.

Until now android-foundation treated all of this as optional:

- `runtime-dependencies.json` said the CLI is "a system tool, not a dependency".
- A SessionStart hook printed an advisory.
- `rules/skills.md` bound the command groups of the one `android-cli` skill to roles in a
  hand-written table.

The other 24 skills reached no role at all. The one skill that was installed had drifted from the
CLI it documents: it describes `android screenshot`, which no longer exists.

Wiring a 25-skill catalog into ten roles by hand has two failure modes:

1. **Drift.** The hand table in the plugin README had already fallen behind the manifest.
2. **Scope leak.** Every installed skill is visible to every subagent, and Claude Code has no
   per-subagent skill ACL. The prompt is the only place a role learns which skills are its own.

## Decision

1. **The catalog is a runtime dependency at the same level as superpowers:** `policy: warn`.
   - The pipeline still runs without it.
   - A mandated row whose skill is missing is downgraded to best-effort, as superpowers rows are
     today.
   - The core stays Android-agnostic. It learns a generic `kind: skill-catalog` dependency with
     declared host tools, not "Android".
2. **One file is the matrix:** `plugins/<plugin>/skill-sets/<set>.yaml`.
   - Every catalog skill appears exactly once, either assigned to roles (policy + a dispatch-scoped
     `when`, optionally gated by `applies_if`) or `unassigned` with a reason.
   - Rows are bare ids. Ownership comes from the set, not from a `plugin:` prefix, because the CLI
     installs without one.
   - `policy` defaults to `recommended` here. Every `mandatory` row is owed by compliance on every
     dispatch.
3. **Categories are a scope guard.**
   - Each category lists the only roles its skills may be assigned to. Lint rejects anything else;
     for example, a UI skill can never be given to the security-analyst.
   - Widening a category is a deliberate, reviewable one-line change, not an accident buried in a
     row.
4. **Humans read generated views.** Two views are rendered from the YAML:
   - the skills × roles table next to it (`<set>.md`), for review
   - a per-role summary between `<!-- skill-set:<set>:begin/end -->` markers in the plugin README

   `sdlc-lint skill-sets` fails if either is stale, if a `TRIAGE` marker remains, if a `when` is
   run-scoped, or if a bare id collides with a skill this marketplace ships. `--write` regenerates
   both views.
5. **Scope is enforced by prompt plus audit, not by a block.**
   - A role's prompt renders only its own rows.
   - A skill invoked outside the matrix is reported after the run, in telemetry, compliance and
     AAR. It is not blocked at call time.

## Consequences

- Assigning a skill, or changing its scope, is a one-file diff with a readable table beside it. A
  reviewer can check it without reading YAML.
- The `android-cli` command-group bindings move into that skill's per-role `when` text, so
  `rules/skills.md` goes away.
- A new upstream skill is invisible to every role until someone triages it. The sync command writes
  it as `TRIAGE`, and lint blocks the merge until it is assigned or explained.
- The security-analyst gains two mandatory skills (`android-intent-security`,
  `android-permissions-security`). That raises the compliance denominator for that role.
- Bare generic names (`styles`, `adaptive`) can collide with unrelated skills a user has installed.
  Lint covers only this marketplace; the doctor has to report collisions on the user's machine.
- Prompt-only scope is advisory. A determined agent can still invoke an out-of-scope skill; the
  audit makes that visible rather than impossible.

## Related
- Implemented by: #224 (matrix, schema, lint), #225 (resolver: `skill_sets` manifest key,
  `kind: skill-catalog` dependency, per-skill downgrade, host-tool check), #226 (doctor: read-only
  `resolve/cli.mjs deps` verb and the `skill_catalogs` report), #227 (the off-matrix audit —
  point 5's "audit" half, recorded as [[decisions/ADR-0037-off-matrix-skill-use-is-audited-not-blocked]]).
  #228 (maintainer sync: `tools/sdlc-lint/scripts/skill-sets.mjs diff|refresh|render` and the
  repo command `/android-skills-sync`).
- Relates to: [[decisions/ADR-0021-agents-live-in-the-core-foundations-carry-expertise]],
  [[decisions/ADR-0028-an-external-dependency-is-never-a-marketplace-entry]],
  [[components/android-foundation]]
