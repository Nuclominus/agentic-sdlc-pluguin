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

- **framework** (`kind: framework`, ADR-0026) — additive library provider (Retrofit/Room/Dagger-like).
  Attaches as a **row in the hosting foundation's `frameworks:` array**, not as its own plugin directory —
  a foundation is the only thing the resolver ever loads a manifest from. Ships **no agents**; enriches
  existing phases. The common case.
- **foundation** (`kind: foundation`) — stack provider that owns a platform aspect, declares the agent
  roster, and hosts frameworks via its own `frameworks:` array. Advanced — pick this only for a genuinely
  new platform (e.g. iOS), not for a new library on an existing platform.

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

Ask for the **plugin/framework name** (human form) and derive `<slug>` (lowercase kebab-case) — this
becomes the `stack:` id either way. For a **foundation**, also derive and CONFIRM the new directory
`plugins/<slug>/` and plugin `name: <slug>`; reject if it exists or any installed manifest already uses
that `stack` id. A **framework** creates no directory of its own (see Phase 2) so only the `stack` id
needs to be unique.

**If framework:**
- **Which foundation hosts it?** `Glob plugins/*/manifest.yaml`, list the `kind: foundation` ones, and
  ask the user to pick one (e.g. `android-foundation`) — the row you draft in Phase 2 goes into THAT
  foundation's `frameworks:` array. Reject a foundation whose `hosts_aspects` cannot include the chosen
  aspect (see below) unless the user confirms adding it there too.
- Ask the library **coordinate(s)** for `dependency:` (group or group:artifact; may be a list).
- Ask the **functional aspect** (`enriches_aspect`) — present the `functional` list from `aspects.yaml`
  (network / persistence / di / ui / background / analytics / architecture). Exactly one.
  - If the user needs a **new** category: confirm, then add it to `aspects.yaml` `functional:` **and** to
    the `functionalAspect` enum in `schemas/manifest.schema.json` (keep the mirror in sync — variant i).
- **Host check:** read the chosen foundation's `hosts_aspects` (treat `all` as "every functional
  category"). If it does not host the chosen aspect, WARN that the framework won't attach until
  `hosts_aspects` is widened (offer to do it, or proceed anyway).
- **Stack uniqueness (ADR-0026):** confirm `<slug>` does not collide with any existing row's `stack` in
  ANY foundation's `frameworks:` array, nor with any foundation's own `stack` id — this is a schema/lint
  invariant (`tools/sdlc-lint`), not just good practice.

**If foundation:**
- Ask the **platform aspect(s)** it owns (`aspects:`, from the `platform` list), `priority` (typ. 300),
  the `detect:` rules (project-structure signals), an optional default `workflow:`, the
  `framework_detection:` search locations (where to look for framework coordinates), and `hosts_aspects:`
  (`all` or an explicit subset).
- Ask for the **per-role expertise** (`role_expertise`). A foundation ships **no agents** (ADR-0021):
  the roster is the core's, and what a stack provider contributes is what those core roles need to know.
  For each CORE role the platform has something to say about — `business-analyst`, `developer`,
  `reviewer`, `tester`, `qa-engineer`, `security-analyst`, `document-writer`, `debugger`, `devops`,
  `cicd`, `aar-analyst` — ask for up to three things:
  - `invariants` — the always-on non-negotiables. Capped at **1400 characters** because this text rides
    in every turn's stable prefix; a long checklist belongs in a skill instead.
  - `rules` — paths (relative to the manifest) the role may `Read`, each with a `note` saying when.
  - `skills` — `{skill, policy, when}` rows. Keep mandatory rows to **≤3 per role**: compliance tracks
    the number of things an agent must remember, not how emphatically you say them.
  Skip a role entirely rather than inventing filler for it — an empty declaration is a real answer.

## Phase 2 — Scaffold the file tree (idempotent — add only what is MISSING)

**Foundation** gets a new plugin directory:
```
plugins/<slug>/
├── .claude-plugin/plugin.json        # name, version "1.0.0", description, author, license, keywords, dependencies: ["sdlc"]
├── manifest.yaml                     # the profile (template below) — hosts no frameworks yet: omit `frameworks:`, or write `frameworks: []` (both are valid)
├── skills/<slug>-conventions/SKILL.md  # optional convention skill(s)
├── rules/snippets/<slug>-*.md        # OPTIONAL
├── runtime-dependencies.json         # { "dependencies": [] } unless it needs external skills (e.g. superpowers)
└── README.md                         # human docs (the manifest is the machine source)
```

**Framework** (ADR-0026) lands entirely INSIDE the foundation chosen in Phase 1 — no new plugin
directory, no new `.claude-plugin/plugin.json`:
```
<foundation>/
├── manifest.yaml                              # append the row template below to its `frameworks:` array
├── skills/<slug>-conventions/SKILL.md         # library idioms — under the FOUNDATION's skills/, not a new tree
└── rules/snippets/<slug>-*.md                 # OPTIONAL — e.g. R8/ProGuard keep rules, under the FOUNDATION's rules/
```
Reference the skill as `<foundation>:<slug>-conventions` (the foundation's own plugin-id namespace) in
the row's `convention_skills`, and any `phase_injections` snippet path relative to the **foundation's**
own directory (e.g. `rules/snippets/<slug>-proguard.md`) — never a `<slug>-plugin/...` path, which no
installed root exists at.

No plugin but the core ships `agents/`. If the platform needs a role the core roster does not have,
that is a change to `plugins/sdlc/`, not a directory here — `sdlc-lint roster` fails any other plugin
that ships one.

### `frameworks:` row template — append to the CHOSEN FOUNDATION's manifest.yaml
```yaml
frameworks:
  # … existing rows …
  - stack: <slug>
    priority: 150                  # documentational for frameworks
    enriches_aspect: <functional>  # one category from aspects.yaml
    dependency: <coordinate>       # string or list
    convention_skills:
      - <foundation-slug>:<slug>-conventions
    extra_phases: []
    pre_phase_commands: []
    phase_injections:
      development: |
        <development guidance — Phase 3>
      security: |
        <security guidance — Phase 3>
    post_pipeline_checks: []
```
A row never carries `kind` itself — the resolver's synthesizer (`manifests.mjs`) adds `kind: framework`
to the record it builds from the row. It is likewise forbidden the foundation-only keys: `workflow`,
`framework_detection`, `hosts_aspects`, `agents_per_phase`, `on_demand_agents`, `aar_analyst`, `detect`,
`aspects`, `role_expertise`, `frameworks` (a row cannot itself host frameworks).

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
role_expertise:                # per CORE role — this is what a foundation contributes
  developer:
    invariants: |
      <the always-on non-negotiables for this platform — ≤1400 chars, it rides in every prefix>
    rules:
      - { path: rules/snippets/non-negotiable.md, note: "forbidden patterns — before the first edit" }
    skills:
      - { skill: <slug>:<slug>-conventions, when: "before writing production code" }
  # … one entry per role the platform has something to say about
convention_skills: []
extra_phases: []               # a new phase names the CORE role that runs it: { name, after, agent }
pre_phase_commands: []
post_pipeline_checks: []
```

`agents_per_phase`, `on_demand_agents` and `aar_analyst` are **forbidden** here — the schema rejects
them on any foundation but the core's own `stack: vanilla` profile.

## Phase 3 — Author the content (ALWAYS ASK auto vs. manual)

For BOTH the `phase_injections` text AND the conventions skill body, ask the user **each time**:
**"draft it automatically (I'll propose, you approve) or will you write it?"**

- **Expertise text** — a framework row's `phase_injections`, a foundation's
  `role_expertise.<role>.invariants`: auto → draft concise, imperative house-style guidance for the
  library/platform; show it; let the user edit before it lands in `manifest.yaml`. A framework row
  **defers** layer/architecture principles to "the hosting foundation's conventions" and **never**
  hard-references another plugin's `plugin:skill` id — only its own hosting foundation's.
  A foundation's `rules/**` must not name the plugin-root variable: those files are read by an agent
  living in `plugins/sdlc`, where it resolves to the wrong plugin. The resolver emits each declared
  rule path absolute — refer to a sibling file by name in the prose.
- **Conventions skill** (`skills/<slug>-conventions/SKILL.md`, under the foundation's own `skills/` for a
  framework row): auto → invoke `superpowers:writing-skills` to produce a well-structured skill
  (frontmatter `name` + `description` with triggers, focused body of library-specific idioms). Manual →
  leave a clear stub the user fills.

## Phase 4 — Register & cross-link

**Foundation:**
- Add a plugin entry to `.claude-plugin/marketplace.json` (`name`, `source: ./plugins/<slug>`,
  `description`). Keep JSON valid.
- Add a row to the root `README.md` plugin table (and, if the user wants, a one-line mention in
  `ARCHITECTURE.md`).

**Framework:** no marketplace entry and no README plugin-table row — it is not an installed plugin.
Mention it in the hosting foundation's own `marketplace.json` description and README section instead
(one line, matching how the embedded frameworks are already described there, ADR-0026).

**Both:** if a new functional category was introduced (Phase 1), make sure `aspects.yaml` + the schema
enum were both updated.

## Phase 5 — Validate (do not skip)

1. **Schema** — validate the manifest against `schemas/manifest.schema.json` (`plugins/<slug>/manifest.yaml`
   for a foundation; the hosting foundation's own `manifest.yaml` for a framework row) — e.g.
   `npx check-jsonschema --schemafile schemas/manifest.schema.json <path>`; if that tool is unavailable,
   parse the YAML and check the guards by hand.
2. **Kind guards** — framework row: has `enriches_aspect` + `dependency`; carries **no** `kind` (the
   resolver's synthesizer adds it) and **no** `workflow` / `framework_detection` / `hosts_aspects` /
   `agents_per_phase` / `on_demand_agents` / `aar_analyst` / `detect` / `aspects` / `role_expertise` /
   `frameworks`. foundation: has `detect` + `aspects`; has **no** `enriches_aspect` / `dependency` /
   `agents_per_phase` / `on_demand_agents` / `aar_analyst`.
2b. **Roster** — `node tools/sdlc-lint/cli.mjs roster --json` (part of `all`): no `agents/` outside the
   core, every `role_expertise` key is a core role, every declared rule path exists, every own-plugin
   skill exists, every external skill is declared in `runtime-dependencies.json`, and no retired agent
   name or plugin-root path survives in the new plugin.
2c. **Cross-row `stack` uniqueness (ADR-0026)** — the new row's `stack` collides with no other row in
   ANY foundation's `frameworks:` array and no foundation's own `stack` id (`tools/sdlc-lint`).
3. **JSON** — `plugin.json` and `marketplace.json` parse.
4. **Aspect** — `enriches_aspect` ∈ `aspects.yaml.functional`; a foundation's `hosts_aspects` ⊆
   `functional` (or `all`).
5. **Dry-run detection (if inside a real project)** — check whether the `dependency` coordinate is present
   in the foundation's `framework_detection` locations; report would-attach / would-not-attach.

🚨 **MUST PRINT** a final summary: files created, the chosen `kind` + `stack` + aspect, validation result,
and any TODOs (e.g. "fill the conventions skill stub", "write the `role_expertise.<role>.invariants`",
"no foundation hosts `<aspect>` yet").

## Hard rules

- **Never clobber** an existing file — create only what is missing; if a target exists, show a diff and ask.
- **Never** put declarative data in the plugin `.md`/`README.md` — it lives in `manifest.yaml`. READMEs are
  human docs only.
- **No plugin but `sdlc` ships agents.** A framework row additionally carries **no** `kind`, `workflow`,
  exactly **one** `enriches_aspect`, and no `plugin.json` of its own — it is not an installed plugin
  (ADR-0026). A foundation owns a workflow and platform aspects, and declares `role_expertise` — never a
  roster (ADR-0021).
- Keep the schema enums and `aspects.yaml` **in sync** whenever you touch the taxonomy.
- Match the marketplace's existing voice and the manifest field order shown in the templates.
