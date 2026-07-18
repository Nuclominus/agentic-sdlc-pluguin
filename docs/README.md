# Documentation

User-facing documentation for the SDLC Marketplace. Start at the repo [`README.md`](../README.md)
for the overview and quickstart; the pages below go deep on each topic.

| Page | What it covers |
| ---- | -------------- |
| [WORKFLOW.md](WORKFLOW.md) | How the system works — orchestration flow, the Stack Provider Pattern (key principles, priority table, detection rules, framework provider pattern), the pipeline phases, model tiers, and run artifacts. |
| [WALKTHROUGH.md](WALKTHROUGH.md) | A full end-to-end Android pipeline run, phase by phase, on a real task. |
| [RECIPES.md](RECIPES.md) | Dynamic workflow recipes — built-in recipes, control-flow shapes, selection precedence, auto-selection, and custom / project-local recipes. |
| [COST-AND-MODELS.md](COST-AND-MODELS.md) | Model-tier enforcement, cost optimization (`model` + `effort`), dry-run & cost caps, and run reports / cross-run rollup / AAR. |
| [CONFIGURATION.md](CONFIGURATION.md) | Per-project configuration — `.claude/sdlc.local.yaml` local overrides and the Project Extension Manifest. |
| [INSTALLATION.md](INSTALLATION.md) | Step-by-step installation, optional dependencies, and requirements. |

**Related, elsewhere in the repo:**

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — authoring a foundation or framework plugin (directory
  shape, `manifest.yaml` examples, schema validation, local verification).
- [`.brain/`](../.brain/) — the engineering source of truth (architecture, ADRs, per-PR change
  history, roadmap/backlog), maintained by the `brain-sync` automation. For contributors/maintainers.

> Not documentation: `docs/plans/` (per-run pipeline workspace — phase outputs, checkpoints,
> telemetry) and `docs/superpowers/` (plan + spec artifacts from the development workflow) are
> process/machine artifacts, not reference docs.
