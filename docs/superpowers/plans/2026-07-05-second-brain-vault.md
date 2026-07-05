# Second Brain Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repo-owned Obsidian "Second Brain" vault at `.brain/` that is the single source of truth for the marketplace, kept in sync with merged PRs by a deterministic Node tool and a follow-up-PR GitHub Action.

**Architecture:** A dependency-free ESM Node tool (`tools/brain-sync/`, sibling to `tools/sdlc-lint/`) reads merged-PR metadata via the `gh` CLI, classifies touched plugins/change-type, and renders one immutable change note per PR plus a reverse-chronological index. The vault (`.brain/`) is scaffolded with four pillars (architecture / components / changes / decisions+planning) wiki-linked into one graph. A GitHub Action runs the tool on merge and opens a follow-up PR with the vault delta.

**Tech Stack:** Node 22 (ESM, built-ins only — no npm deps), `node --test`, GitHub CLI (`gh`, preinstalled on runners), `peter-evans/create-pull-request@v6`, Obsidian-flavored Markdown (`[[wikilinks]]`, YAML frontmatter).

## Global Constraints

- **Node ESM, zero runtime deps.** `tools/brain-sync/package.json` has `"type": "module"` and NO `dependencies` — use Node built-ins only (`node:fs`, `node:path`, `node:child_process`, `node:url`). (Unlike `sdlc-lint`, this tool needs no yaml/ajv.)
- **Tests via `node --test`.** Test files live in `tools/brain-sync/test/*.test.mjs`. Pure functions are tested directly with inline fixtures — never shell out to `gh` in a test.
- **Vault path is `.brain/` at repo root.** Never `.obsidian-vault/` (that is the end-user template owned by the `manage-vault` skill — must not collide).
- **Deterministic + idempotent.** Re-running `sync` on the same PR overwrites its note byte-for-byte. No timestamps from `Date.now()` in output — only PR `mergedAt` dates.
- **Follow-up PR, never direct commit to `develop`.** The Action opens `brain-sync/pr-<num>`.
- **MOC files are named `_moc-<section>.md`.** Index files start with `_` and are skipped by frontmatter checks.
- **Do NOT modify** `CLAUDE.md`, `.claude/rules/`, `~/.claude`, settings, hooks, or the `manage-vault` skill / `.obsidian-vault/` template. Wiring the vault into repo rules is the owner's separate step.
- **Targeted git staging.** Every commit stages explicit paths — never `git add -A` / `git add .`.
- **Known plugins set** (single source in `lib/classify.mjs`): `sdlc`, `android-foundation`, `retrofit-plugin`, `room-plugin`, `dagger-plugin`, `workmanager-plugin`. Historical PR file paths under an unknown `plugins/<x>/` dir (e.g. the old `android-plugin`) are intentionally ignored (no component link is emitted) to keep the graph link-clean.

---

## File Structure

**Tool (`tools/brain-sync/`):**
- `package.json` — ESM, no deps, `bin` + `test` script.
- `cli.mjs` — command dispatch: `sync --pr <n>`, `sync --backfill`, `check`.
- `lib/pr.mjs` — `gh` invocation + `normalizePr(raw)`.
- `lib/classify.mjs` — `KNOWN_PLUGINS`, `stripPrefix`, `changeType`, `roadmapTag`, `slug`, `pluginsTouched`, `classify`.
- `lib/render.mjs` — `noteBasename(pr, cls)`, `renderChangeNote(pr, cls)`.
- `lib/index.mjs` — `parseFrontmatter(md)`, `buildChangesIndex(changesDir)`.
- `lib/check.mjs` — `checkVault(vault)` structural + link validator.
- `test/*.test.mjs` — one per lib module + one CLI integration test.

**Vault (`.brain/`):** skeleton per spec §2 (`_templates/`, `architecture/`, `components/`, `changes/`, `decisions/`, `planning/`, `releases/`, `_moc-root.md`, `README.md`, `.obsidian/`).

**Action:** `.github/workflows/brain-sync.yml`.

---

## Task 1: brain-sync package + PR reader

**Files:**
- Create: `tools/brain-sync/package.json`
- Create: `tools/brain-sync/lib/pr.mjs`
- Test: `tools/brain-sync/test/pr.test.mjs`

**Interfaces:**
- Produces: `normalizePr(raw) -> { number:int, title:str, body:str, author:str, mergedAt:str|null, labels:str[], files:str[] }`; `readPr(number, exec?) -> normalized`; `listMergedPrNumbers(base?, exec?) -> int[]`; `ghExec(args) -> string`.

- [ ] **Step 1: Write the failing test**

```js
// tools/brain-sync/test/pr.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePr } from "../lib/pr.mjs";

test("normalizePr flattens gh json", () => {
  const raw = {
    number: 29,
    title: "feat(workmanager): provider (Roadmap C2)",
    body: "First para.\n\nSecond para.",
    author: { login: "Nuclominus" },
    mergedAt: "2026-07-03T21:36:33Z",
    labels: [{ name: "feat" }, { name: "enhancement" }],
    files: [{ path: "plugins/workmanager-plugin/manifest.yaml" }, { path: "README.md" }],
  };
  const pr = normalizePr(raw);
  assert.equal(pr.number, 29);
  assert.equal(pr.author, "Nuclominus");
  assert.equal(pr.mergedAt, "2026-07-03T21:36:33Z");
  assert.deepEqual(pr.labels, ["feat", "enhancement"]);
  assert.deepEqual(pr.files, ["plugins/workmanager-plugin/manifest.yaml", "README.md"]);
});

test("normalizePr tolerates missing fields", () => {
  const pr = normalizePr({ number: 1 });
  assert.equal(pr.title, "");
  assert.equal(pr.author, "unknown");
  assert.equal(pr.mergedAt, null);
  assert.deepEqual(pr.labels, []);
  assert.deepEqual(pr.files, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/brain-sync/test/pr.test.mjs`
Expected: FAIL — `Cannot find module '../lib/pr.mjs'`.

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "brain-sync",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "brain-sync": "./cli.mjs" },
  "scripts": { "test": "node --test" }
}
```

- [ ] **Step 4: Implement `lib/pr.mjs`**

```js
import { execFileSync } from "node:child_process";

const PR_FIELDS = "number,title,body,author,mergedAt,labels,files";

export function ghExec(args) {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

export function normalizePr(raw) {
  return {
    number: raw.number,
    title: raw.title ?? "",
    body: raw.body ?? "",
    author: raw.author?.login ?? "unknown",
    mergedAt: raw.mergedAt ?? null,
    labels: (raw.labels ?? []).map((l) => l.name),
    files: (raw.files ?? []).map((f) => f.path),
  };
}

export function readPr(number, exec = ghExec) {
  return normalizePr(JSON.parse(exec(["pr", "view", String(number), "--json", PR_FIELDS])));
}

export function listMergedPrNumbers(base = "develop", exec = ghExec) {
  const rows = JSON.parse(
    exec(["pr", "list", "--state", "merged", "--base", base, "--limit", "500", "--json", "number,mergedAt"]),
  );
  return rows
    .filter((r) => r.mergedAt)
    .sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))
    .map((r) => r.number);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tools/brain-sync/test/pr.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add tools/brain-sync/package.json tools/brain-sync/lib/pr.mjs tools/brain-sync/test/pr.test.mjs
git commit -m "feat(brain-sync): PR reader + gh JSON normalization"
```

---

## Task 2: Classifier

**Files:**
- Create: `tools/brain-sync/lib/classify.mjs`
- Test: `tools/brain-sync/test/classify.test.mjs`

**Interfaces:**
- Consumes: normalized PR from Task 1.
- Produces: `KNOWN_PLUGINS: string[]`; `stripPrefix(title) -> string`; `changeType(title) -> string`; `roadmapTag(title) -> string|null`; `slug(title) -> string`; `pluginsTouched(files, known?) -> string[]`; `classify(pr) -> { type, plugins:string[], roadmap:string|null, slug }`.

- [ ] **Step 1: Write the failing test**

```js
// tools/brain-sync/test/classify.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { changeType, roadmapTag, slug, pluginsTouched, classify, stripPrefix } from "../lib/classify.mjs";

test("changeType parses conventional-commit prefixes", () => {
  assert.equal(changeType("feat(sdlc): add x"), "feat");
  assert.equal(changeType("feat(config)!: breaking"), "feat");
  assert.equal(changeType("docs+chore: sync readme"), "docs+chore");
  assert.equal(changeType("no prefix here"), "other");
});

test("roadmapTag extracts the roadmap id", () => {
  assert.equal(roadmapTag("feat(sdlc): rollup (Roadmap B2)"), "B2");
  assert.equal(roadmapTag("feat: nothing tagged"), null);
});

test("slug strips prefix and kebab-cases", () => {
  assert.equal(slug("feat(workmanager): WorkManager framework provider (Roadmap C2)"),
    "workmanager-framework-provider-roadmap-c2");
  assert.equal(stripPrefix("fix(sdlc): pass short tier"), "pass short tier");
});

test("pluginsTouched keeps only known plugins, sorted, deduped", () => {
  const files = [
    "plugins/workmanager-plugin/manifest.yaml",
    "plugins/workmanager-plugin/README.md",
    "plugins/sdlc/skills/x.md",
    "plugins/android-plugin/old.md", // unknown historical dir → ignored
    "README.md",
  ];
  assert.deepEqual(pluginsTouched(files), ["sdlc", "workmanager-plugin"]);
});

test("classify aggregates", () => {
  const c = classify({ title: "feat(room): dao (Roadmap C2)", files: ["plugins/room-plugin/x.md"] });
  assert.deepEqual(c, { type: "feat", plugins: ["room-plugin"], roadmap: "C2", slug: "dao-roadmap-c2" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/brain-sync/test/classify.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/classify.mjs`**

```js
export const KNOWN_PLUGINS = [
  "sdlc",
  "android-foundation",
  "retrofit-plugin",
  "room-plugin",
  "dagger-plugin",
  "workmanager-plugin",
];

const PREFIX_RE = /^([a-z0-9+-]+)(?:\([^)]*\))?!?:\s*/i;

export function changeType(title) {
  const m = title.match(PREFIX_RE);
  return m ? m[1].toLowerCase() : "other";
}

export function stripPrefix(title) {
  return title.replace(PREFIX_RE, "").trim();
}

export function roadmapTag(title) {
  const m = title.match(/Roadmap\s+([A-Z]\d+)/i);
  return m ? m[1].toUpperCase() : null;
}

export function slug(title) {
  const s = stripPrefix(title)
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || "change";
}

export function pluginsTouched(files, known = KNOWN_PLUGINS) {
  const set = new Set();
  for (const f of files) {
    const m = f.match(/^plugins\/([^/]+)\//);
    if (m && known.includes(m[1])) set.add(m[1]);
  }
  return [...set].sort();
}

export function classify(pr) {
  return {
    type: changeType(pr.title),
    plugins: pluginsTouched(pr.files),
    roadmap: roadmapTag(pr.title),
    slug: slug(pr.title),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/brain-sync/test/classify.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/brain-sync/lib/classify.mjs tools/brain-sync/test/classify.test.mjs
git commit -m "feat(brain-sync): PR classifier (type, roadmap, plugins, slug)"
```

---

## Task 3: Change-note renderer

**Files:**
- Create: `tools/brain-sync/lib/render.mjs`
- Test: `tools/brain-sync/test/render.test.mjs`

**Interfaces:**
- Consumes: normalized PR (Task 1), classification (Task 2).
- Produces: `noteBasename(pr, cls) -> string` (e.g. `2026-07-03-PR-29-<slug>.md`); `renderChangeNote(pr, cls) -> string` (full markdown, YAML frontmatter + prose).
- **Contract:** the "Decisions & rationale" enrich hint uses a **code span** `` `decisions/ADR-XXXX` `` (NOT a `[[wikilink]]`) so it never fails link-check. Only `[[components/<plugin>]]` and `[[planning/roadmap]]` (real, seeded notes) are emitted as wikilinks.

- [ ] **Step 1: Write the failing test**

```js
// tools/brain-sync/test/render.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { noteBasename, renderChangeNote } from "../lib/render.mjs";

const PR = {
  number: 29,
  title: "feat(workmanager): provider (Roadmap C2)",
  body: "Adds the WorkManager provider.\n\nMore detail here.",
  author: "Nuclominus",
  mergedAt: "2026-07-03T21:36:33Z",
  labels: ["feat"],
  files: ["plugins/workmanager-plugin/manifest.yaml"],
};
const CLS = { type: "feat", plugins: ["workmanager-plugin"], roadmap: "C2", slug: "provider-roadmap-c2" };

test("noteBasename is date-PR-num-slug", () => {
  assert.equal(noteBasename(PR, CLS), "2026-07-03-PR-29-provider-roadmap-c2.md");
});

test("renderChangeNote emits frontmatter + component link + roadmap link", () => {
  const md = renderChangeNote(PR, CLS);
  assert.match(md, /^---\npr: 29\n/);
  assert.match(md, /date: 2026-07-03/);
  assert.match(md, /type: feat/);
  assert.match(md, /plugins: \[workmanager-plugin\]/);
  assert.match(md, /roadmap: C2/);
  assert.match(md, /\[\[components\/workmanager-plugin\]\]/);
  assert.match(md, /\[\[planning\/roadmap\]\]/);
  assert.match(md, /Adds the WorkManager provider\./);
  // enrich hint must NOT be a wikilink
  assert.ok(!/\[\[decisions\//.test(md));
  assert.match(md, /`decisions\/ADR-XXXX`/);
});

test("renderChangeNote handles repo-level PR (no plugins, no roadmap)", () => {
  const pr = { ...PR, files: ["README.md"] };
  const cls = { type: "docs", plugins: [], roadmap: null, slug: "readme" };
  const md = renderChangeNote(pr, cls);
  assert.match(md, /plugins: \[\]/);
  assert.match(md, /roadmap: null/);
  assert.match(md, /Repo-level change/);
  assert.ok(!/\[\[components\//.test(md));
  assert.ok(!/\[\[planning\/roadmap\]\]/.test(md));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/brain-sync/test/render.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/render.mjs`**

```js
import { stripPrefix } from "./classify.mjs";

export function noteBasename(pr, cls) {
  const date = (pr.mergedAt ?? "0000-00-00").slice(0, 10);
  return `${date}-PR-${pr.number}-${cls.slug}.md`;
}

function firstParagraph(body) {
  const cleaned = (body ?? "").replace(/\r\n/g, "\n").trim();
  if (!cleaned) return "_No description provided._";
  return cleaned.split(/\n\s*\n/)[0].trim();
}

export function renderChangeNote(pr, cls) {
  const date = (pr.mergedAt ?? "").slice(0, 10) || "unknown";
  const title = stripPrefix(pr.title) || pr.title || "(untitled)";

  const frontmatter = [
    "---",
    `pr: ${pr.number}`,
    `date: ${date}`,
    `author: ${pr.author}`,
    `type: ${cls.type}`,
    `plugins: [${cls.plugins.join(", ")}]`,
    `roadmap: ${cls.roadmap ?? "null"}`,
    `files_changed: ${pr.files.length}`,
    "---",
  ].join("\n");

  const changedAreas = cls.plugins.length
    ? cls.plugins.map((p) => `- [[components/${p}]]`).join("\n")
    : "- _Repo-level change (no plugin under `plugins/` touched)._";

  const planning = cls.roadmap
    ? `- Advances roadmap item **${cls.roadmap}** → [[planning/roadmap]]`
    : "- _No roadmap item tagged._";

  return `${frontmatter}

# PR #${pr.number} — ${title}

> \`${cls.type}\`${cls.roadmap ? ` · Roadmap ${cls.roadmap}` : ""} · merged ${date} · by @${pr.author}

## Summary

${firstParagraph(pr.body)}

## Changed areas

${changedAreas}

## Decisions & rationale

- _Enrich: record or link the decision behind this change, e.g. \`decisions/ADR-XXXX\`._

## Planning

${planning}

---
_Auto-generated by \`tools/brain-sync\`. Frontmatter is machine-owned; prose below “Summary” is safe to enrich._
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/brain-sync/test/render.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/brain-sync/lib/render.mjs tools/brain-sync/test/render.test.mjs
git commit -m "feat(brain-sync): change-note renderer"
```

---

## Task 4: Changes index builder

**Files:**
- Create: `tools/brain-sync/lib/index.mjs`
- Test: `tools/brain-sync/test/index.test.mjs`

**Interfaces:**
- Consumes: a directory of change notes written by Task 3.
- Produces: `parseFrontmatter(md) -> Record<string,string>`; `buildChangesIndex(changesDir) -> string` (markdown table, reverse-chronological, non-aliased `[[changes/<name>]]` links so table cells stay pipe-safe).

- [ ] **Step 1: Write the failing test**

```js
// tools/brain-sync/test/index.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFrontmatter, buildChangesIndex } from "../lib/index.mjs";

test("parseFrontmatter reads simple key: value", () => {
  const fm = parseFrontmatter("---\npr: 29\ndate: 2026-07-03\ntype: feat\n---\n# body");
  assert.equal(fm.pr, "29");
  assert.equal(fm.date, "2026-07-03");
  assert.equal(fm.type, "feat");
});

test("buildChangesIndex sorts desc and links each note", () => {
  const dir = mkdtempSync(join(tmpdir(), "brain-idx-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "2026-07-01-PR-16-a.md"), "---\npr: 16\ndate: 2026-07-01\ntype: feat\nroadmap: null\n---\n");
  writeFileSync(join(dir, "2026-07-03-PR-29-b.md"), "---\npr: 29\ndate: 2026-07-03\ntype: feat\nroadmap: C2\n---\n");
  writeFileSync(join(dir, "_moc-changes.md"), "ignored");
  const md = buildChangesIndex(dir);
  const i29 = md.indexOf("#29");
  const i16 = md.indexOf("#16");
  assert.ok(i29 !== -1 && i16 !== -1 && i29 < i16, "PR 29 (newer) listed before 16");
  assert.match(md, /\[\[changes\/2026-07-03-PR-29-b\]\]/);
  assert.ok(!md.includes("_moc-changes"), "index does not list itself");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/brain-sync/test/index.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/index.mjs`**

```js
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function parseFrontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const fm = {};
  if (!m) return fm;
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return fm;
}

export function buildChangesIndex(changesDir) {
  const files = readdirSync(changesDir).filter((f) => f.endsWith(".md") && !f.startsWith("_"));
  const rows = files.map((f) => {
    const fm = parseFrontmatter(readFileSync(join(changesDir, f), "utf8"));
    return {
      name: f.replace(/\.md$/, ""),
      pr: Number(fm.pr) || 0,
      date: fm.date ?? "",
      type: fm.type ?? "",
      roadmap: fm.roadmap && fm.roadmap !== "null" ? fm.roadmap : "—",
    };
  });
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.pr - a.pr);
  const body = rows
    .map((r) => `| ${r.date} | #${r.pr} | \`${r.type}\` | ${r.roadmap} | [[changes/${r.name}]] |`)
    .join("\n");
  return `# Changes — Index

> Reverse-chronological log of every merged PR. Auto-generated by \`tools/brain-sync\` — do not edit by hand.

| Date | PR | Type | Roadmap | Note |
|------|----|------|---------|------|
${body}
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/brain-sync/test/index.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/brain-sync/lib/index.mjs tools/brain-sync/test/index.test.mjs
git commit -m "feat(brain-sync): reverse-chronological changes index"
```

---

## Task 5: Vault checker + CLI wiring

**Files:**
- Create: `tools/brain-sync/lib/check.mjs`
- Create: `tools/brain-sync/cli.mjs`
- Test: `tools/brain-sync/test/check.test.mjs`
- Test: `tools/brain-sync/test/cli.test.mjs`

**Interfaces:**
- Consumes: all lib modules above.
- Produces: `checkVault(vault) -> string[]` (list of problems; empty = clean). CLI commands: `sync --pr <n> [--from-json <file>] [--vault <path>]`, `sync --backfill [--vault <path>]`, `check [--vault <path>]`.
- **`--from-json <file>`** is a test/offline escape hatch: `sync` reads the PR JSON from a file instead of calling `gh`.

- [ ] **Step 1: Write the failing tests**

```js
// tools/brain-sync/test/check.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkVault } from "../lib/check.mjs";

function scaffold() {
  const v = mkdtempSync(join(tmpdir(), "brain-vault-"));
  for (const d of ["_templates", "architecture", "components", "changes", "decisions", "planning", "releases"]) {
    mkdirSync(join(v, d), { recursive: true });
  }
  const required = [
    "README.md", "_moc-root.md",
    "_templates/change-note.md", "_templates/adr.md", "_templates/plan.md", "_templates/component.md",
    "architecture/_moc-architecture.md", "changes/_moc-changes.md",
    "decisions/_moc-decisions.md", "planning/_moc-planning.md", "releases/_moc-releases.md",
  ];
  for (const f of required) writeFileSync(join(v, f), "# stub\n");
  return v;
}

test("checkVault is clean on a complete skeleton", () => {
  assert.deepEqual(checkVault(scaffold()), []);
});

test("checkVault reports a broken wikilink", () => {
  const v = scaffold();
  writeFileSync(join(v, "changes", "2026-01-01-PR-1-x.md"),
    "---\npr: 1\ndate: 2026-01-01\n---\n# x\n[[components/does-not-exist]]\n");
  const problems = checkVault(v);
  assert.ok(problems.some((p) => p.includes("broken link") && p.includes("does-not-exist")), problems.join("; "));
});

test("checkVault reports a change note missing frontmatter", () => {
  const v = scaffold();
  writeFileSync(join(v, "changes", "2026-01-01-PR-2-y.md"), "# no frontmatter\n");
  assert.ok(checkVault(v).some((p) => p.includes("frontmatter")));
});
```

```js
// tools/brain-sync/test/cli.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

test("cli sync --from-json writes a note and rebuilds the index", () => {
  const v = mkdtempSync(join(tmpdir(), "brain-cli-"));
  mkdirSync(join(v, "changes"), { recursive: true });
  const prFile = join(v, "pr.json");
  writeFileSync(prFile, JSON.stringify({
    number: 29, title: "feat(workmanager): provider (Roadmap C2)",
    body: "Body.", author: { login: "Nuclominus" }, mergedAt: "2026-07-03T21:36:33Z",
    labels: [], files: [{ path: "plugins/workmanager-plugin/manifest.yaml" }],
  }));
  execFileSync("node", [CLI, "sync", "--pr", "29", "--from-json", prFile, "--vault", v], { encoding: "utf8" });
  const notes = readdirSync(join(v, "changes")).filter((f) => f.startsWith("2026"));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /2026-07-03-PR-29-.*\.md/);
  const idx = readFileSync(join(v, "changes", "_moc-changes.md"), "utf8");
  assert.match(idx, /#29/);
});

test("cli sync is idempotent", () => {
  const v = mkdtempSync(join(tmpdir(), "brain-cli2-"));
  mkdirSync(join(v, "changes"), { recursive: true });
  const prFile = join(v, "pr.json");
  writeFileSync(prFile, JSON.stringify({
    number: 5, title: "feat(x): y", body: "b", author: { login: "a" },
    mergedAt: "2026-06-23T07:59:06Z", labels: [], files: [],
  }));
  const run = () => execFileSync("node", [CLI, "sync", "--pr", "5", "--from-json", prFile, "--vault", v], { encoding: "utf8" });
  run();
  const first = readdirSync(join(v, "changes")).sort();
  run();
  const second = readdirSync(join(v, "changes")).sort();
  assert.deepEqual(first, second);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tools/brain-sync/test/check.test.mjs tools/brain-sync/test/cli.test.mjs`
Expected: FAIL — `lib/check.mjs` and `cli.mjs` do not exist.

- [ ] **Step 3: Implement `lib/check.mjs`**

```js
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REQUIRED = [
  "README.md",
  "_moc-root.md",
  "_templates/change-note.md",
  "_templates/adr.md",
  "_templates/plan.md",
  "_templates/component.md",
  "architecture/_moc-architecture.md",
  "changes/_moc-changes.md",
  "decisions/_moc-decisions.md",
  "planning/_moc-planning.md",
  "releases/_moc-releases.md",
];

function walkMd(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".obsidian" || e.name === "_templates") continue; // scaffolding, not content
    const p = join(dir, e.name);
    if (e.isDirectory()) walkMd(p, acc);
    else if (e.name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

export function checkVault(vault) {
  const problems = [];
  if (!existsSync(vault)) return [`vault does not exist: ${vault}`];

  for (const r of REQUIRED) if (!existsSync(join(vault, r))) problems.push(`missing required: ${r}`);

  const notes = walkMd(vault);
  const rels = notes.map((p) => p.slice(vault.length + 1).replace(/\\/g, "/"));
  const noteSet = new Set(rels);

  for (const abs of notes) {
    const rel = abs.slice(vault.length + 1).replace(/\\/g, "/");
    const md = readFileSync(abs, "utf8");
    const base = rel.split("/").pop();

    if (rel.startsWith("changes/") && !base.startsWith("_")) {
      if (!/^---\n[\s\S]*?\bpr:\s*\d+[\s\S]*?\n---/.test(md)) {
        problems.push(`${rel}: missing/invalid frontmatter (pr)`);
      }
    }

    for (const m of md.matchAll(/\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]/g)) {
      const target = m[1].trim();
      if (!target) continue;
      const candidate = target.endsWith(".md") ? target : `${target}.md`;
      if (!noteSet.has(candidate)) problems.push(`${rel}: broken link [[${target}]]`);
    }
  }
  return problems;
}
```

- [ ] **Step 4: Implement `cli.mjs`**

```js
#!/usr/bin/env node
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { readPr, listMergedPrNumbers, normalizePr } from "./lib/pr.mjs";
import { classify } from "./lib/classify.mjs";
import { renderChangeNote, noteBasename } from "./lib/render.mjs";
import { buildChangesIndex } from "./lib/index.mjs";
import { checkVault } from "./lib/check.mjs";

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const opt = (n) => {
  const i = argv.indexOf(n);
  return i === -1 ? undefined : argv[i + 1];
};

const vault = resolve(process.cwd(), opt("--vault") ?? ".brain");
const changesDir = join(vault, "changes");

function loadPr(n) {
  const f = opt("--from-json");
  if (f) return normalizePr(JSON.parse(readFileSync(f, "utf8")));
  return readPr(n);
}

function writeNote(pr) {
  const cls = classify(pr);
  mkdirSync(changesDir, { recursive: true });
  const path = join(changesDir, noteBasename(pr, cls));
  writeFileSync(path, renderChangeNote(pr, cls));
  return path;
}

function refreshIndex() {
  writeFileSync(join(changesDir, "_moc-changes.md"), buildChangesIndex(changesDir));
}

const cmd = argv[0];
if (cmd === "sync" && has("--backfill")) {
  const nums = listMergedPrNumbers("develop");
  for (const n of nums) console.log("note:", writeNote(readPr(n)));
  refreshIndex();
  console.log(`backfilled ${nums.length} PRs`);
} else if (cmd === "sync") {
  const n = Number(opt("--pr"));
  if (!n) {
    console.error("usage: sync --pr <number> [--from-json <file>] | sync --backfill");
    process.exit(2);
  }
  console.log("note:", writeNote(loadPr(n)));
  refreshIndex();
} else if (cmd === "check") {
  const problems = checkVault(vault);
  for (const p of problems) console.error("✗", p);
  console.log(`check: ${problems.length ? `${problems.length} problem(s)` : "clean"}`);
  process.exit(problems.length ? 1 : 0);
} else {
  console.error("commands: sync --pr <n> | sync --backfill | check   [--vault <path>]");
  process.exit(2);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tools/brain-sync/test/`
Expected: PASS — all test files (pr, classify, render, index, check, cli) green.

- [ ] **Step 6: Commit**

```bash
git add tools/brain-sync/lib/check.mjs tools/brain-sync/cli.mjs tools/brain-sync/test/check.test.mjs tools/brain-sync/test/cli.test.mjs
git commit -m "feat(brain-sync): vault checker + CLI (sync/backfill/check)"
```

---

## Task 6: Scaffold the `.brain/` vault skeleton

**Files:**
- Create: `.brain/.obsidian/app.json`, `.brain/.obsidian/graph.json`
- Create: `.brain/README.md`, `.brain/_moc-root.md`
- Create: `.brain/_templates/{change-note,adr,plan,component}.md`
- Create: `.brain/{architecture/_moc-architecture,decisions/_moc-decisions,planning/_moc-planning,releases/_moc-releases}.md`
- Create: `.brain/changes/_moc-changes.md`, `.brain/components/.gitkeep`

**Interfaces:**
- Consumes: nothing (static content).
- Produces: a `checkVault('.brain')`-clean skeleton (except `changes/_moc-changes.md` will be regenerated in Task 10).

- [ ] **Step 1: Create the Obsidian config**

`.brain/.obsidian/app.json`:
```json
{ "alwaysUpdateLinks": true, "newLinkFormat": "relative", "useMarkdownLinks": false }
```
`.brain/.obsidian/graph.json`:
```json
{ "collapse-filter": true, "search": "", "showTags": false, "showAttachments": false }
```

- [ ] **Step 2: Create `.brain/README.md` (the maintenance contract)**

```markdown
# Second Brain — `.brain/`

The single source of truth for how the **SDLC Marketplace** works and how it evolves.
Open this folder as an Obsidian vault. Four pillars, one wiki-linked graph:

- **[[_moc-root]]** — start here (dashboard).
- **architecture/** — how the system works ([[architecture/_moc-architecture]]).
- **components/** — one note per plugin.
- **changes/** — one immutable note per merged PR ([[changes/_moc-changes]]).
- **decisions/** — ADRs, the "why" ([[decisions/_moc-decisions]]).
- **planning/** — roadmap + backlog ([[planning/_moc-planning]]).
- **releases/** — thin release list mirroring `../CHANGELOG.md`.

## Maintenance contract (the heartbeat)

A **merged PR is the trigger.** On merge to `develop`, the `brain-sync` GitHub Action runs
`tools/brain-sync` and opens a follow-up PR (`brain-sync/pr-<num>`) adding that PR's change note
and refreshing `changes/_moc-changes.md`. The auto note is deterministic; **enrich** its prose,
link the ADR it implements, and update the touched `components/` + `architecture/` notes by hand
or via the `android-docs` agent.

Run locally:
```bash
node tools/brain-sync/cli.mjs sync --pr <number>   # one PR
node tools/brain-sync/cli.mjs sync --backfill       # all merged PRs
node tools/brain-sync/cli.mjs check                 # validate structure + links
```

> This vault documents **this repository** (the plugin marketplace). It is unrelated to the
> `.obsidian-vault/` template that the `manage-vault` skill scaffolds for end-user Android apps.
```

- [ ] **Step 3: Create the four templates**

`.brain/_templates/change-note.md`:
```markdown
---
pr:
date:
author:
type:
plugins: []
roadmap: null
files_changed:
---

# PR #<n> — <title>

## Summary

## Changed areas

## Decisions & rationale

## Planning
```

`.brain/_templates/adr.md`:
```markdown
---
adr:
status: proposed   # proposed | accepted | superseded
date:
supersedes: null
---

# ADR-<nnnn> — <title>

## Context

## Decision

## Consequences

## Related
- Implemented by: [[changes/...]]
```

`.brain/_templates/plan.md`:
```markdown
---
status: planned   # planned | in-progress | done
roadmap:
---

# <Planning item>

## Goal

## Scope

## Status
```

`.brain/_templates/component.md`:
```markdown
---
plugin:
kind:            # foundation | framework | core
enriches_aspect: null
dependency: null
---

# <plugin>

## Responsibility

## Key files

## Decisions
- [[decisions/...]]

## Change history
_Backlinks from `changes/` accumulate here (see the graph)._
```

- [ ] **Step 4: Create the MOC placeholders**

`.brain/_moc-root.md`:
```markdown
# Second Brain — Home

> Dashboard for the SDLC Marketplace knowledge base. See [[README]] for the maintenance contract.

## Pillars
- [[architecture/_moc-architecture]] — how the system works
- [[changes/_moc-changes]] — every merged PR, newest first
- [[decisions/_moc-decisions]] — architecture decisions
- [[planning/_moc-planning]] — roadmap & backlog
- [[releases/_moc-releases]] — release list

## Components
- [[components/sdlc]]
- [[components/android-foundation]]
- [[components/retrofit-plugin]]
- [[components/room-plugin]]
- [[components/dagger-plugin]]
- [[components/workmanager-plugin]]
```

`.brain/architecture/_moc-architecture.md`:
```markdown
# Architecture — Map of Content

> Absorbed from the repo-root `ARCHITECTURE.md` (now a pointer stub).

- [[architecture/stack-provider-pattern]]
- [[architecture/pipeline-orchestrator]]
- [[architecture/manifest-and-aspects]]
```

`.brain/decisions/_moc-decisions.md`:
```markdown
# Decisions (ADRs) — Map of Content

> One note per architecture decision. Newest first.

- [[decisions/ADR-0001-stack-provider-pattern]]
- [[decisions/ADR-0002-framework-provider-pattern]]
```

`.brain/planning/_moc-planning.md`:
```markdown
# Planning — Map of Content

> Absorbed from the repo-root `CORE-TODO.md` (now a pointer stub).

- [[planning/roadmap]]
- [[planning/backlog]]
```

`.brain/releases/_moc-releases.md`:
```markdown
# Releases

> Thin list mirroring the repo-root `../CHANGELOG.md`. Tags only; detail lives in `changes/`.
```

`.brain/changes/_moc-changes.md`:
```markdown
# Changes — Index

> Auto-generated by `tools/brain-sync`. Run `node tools/brain-sync/cli.mjs sync --backfill` to populate.
```

`.brain/components/.gitkeep`: (empty file)

- [ ] **Step 5: Verify the skeleton passes structural check**

Run: `node tools/brain-sync/cli.mjs check --vault .brain`
Expected: reports **broken links** for the component/architecture/decision/planning notes referenced by the MOCs that do not exist yet (Tasks 7–10 create them). This is expected at this stage. Confirm the output lists ONLY those not-yet-created links and NO "missing required" problems.

- [ ] **Step 6: Commit**

```bash
git add .brain/.obsidian .brain/README.md .brain/_moc-root.md .brain/_templates .brain/architecture/_moc-architecture.md .brain/decisions/_moc-decisions.md .brain/planning/_moc-planning.md .brain/releases/_moc-releases.md .brain/changes/_moc-changes.md .brain/components/.gitkeep
git commit -m "feat(brain): scaffold .brain vault skeleton (pillars, templates, MOCs)"
```

---

## Task 7: Migrate `ARCHITECTURE.md` into the vault

**Files:**
- Create: `.brain/architecture/stack-provider-pattern.md`
- Create: `.brain/architecture/pipeline-orchestrator.md`
- Create: `.brain/architecture/manifest-and-aspects.md`
- Modify: `ARCHITECTURE.md` (replace body with a pointer stub)

**Interfaces:**
- Produces: the three architecture notes referenced by `architecture/_moc-architecture.md`.

**Section mapping (from `ARCHITECTURE.md` H2 sections — copy content verbatim, then wiki-link):**
- `stack-provider-pattern.md` ← "## 1. Two patterns, one engine" + "## 10. Adding a provider".
- `pipeline-orchestrator.md` ← "## 5. Pipeline orchestrator" + "## 6. Agents" + "## 7. Hooks" + "## 9. Practical usage".
- `manifest-and-aspects.md` ← "## 2. File structure" + "## 3. Profiles" + "## 3.4 Manifest field spec" + "## 4. Aspect resolution & the additive set" + "## 8. Android constraints".

- [ ] **Step 1: Read the source**

Run: `sed -n '1,400p' ARCHITECTURE.md`
(Understand the section boundaries listed above.)

- [ ] **Step 2: Create the three architecture notes**

Each note starts with frontmatter and a backlink, then the verbatim section content:
```markdown
---
source: ARCHITECTURE.md
---

# <Note title>

> Migrated from `ARCHITECTURE.md`. See [[architecture/_moc-architecture]].

<verbatim content of the mapped sections, with any `[[...]]`-worthy cross-references left as plain prose>
```
Copy the mapped H2 sections' body text verbatim into each file. Do not rewrite prose. Where a section references a plugin by name, you MAY add `[[components/<plugin>]]` links, but only to the six known component notes.

- [ ] **Step 3: Replace `ARCHITECTURE.md` with a pointer stub**

```markdown
# Architecture

> **Moved into the Second Brain vault.** The living architecture docs now reside in
> [`.brain/architecture/`](.brain/architecture/_moc-architecture.md). This file remains as a
> pointer so external links do not break.
>
> - Stack/Framework Provider Pattern → `.brain/architecture/stack-provider-pattern.md`
> - Pipeline orchestrator, agents, hooks → `.brain/architecture/pipeline-orchestrator.md`
> - Manifests, profiles, aspects → `.brain/architecture/manifest-and-aspects.md`
```

- [ ] **Step 4: Verify links resolve**

Run: `node tools/brain-sync/cli.mjs check --vault .brain`
Expected: the three `architecture/*` broken-link problems from Task 6 are gone. Remaining broken links (components/*, decisions/*, planning/*) are still expected until Tasks 8–10.

- [ ] **Step 5: Commit**

```bash
git add .brain/architecture ARCHITECTURE.md
git commit -m "docs(brain): migrate ARCHITECTURE.md into vault + pointer stub"
```

---

## Task 8: Migrate `CORE-TODO.md` + roadmap into planning

**Files:**
- Create: `.brain/planning/roadmap.md`
- Create: `.brain/planning/backlog.md`
- Modify: `CORE-TODO.md` (replace with pointer stub)

**Interfaces:**
- Produces: `planning/roadmap.md` (target of every change note's roadmap link) and `planning/backlog.md`.

- [ ] **Step 1: Read the source**

Run: `sed -n '1,200p' CORE-TODO.md`

- [ ] **Step 2: Create `.brain/planning/roadmap.md`**

Seed the roadmap status from the known program state (letters are roadmap tracks referenced by PR titles):
```markdown
---
status: in-progress
---

# Roadmap

> Program tracks. Change notes link here via their `roadmap:` tag. See [[planning/_moc-planning]].

| Track | Item | Status | Landed in |
|-------|------|--------|-----------|
| A  | (foundation retune)              | done        | #23 |
| B1 | `--resume` checkpoints            | done        | #25 |
| B2 | cross-run rollup `/sdlc:report`   | done        | #28 |
| B3 | (planned)                         | planned     | — |
| C1 | AAR learning cycle `/sdlc:aar`    | done        | #27 |
| C2 | WorkManager provider (background) | in-progress | #29 |
| D  | HTML run-report artifact          | done        | #26 |

_Remaining: complete C2 (Koin / Ktor / kotlinx.serialization / DataStore-Proto), then B3._
```

- [ ] **Step 3: Create `.brain/planning/backlog.md`**

Migrate the still-open items from `CORE-TODO.md` (the non-`*(DONE)*` sections) verbatim into a backlog list:
```markdown
---
status: planned
---

# Backlog

> Open items migrated from `CORE-TODO.md`. Promote to a [[planning/roadmap]] track when scheduled.

<verbatim open (non-DONE) items from CORE-TODO.md, one bullet each>
```

- [ ] **Step 4: Replace `CORE-TODO.md` with a pointer stub**

```markdown
# CORE-TODO

> **Moved into the Second Brain vault.** Roadmap → [`.brain/planning/roadmap.md`](.brain/planning/roadmap.md);
> open items → [`.brain/planning/backlog.md`](.brain/planning/backlog.md).
```

- [ ] **Step 5: Verify**

Run: `node tools/brain-sync/cli.mjs check --vault .brain`
Expected: `planning/*` broken links resolved. Only `components/*` and `decisions/*` remain (Tasks 9).

- [ ] **Step 6: Commit**

```bash
git add .brain/planning CORE-TODO.md
git commit -m "docs(brain): migrate CORE-TODO + roadmap into vault planning"
```

---

## Task 9: Seed component notes + foundational ADRs

**Files:**
- Create: `.brain/components/{sdlc,android-foundation,retrofit-plugin,room-plugin,dagger-plugin,workmanager-plugin}.md`
- Create: `.brain/decisions/ADR-0001-stack-provider-pattern.md`
- Create: `.brain/decisions/ADR-0002-framework-provider-pattern.md`

**Interfaces:**
- Produces: the six `components/<plugin>` notes (targets of every change note's "Changed areas" links) and the two ADRs referenced by `decisions/_moc-decisions.md`.

- [ ] **Step 1: Read each plugin's identity**

Run: `for p in sdlc android-foundation retrofit-plugin room-plugin dagger-plugin workmanager-plugin; do echo "== $p =="; sed -n '1,12p' plugins/$p/manifest.yaml; cat plugins/$p/.claude-plugin/plugin.json; done`

- [ ] **Step 2: Create the six component notes**

For each plugin, fill the `_templates/component.md` shape from its `manifest.yaml` (`kind`, `enriches_aspect`, `dependency`) and `plugin.json` (`description`). Example — `.brain/components/workmanager-plugin.md`:
```markdown
---
plugin: workmanager-plugin
kind: framework
enriches_aspect: background
dependency: androidx.work
---

# workmanager-plugin

## Responsibility

Additive framework provider for Android WorkManager deferrable background work. Enriches the
`background` aspect with the `workmanager-conventions` skill plus development + security phase
injections. Ships no agents.

## Key files
- `plugins/workmanager-plugin/manifest.yaml`
- `plugins/workmanager-plugin/.claude-plugin/plugin.json`

## Decisions
- [[decisions/ADR-0002-framework-provider-pattern]]

## Change history
_Backlinks from `changes/` accumulate here._
```
Repeat for the other five, pulling their real `kind` / `enriches_aspect` / `dependency` / description. `sdlc` is `kind: core` (no `enriches_aspect`); `android-foundation` is `kind: foundation`; the three others are `kind: framework`. The foundation + core link ADR-0001; the frameworks link ADR-0002.

- [ ] **Step 3: Create the two ADRs**

`.brain/decisions/ADR-0001-stack-provider-pattern.md` — status `accepted`, landed via #12/#13/#14. Context: one platform-agnostic orchestrator must host many stacks without core forks. Decision: foundations register via `manifest.yaml` (`kind: foundation`) and win an aspect by priority; the core never changes. Consequences: additive, no slot registries.

`.brain/decisions/ADR-0002-framework-provider-pattern.md` — status `accepted`. Context: frameworks (Retrofit/Room/Hilt/WorkManager) must enrich a foundation without overriding it. Decision: `kind: framework` manifests attach additively via `enriches_aspect`. Consequences: auto-detected, additive; referenced by all framework component notes.

Both ADRs follow the `_templates/adr.md` shape (frontmatter `adr`, `status`, `date`). **In the "Related" section, reference implementing PRs as plain text (e.g. "Implemented by #12, #13, #14") — NOT as `[[changes/...]]` wikilinks**, because the change notes do not exist until Task 10 and a wikilink to a missing note would fail `check` at this task's Step 4.

- [ ] **Step 4: Verify all non-change links resolve**

Run: `node tools/brain-sync/cli.mjs check --vault .brain`
Expected: **clean** except possibly the `changes/` index (still empty). No "broken link" or "missing required" problems from components/decisions/architecture/planning.

- [ ] **Step 5: Commit**

```bash
git add .brain/components .brain/decisions/ADR-0001-stack-provider-pattern.md .brain/decisions/ADR-0002-framework-provider-pattern.md
git commit -m "docs(brain): seed component notes + foundational ADRs"
```

---

## Task 10: Backfill all merged PRs

**Files:**
- Create: `.brain/changes/*.md` (one per merged PR)
- Modify: `.brain/changes/_moc-changes.md` (regenerated index)

**Interfaces:**
- Consumes: the CLI (Task 5) + `gh` auth in the local environment.

- [ ] **Step 1: Confirm `gh` is authenticated**

Run: `gh auth status`
Expected: logged in to github.com. (If not, the operator runs `gh auth login` — do not proceed without it.)

- [ ] **Step 2: Run the backfill**

Run: `node tools/brain-sync/cli.mjs sync --backfill --vault .brain`
Expected: prints `note: .brain/changes/...` for each merged PR and ends with `backfilled <N> PRs` (N ≈ 30).

- [ ] **Step 3: Verify count and index**

Run: `ls .brain/changes/*.md | grep -v _moc | wc -l && head -20 .brain/changes/_moc-changes.md`
Expected: file count equals the merged-PR count; the index table lists PRs newest-first with resolvable `[[changes/...]]` links.

- [ ] **Step 4: Full structural check must be clean**

Run: `node tools/brain-sync/cli.mjs check --vault .brain`
Expected: `check: clean`. If any `broken link [[components/<x>]]` appears, it means a PR touched an unknown plugin dir — confirm it is an intended historical dir; the classifier already filters to `KNOWN_PLUGINS`, so a clean run is expected.

- [ ] **Step 5: Run the whole tool test suite once more**

Run: `node --test tools/brain-sync/test/`
Expected: all green (regression guard before committing generated content).

- [ ] **Step 6: Commit**

```bash
git add .brain/changes
git commit -m "docs(brain): backfill change notes for all merged PRs"
```

---

## Task 11: GitHub Action — sync on merge, open follow-up PR

**Files:**
- Create: `.github/workflows/brain-sync.yml`

**Interfaces:**
- Consumes: `tools/brain-sync/cli.mjs` (Task 5).

- [ ] **Step 1: Create the workflow**

`.github/workflows/brain-sync.yml`:
```yaml
name: brain-sync

on:
  pull_request:
    types: [closed]
    branches: [develop]

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: develop
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Sync vault for the merged PR
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node tools/brain-sync/cli.mjs sync --pr ${{ github.event.pull_request.number }} --vault .brain
      - name: Validate vault
        run: node tools/brain-sync/cli.mjs check --vault .brain || true
      - name: Open follow-up PR with the vault update
        uses: peter-evans/create-pull-request@v6
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          base: develop
          branch: brain-sync/pr-${{ github.event.pull_request.number }}
          add-paths: .brain
          commit-message: "docs(brain): sync vault for #${{ github.event.pull_request.number }}"
          title: "docs(brain): sync vault for #${{ github.event.pull_request.number }}"
          body: |
            Automated Second Brain vault update for the merge of #${{ github.event.pull_request.number }}.

            Generated deterministically by `tools/brain-sync`. Enrich prose / ADR links as needed
            before or after merge.
          delete-branch: true
```

Notes baked into the design:
- `if: merged == true` skips PRs that are closed without merging.
- Using `GITHUB_TOKEN` for the follow-up PR means it will **not** trigger another `brain-sync` run — no loop.
- `add-paths: .brain` means the PR only ever contains vault changes; if `sync` produced no diff, `create-pull-request` opens nothing.
- `check ... || true` surfaces link problems in the Action log without failing the run (enrichment is a human follow-up, not a gate).

- [ ] **Step 2: Lint the workflow locally (if `actionlint` is available)**

Run: `command -v actionlint >/dev/null && actionlint .github/workflows/brain-sync.yml || echo "actionlint not installed — visual review only"`
Expected: no errors (or the skip message).

- [ ] **Step 3: Dry-run the exact command the Action will run**

Run: `git stash -u 2>/dev/null; node tools/brain-sync/cli.mjs sync --pr 29 --vault .brain && git status --porcelain .brain; git checkout -- .brain 2>/dev/null; git stash pop 2>/dev/null || true`
Expected: re-syncing PR #29 is a no-op or a trivial deterministic diff (idempotence), confirming the Action's core command works against the real repo. Leave `.brain/` unchanged afterward.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/brain-sync.yml
git commit -m "ci(brain-sync): auto-sync vault on merge via follow-up PR"
```

---

## Final verification

- [ ] `node --test tools/brain-sync/test/` — all green.
- [ ] `node tools/brain-sync/cli.mjs check --vault .brain` — `check: clean`.
- [ ] `.brain/` opens in Obsidian with a connected graph (change notes → components → ADRs → roadmap).
- [ ] `ARCHITECTURE.md` and `CORE-TODO.md` are pointer stubs; their content lives in the vault.
- [ ] Every merged PR has a change note; `_moc-changes.md` lists them newest-first.
- [ ] `.github/workflows/brain-sync.yml` present; owner enables the workflow and it fires on the next merge.

**Owner's separate step (out of scope here):** wire the vault into the repository working rules (`CLAUDE.md` / `.claude/rules/`) — not modified by this plan.
