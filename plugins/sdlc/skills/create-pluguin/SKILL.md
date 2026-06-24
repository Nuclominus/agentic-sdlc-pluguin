---
name: create-pluguin
description: |
  Scaffold a NEW SDLC plugin step by step — a framework provider (additive library) or a foundation
  (stack provider). Gathers identity, picks a functional aspect from the taxonomy, writes a schema-valid
  manifest.yaml, drafts the phase injections + a conventions skill (always asking auto vs. manual),
  registers the plugin in the marketplace, and validates everything.

  Use when the user wants to add / create / scaffold a plugin for THIS marketplace:
  "create a plugin", "new plugin", "scaffold a framework plugin", "add a koin plugin", "create-pluguin".
  UA: "створити плагін", "новий плагін", "згенерувати плагін", "додати фреймворк-плагін", "скаффолд плагіна".

  Do NOT use for: running the pipeline (/sdlc:start), editing an existing plugin's code, or authoring
  the per-project extension manifest (that is /sdlc:extension).
---

# create-pluguin — new-plugin wizard

You scaffold a complete, schema-valid SDLC plugin into the **current marketplace repo**. Work top-down
through the phases; **ask before guessing**, write files idempotently (only create what is missing, never
clobber), and finish by validating. Two plugin kinds:

- **framework** (`kind: framework`) — additive library provider (Retrofit/Room/Dagger-like). Ships **no
  agents**; enriches existing phases. The common case.
- **foundation** (`kind: foundation`) — stack provider that owns a platform aspect, declares the agent
  roster, and hosts frameworks. Advanced.

## Preflight

1. **Locate the marketplace root** — the directory containing `.claude-plugin/marketplace.json`. If the
   user isn't in one, STOP and say so (this skill authors plugins for an SDLC marketplace repo).
2. **Read the taxonomy** — `plugins/sdlc/config/aspects.yaml` (`platform` + `functional` lists). You will
   offer aspect choices from it. Keep it open for validation.
3. **Read the schema** — `schemas/manifest.schema.json` (the contract every manifest must satisfy).
4. **List existing plugins** — `Glob plugins/*/manifest.yaml`, read each `stack`/`name`, so you can reject
   a duplicate id and (for frameworks) find which foundation hosts which functional aspect.

---

## Phase 0 — Plugin kind

Ask (AskUserQuestion): **framework** (additive, recommended/common) or **foundation** (stack provider,
advanced)? Branch the rest of the flow on the answer.

## Phase 1 — Identity & detection

Ask for the **plugin name** (human form). Derive and CONFIRM:
- directory `plugins/<slug>/`, plugin `name: <slug>`, manifest `stack: <slug>` — `<slug>` is lowercase
  kebab-case. Reject if `plugins/<slug>/` exists or any installed manifest already uses that `stack` id.

**If framework:**
- Ask the library **coordinate(s)** for `dependency:` (group or group:artifact; may be a list).
- Ask the **functional aspect** (`enriches_aspect`) — present the `functional` list from `aspects.yaml`
  (network / persistence / di / ui / background / analytics / architecture). Exactly one.
  - If the user needs a **new** category: confirm, then add it to `aspects.yaml` `functional:` **and** to
    the `functionalAspect` enum in `schemas/manifest.schema.json` (keep the mirror in sync — variant i).
- **Host check:** read each foundation manifest's `hosts_aspects` (treat `all` as "every functional
  category"). If **no** installed foundation hosts the chosen aspect, WARN that the framework won't attach
  until some foundation hosts it (offer to add it to a foundation's `hosts_aspects`, or proceed anyway).

**If foundation:**
- Ask the **platform aspect(s)** it owns (`aspects:`, from the `platform` list), `priority` (typ. 300),
  the `detect:` rules (project-structure signals), an optional default `workflow:`, the
  `framework_detection:` search locations (where to look for framework coordinates), and `hosts_aspects:`
  (`all` or an explicit subset).
- Ask the **agent name per phase** (`agents_per_phase`) and any `on_demand_agents`. (Authoring the agents
  themselves is out of scope here — this scaffolds the manifest + skill; note which agents must exist.)

## Phase 2 — Scaffold the file tree (idempotent — add only what is MISSING)

```
plugins/<slug>/
├── .claude-plugin/plugin.json        # name, version "1.0.0", description, author, license, keywords, dependencies: ["sdlc"]
├── manifest.yaml                     # the profile (templates below)
├── skills/<slug>-conventions/SKILL.md  # framework: library idioms.  foundation: optional convention skill(s)
├── rules/snippets/<slug>-*.md        # OPTIONAL — e.g. R8/ProGuard keep rules, if relevant
├── runtime-dependencies.json         # { "dependencies": [] } unless it needs external skills (e.g. superpowers)
└── README.md                         # human docs (the manifest is the machine source)
```

Foundations additionally own `agents/` (the roster you named) — flag those as TODO if they don't exist;
do not fabricate agent bodies here.

### manifest.yaml — framework template
```yaml
kind: framework
stack: <slug>
priority: 150                  # documentational for frameworks
enriches_aspect: <functional>  # one category from aspects.yaml
dependency: <coordinate>       # string or list
convention_skills:
  - <slug>:<slug>-conventions
extra_phases: []
pre_phase_commands: []
phase_injections:
  development: |
    <development guidance — Phase 3>
  security: |
    <security guidance — Phase 3>
post_pipeline_checks: []
```

### manifest.yaml — foundation template
```yaml
kind: foundation
stack: <slug>
priority: 300
aspects: [<platform>]
workflow: <recipe-or-omit>
detect:
  all: [ ... ]                 # project-structure rules
hosts_aspects: all             # or an explicit subset
framework_detection:
  - <where to look for a framework coordinate, in order>
agents_per_phase:
  business_analysis: <agent>
  development: <agent>
  # … one per phase
on_demand_agents: []
convention_skills: []
extra_phases: []
pre_phase_commands: []
phase_injections:
  development: |
    <guidance>
post_pipeline_checks: []
```

## Phase 3 — Author the content (ALWAYS ASK auto vs. manual)

For BOTH the `phase_injections` text AND the conventions skill body, ask the user **each time**:
**"draft it automatically (I'll propose, you approve) or will you write it?"**

- **Phase injections** (`development`, `security`, and any others): auto → draft concise, imperative
  house-style guidance for the library/platform; show it; let the user edit before it lands in
  `manifest.yaml`. Frameworks **defer** layer/architecture principles to "the hosting foundation's
  conventions" and **never** hard-reference another plugin's `plugin:skill` id.
- **Conventions skill** (`skills/<slug>-conventions/SKILL.md`): auto → invoke `superpowers:writing-skills`
  to produce a well-structured skill (frontmatter `name` + `description` with triggers, focused body of
  library-specific idioms). Manual → leave a clear stub the user fills.

## Phase 4 — Register & cross-link

- Add a plugin entry to `.claude-plugin/marketplace.json` (`name`, `source: ./plugins/<slug>`,
  `description`). Keep JSON valid.
- Add a row to the root `README.md` plugin table (and, if the user wants, a one-line mention in
  `ARCHITECTURE.md`).
- If a new functional category was introduced (Phase 1), make sure `aspects.yaml` + the schema enum were
  both updated.

## Phase 5 — Validate (do not skip)

1. **Schema** — validate `plugins/<slug>/manifest.yaml` against `schemas/manifest.schema.json` (e.g.
   `npx check-jsonschema --schemafile schemas/manifest.schema.json plugins/<slug>/manifest.yaml`; if that
   tool is unavailable, parse the YAML and check the guards by hand).
2. **Kind guards** — framework: has `enriches_aspect` + `dependency`; has **no** `agents_per_phase` /
   `workflow` / `framework_detection` / `hosts_aspects` / non-empty `aspects`. foundation: has `detect` +
   `aspects`; has **no** `enriches_aspect` / `dependency`.
3. **JSON** — `plugin.json` and `marketplace.json` parse.
4. **Aspect** — `enriches_aspect` ∈ `aspects.yaml.functional`; a foundation's `hosts_aspects` ⊆
   `functional` (or `all`).
5. **Dry-run detection (if inside a real project)** — check whether the `dependency` coordinate is present
   in the foundation's `framework_detection` locations; report would-attach / would-not-attach.

🚨 **MUST PRINT** a final summary: files created, the chosen `kind` + `stack` + aspect, validation result,
and any TODOs (e.g. "create the agents named in `agents_per_phase`", "fill the conventions skill stub",
"no foundation hosts `<aspect>` yet").

## Hard rules

- **Never clobber** an existing file — create only what is missing; if a target exists, show a diff and ask.
- **Never** put declarative data in the plugin `.md`/`README.md` — it lives in `manifest.yaml`. READMEs are
  human docs only.
- A **framework** ships **no** agents, **no** workflow, exactly **one** `enriches_aspect`, and depends on
  **no** sibling plugin (`plugin.json → dependencies` lists only `sdlc`).
- Keep the schema enums and `aspects.yaml` **in sync** whenever you touch the taxonomy.
- Match the marketplace's existing voice and the manifest field order shown in the templates.
