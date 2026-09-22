---
description: Initialize SDLC config for this project — detect the winning stack profile(s), scaffold .sdlc/sdlc.local.yaml, and optionally seed CLAUDE.md. Idempotent; never overwrites existing config.
argument-hint: "[--seed-claude-md]"
---

# /sdlc:init

One-time project setup. Invoke the **`sdlc:init`** skill.

- `--seed-claude-md` (optional) — also append a managed SDLC section to `CLAUDE.md`.

The skill: detects the platform(s) via the same stack resolution the pipeline uses, scaffolds a
starter `.sdlc/sdlc.local.yaml` (create-if-absent, never overwrites), and reports which profile(s)
the pipeline will use.
