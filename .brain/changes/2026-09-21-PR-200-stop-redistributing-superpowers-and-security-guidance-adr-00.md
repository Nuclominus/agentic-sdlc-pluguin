---
pr: 200
date: 2026-09-21
author: Nuclominus
type: fix
plugins: [android-foundation, sdlc]
roadmap: null
files_changed: 18
---

# PR #200 — stop redistributing superpowers and security-guidance (ADR-0028)

> `fix` · merged 2026-09-21 · by @Nuclominus

## Summary

`marketplace.json` re-declared two foreign plugins as entries of `agentic-sdlc` — `superpowers` via a `url` source into `obra/superpowers.git`, `security-guidance` via a `git-subdir` into `anthropics/claude-plugins-official`. Claude Code takes such an entry literally and clones the foreign repository into **our** namespace, registering it as `<name>@agentic-sdlc`: a second install of software we never authored, shadowing the copy the user installed themselves. Both entries are removed, so the marketplace now lists only the two plugins this repo owns.

The cost was never disk. It was that this repo took ownership of a namespace and an update path
for software it does not write: a consumer pinning, updating or uninstalling upstream superpowers
would not touch our clone, and our clone is the one the preflight found. Measured on a real install
before the fix — `cache/agentic-sdlc/superpowers/6.4.1` registered and enabled as
`superpowers@agentic-sdlc`, an orphaned `cache/agentic-sdlc/security-guidance/2.0.7`, and the
user's own `cache/claude-plugins-official/security-guidance/2.0.8` alongside it. The same plugin,
twice, from two marketplaces, one of which had no business shipping it.

**Nothing about resolution had to change**, which is what made the removal safe: `deps.mjs`'s
`pluginNameOf` keys on the bare plugin name, so any install satisfies the declared row, and every
mandate is a bare `superpowers:<skill>` id identical from any source. Proven against the live
registry (key `superpowers@agentic-sdlc`, skill ids `superpowers:*`, status `available`) and pinned
by two new tests asserting `@claude-plugins-official`, `@superpowers-dev` and `@agentic-sdlc` all
satisfy the same dependency, and that the marketplace segment never leaks into a skill id.

The removal exposed a second defect: the install id was wrong in **every** place it appeared —
`superpowers@superpowers` in both `runtime-dependencies.json` files and
`superpowers@superpowers-marketplace` in `docs/INSTALLATION.md`. Obra's marketplace is actually
named `superpowers-dev`. Nobody had ever hit it, because the entry being removed made
`/plugin install superpowers@agentic-sdlc` work. All of it now reads
`superpowers@claude-plugins-official`.

## Changed areas

- [[components/sdlc]] — `runtime-dependencies.json` (recommended source + the marketplace-agnostic
  note), `commands/doctor.md` (the stale-install advisory generalised to cover a foreign plugin,
  with an install-before-uninstall remedy), `skills/create-pluguin` (the authoring guard), and two
  regression tests in `deps.test.mjs`.
- [[components/android-foundation]] — `runtime-dependencies.json` only; its six declared superpowers
  skills and `policy: warn` are untouched, since `sdlc-lint roster` requires them.
- [[architecture/pipeline-orchestrator]] — the Step 0a preflight line now says where the optional
  plugins come from.
- Repo tooling — new `sdlc-lint marketplace-surface` rule (8 tests) failing any entry whose source
  is not a local `./plugins/<name>` that exists on disk, wired into `all` and therefore into CI.

## Decisions & rationale

- Implements [[decisions/ADR-0028-an-external-dependency-is-never-a-marketplace-entry]]: a
  marketplace entry means *this repo redistributes this plugin*; an optional external dependency is
  declared once in `runtime-dependencies.json` and documented, never re-exported.
- Amends [[decisions/ADR-0026-embed-framework-providers-in-the-foundation]], whose consequence line
  counted the marketplace surface as 3 by treating the two external dependencies as install entries
  of this marketplace — the framing that produced the clone. The surface is 2.
- **A re-source is not a rename.** `superpowers:brainstorming` is the same id everywhere, so
  `config/plugin-migrations.json` gains nothing and `migrate apply` must not be offered; the
  migration is prose in `/sdlc:doctor`, ordered install-first because the reverse leaves a consumer
  with no superpowers at all and silently downgrades every mandate via `downgradeIfMissing`.
- Rejected: declaring superpowers as a native `plugin.json` dependency. Claude Code has supported
  cross-marketplace `dependencies` since 2.1.x — the stale `_comment` claiming otherwise is
  corrected here — but native dependencies are *required*, and `policy: warn` exists precisely so
  the pipeline runs without it.
- Accepted trade-off: the official entry is SHA-pinned at obra `b36e0829` (v6.3.0) while ours
  tracked HEAD (6.4.1), so consumers may step back one minor version. Verified at that pin: all six
  skills `android-foundation` declares, plus `using-superpowers` and `writing-skills`, exist, and
  `>=1.0.0` holds. The only addition in 6.4.1 is `diagnosing-superpowers`, referenced nowhere here.

## Planning

- Track I (plugin topology) in [[planning/roadmap]] — adjacent rather than a planned item. I1 drew
  the line between process and expertise *inside* the marketplace; this draws the line at its
  edge, deciding what the marketplace may contain at all. The rule is now enforced by a lint rule
  rather than remembered, so the topology cannot silently regrow a foreign entry.

---
_Auto-generated by `tools/brain-sync`. Frontmatter and the index are machine-owned; every prose section, Summary included, is meant to be enriched — but `sync --pr` rewrites the whole file, so enrich after running it._
