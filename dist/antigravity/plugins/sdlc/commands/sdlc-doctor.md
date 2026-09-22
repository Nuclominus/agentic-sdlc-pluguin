---
description: Diagnose SDLC pipeline health — external plugin dependencies, runtime preflight status, stale agent names in this project's config, and cost baseline (if available). Diagnosis is read-only; the config migration is applied only with explicit approval.
argument-hint: "[--json]"
---

# /sdlc:doctor

Snapshot of the pipeline's runtime environment. Invoke the **`sdlc:doctor`** skill.

- `--json` (optional) — emit a single valid JSON object instead of the human-readable report.

The skill: reruns the same preflight the pipeline runs, read-only; reports external dependency
status, active stack profiles, host toolchain capability, a stale agent-name or config-location
finding (`.claude/` → `.sdlc/`, ADR-0030), stale plugin registrations, and the cost baseline. The
ONE write it can make — moving/renaming this project's own SDLC config files — happens only after
you say yes.
