# Brief Intake (`/sdlc:brief` + `/sdlc:start --brief`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone interview skill that writes `docs/briefs/<slug>.md`, plus a `--brief=<path>` flag that lets `/sdlc:start` take its slug, language and recipe-match text from that file.

**Architecture:** The deterministic half lives in JS. A new `resolve/brief.mjs` reads and validates the brief, and `resolvePlan` swaps the flag for the brief's title before workflow matching, then exposes `plan.brief`. The orchestrator prose consumes `plan.brief` for `task_slug`, `narrative_language` and `_brief.md`. The skill is prose only and knows nothing about the orchestrator.

**Tech Stack:** Node ≥22 ESM, `node:test`, bash, Markdown skills/commands, `claude plugin eval`.

**Spec:** `.brain/decisions/ADR-0042-brief-intake-is-a-standalone-skill-not-an-agent.md`

## Global Constraints

- Every file written is English. Commit messages and PR text never mention AI tools or agents (no `Co-Authored-By` trailer).
- Stage specific paths only, never `git add -A` (the user edits files concurrently).
- No comments or KDoc beyond one line stating a non-obvious why.
- Brief frontmatter keys exactly: `title`, `slug`, `narrative_language` (`uk` | `en`).
- Slug rule: `/^[a-z0-9][a-z0-9-]*$/`, max 40 chars (the existing `SLUG_RE` / `slugify`).
- Brief location: `docs/briefs/<slug>.md`.
- Brief sections exactly: Goal, Context, In scope / Out of scope, Constraints, Done looks like, Open questions & risks.
- `--brief` + a description → error. `--brief` + `--resume` → error. `--brief` + `--workflow` / `--dry-run` / `--stack` → allowed.
- The skill never touches git or `.gitignore`, never runs `/sdlc:start`, and declares `disallowed-tools: [Edit, NotebookEdit, Bash]`.
- Work branch: `feat/brief-intake` cut from `develop`. The PR targets `develop`.

## Review Focus

1. **A path with spaces** (`--brief=docs/my brief.md`): `opt()` stops at whitespace. Expect a clear `file not found` halt naming the truncated path, not a crash. Pinned in Task 2.
2. **CRLF or BOM frontmatter** (a brief saved on Windows): expect it to parse like LF. Pinned in Task 2.
3. **A title with quotes or regex metacharacters** (`Fix "empty" list (urgent)`): expect the rewrite to keep args well-formed and the `hotfix` match to still fire. Pinned in Task 3.
4. **Path traversal** (`--brief=../../etc/hosts`): expect a halt because the path is outside the project. Pinned in Task 2.
5. **A brief slug that already has `docs/plans/<slug>/`**: a new run would overwrite the earlier run's `_brief.md`. Expect a `WARN:` naming the directory. Pinned in Task 3.

---

### Task 1: Work branch and ADR-0042 amendment

**Files:**
- Modify: `.brain/decisions/ADR-0042-brief-intake-is-a-standalone-skill-not-an-agent.md`
- Commit (already written on `develop`, uncommitted): the ADR-0042 file, `.brain/decisions/_moc-decisions.md` (ADR-0042 row only), `.brain/planning/roadmap.md` (K1 row only)

- [ ] **Step 1:** `git worktree list`, then `git switch -c feat/brief-intake develop`. The uncommitted vault edits carry over.
- [ ] **Step 2: Amend the ADR.** Spell the flag `--brief=<path>` everywhere, because the resolver's `opt()` reads only the `--x=VALUE` form. In Decision 2, state that `disallowed-tools` lasts only until the user's next message (Claude Code `skills.md`). It guards the opening research turn; across the interview the guarantee is the instruction plus visible permission prompts. Remove the "To confirm" bullet about its lifetime. Remove "lint covers the skill's frontmatter" from Consequences, because no skill-frontmatter lint exists. Coverage comes from `doc-refs`, `emit --check` and the eval.
- [ ] **Step 3:** `node tools/brain-sync/cli.mjs check --vault .brain` → `check: clean`.
- [ ] **Step 4: Commit.** If `_moc-decisions.md` or `roadmap.md` also carry the ADR-0043 / K2 lines, stage only the ADR-0042 / K1 hunks with `git add -p`.

```bash
git add .brain/decisions/ADR-0042-brief-intake-is-a-standalone-skill-not-an-agent.md
git add -p .brain/decisions/_moc-decisions.md .brain/planning/roadmap.md
git commit -m "docs(brain): ADR-0042 brief intake is a standalone skill"
```

---

### Task 2: `resolve/brief.mjs`: read and validate a brief

**Files:**
- Create: `plugins/sdlc/tools/resolve/slug.mjs`, which moves `slugify`, `briefOf`, `SLUG_RE` and `TOKEN_VALUE_FLAGS` out of `plan.mjs:178-196` unchanged, now exported.
- Modify: `plugins/sdlc/tools/resolve/plan.mjs`, which imports those from `./slug.mjs`.
- Create: `plugins/sdlc/tools/resolve/brief.mjs`
- Test: `tools/sdlc-lint/test/brief.test.mjs`

**Interfaces:**
- Produces:
  - `readBrief({ cwd: string, args: string }) -> { requested: false } | { requested: true, path: string, title: string, slug: string, narrative_language: "uk"|"en" } | { requested: true, error: string }`. `path` is project-relative.
  - `briefArgs(args: string, title: string) -> string`: `args` with the `--brief=<path>` token replaced by `JSON.stringify(title)`.

- [ ] **Step 1: Write the failing tests** in `brief.test.mjs`. Use a temp dir per test.
  - `no --brief → { requested: false }`.
  - Valid file (`title: Hotfix crash on empty list`, `slug: empty-list-crash`, `narrative_language: uk`) → the four fields, with `path === "docs/briefs/x.md"`.
  - `--brief=docs/briefs/x.md "extra words"` → `error` matches `/either --brief=<path> or a description/`.
  - `--brief=x.md --resume` → `error` matches `/cannot be combined with --resume/`.
  - Missing file → `error` matches `/not found: docs\/briefs\/missing\.md/`.
  - Path with spaces `--brief=docs/my brief.md` → `error` matches `/not found: docs\/my/` (Review Focus 1).
  - No frontmatter → `/no frontmatter/`. Empty `title` → `/title/`.
  - `slug: Bad Slug` → `/slug/`. A 41-char slug → `/slug/`.
  - `narrative_language: de` → `/narrative_language/`.
  - CRLF line endings and a leading BOM parse like LF (Review Focus 2).
  - `--brief=../../etc/hosts` → `/outside the project/` (Review Focus 4).
  - `briefArgs('--brief=a.md --dry-run', 'Fix "x" (urgent)')` → `'"Fix \\"x\\" (urgent)" --dry-run'`.
- [ ] **Step 2:** `node --test tools/sdlc-lint/test/brief.test.mjs` → FAIL (module not found).
- [ ] **Step 3: Move the helpers.** Move them to `slug.mjs` and re-import them in `plan.mjs`.
- [ ] **Step 4:** `node --test tools/sdlc-lint/test/plan.test.mjs tools/sdlc-lint/test/resume.test.mjs` → still PASS.
- [ ] **Step 5: Implement `readBrief` / `briefArgs`.**
  - Check in this order, returning the first failure: containment → exists → frontmatter fields → description present → `--resume` present. The file checks run first, so a path with spaces reports `not found` rather than "description present". The combination tests therefore use an existing valid file.
  - Read the path with `opt(args, "--brief")` semantics.
  - Description check: `briefOf(args)` is non-empty after removing the `--brief=` token.
  - Resume check: `/(^|\s)--resume(=|\s|$)/`.
  - Containment: `resolve(cwd, p)` must start with `realpathSync(cwd) + sep`.
  - Frontmatter: strip the BOM and normalise `\r\n` first, then parse the block between the leading `---` lines with `parseYaml` from `./yaml.mjs`.
  - Error strings are prefixed `--brief=<path>: ` except the two combination errors, which use the exact copy in Task 3.
- [ ] **Step 6:** `node --test tools/sdlc-lint/test/brief.test.mjs` → PASS.
- [ ] **Step 7: Commit.**

```bash
git add plugins/sdlc/tools/resolve/slug.mjs plugins/sdlc/tools/resolve/brief.mjs plugins/sdlc/tools/resolve/plan.mjs tools/sdlc-lint/test/brief.test.mjs
git commit -m "feat(sdlc): read and validate a --brief file"
```

---

### Task 3: Wire `--brief` into `resolvePlan`

**Files:**
- Modify: `plugins/sdlc/tools/resolve/plan.mjs:640-660`, and the `plan` object assembled before `:835`.
- Modify: `plugins/sdlc/tools/resolve/cli.mjs:34-41` (`usage()`, adds `--brief=<path>`).
- Test: `tools/sdlc-lint/test/plan.test.mjs`

**Interfaces:**
- Consumes: `readBrief`, `briefArgs` (Task 2).
- Produces:
  - `plan.brief: null | { path, title, slug, narrative_language }`.
  - A print line, exact: `📄 Brief: <path> → slug <slug>, narrative_language <lang>`.
  - Halt copy, exact:
    - `❌ --brief: use either --brief=<path> or a description, not both`
    - `❌ --brief cannot be combined with --resume (a resumed run already has its _brief.md)`
    - `❌ <readBrief error>`

- [ ] **Step 1: Write the failing tests.** Reuse the temp-project helper pattern at `plan.test.mjs:796-813`.
  - A brief titled `Hotfix crash on empty list` with `--dry-run` selects workflow `hotfix` (match ran on the title), and `plan.brief.slug === "empty-list-crash"`.
  - The same brief plus `--workflow=docs-only` selects `docs-only`.
  - A brief titled `Fix "empty" list (urgent)` still selects `hotfix` (Review Focus 3).
  - Brief plus description → `halt` equals the first copy line. Brief plus `--resume` → the second.
  - An existing `docs/plans/empty-list-crash/` → `warnings` contains `WARN: --brief: docs/plans/empty-list-crash/ already exists — a new run will overwrite its _brief.md` (Review Focus 5).
  - No `--brief` → `plan.brief === null`.
- [ ] **Step 2:** `node --test tools/sdlc-lint/test/plan.test.mjs` → the new tests FAIL.
- [ ] **Step 3: Implement.** At the top of `resolvePlan`, before `resolveProfile`:
  - call `readBrief`;
  - on `error`, return `{ plan: null, prints, warnings, halt }`;
  - otherwise set `args = briefArgs(args, brief.title)`, push the print line and the existing-dir warning, and attach `plan.brief`.
- [ ] **Step 4:** `npm test --prefix tools/sdlc-lint` → PASS.
- [ ] **Step 5: Commit.**

```bash
git add plugins/sdlc/tools/resolve/plan.mjs plugins/sdlc/tools/resolve/cli.mjs tools/sdlc-lint/test/plan.test.mjs
git commit -m "feat(sdlc): /sdlc:start resolves slug, language and recipe from --brief"
```

---

### Task 4: Orchestrator prose and `/sdlc:start` docs consume `plan.brief`

**Files:**
- Modify: `plugins/sdlc/commands/start.md`
  - L3: add `[--brief=PATH]` to `argument-hint`.
  - Step 1 (L13-35): `--brief=` alone is a valid, non-empty input.
  - Examples (L63-69): add one.
- Modify: `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md`
  - L44-54 Inputs.
  - L68: when `plan.brief` is set, `narrative_language` is `plan.brief.narrative_language` and the heuristic is skipped.
  - L298: `task_slug = plan.brief.slug` when set.
  - L324: `_brief.md` is a copy of the file at `plan.brief.path`. Keep the heredoc rule at L307-308 for worktree-guard mode.
- Modify: `plugins/sdlc/hosts/antigravity/overlays/pipeline-orchestrator/`, the same three edits in the overlay.
- Modify: `docs/WORKFLOW.md` (§5 artifacts, L238: `docs/briefs/`), and `CHANGELOG.md` `## [Unreleased]` → `### Added`.
- Regenerate: `dist/antigravity/plugins/sdlc/`

- [ ] **Step 1: Make the edits** listed above. The `sdlc-contract` blocks `0-resolve` (L80-86) and `2-4-anchor` (L290-296) stay byte-identical unless their text names the changed values. If they do, update them and their lint fixtures together.
- [ ] **Step 2:** `node tools/sdlc-lint/cli.mjs emit`, then `node tools/sdlc-lint/cli.mjs all --json` → no failures.
- [ ] **Step 3: Commit.**

```bash
git add plugins/sdlc/commands/start.md plugins/sdlc/skills/pipeline-orchestrator/SKILL.md plugins/sdlc/hosts/antigravity/overlays/pipeline-orchestrator docs/WORKFLOW.md CHANGELOG.md dist/antigravity/plugins/sdlc
git commit -m "feat(sdlc): orchestrator takes task_slug, language and _brief.md from --brief"
```

---

### Task 5: The `/sdlc:brief` skill and command

**Files:**
- Create: `plugins/sdlc/skills/brief/SKILL.md`
- Create: `plugins/sdlc/commands/brief.md`. Use the `commands/aar.md` pattern ("Invoke the `sdlc:brief` skill") with `argument-hint: "[rough idea]"`.
- Modify: `README.md` Commands table (L119-130), `plugins/sdlc/README.md`, `CHANGELOG.md` `### Added`.
- Regenerate: `dist/antigravity/plugins/sdlc/`

**Interfaces:**
- Produces: a file that `readBrief` (Task 2) accepts.

- [ ] **Step 1: Write the SKILL.md frontmatter.**
  - `name: brief`.
  - `description`: one paragraph with "Use when …", `Trigger words — EN:` / `UA:`, and "Do NOT use for: running the pipeline, answering questions about the project (`/sdlc:ask`), editing code".
  - `disallowed-tools: [Edit, NotebookEdit, Bash]`.
- [ ] **Step 2: Write the body sections, in order.**
  1. **Read the project.** Read README, CLAUDE.md, and `.brain/` or `docs/` directly. Dispatch one `Explore` for a broad code sweep.
  2. **Interview rounds.** The frontier, numbered questions, and a recommended answer for each grounded in what was read. Write this in our own words; check the mattpocock-skills license before borrowing any phrasing.
  3. **The six-section template.** The interview ends when every section is filled or `n/a`.
  4. **Slug.** Propose one from the agreed title using the slug rule in Global Constraints; the user confirms. If the file exists, ask: refine it, or pick another slug.
  5. **Write.** Frontmatter `title` / `slug` / `narrative_language` = the conversation's language. Write only `docs/briefs/<slug>.md`.
  6. **End.** Print a summary (slug, language, open-question count) and `/sdlc:start --brief=docs/briefs/<slug>.md`. Do not run it.
- [ ] **Step 3: Validate.** Write a sample brief by hand that follows the template. `node -e` with `readBrief` from Task 2 must return its fields.
- [ ] **Step 4:** `node tools/sdlc-lint/cli.mjs emit`, then `node tools/sdlc-lint/cli.mjs all --json` → no failures (`doc-refs` resolves `sdlc:brief`).
- [ ] **Step 5: Commit.**

```bash
git add plugins/sdlc/skills/brief/SKILL.md plugins/sdlc/commands/brief.md README.md plugins/sdlc/README.md CHANGELOG.md dist/antigravity/plugins/sdlc
git commit -m "feat(sdlc): /sdlc:brief interviews the user and writes docs/briefs/<slug>.md"
```

---

### Task 6: Eval case `10-brief-dry-run` and the manual check

**Files:**
- Create: `plugins/sdlc/evals/10-brief-dry-run/prompt.md`
- Create: `plugins/sdlc/evals/10-brief-dry-run/fixture-brief.md` (frontmatter `title: Hotfix crash when the actions list is empty`, `slug: actions-list-crash`, `narrative_language: uk`; body follows the six sections, written in Ukrainian)
- Create: `plugins/sdlc/evals/10-brief-dry-run/graders/{fired,no-agent-dispatch,no-workspace,brief-line,hotfix}.md`

- [ ] **Step 1: Write `prompt.md`.** Copy the frontmatter from `03-hotfix-recipe/prompt.md`. Body: `/sdlc:start --brief=plugins/sdlc/evals/10-brief-dry-run/fixture-brief.md --dry-run`.
- [ ] **Step 2: Write the graders.**
  - `fired`, `no-agent-dispatch` and `no-workspace`: copied from case 03.
  - `brief-line`: regex on `last_message`, `slug actions-list-crash, narrative_language uk`.
  - `hotfix`: regex on `last_message`, `\bhotfix\b`.
- [ ] **Step 3: Run the case.** `claude plugin eval . --ablation with-without --judge-model opus --allow-tools "Bash(node:*)" "Bash(jq:*)"`, restricted to case 10 if the CLI allows. Expect every grader to PASS on the with-arm.
- [ ] **Step 4: Manual check** in a real project:
  1. `/sdlc:brief "<idea>"` → the interview runs in rounds;
  2. the file lands at `docs/briefs/<slug>.md`;
  3. no other file changes (`git status`);
  4. the printed command runs, and `_brief.md` equals the brief.

  Record the result in the PR description.
- [ ] **Step 5: Commit.**

```bash
git add plugins/sdlc/evals/10-brief-dry-run
git commit -m "test(sdlc): eval case for /sdlc:start --brief dry run"
```

- [ ] **Step 6: Final gate.**
  - `npm test --prefix tools/sdlc-lint`
  - `node tools/sdlc-lint/cli.mjs all --json`
  - `node --test tools/brain-sync/test/*.test.mjs`
  - `node tools/brain-sync/cli.mjs check --vault .brain`

  All must be green. Then open the PR to `develop`, check `git log -1 --format=%B` and the PR body for AI mentions, and offer a review.
