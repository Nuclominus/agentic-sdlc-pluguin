---
description: Diagnose SDLC pipeline health — external plugin dependencies, runtime preflight status, stale agent names in this project's config, and cost baseline (if available). Diagnosis is read-only; the config migration is applied only with explicit approval.
argument-hint: "[--json]"
---

# /sdlc:doctor

Snapshot of the pipeline's runtime environment. Reuses the same preflight code-path that `/sdlc:start` runs on every invocation (`tools/resolve/deps.mjs`), but in a read-only mode that never aborts.

It is also where a project catches up with an agent rename. The marketplace ships **no runtime aliases** for renamed agents (ADR-0021): a name in `sdlc.local.yaml` or `model.local.json` is used exactly as written, so a stale one silently targets nothing. Doctor finds those, shows them, and rewrites them **only after you say yes**.

## What this command does

0. **Resolve the plugin roots.** Run orchestrator Step 0 (`plugins/sdlc/PLUGIN-PATHS.md`) to get
   `{SDLC_PLUGIN_ROOT}`, `{PLUGIN_CACHE_ROOT}` and `{CONFIG_DIR}`. Every path below uses them —
   a literal `~` would read the operator's home instead of the active `CLAUDE_CONFIG_DIR` (#70).
   Print the resolved `{PLUGIN_CACHE_ROOT}` in the report; it is the first thing to check when a
   run picks an unexpected stack.

1. **Locate the runtime dependencies file.** Try these paths in order, take the first that exists:
   - `{SDLC_PLUGIN_ROOT}/runtime-dependencies.json`
   - `<repo>/plugins/sdlc/runtime-dependencies.json` (development checkout)

   If neither exists, print `🔌 Dependency preflight: no runtime-dependencies.json found.` and skip step 2.

2. **Run the same preflight algorithm the pipeline runs** — `enumerateSkills` / `collectDependencies` / `computeDepsStatus` in `${CLAUDE_PLUGIN_ROOT}/tools/resolve/deps.mjs` (enumerate available skills via `mcp__skills__list_skills` with FS fallback to `{PLUGIN_CACHE_ROOT}/**/{plugin}/**/skills/{skill}/SKILL.md`, then compute per-dependency status). DO NOT enforce policy in `/sdlc:doctor` — `block` does NOT exit here. Just collect status.

3. **Locate active stack profiles.** Reuse the detection logic in `tools/resolve/manifests.mjs` + `detect.mjs` (`resolveStack`): `Glob {PLUGIN_CACHE_ROOT}/**/manifest.yaml`, parse each, split by `kind`, evaluate `kind: foundation` detect rules against the current project. Identify the primary profile that would be selected.

3b. **Probe host capability.** Run `uname -s -m` for the OS/arch, then best-effort probe the host toolchains relevant to installed stack plugins — never fail, just report version or `not found`. Suggested probes (skip any that don't apply to the installed plugins): `node --version`, `java -version`, `./gradlew --version` (if a wrapper exists), `swift --version`, `xcodebuild -version`, `android --version`. This surfaces capability-gated checks up front (e.g. iOS lint/build needs macOS + Xcode; those post-pipeline checks SKIP rather than fail off-host).

3c. **Check this project's config for stale agent names.** Run:

   ```
   node {SDLC_PLUGIN_ROOT}/tools/migrate/cli.mjs check --json
   ```

   It reads the rename data in `config/agent-migrations.json` and reports every `sdlc.local.yaml`
   `extensions.skills[].agents` entry and `model.local.json` `agents{}` key that names an agent the
   marketplace no longer ships. Exit 2 means findings, 0 means clean; the JSON carries
   `findings[] = {file, where, from, to, conflict?}`. Render them in the report (below).

   **If there are findings and this is an interactive session,** ask the user whether to apply them,
   listing each `from → to`. On an explicit yes, and only then, run:

   ```
   node {SDLC_PLUGIN_ROOT}/tools/migrate/cli.mjs apply --json
   ```

   which rewrites only those name tokens in place, preserving comments and formatting. On no, or in
   a non-interactive session, leave the files alone and print the exact command above so the user
   can run it themselves. Never apply without an answer.

4. **Read cost baseline (if present).** Try `<repo>/docs/cost-baseline.md`. If it has a fenced JSON block tagged `summary` (e.g. ```` ```json summary ````) parse and extract `avg_cost_per_medium_run_usd`, `p90_cost_per_medium_run_usd`, `cache_hit_ratio`, `runs_aggregated`. Otherwise show the raw "not yet baselined" notice.

5. **Render output.** Default = human-readable table. With `--json` flag, emit a single valid JSON object to stdout and exit.

## Human output format

```
🩺 SDLC Doctor

Dependencies (from runtime-dependencies.json):
  superpowers >=1.0.0 [policy=warn]
    status: ✅ available
    skills: test-driven-development, verification-before-completion

  acme-internal >=2.0.0 [policy=block]
    status: ❌ missing
    missing skills: code-style, internal-api-style
    install:
      /plugin marketplace add acme/internal-tools
      /plugin install acme-internal@acme-internal-tools

Stack profiles:
  🎯 active: android (priority=300, from android-foundation/manifest.yaml)
  ➕ frameworks: retrofit (additive)
  also installed: vanilla (priority=0)

Host capability:
  os: Linux x86_64
  node: v20.11.0   java: 17.0.10   ./gradlew: 8.7
  android (CLI): not found (optional)

Agent names in this project's config:
  ⚠️ 2 stale name(s) — they currently target nothing:
     .claude/sdlc.local.yaml extensions.skills[0].agents: android-developer → developer
     .claude/model.local.json agents: android-ba → business-analyst
  Fix available: /sdlc:doctor will rewrite them in place if you approve.

Cost baseline (docs/cost-baseline.md, last updated 2026-05-04, 22 runs):
  avg medium-run: $1.62
  p90 medium-run: $2.31
  cache hit ratio: 0.61

Heads-up:
  ❌ 1 blocking dependency missing — /sdlc:start would abort.
     Run the install commands above, then retry.
```

If a section is absent (no baseline file, no missing deps, etc.) say so explicitly with one line — never silently omit a section.

## JSON output format (`--json`)

```json
{
  "deps_preflight": {
    "superpowers": {
      "status": "available",
      "policy": "warn",
      "missing_skills": []
    },
    "acme-internal": {
      "status": "missing",
      "policy": "block",
      "missing_skills": ["code-style", "internal-api-style"],
      "install_command": [
        "/plugin marketplace add acme/internal-tools",
        "/plugin install acme-internal@acme-internal-tools"
      ]
    }
  },
  "stack": {
    "active_profile": "android",
    "primary_priority": 300,
    "all_installed": ["vanilla", "android"],
    "active_frameworks": ["retrofit"]
  },
  "host": {
    "os": "Linux",
    "arch": "x86_64",
    "toolchains": {
      "node": "v20.11.0",
      "java": "17.0.10",
      "gradlew": "8.7",
      "android": null
    }
  },
  "agent_names": {
    "stale": 2,
    "findings": [
      { "file": ".claude/sdlc.local.yaml", "where": "extensions.skills[0].agents", "from": "android-developer", "to": "developer" },
      { "file": ".claude/model.local.json", "where": "agents", "from": "android-ba", "to": "business-analyst" }
    ],
    "applied": false
  },
  "cost_baseline": {
    "available": true,
    "runs_aggregated": 22,
    "avg_cost_per_medium_run_usd": 1.62,
    "p90_cost_per_medium_run_usd": 2.31,
    "cache_hit_ratio": 0.61,
    "last_updated": "2026-05-04"
  },
  "would_abort_pipeline": true
}
```

`would_abort_pipeline` is `true` iff any dependency with `policy=block` is missing.

## Hard rules

- **Diagnosis is read-only.** Do NOT install plugins, run pipelines, or write files. The ONE exception is step 3c's `migrate apply`, which touches only `.claude/sdlc.local.yaml` and `.claude/model.local.json`, only renames agent-name tokens, and only after an explicit yes. Never run it as part of a plain `/sdlc:doctor` invocation, never in a non-interactive session, and never with `--json` (a machine caller gets the findings and decides for itself).
- **Do not enforce policy.** A missing `block` dep here is just reported, not actioned.
- **Reuse, don't reimplement.** The dependency-status algorithm now lives in code, not prose: `tools/resolve/deps.mjs` (`enumerateSkills`, `collectDependencies`, `computeDepsStatus`, `enforcePolicies`), covered by `tools/sdlc-lint/test/deps.test.mjs`. If that module changes, this command's behavior must follow — this command delegates to it, and must not become a parallel implementation. (It cited SKILL.md Steps 0a-2 / 0a-3 until #121 replaced them with the module.)
- **Exit code semantics with `--json`:** exit 0 normally; exit 1 only if the runtime-dependencies.json file itself is malformed JSON (parse error). Missing-but-blocking deps still exit 0 — report them in the JSON and let the caller decide.

## When to use

- **After upgrading the marketplace** — catch a config that still names agents from the previous version before a run silently drops those entries.
- After installing or updating a stack plugin — verify external dep wiring still resolves.
- Before kicking off a long pipeline run — confirm `/sdlc:start` won't abort on a `block`-policy dependency.
- In CI / automation — `/sdlc:doctor --json` gives a machine-checkable health report.
- When a cost regression is suspected — compare current `cost_baseline` against historical values.
