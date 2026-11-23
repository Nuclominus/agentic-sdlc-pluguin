# Project Q&A (`/sdlc:ask` + `project-researcher`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/sdlc:ask`, a skill that clarifies a question about the project, fans research out to one to three read-only `project-researcher` agents, and writes a sourced answer with tables and Mermaid.

**Architecture:** `project-researcher` is a new on-demand core role. Registering it in `on_demand_agents` makes the roster lint, the resolver and the skill-set matrix pick it up, and two hard-coded mirrors are edited by hand. A plugin-level `PreToolUse` Bash hook keyed on `agent_type` keeps the agent's `Bash` to read-only git/gh. The skill is prose only, and it is the sole author of the answer.

**Tech Stack:** Markdown agent/skill/command files, YAML manifests, JSON Schema, bash + jq hooks, `node:test`, `claude plugin eval`.

**Spec:** `.brain/decisions/ADR-0043-project-qa-is-a-skill-fronting-a-read-only-researcher-agent.md`

## Global Constraints

- Every file written is English. Commit messages and PR text never mention AI tools or agents.
- Stage specific paths only, never `git add -A`.
- No comments beyond one line stating a non-obvious why.
- Agent frontmatter, exact:
  - `name: project-researcher`
  - `model: sonnet`
  - `effort: medium`
  - `tools: [Read, Glob, Grep, Bash, WebFetch, Skill]`
- The agent never writes files and never prescribes fixes. Its report sections are exactly **Findings** (each claim has a source and is marked `confirmed` | `inferred`), **Gaps**, **Suggested visuals**.
- Answer sections, exact order:
  1. TL;DR
  2. the answer by aspect
  3. Sources
  4. Assumptions & gaps
  5. Observations (optional)
  6. suggested follow-ups
- Fan-out: 1–3 researchers. The checklist is Structure / Rationale / Behavior.
- Skill: `disallowed-tools: [Edit, NotebookEdit, Bash]`. It saves `docs/answers/<slug>.md` only on request and never touches git.
- Work branch: `feat/project-qa` cut from `develop`, **after** the brief-intake PR has merged, because the eval cites ADR-0042.

## Review Focus

1. **A chained command from the researcher** (`git log; rm -rf build`): expect it blocked. Pinned in Task 3.
2. **A writing flag on an allowed verb** (`git diff --output=/tmp/x`, `git grep -O`, `--ext-diff`): expect it blocked. Pinned in Task 3.
3. **Main-session Bash** (no `agent_type` in the hook input): expect the guard to be a no-op. Pinned in Task 3.
4. **A prefixed agent type** (`sdlc:project-researcher`): expect the guard to apply. Pinned in Task 3.
5. **A stack with no block for the role** (vanilla): expect `expertise --role project-researcher` to exit 0 with `no stack expertise for project-researcher`. Pinned in Task 2.

---

### Task 1: Work branch and ADR-0043 amendment

**Files:**
- Modify: `.brain/decisions/ADR-0043-project-qa-is-a-skill-fronting-a-read-only-researcher-agent.md`
- Commit: that file, the ADR-0043 row in `.brain/decisions/_moc-decisions.md`, and the K2 row in `.brain/planning/roadmap.md`

- [ ] **Step 1:** `git worktree list`, then `git switch -c feat/project-qa develop`.
- [ ] **Step 2: Amend the ADR.**
  - Decision 2 `tools` gains `Skill`, because a `role_expertise` block can name MANDATORY skills, which need `Skill`.
  - State that the hook keys on the documented `agent_type` field (Claude Code `hooks.md`).
  - Decision 9: `disallowed-tools` lasts only until the user's next message.
  - Consequences: replace "model registry tier mapping … gain an entry" with the real list. `on_demand_agents`, the `coreRole` schema enum, `READ_ONLY_AGENTS`, and two test mirrors change. Tiers come from frontmatter, and `sonnet/medium` already maps on Antigravity.
  - Delete both "To confirm" bullets.
- [ ] **Step 3:** `node tools/brain-sync/cli.mjs check --vault .brain` → `check: clean`.
- [ ] **Step 4: Commit.** Stage only the ADR-0043 / K2 hunks with `git add -p`.

```bash
git add .brain/decisions/ADR-0043-project-qa-is-a-skill-fronting-a-read-only-researcher-agent.md
git add -p .brain/decisions/_moc-decisions.md .brain/planning/roadmap.md
git commit -m "docs(brain): ADR-0043 project Q&A skill and read-only researcher"
```

---

### Task 2: Register the `project-researcher` role and its agent file

**Files:**
- Modify: `plugins/sdlc/manifest.yaml:33-37`, appending `project-researcher` to `on_demand_agents`.
- Modify: `schemas/manifest.schema.json:610-625` (add it to the `$defs.coreRole` enum) and `:340` (the role list in the description prose).
- Modify: `tools/sdlc-lint/lib/agent-tools.mjs:37-42` (`READ_ONLY_AGENTS`) and `tools/sdlc-lint/lib/skill-sets.mjs:96-100` (`ABBR`: `"project-researcher": "RS"`).
- Modify tests:
  - `tools/sdlc-lint/test/skill-sets.test.mjs:13` (`CORE_ROLES`);
  - `tools/sdlc-lint/test/emit.test.mjs:217` (`12` → `13`; add it to the read-only list at `:230,236`);
  - `tools/sdlc-lint/test/plan.test.mjs:519` (the on-demand list).
- Create: `plugins/sdlc/agents/project-researcher.md`
- Modify docs: "12-agent" → "13-agent" in
  - `README.md:138`
  - `plugins/sdlc/.claude-plugin/plugin.json:4`
  - `.claude-plugin/marketplace.json:13`
  - `docs/CONFIGURATION.md:50`
  - `docs/WORKFLOW.md:176`
  - `plugins/sdlc/README.md:50-59` (an on-demand table row)
  - `plugins/sdlc/skills/pipeline-orchestrator/SKILL.md:732,820` and `plugins/sdlc/skills/create-pluguin/SKILL.md:82`, wherever they enumerate roles
  - the comments at `plugins/sdlc/tools/resolve/cli.mjs:10` and `plan.mjs:783`
- Regenerate: `dist/antigravity/plugins/sdlc/`

**Interfaces:**
- Produces: the role name `project-researcher`, accepted by `resolve/cli.mjs expertise --role` and dispatchable as `subagent_type: "sdlc:project-researcher"`.

- [ ] **Step 1: Write the failing tests** in `tools/sdlc-lint/test/plan.test.mjs`, next to `:469` and `:546`:
  - `expertise --role project-researcher` on a vanilla project returns an empty block, and the CLI prints `no stack expertise for project-researcher` with exit 0 (Review Focus 5).
  - Edit the mirrors listed above to include the new role.
- [ ] **Step 2:** `npm test --prefix tools/sdlc-lint` → FAIL (unknown role; count 12 ≠ 13).
- [ ] **Step 3: Register the role** in `manifest.yaml`, the schema, `READ_ONLY_AGENTS` and `ABBR`.
- [ ] **Step 4: Write `agents/project-researcher.md`.**
  - Frontmatter: per Global Constraints, plus `color: cyan`.
  - `description`: one paragraph. Say READ-ONLY, on demand, dispatched by `sdlc:ask`, and that expertise comes via `resolve/cli.mjs expertise --role project-researcher`. Include `Trigger words — EN:` / `UA:`, and route bugs to `debugger` and new features to `business-analyst`.
  - Body headings, in this order:
    - intro and **CRITICAL: READ-ONLY.**;
    - `## Stack expertise (how platform knowledge reaches you)`, a copy of `aar-analyst.md:19-31` with the role swapped; the literal `expertise --role project-researcher` is required by the roster lint;
    - `## Input (passed by the sdlc:ask skill)`: sub-question, audience, aspect, external findings;
    - `## Research procedure`: vault/docs → ADRs → code → tests/config → `git log/blame/show` → `gh pr|issue view/list`. `WebFetch` is only for documentation of libraries the project uses;
    - `## Report contract`: the three sections from Global Constraints. No end-user prose, no finished Mermaid;
    - `## Non-negotiable rules`: no writes, no fixes, every claim sourced, unknowns go to Gaps.
- [ ] **Step 5:** `npm test --prefix tools/sdlc-lint`, then `node tools/sdlc-lint/cli.mjs emit`, then `node tools/sdlc-lint/cli.mjs all --json` → all green.
- [ ] **Step 6: Commit.**

```bash
git add plugins/sdlc/manifest.yaml schemas/manifest.schema.json tools/sdlc-lint/lib/agent-tools.mjs tools/sdlc-lint/lib/skill-sets.mjs tools/sdlc-lint/test/skill-sets.test.mjs tools/sdlc-lint/test/emit.test.mjs tools/sdlc-lint/test/plan.test.mjs plugins/sdlc/agents/project-researcher.md README.md plugins/sdlc/.claude-plugin/plugin.json .claude-plugin/marketplace.json docs/CONFIGURATION.md docs/WORKFLOW.md plugins/sdlc/README.md plugins/sdlc/skills/pipeline-orchestrator/SKILL.md plugins/sdlc/skills/create-pluguin/SKILL.md plugins/sdlc/tools/resolve/cli.mjs plugins/sdlc/tools/resolve/plan.mjs dist/antigravity/plugins/sdlc
git commit -m "feat(sdlc): add the read-only project-researcher on-demand role"
```

---

### Task 3: Read-only Bash guard for `project-researcher`

**Files:**
- Create: `plugins/sdlc/hooks/researcher-readonly-guard.sh`
- Modify: `plugins/sdlc/hooks/hooks.json`, adding a second hook to the existing `PreToolUse` `"matcher": "Bash"` entry.
- Test: `tests/test-researcher-readonly-guard.sh`. Add it to `.github/workflows/ci.yml:44-64` if that file lists test scripts by name.

**Interfaces:**
- Consumes: hook input `.agent_type` and `.tool_input.command`. Read them the way `plugins/android-foundation/hooks/post-implement-check.sh:16-21` does, and strip the prefix with `${agent##*:}`.
- Produces: exit 0 = allow, exit 2 + stderr = block. Block message, exact: `project-researcher is read-only: allowed are git log|show|blame|diff|status|rev-parse|ls-files|grep, gh pr|issue view|list|diff, and the expertise bootstrap`.

- [ ] **Step 1: Write the failing test script.** Follow the shape of `tests/test-config-protection.sh:35`: pipe JSON, then assert `EXIT:<n>`.

  | `agent_type` | command | expect |
  |---|---|---|
  | none | `rm -rf build` | 0 (Review Focus 3) |
  | `sdlc:project-researcher` | `git log --oneline -5` | 0 (Review Focus 4) |
  | `project-researcher` | `gh pr view 12` | 0 |
  | `project-researcher` | `node "${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs" expertise --role project-researcher` | 0 |
  | `project-researcher` | `git log; rm -rf build` | 2 (Review Focus 1) |
  | `project-researcher` | `git log && touch x` | 2 |
  | `project-researcher` | `git log \| tee x` | 2 |
  | `project-researcher` | `git show $(rm x)` | 2 |
  | `project-researcher` | `git diff --output=/tmp/x` | 2 (Review Focus 2) |
  | `project-researcher` | `git grep -O foo` | 2 |
  | `project-researcher` | `git show --ext-diff HEAD` | 2 |
  | `project-researcher` | `git checkout main` | 2 |
  | `project-researcher` | `gh pr merge 12` | 2 |
  | `debugger` | `git checkout main` | 0 |

- [ ] **Step 2:** `bash tests/test-researcher-readonly-guard.sh` → FAIL (script missing).
- [ ] **Step 3: Implement the guard.**
  - Fail open when `jq` is missing, as `pre-commit-guard.sh:17-20` does.
  - Exit 0 unless the stripped agent is `project-researcher`.
  - Check order: (1) allow the bootstrap only on an exact string match of `node "${CLAUDE_PLUGIN_ROOT}/tools/resolve/cli.mjs" expertise --role project-researcher` (quoted or unquoted, literal `${CLAUDE_PLUGIN_ROOT}` or the resolved `$CLAUDE_PLUGIN_ROOT` when set; no wildcard path). (2) Reject any command with a character outside `A-Za-z0-9`, space and `_ . / : = @ , + % ^ ~ * ? # " ' [ ] -`. (3) Split on spaces, strip quotes from each token, deny tokens starting with `--o` (except `--oneline`), `--ex` or `--te`, and single-dash tokens containing `O`. (4) Allow only `^git (log|show|blame|diff|status|rev-parse|ls-files|grep)( |$)` or `^gh (pr|issue) (view|list|diff)( |$)`; deny everything else.
- [ ] **Step 4:** `bash tests/test-researcher-readonly-guard.sh` → all PASS. Run `shellcheck plugins/sdlc/hooks/researcher-readonly-guard.sh` → clean.
- [ ] **Step 5:** `node tools/sdlc-lint/cli.mjs emit`, then `node tools/sdlc-lint/cli.mjs all --json` → green.
- [ ] **Step 6: Commit.**

```bash
git add plugins/sdlc/hooks/researcher-readonly-guard.sh plugins/sdlc/hooks/hooks.json tests/test-researcher-readonly-guard.sh .github/workflows/ci.yml dist/antigravity/plugins/sdlc
git commit -m "feat(sdlc): keep project-researcher Bash to read-only git and gh"
```

---

### Task 4: Android expertise block for `project-researcher`

**Files:**
- Modify: `plugins/android-foundation/manifest.yaml`, adding `role_expertise.project-researcher` after the `aar-analyst` block (`:450-461`), plus the comment at `:231-233`.
- Modify: `plugins/android-foundation/README.md:61` (role table) and `:100` (read-only roles).
- Test: `tools/sdlc-lint/test/plan.test.mjs`

- [ ] **Step 1: Write the failing test.** Resolving `expertise --role project-researcher` on an android fixture project returns a block containing `.obsidian-vault/` and `:feature:`. Copy the setup the existing android-role expertise tests use.
- [ ] **Step 2:** `node --test tools/sdlc-lint/test/plan.test.mjs` → FAIL.
- [ ] **Step 3: Add the block.**
  - `invariants`, at most 1400 chars:
    - read `.obsidian-vault/` first when it exists (its notes and generated dependency graph);
    - map the `:feature:<name>` modules from `settings.gradle(.kts)`;
    - find routes through `@Serializable` route types;
    - find DI wiring in the project's DI modules.
  - `skills`: none.
- [ ] **Step 4:** `npm test --prefix tools/sdlc-lint`, then `node tools/sdlc-lint/cli.mjs all --json` → green.
- [ ] **Step 5: Commit.**

```bash
git add plugins/android-foundation/manifest.yaml plugins/android-foundation/README.md tools/sdlc-lint/test/plan.test.mjs
git commit -m "feat(android-foundation): project-researcher expertise block"
```

---

### Task 5: The `/sdlc:ask` skill and command

**Files:**
- Create: `plugins/sdlc/skills/ask/SKILL.md`
- Create: `plugins/sdlc/commands/ask.md`. Use the `commands/aar.md` pattern with `argument-hint: "<question>"`.
- Modify: `README.md` Commands table (L119-130), `CHANGELOG.md` `## [Unreleased]` → `### Added`.
- Regenerate: `dist/antigravity/plugins/sdlc/`

**Interfaces:**
- Consumes: `subagent_type: "sdlc:project-researcher"` (Task 2) and its report contract.

- [ ] **Step 1: Write the frontmatter.**
  - `name: ask`.
  - `description` with "Use when …", `Trigger words — EN:` / `UA:`, and "Do NOT use for: diagnosing a bug (`debugger`), writing requirements (`business-analyst`), drafting a brief (`/sdlc:brief`)".
  - `disallowed-tools: [Edit, NotebookEdit, Bash]`.
- [ ] **Step 2: Write the body sections, in order.**
  1. **Clarify.** Ask only when the question is ambiguous, plus one audience question (participant | outsider) when the wording does not show it.
  2. **Route.** A bug goes to `debugger` and a new feature to `business-analyst`; say so and stop.
  3. **Decompose.** Split into 1–3 sub-questions against the Structure / Rationale / Behavior checklist.
  4. **External sources.** Query a connected MCP source (Jira, Confluence, Notion) only with the user's consent for this question, and pass the findings to researchers as context.
  5. **Dispatch.** Parallel `Agent` calls, each carrying the sub-question, audience, aspect and external findings.
  6. **Synthesize.** Use the answer sections from Global Constraints, in the asker's language and at their level. Every Sources entry comes from a researcher Finding. `inferred` claims go to Assumptions & gaps.
  7. **Follow-ups.** Answer from gathered findings first; dispatch only for an uncovered aspect.
  8. **Save on request.** `docs/answers/<slug>.md`, with the slug rule from `/sdlc:brief`. No git.
- [ ] **Step 3:** `node tools/sdlc-lint/cli.mjs emit`, then `node tools/sdlc-lint/cli.mjs all --json` → green (`doc-refs` resolves `sdlc:ask`).
- [ ] **Step 4: Commit.**

```bash
git add plugins/sdlc/skills/ask/SKILL.md plugins/sdlc/commands/ask.md README.md CHANGELOG.md dist/antigravity/plugins/sdlc
git commit -m "feat(sdlc): /sdlc:ask answers project questions from read-only research"
```

---

### Task 6: Eval case `11-ask-cites-adr` and the manual check

**Files:**
- Create: `plugins/sdlc/evals/11-ask-cites-adr/prompt.md`
- Create: `plugins/sdlc/evals/11-ask-cites-adr/graders/{dispatched,cites,tldr,no-files,sources-real}.md`

- [ ] **Step 1: Write `prompt.md`.**
  - Frontmatter: `max_turns: 30`, `timeout_seconds: 600`, `allowed_tools: [Skill, Read, Glob, Grep, Agent, "Bash(git:*)"]`, `model: sonnet`, `runs: 3`.
  - Body: `/sdlc:ask "I am new to this repo and not a contributor. Why is brief intake a skill and not an agent?"`. The audience is stated, so the skill does not ask.
- [ ] **Step 2: Write the graders.**
  - `dispatched`: `tool_used` `Agent`, `input_match: '"subagent_type":"sdlc:project-researcher"'`, `min: 1`.
  - `cites`: regex on `last_message`, `ADR-0042`.
  - `tldr`: regex `TL;DR`.
  - `no-files`: `file_exists` `docs/answers/**` → `exists: false`.
  - `sources-real`: `llm`, `focus: trace`. PASS only if every `file:line` in the answer's Sources was read in the trace and the cited line supports the claim.
- [ ] **Step 3: Run the case.** `claude plugin eval . --ablation with-without --judge-model opus --allow-tools "Bash(node:*)" "Bash(jq:*)" "Bash(git:*)"`, restricted to case 11 if possible. Expect all graders to PASS on the with-arm.
- [ ] **Step 4: Manual check** in a real project:
  1. a broad question dispatches 2–3 researchers, a narrow one dispatches 1;
  2. a bug-shaped question routes to `debugger`;
  3. "save it" writes `docs/answers/<slug>.md`;
  4. `git status` shows nothing else.

  Record the result in the PR description.
- [ ] **Step 5: Commit.**

```bash
git add plugins/sdlc/evals/11-ask-cites-adr
git commit -m "test(sdlc): eval case for /sdlc:ask citing ADR-0042"
```

- [ ] **Step 6: Final gate.**
  - `npm test --prefix tools/sdlc-lint`
  - `node tools/sdlc-lint/cli.mjs all --json`
  - `bash tests/test-researcher-readonly-guard.sh`
  - `node --test tools/brain-sync/test/*.test.mjs`
  - `node tools/brain-sync/cli.mjs check --vault .brain`

  All must be green. Then open the PR to `develop`, check the commit messages and PR body for AI mentions, and offer a review.
