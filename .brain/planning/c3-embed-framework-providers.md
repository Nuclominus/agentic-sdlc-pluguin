---
status: done
---

# C3 — embed the framework providers into android-foundation

> Reverses [[planning/c2-framework-providers]] (and the original C1/roadmap work that created
> `retrofit-plugin`/`room-plugin`/`dagger-plugin`/`workmanager-plugin`): the 7 additive Android
> framework plugins are folded into `android-foundation`'s own `manifest.yaml` as a `frameworks:`
> array, per [[decisions/ADR-0026-embed-framework-providers-in-the-foundation]]. See
> [[planning/_moc-planning]].

## Goal

Shrink the marketplace's Android install surface from 8 entries (`sdlc`, `android-foundation`, 7
`*-plugin`) to 2 (`sdlc`, `android-foundation`), without losing conditional activation: each
embedded framework still enriches exactly one functional aspect (`network`, `persistence`, `di`,
`background`) and activates only when its library coordinate is detected — never unconditionally,
never two providers of one contested aspect at once.

## Why this reverses C2/C1 rather than extending them

C1 and C2 established the per-plugin framework pattern (ADR-0002) on the premise that each
framework is a standalone, independently-installable unit. In practice every Android install also
installs `android-foundation` — there is no marketplace scenario where a framework plugin is used
without it — so the independence C1/C2 optimized for was never exercised, while its cost (7 extra
marketplace entries, 7 extra skill namespaces, 7 extra `.claude-plugin/plugin.json` files) was paid
on every install.

## What changed

- **Schema:** `schemas/manifest.schema.json` gained a foundation-only `frameworks:` array
  (`$defs/frameworkRow`) — same required/forbidden shape a standalone framework manifest had,
  minus `kind` (a row never declares it).
- **Resolver:** `plugins/sdlc/tools/resolve/manifests.mjs`'s `classify()` synthesizes one ordinary
  `kind: framework` record per row, in both tree and installed loader modes — verified by a
  dual-mode equality test written and green **before** any file was moved (the R1 mitigation).
- **Assets:** the 7 plugins' skills and ProGuard snippets relocated under `android-foundation/`;
  their manifest content folded into `frameworks:` rows; the 7 plugin directories deleted; the 7
  marketplace entries removed.
- **Migration:** `/sdlc:doctor` + `plugins/sdlc/config/plugin-migrations.json` report a stale
  `<plugin>:<skill>` id in a project's `.claude/sdlc.local.yaml` and rewrite it on approval — no
  alias layer, one cut.
- **Lint:** a new `nested-manifest` rule fails the build if a `manifest.yaml` survives below any
  plugin root, closing the tree-vs-installed trap structurally.

## Related
- [[decisions/ADR-0026-embed-framework-providers-in-the-foundation]] — the ADR this note explains.
- [[planning/c2-framework-providers]] — the track this reverses.
- [[components/android-foundation]] — now embeds all 7.
