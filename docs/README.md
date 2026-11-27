<h1 align="center">
  <img src="assets/headers/docs.svg" alt="Documentation" width="100%">
</h1>

<p align="center">
  <a href="../README.md">Overview</a> ·
  <a href="WORKFLOW.md">How it works</a> ·
  <a href="WALKTHROUGH.md">Walkthrough</a> ·
  <a href="RECIPES.md">Recipes</a> ·
  <a href="COST-AND-MODELS.md">Cost &amp; models</a> ·
  <a href="CONFIGURATION.md">Configuration</a> ·
  <a href="INSTALLATION.md">Installation</a>
</p>

---

User-facing documentation for the Agentic SDLC marketplace. Start at the repo [`README.md`](../README.md)
for the overview and quickstart; the pages below go deep on each topic.

| Page | What it covers |
| ---- | -------------- |
| **[How it works](WORKFLOW.md)** | Orchestration flow, the Stack Provider Pattern (key principles, priority table, detection rules, framework provider pattern), the pipeline phases, model tiers, and run artifacts. |
| **[Walkthrough](WALKTHROUGH.md)** | A full end-to-end Android pipeline run, phase by phase, on a real task. |
| **[Workflow recipes](RECIPES.md)** | Built-in recipes, control-flow shapes, selection precedence, auto-selection, and custom / project-local recipes. |
| **[Cost & models](COST-AND-MODELS.md)** | Model-tier enforcement, cost optimization (`model` + `effort`), dry-run & cost caps, and run reports / cross-run rollup / AAR. |
| **[Configuration](CONFIGURATION.md)** | Per-project configuration — `.sdlc/sdlc.local.yaml` local overrides and the Project Extension Manifest. |
| **[Installation](INSTALLATION.md)** | Step-by-step installation, optional dependencies, upgrading, and requirements. |

**Related, elsewhere in the repo:**

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — authoring a foundation or framework plugin (directory
  shape, `manifest.yaml` examples, schema validation, local verification).
- [`.brain/`](../.brain/) — the engineering source of truth (architecture, ADRs, per-PR change
  history, roadmap/backlog), maintained by the `brain-sync` automation. For contributors/maintainers.

> Not documentation: `docs/plans/` (per-run pipeline workspace — phase outputs, checkpoints,
> telemetry) and `docs/superpowers/` (plan + spec artifacts from the development workflow) are
> process/machine artifacts, not reference docs.
