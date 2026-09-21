---
adr: 28
status: accepted
date: 2026-09-21
supersedes: null
---

# ADR-0028 — An external dependency is never a marketplace entry

## Context

`.claude-plugin/marketplace.json` listed four plugins. Two of them were not ours:

```json
{ "name": "superpowers",       "source": { "source": "url", "url": "https://github.com/obra/superpowers.git" } },
{ "name": "security-guidance", "source": { "source": "git-subdir", "url": "https://github.com/anthropics/claude-plugins-official.git", "path": "plugins/security-guidance" } }
```

The intent was convenience — one marketplace, everything installable. Claude Code takes such an
entry literally: it clones the foreign repository into **our** namespace and registers the result as
`<name>@agentic-sdlc`. Measured on a real install:

| On disk | What it is |
|---|---|
| `plugins/cache/agentic-sdlc/superpowers/6.4.1` (and `6.3.0`) | our clone, registered and enabled as `superpowers@agentic-sdlc` |
| `plugins/cache/agentic-sdlc/security-guidance/2.0.7` | an orphaned clone of the same mistake |
| `plugins/cache/claude-plugins-official/security-guidance/2.0.8` | the copy the user actually installed |

So `security-guidance` existed twice, from two marketplaces, and `superpowers` was installed
*through* a marketplace that had nothing to do with authoring it. The cost is not disk: it is that
we took ownership of a namespace and an update path for software we do not write. A consumer
pinning, updating or uninstalling upstream superpowers would not touch our copy, and our copy is the
one the preflight found.

Every other part of the repo already treated both as external, optional and degradable —
`runtime-dependencies.json` (`policy: warn`, per-skill `skills_used`, a `fallback_note`), the README
"Optional external dependencies" table, `/sdlc:security-init`'s cache-wide probe. The marketplace
entries were the single place that contradicted this, and they were the place that actually
installed things.

The defect also hid a smaller one: the id was spelled three different ways
(`superpowers@superpowers` in both `runtime-dependencies.json` files,
`superpowers@superpowers-marketplace` in `docs/INSTALLATION.md`), and **all** of them were wrong —
obra's own marketplace is named `superpowers-dev`, and what was actually installed was
`superpowers@agentic-sdlc`. Nobody noticed, because nobody ever had to run the command: our entry
made `/plugin install superpowers@agentic-sdlc` work.

## Decision

**A marketplace entry means "this repo redistributes this plugin."** Only plugins living in this
repo get one, and their `source` is always the string `./plugins/<name>`, never a `url` or
`git-subdir` pointing at somebody else's repository.

An external runtime dependency is declared **once**, in the declaring plugin's
`runtime-dependencies.json` — `name`, `policy`, `skills_used`, `install_command`, `fallback_note` —
and documented in the README. It is never a marketplace entry, and it is not a native
`plugin.json` `dependencies` entry either: native dependencies are install-time and **required**
(the resolver enables the dependency or fails the install), and since Claude Code 2.1.x they may be
cross-marketplace — but "required" is exactly what `policy: warn` is not. A pipeline that must run
without superpowers cannot express that through a mechanism whose only outcome is "installed".

This costs nothing at runtime because **resolution was already marketplace-agnostic**:
`deps.mjs`'s `pluginNameOf` keys on the bare plugin name, so any install of superpowers — from
`claude-plugins-official`, from `superpowers-dev`, or a user-level `skills/` copy — satisfies the
same declared row, and every mandate is a bare `superpowers:<skill>` id that is identical from any
source. `install_command` therefore names a **recommended** source, not a requirement. The
recommendation is `claude-plugins-official`, which carries both plugins and is the marketplace
`security-guidance` was already documented against.

The rule is enforced, not merely decided: `node tools/sdlc-lint/cli.mjs marketplace-surface` fails
any entry whose source is not a local `./plugins/<name>` that exists on disk, and
`skills/create-pluguin` carries the same instruction where new entries are authored.

## Consequences

- Marketplace surface: 4 entries → **2** (`sdlc`, `android-foundation`). This amends ADR-0026's
  consequence line, which counted 3 by treating the two optional external dependencies as install
  entries of this marketplace — the very framing that produced `superpowers@agentic-sdlc`.
- **A re-source is not a rename.** `superpowers:brainstorming` is the same skill id from every
  marketplace, so no `.claude/sdlc.local.yaml` row changes, `config/plugin-migrations.json` gains
  nothing, and `migrate apply` must not be offered for it. `/sdlc:doctor` carries a prose advisory
  instead, and it prints the remedy **install-first, uninstall-second**: the other order leaves a
  consumer with no superpowers at all, silently downgrading every `MANDATORY — invoke
  superpowers:*` row to best-effort via `downgradeIfMissing`.
- The official entry is **SHA-pinned** at obra commit `b36e0829` (v6.3.0) while ours tracked HEAD
  (6.4.1), so a consumer may step back one minor version. Verified at that pin: all six skills
  `android-foundation` declares, plus the core's `using-superpowers` and `create-pluguin`'s
  `writing-skills`, exist — and `>=1.0.0` holds. The only skill 6.4.1 adds is
  `diagnosing-superpowers`, which this repo references nowhere. Anyone wanting HEAD can add
  `obra/superpowers` and install `superpowers@superpowers-dev`.
- One id spelling, correct, in one place — replacing three that were each wrong.
- We lose the one-marketplace install convenience. Consumers now add
  `anthropics/claude-plugins-official` themselves. That is the price of not owning a namespace we
  have no right to.

## Related
- Amends: [[decisions/ADR-0026-embed-framework-providers-in-the-foundation]]
- Relates to: [[architecture/pipeline-orchestrator]]
- Implemented by: #<pr>
