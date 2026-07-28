#!/usr/bin/env node
import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
  // Exactly one note per PR. The filename embeds the title-derived slug, so an edited
  // title (or a re-run of backfill against an edited title) would otherwise leave the
  // old-slug note behind and double-list the PR in the index. Drop any prior note for
  // this PR number (matched right after the YYYY-MM-DD date) before writing the current one.
  const prior = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-PR-${pr.number}-.*\\.md$`);
  for (const f of readdirSync(changesDir)) {
    if (prior.test(f)) rmSync(join(changesDir, f));
  }
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
} else if (cmd === "reindex") {
  // Rebuild ONLY `_moc-changes.md` from the notes already on disk. This exists because the
  // index is machine-owned and regularly conflicts — two brain-sync follow-up PRs both append
  // a row, so merging develop into the second one collides every time. The correct resolution
  // is to regenerate rather than hand-merge, and the only regenerating verb used to be
  // `sync --backfill`, which REWRITES EVERY NOTE from its PR and so destroys the enriched
  // prose that the vault rule requires each note to carry. Resolving a one-line index conflict
  // must not cost the hand-written half of the vault.
  const n = (readdirSync(changesDir).filter((f) => f.endsWith(".md") && !f.startsWith("_"))).length;
  refreshIndex();
  console.log(`reindex: ${join(changesDir, "_moc-changes.md")} (${n} note(s))`);
} else if (cmd === "check") {
  const problems = checkVault(vault);
  for (const p of problems) console.error("✗", p);
  console.log(`check: ${problems.length ? `${problems.length} problem(s)` : "clean"}`);
  process.exit(problems.length ? 1 : 0);
} else {
  console.error("commands: sync --pr <n> | sync --backfill | reindex | check   [--vault <path>]");
  process.exit(2);
}
