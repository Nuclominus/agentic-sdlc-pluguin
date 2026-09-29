---
name: doctor
description: |
  Diagnose SDLC pipeline health — external plugin dependencies and skill catalogs (missing per
  role, stale, untriaged), runtime preflight status, stale
  agent names or a stale config location in this project's config, and cost baseline (if
  available). Diagnosis is read-only; the config migration is applied only with explicit approval.

  Use when the user invokes /sdlc:doctor, or asks in natural language to check pipeline health,
  diagnose the SDLC setup, verify dependencies, or find out why a config value isn't taking effect.
  UA: "перевір пайплайн", "діагностика SDLC", "чому конфіг не працює", "стан плагіна".

  Also use BEFORE a long pipeline run when a `block`-policy dependency might be missing, and after
  upgrading the marketplace — a renamed agent or a config file left in the pre-rename location
  silently drops the entries it carries.

  Do NOT use for: running the pipeline (that is pipeline-orchestrator), writing project config from
  scratch (that is /sdlc:init), or listing stack profiles alone (that is /sdlc:list-stacks).
---

# SDLC Doctor (`sdlc:doctor`)

Snapshot of the pipeline's runtime environment. Reuses the same preflight code-path that the
pipeline orchestrator runs on every invocation (`tools/resolve/deps.mjs`), but in a read-only mode
that never aborts.

It is also where a project catches up with an agent rename, or with the config directory rename
(`.claude/` → `.sdlc/`). The marketplace ships **no runtime aliases** for either (ADR-0021,
ADR-0030): a name or a path used exactly as written that no longer matches silently targets
nothing. Doctor finds those, shows them, and rewrites/moves them **only after you say yes**.

## What this skill does

0. **Resolve the plugin roots.** Run `plugins/sdlc/PLUGIN-PATHS.md` to get `{SDLC_PLUGIN_ROOT}`,
   `{PLUGIN_CACHE_ROOT}` and `{CONFIG_DIR}` — the lightweight path-resolution snippet, not the
   pipeline orchestrator's Step 0 (that one plans a whole pipeline run and needs a feature
   description this skill doesn't have). Every path below uses them — a literal `~` would read the
   operator's home instead of the active config dir. Print the resolved `{PLUGIN_CACHE_ROOT}` in the
   report; it is the first thing to check when a run picks an unexpected stack.

1. **Run the pipeline's own dependency preflight, read-only.** One command, from the project root:

   ```
   node {SDLC_PLUGIN_ROOT}/tools/resolve/cli.mjs deps --json --probe
   ```

   It merges every installed+enabled plugin's `runtime-dependencies.json`, enumerates the available
   skills and computes per-dependency status with the SAME code a run executes
   (`tools/resolve/deps.mjs`) — but writes no preflight stamp and enforces no policy: a missing
   `block` dependency is reported in `would_abort_pipeline`, it does not exit. Exit 1 means only
   "could not diagnose" (`{ok:false, error}`); report the error and continue with step 3.

   Take `deps_preflight` from its output as-is. If it is empty, print
   `🔌 Dependency preflight: no external dependencies declared.`

2. **Skill catalogs (ADR-0036).** The same output carries `skill_catalogs[]` — one entry per
   `kind: skill-catalog` dependency (e.g. `android-skills`, the Android CLI's agent skills, which
   `android-foundation` assigns per role in `skill-sets/android-skills.yaml`). Render each entry
   as the "Skill catalogs" section below. An entry with `applies_to_project: false`
   (`status: "not_applicable"`) belongs to a foundation that does not detect this project — print
   its one line and nothing else; it is not a problem to fix. Otherwise the fields mean:

   - `version.installed` / `version.matrix` / `version.drift` — the catalog on this machine vs. the
     version the plugin's matrix was triaged against. Drift is the maintainers' cue, not the user's
     fault; say so.
   - `applicable` of `assigned`, `gated_off[]` — skills this project needs vs. the matrix total; a
     gated-off skill (no CameraX → no `camerax`) is **not** missing and must not be reported as such.
   - `assigned_missing[] = {skill, roles[{role, policy}]}` — **lead with any row whose policy is
     `mandatory`**: that role's mandate is running best-effort.
   - `tool_blocked[]` and `tools[] = {name, path, version, required_by}` — a skill installed but
     unusable because its host tool is not on PATH. `--probe` fills `version` by running
     `<tool> --version`; this is the ONLY place tool versions come from — do not probe them again
     in step 3b.
   - `stale[]` — an installed copy that differs from the catalog's copy (the CLI copies skills, so
     they do not follow a catalog update); `duplicate_roots[]` — the same bare id installed in more
     than one place, where the host may load either.
   - `unknown_to_matrix[]` / `removed_upstream[]` — catalog skills no role receives yet, and matrix
     ids the catalog no longer ships. Informational: `remediation.rematrix` explains that the
     plugin's maintainers re-triage; there is nothing for the user to run.
   - `remediation.install` / `.update` / `.alt_install` — print these verbatim as the fix. Never run
     them: installing is the user's call.

3. **Locate active stack profiles.** Reuse the detection logic in `tools/resolve/manifests.mjs` +
   `detect.mjs` (`resolveStack`): glob `{PLUGIN_CACHE_ROOT}/**/manifest.yaml`, parse each, split by
   `kind`, evaluate `kind: foundation` detect rules against the current project. Identify the
   primary profile that would be selected.

   **Pass the project's `frameworks.disable` through** (ADR-0027). Read
   `<project>/.sdlc/sdlc.local.yaml`; a framework whose `stack` id is listed there is detected and
   then held back, so `resolveStack` must be called with `disableFrameworks` and the report must
   show the same set the pipeline will. A diagnostic that prints `➕ frameworks: ktor (additive)`
   while the pipeline prints `suppressed: ktor (frameworks.disable)` sends the user after a problem
   that does not exist — and this is the skill they run precisely to find out what the pipeline
   sees.

3b. **Probe host capability.** Run `uname -s -m` for the OS/arch, then best-effort probe the host
    toolchains relevant to installed stack plugins — never fail, just report version or
    `not found`. Suggested probes (skip any that don't apply to the installed plugins):
    `node --version`, `java -version`, `./gradlew --version` (if a wrapper exists),
    `swift --version`, `xcodebuild -version`. A skill catalog's host tools (e.g. `android`) are
    already probed by step 1's `--probe` — report them under "Skill catalogs", not here. This
    surfaces capability-gated checks up front (e.g. iOS lint/build needs macOS + Xcode; those post-pipeline checks SKIP
    rather than fail off-host).

3c. **Check this project's config for stale agent names, stale skill ids and a stale location.**
    Run:

   ```
   node {SDLC_PLUGIN_ROOT}/tools/migrate/cli.mjs check --json
   ```

   It answers two questions in one pass.

   **Location.** This project's SDLC files live in `<project>/.sdlc/`. They used to live in
   `<project>/.claude/` — another tool's directory, which stopped being merely untidy once the
   pipeline ran on hosts that have no such directory (ADR-0030). Nothing reads the old path any
   more, by design, so a file left there is silently not applied: a cost cap that no longer caps, a
   skill mapping that no longer maps. `legacy_location[] = {from, to, conflict}` names each one.
   **This is the finding to report FIRST** — a stale agent name degrades one entry, a stale location
   drops the whole file. Never omit this section from the report even when it is empty; say
   `✅ Config location: this project's SDLC files are in .sdlc/.` explicitly.

   **Names.** It reads two rename tables — `config/agent-migrations.json` (bare agent names,
   ADR-0021) and `config/plugin-migrations.json` (fully-qualified `plugin:skill` ids, ADR-0026 —
   e.g. a project still naming `retrofit-plugin:retrofit-conventions` after the 7 additive Android
   framework plugins were embedded into `android-foundation`) — and reports every `sdlc.local.yaml`
   `extensions.skills[].agents` entry, `extensions.skills[].skill` id, and `model.local.json`
   `agents{}` key that the marketplace no longer ships under that spelling. The JSON carries
   `findings[] = {file, where, from, to, kind: "agent"|"skill", conflict?}` — `kind` disambiguates
   the two migrations sharing this one report shape.

   Exit 2 means either kind of finding, 0 means clean. Render both in the report (below).

   **If there are findings and this is an interactive session,** ask the user whether to apply
   them, listing each `from → to`. On an explicit yes, and only then, run:

   ```
   node {SDLC_PLUGIN_ROOT}/tools/migrate/cli.mjs apply --json
   ```

   which moves any file still in `.claude/` into `.sdlc/` and rewrites only those name/id tokens in
   place, preserving comments and formatting. The move happens first, because renaming inside a
   file that is about to move would rewrite the copy nothing reads. A destination that already
   exists is a CONFLICT: the user's file there is kept and the old one is left alone — reported in
   `move_skipped[]`, never overwritten. On no, or in a non-interactive session, leave the files
   alone and print the exact command above so the user can run it themselves. Never apply without
   an answer.

   **Also report (advisory only, never a file rewrite):** this marketplace ships exactly two
   plugins — `sdlc` and `android-foundation`. Any OTHER installed-plugin registration whose
   marketplace segment is `@agentic-sdlc` is a stale registration, and there are two kinds, with
   different remedies:

   - **A retired plugin of ours** — one of the 7 removed names (`retrofit-plugin`, `ktor-plugin`,
     `room-plugin`, `datastore-proto-plugin`, `dagger-plugin`, `koin-plugin`, `workmanager-plugin`,
     ADR-0026), or anything `manifests.mjs` reports in `shadowed_frameworks` (a stale standalone
     install registered alongside `android-foundation`'s own embedded row). Print the host's
     uninstall command for `<name>@agentic-sdlc`.
   - **A foreign plugin this marketplace used to re-declare** — `superpowers` or
     `security-guidance` (ADR-0028). These were never ours to ship; the old entries cloned them
     into our namespace and shadowed the user's real install. Print the remedy **in this order**,
     and say why the order matters — uninstalling first leaves the user with no superpowers at all,
     silently downgrading every `MANDATORY — invoke superpowers:*` row to best-effort: install the
     replacement from its own marketplace FIRST, only then uninstall ours.

   Never write the host's own plugin registry yourself — that file is harness-owned, not this
   repo's.

4. **Read cost baseline (if present).** Try `<repo>/docs/cost-baseline.md`. If it has a fenced JSON
   block tagged `summary` parse and extract `avg_cost_per_medium_run_usd`,
   `p90_cost_per_medium_run_usd`, `cache_hit_ratio`, `runs_aggregated`. Otherwise show the raw "not
   yet baselined" notice.

5. **Render output.** Human-readable table by default. With a `--json` argument, emit a single
   valid JSON object and stop.

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

Skill catalogs:
  android-skills 1.0.16406183 [policy=warn] — ⚠️ degraded
    matrix: android-skills triaged against 1.0.16406183
    skills: 13 needed in this project of 25 assigned (gated off here: camerax, wear-compose-m3, …)
    tool android: 1.0.16406183 — needed by android-cli
    ❌ missing android-permissions-security — developer, security-analyst (MANDATORY)
    ❌ missing r8-analyzer — devops, security-analyst
    ⚠️ stale: android-cli at {CONFIG_DIR}/skills/android-cli differs from the catalog copy
    fix:
      android update
      android init
      android skills add --all --agent=claude-code
      android skills update --all
      (or: /plugin marketplace add android/skills && /plugin install android-skills@android-skills)

Stack profiles:
  🎯 active: android (priority=300, from android-foundation/manifest.yaml)
  ➕ frameworks: retrofit (additive)
  ➖ suppressed: ktor (detected, held back by .sdlc/sdlc.local.yaml frameworks.disable)
  also installed: vanilla (priority=0)

Host capability:
  os: Linux x86_64
  node: v20.11.0   java: 17.0.10   ./gradlew: 8.7

Config location:
  ✅ this project's SDLC files are in .sdlc/.

Agent names / skill ids in this project's config:
  ⚠️ 2 agent name(s), 1 skill id(s) stale — they currently target nothing:
     .sdlc/sdlc.local.yaml extensions.skills[0].agents: android-developer → developer
     .sdlc/model.local.json agents: android-ba → business-analyst
     .sdlc/sdlc.local.yaml extensions.skills[1].skill: retrofit-plugin:retrofit-conventions → android-foundation:retrofit-conventions
  Fix available: this skill will rewrite them in place if you approve.

Cost baseline (docs/cost-baseline.md, last updated 2026-05-04, 22 runs):
  avg medium-run: $1.62
  p90 medium-run: $2.31
  cache hit ratio: 0.61

Heads-up:
  ❌ 1 blocking dependency missing — the pipeline would abort.
     Run the install commands above, then retry.
```

If a section is absent (no baseline file, no missing deps, etc.) say so explicitly with one line —
never silently omit a section.

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
  "skill_catalogs": [
    {
      "name": "android-skills",
      "policy": "warn",
      "status": "degraded",
      "skill_set": "android-skills",
      "version": { "installed": "1.0.16406183", "matrix": "1.0.16406183", "drift": false },
      "catalog_dir": "/home/me/.android/cli/skills",
      "catalog_present": true,
      "tools": [{ "name": "android", "path": "/usr/local/bin/android", "version": "1.0.16406183", "required_by": ["android-cli"] }],
      "assigned": 25,
      "applicable": 13,
      "gated_off": ["camerax", "wear-compose-m3"],
      "assigned_missing": [
        { "skill": "android-permissions-security", "roles": [{ "role": "developer", "policy": "recommended" }, { "role": "security-analyst", "policy": "mandatory" }] }
      ],
      "tool_blocked": [],
      "unknown_to_matrix": [],
      "removed_upstream": [],
      "stale": [{ "skill": "android-cli", "installed_at": "/home/me/.claude/skills/android-cli", "catalog_at": "/home/me/.android/cli/skills/devtools/android-cli" }],
      "duplicate_roots": [],
      "remediation": {
        "install": ["android update", "android init", "android skills add --all --agent=claude-code"],
        "update": ["android update", "android skills update --all"],
        "alt_install": ["/plugin marketplace add android/skills", "/plugin install android-skills@android-skills"],
        "rematrix": null
      }
    }
  ],
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
      "gradlew": "8.7"
    }
  },
  "config_location": {
    "stale": 1,
    "legacy_location": [
      { "from": ".claude/sdlc.local.yaml", "to": ".sdlc/sdlc.local.yaml", "conflict": false }
    ],
    "applied": false
  },
  "agent_names": {
    "stale": 3,
    "findings": [
      { "file": ".sdlc/sdlc.local.yaml", "where": "extensions.skills[0].agents", "from": "android-developer", "to": "developer", "kind": "agent" },
      { "file": ".sdlc/model.local.json", "where": "agents", "from": "android-ba", "to": "business-analyst", "kind": "agent" },
      { "file": ".sdlc/sdlc.local.yaml", "where": "extensions.skills[1].skill", "from": "retrofit-plugin:retrofit-conventions", "to": "android-foundation:retrofit-conventions", "kind": "skill" }
    ],
    "applied": false
  },
  "shadowed_frameworks": [],
  "stale_plugin_installs": [
    {
      "install_key": "superpowers@agentic-sdlc",
      "kind": "foreign",
      "remedy": [
        "/plugin install superpowers@claude-plugins-official",
        "/plugin uninstall superpowers@agentic-sdlc"
      ]
    }
  ],
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

`would_abort_pipeline` is `true` iff any dependency with `policy=block` is missing. This is the
shape a CI/automation caller should anchor field names to — the field set does not change run to
run even when a section above it is empty (e.g. `legacy_location: []`, `findings: []`).

## Hard rules

- **Diagnosis is read-only.** Do NOT install plugins, run pipelines, or write files. The ONE
  exception is step 3c's `migrate apply`, which touches only this project's own SDLC files, only
  moves them out of the pre-rename `.claude/` location and renames agent-name and `plugin:skill`-id
  tokens, and only after an explicit yes. Never run it as part of a plain diagnosis, never in a
  non-interactive session, and never with `--json` (a machine caller gets the findings and decides
  for itself). The stale-plugin-install advisory is print-only — it never uninstalls or installs a
  plugin itself, including the foreign-plugin remedy, whose ordering only matters because a human
  executes the two steps (ADR-0028).
- **Do not enforce policy.** A missing `block` dep here is just reported, not actioned.
- **Reuse, don't reimplement.** The dependency-status algorithm lives in
  `tools/resolve/deps.mjs`, the catalog report in `tools/resolve/catalogs.mjs`, and step 1's
  `resolve/cli.mjs deps` is the one entry to both. Never recompute a status, a role impact or a
  stale check by hand — a second implementation is how a diagnosis comes to disagree with the run.
- **Never install or update a skill catalog.** `remediation.*` commands are printed, not run.
- **Exit code semantics with `--json`:** exit 0 normally; exit 1 only if the dependency preflight
  could not run at all (step 1's `ok: false`). Missing-but-blocking deps still exit 0 — report them
  in the JSON and let the caller decide.

## When to use

- **After upgrading the marketplace** — catch a config that still names agents from the previous
  version, or still lives in the pre-rename location, before a run silently drops those entries.
- After installing or updating a stack plugin — verify external dep wiring still resolves.
- After `android skills add` / `android skills update` — confirm every role's catalog skills are
  installed, current, and not shadowed by a same-named copy elsewhere.
- Before kicking off a long pipeline run — confirm it won't abort on a `block`-policy dependency.
- In CI / automation — `--json` gives a machine-checkable health report.
- When a cost regression is suspected — compare current `cost_baseline` against historical values.
