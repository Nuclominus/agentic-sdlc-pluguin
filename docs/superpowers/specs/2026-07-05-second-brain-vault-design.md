# Second Brain Vault — Design

- **Date:** 2026-07-05
- **Status:** Approved (design), pending implementation plan
- **Topic:** A repo-owned Obsidian "Second Brain" vault at `.brain/`, kept in sync with merged PRs

---

## 1. Purpose & Principles

The **Second Brain** is a real Obsidian vault at `.brain/` that becomes the **single source of
truth** for how this marketplace works and how it evolves. It replaces the current scattering of
knowledge across `ARCHITECTURE.md`, `CORE-TODO.md`, `docs/superpowers/specs/`, and ad-hoc memory
with one wiki-linked knowledge graph, and gives the project a **stable memory structure for future
planning**.

It is organized around four durable pillars, wiki-linked into one graph:

| Pillar | Answers | Folder | Populated by |
|---|---|---|---|
| **Knowledge** | *How does the system work?* | `architecture/`, `components/` | absorbed from `ARCHITECTURE.md` |
| **Changes** | *What happened, and when?* | `changes/` | **auto** — one note per merged PR |
| **Decisions** | *Why did we choose this?* | `decisions/` (ADRs) | human + `android-docs` agent |
| **Planning** | *What's next?* | `planning/` | absorbed from `CORE-TODO.md` + roadmap |

**Core principle — the merge is the heartbeat.** Every merged PR deterministically produces an
immutable change note. That record is *guaranteed to exist* even if nobody writes prose. Depth
(rationale, ADRs, architecture updates) is layered on afterward by a human or the `android-docs`
agent. The graph is what makes it a *brain*: a change note links to the component it touched, the
ADR it implements, and the roadmap item it advances — so navigation is by meaning, not by folder.

**Scope boundary.** This vault is for **this repository** (the plugin marketplace's own codebase).
It is intentionally distinct from the `.obsidian-vault/` template that the `manage-vault` skill
scaffolds for **end-user Android apps**. The two must never collide — hence `.brain/`, not
`.obsidian-vault/`.

## 2. Vault Structure

```
.brain/
├── .obsidian/                 # minimal vault config (graph; no third-party plugins required)
├── README.md                  # what this vault is + the maintenance contract
├── _moc-root.md               # home dashboard: links to every MOC + latest changes
├── _templates/
│   ├── change-note.md         # per-PR (frontmatter: pr, date, author, type, plugins, files)
│   ├── adr.md                 # decision record (status, context, decision, consequences)
│   ├── plan.md                # planning / roadmap item
│   └── component.md           # one plugin's architecture note
├── architecture/              # ← absorbs ARCHITECTURE.md
│   ├── _moc-architecture.md
│   ├── stack-provider-pattern.md
│   ├── pipeline-orchestrator.md
│   └── manifest-and-aspects.md
├── components/                # one note per plugin (the "modules" of this repo)
│   ├── sdlc.md
│   ├── android-foundation.md
│   ├── retrofit-plugin.md
│   ├── room-plugin.md
│   ├── dagger-plugin.md
│   └── workmanager-plugin.md
├── changes/                   # ← AUTO: one immutable note per merged PR
│   ├── _moc-changes.md        # reverse-chronological index (the running changelog)
│   └── 2026-07-03-PR-29-workmanager-provider.md
├── decisions/                 # ADRs — the "why"
│   ├── _moc-decisions.md
│   └── ADR-0001-stack-provider-pattern.md
├── planning/                  # ← absorbs CORE-TODO.md + roadmap
│   ├── _moc-planning.md
│   ├── roadmap.md
│   └── backlog.md
└── releases/                  # thin release list mirroring CHANGELOG.md tags
    └── _moc-releases.md
```

**Stays outside the vault:**
- `CHANGELOG.md` — remains at repo root, thin and release-tagged, human-facing.
- `README.md` / `CONTRIBUTING.md` — remain as entry points.

**Migrated into the vault (old path becomes a one-line pointer stub):**
- `ARCHITECTURE.md` → `architecture/*.md`
- `CORE-TODO.md` + roadmap → `planning/roadmap.md` + `planning/backlog.md`

## 3. Sync Tooling & GitHub Action

### 3.1 Tooling — `tools/brain-sync/`

Repo-infrastructure Node package, sibling to the existing `tools/sdlc-lint/`. **Not** shipped
inside any plugin — it is CI infrastructure for this repo.

```
tools/brain-sync/
├── package.json
├── cli.mjs                    # `node cli.mjs sync --pr <num>`  |  `sync --backfill`
└── lib/
    ├── pr.mjs                 # reads PR data via `gh pr view --json ...`
    ├── classify.mjs           # file paths → touched plugins/components + change type
    ├── render.mjs             # fills change-note.md template from PR data
    └── index.mjs              # rebuilds changes/_moc-changes.md + releases index
```

### 3.2 Deterministic sync — per PR

1. **Pull PR metadata** via `gh pr view <num> --json number,title,body,author,mergedAt,labels,files`
   (+ diffstat).
2. **Classify:** map `plugins/<name>/…` paths → component notes; derive change type from the
   conventional-commit prefix (`feat`/`fix`/`chore`/`docs`) and any Roadmap tag in the title
   (e.g. "Roadmap C2").
3. **Write** `changes/<mergedAt-date>-PR-<num>-<slug>.md`:
   - **frontmatter:** `pr`, `date`, `author`, `type`, `plugins`, `roadmap`, `files_changed`
   - **Summary:** PR title + first paragraph of body
   - **Changed areas:** auto bullet list linking `[[components/<plugin>]]`
   - **Links:** placeholder links to `[[decisions/…]]` and the `[[planning/roadmap]]` item (enriched later)
4. **Rebuild** `changes/_moc-changes.md` (reverse-chron table); for release PRs, refresh the
   `releases/` index.
5. **Idempotent:** re-running on the same PR overwrites its note deterministically — the whole
   backfill is safe to re-run.

### 3.3 The Action — `.github/workflows/brain-sync.yml`

- **Trigger:** `pull_request` with `types: [closed]`, guarded by `if: github.event.pull_request.merged == true`, base `develop`.
- **Permissions:** `contents: write`, `pull-requests: write`.
- **Steps:** checkout → setup Node → run
  `node tools/brain-sync/cli.mjs sync --pr ${{ github.event.pull_request.number }}` (the `gh` CLI
  is preinstalled on GitHub-hosted runners; authenticate it with `GITHUB_TOKEN`).
- **Output — follow-up PR (chosen approach):** if the sync produced changes under `.brain/`, create
  a branch `brain-sync/pr-<num>`, commit the vault update, and open a PR against `develop` titled
  `docs(brain): sync vault for #<num>`. Using `GITHUB_TOKEN` for this PR means it will **not**
  trigger further workflow runs, so there is no sync loop. If the sync produced no changes, the job
  exits cleanly without opening a PR.
- **Cost:** no Anthropic key, no external API cost. The Action only guarantees the append-log entry
  exists; prose/ADR enrichment happens later via a human or the `android-docs` agent.

### 3.4 Self-describing contract

`.brain/README.md` documents the whole maintenance loop (heartbeat, what is auto vs. enriched, how
to run the sync locally) so the process is discoverable without reading this spec.

## 4. One-Time Backfill & Migration

Performed once, at implementation time, to populate the vault:

1. **Scaffold** the `.brain/` skeleton: `.obsidian/` config, `_templates/`, all `_moc-*.md`,
   `README.md`.
2. **Backfill all merged PRs** (#1–#30 at time of writing): `node tools/brain-sync/cli.mjs sync
   --backfill` iterates every PR merged into `develop` and generates a change note for each —
   producing the full immutable history on day one.
3. **Migrate `ARCHITECTURE.md`** → split into `architecture/*.md` notes; leave a one-line pointer
   stub at the old path.
4. **Migrate `CORE-TODO.md` + roadmap** → `planning/roadmap.md` + `planning/backlog.md`; pointer
   stub at old path. Seed roadmap status from known progress (A / B1 / D / C1 / B2 / C2 done;
   remaining C2 items + B3).
5. **Seed `components/*.md`** — one note per plugin, identity pulled from each
   `plugins/<name>/manifest.yaml` / plugin manifest, with a backlink section that its change notes
   populate.
6. **Seed foundational ADRs** — e.g. ADR-0001 Stack Provider Pattern, ADR-0002 Framework Provider
   Pattern — so the `decisions/` pillar is non-empty and the template is demonstrated.

The backfill runs **locally** during implementation (not via the Action), committed as part of the
feature branch.

## 5. Connection to Repo Rules (owner's step)

The vault owner will wire the vault into the **repository's working rules** (rules for working with
this repo, *not* the shipped plugin behavior). This design only prepares the hook point:

- `.brain/README.md` states the maintenance contract.
- A future rule — *"when a PR merges and it touched a plugin, enrich its change note and update the
  component/ADR notes"* — would live in a root `CLAUDE.md` or `.claude/rules/` (neither exists yet).

This implementation will **not** modify `CLAUDE.md`, `.claude/rules/`, `~/.claude`, or any
settings/hooks/agents without explicit approval — it only makes the vault ready to be referenced.

## 6. Out of Scope

- Claude/LLM authoring of notes in CI (deterministic stub + human/agent enrichment was chosen instead).
- Direct commits to `develop` (a reviewable follow-up PR was chosen instead).
- Modifying repo rules, `CLAUDE.md`, or `~/.claude` (owner's separate step).
- Changing the `manage-vault` skill or the end-user `.obsidian-vault/` template.

## 7. Success Criteria

- `.brain/` opens as a valid Obsidian vault with a working graph and backlinks.
- All merged PRs (#1–#30) have a change note; `changes/_moc-changes.md` lists them reverse-chron.
- `ARCHITECTURE.md` and `CORE-TODO.md` content lives in the vault, with pointer stubs left behind.
- `node tools/brain-sync/cli.mjs sync --pr <num>` is idempotent and re-runnable.
- The `brain-sync.yml` Action opens a follow-up PR on a test merge, without triggering a sync loop.
- `.brain/README.md` fully describes the maintenance contract.
