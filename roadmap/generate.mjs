#!/usr/bin/env node
// Regenerate the SEED array in roadmap/index.html from the vault roadmap.
//
//   node roadmap/generate.mjs
//
// The Second Brain roadmap table (.brain/planning/roadmap.md) is the source of
// truth for which items exist, their status, and their landed-in PR. This script
// parses that table and rewrites the block between the <<SEED-START>>/<<SEED-END>>
// markers in index.html. Curated prose (DESCRIPTIONS) and the priority flag live
// here, so re-running never loses them. Card-position overrides made in the
// browser are separate (localStorage) and untouched.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROADMAP_MD = join(HERE, "..", ".brain", "planning", "roadmap.md");
const INDEX_HTML = join(HERE, "index.html");

// status in the table -> board column
const STATUS_TO_COL = {
  "done": "done",
  "in-progress": "progress",
  "in progress": "progress",
  "in-review": "review",
  "in review": "review",
  "planned": "todo",
};
// Compound statuses ("landed, DoD unmeasured", "gated, leaning against", "measured, not decided")
// resolve by their leading word: landed/shipped = in review until the DoD is measured; anything
// gated or merely measured is still queued.
function statusToCol(status) {
  const key = status.toLowerCase().trim();
  if (STATUS_TO_COL[key]) return STATUS_TO_COL[key];
  const head = key.split(/[,\s(]/)[0];
  if (STATUS_TO_COL[head]) return STATUS_TO_COL[head];
  if (head === "landed" || head === "shipped") return "review";
  return "todo";
}

// Curated one-line descriptions (not carried in the roadmap table). Keyed by item id.
// Add an entry when a new track item appears; falls back to "" if absent.
const DESCRIPTIONS = {
  A:  "Baseline stack-provider foundation pass.",
  B1: "Resume a pipeline run from its last checkpoint.",
  B2: "Aggregate cost/telemetry across all runs.",
  B3: "Next Track B item — approval gates; scope TBD.",
  B4: "Cumulative journal + measured wall-clock run time.",
  C1: "After Action Review captures lessons per run.",
  C2: "Framework providers: WorkManager #29 + Koin/Ktor/DataStore-Proto #64. kotlinx.serialization deferred.",
  D:  "Rendered per-run report from telemetry.",
  E:  "Cut prompt-cache reads (6.65M/run baseline). E5 shipped.",
  E6: "Byte-identical stable prefix for max prompt-cache hits (plan §1.1).",
  E7: "Haiku summarizes failed review-loop attempts before next Dev pass (§1.2).",
  E8: "Auto-group 3–5 bugfixes into one session; amortize init cost (§1.3).",
  F1: "Run QA test-writing concurrently with Dev after BA approval (§2.1).",
  F2: "LOC-gated Dev→QA→Docs when change is trivial (§2.2).",
  G1: "Feed compiler/lint stderr back to Dev, capped at 2 attempts (§3.1).",
  G2: "Tag lessons; load only domain-relevant ones per phase (§3.2).",
  H1: "Audit transcripts for mandated steps the orchestrator skipped. 92.9% on 28 runs (#117).",
  H2: "Run tail is one command (ADR-0014). 5b-finish 5/5 so far.",
  H3: "Never ask the model to recompute a machine-known value (ADR-0015).",
  H4: "Deterministic control flow. Gated on ~10 runs on the new tail; 5 exist, leaning against.",
  H5: "Prose costs ~3%; cardinality predicts compliance. Decision deferred (#110, #117).",
  "H5-D2": "Steps 0→1d as one shipped command (ADR-0019), −808 lines. DoD: start window 9 → 2–3 calls, unmeasured.",
  H6: "Stop hook seals a finished run; state, not enforcement.",
};

// Presentation overrides where the table title is terse. Keyed by item id.
const TITLE_OVERRIDES = {
  B3: "B3 (unscheduled)",
};

const md = readFileSync(ROADMAP_MD, "utf8");

// ---- parse priority flags from the "highest-ROI" narrative line ----
const priority = new Set();
for (const line of md.split("\n")) {
  if (/highest-roi/i.test(line)) {
    // [A-Z], not [A-G]: a hard-coded upper bound silently drops every item of the next
    // track added to the vault table — Track H lost all 6 of its cards this way.
    for (const m of line.matchAll(/\b([A-Z][0-9])\b/g)) priority.add(m[1]);
  }
}
// "**Track H — … PRIORITY track …**" flags the whole track; resolved to item ids after parsing.
const priorityTracks = new Set();
for (const m of md.matchAll(/\*\*Track ([A-Z])\b[^\n]*?PRIORITY track/g)) priorityTracks.add(m[1]);

// ---- parse the roadmap table ----
function cleanTitle(raw) {
  let t = raw.replace(/`/g, "").trim();
  if (/^\(.*\)$/.test(t)) t = t.slice(1, -1).trim();      // fully-wrapped "(planned)" -> "planned"
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const cards = [];
for (const line of md.split("\n")) {
  if (!line.trim().startsWith("|")) continue;
  const cells = line.split("|").slice(1, -1).map(c => c.trim());
  if (cells.length < 4) continue;
  const [id, item, status, landed] = cells;
  if (!/^[A-Z]\d*(-[A-Z0-9]+)?$/.test(id)) continue;       // skips header + separator rows; allows H5-D2

  const col = statusToCol(status);
  const prMatch = landed.match(/#(\d+)/);
  cards.push({
    id,
    track: `Track ${id[0]}`,
    title: TITLE_OVERRIDES[id] ?? cleanTitle(item),
    desc: DESCRIPTIONS[id] ?? "",
    pr: prMatch ? Number(prMatch[1]) : null,
    col,
    pri: priority.has(id) || (priorityTracks.has(id[0]) && col !== "done") || undefined,
  });
}

if (!cards.length) {
  console.error("generate: no roadmap rows parsed — aborting (check the table in", ROADMAP_MD + ")");
  process.exit(1);
}

// ---- render the SEED literal ----
const lines = cards.map(c => {
  const parts = [
    `id: ${JSON.stringify(c.id)}`,
    `track: ${JSON.stringify(c.track)}`,
    `title: ${JSON.stringify(c.title)}`,
    `desc: ${JSON.stringify(c.desc)}`,
    `pr: ${c.pr === null ? "null" : c.pr}`,
    `col: ${JSON.stringify(c.col)}`,
  ];
  if (c.pri) parts.push("pri: true");
  return `  { ${parts.join(", ")} },`;
});

const block =
  "// <<SEED-START>> — generated by `node roadmap/generate.mjs` from .brain/planning/roadmap.md; do not hand-edit\n" +
  "const SEED = [\n" +
  lines.join("\n") + "\n" +
  "];\n" +
  "// <<SEED-END>>";

const html = readFileSync(INDEX_HTML, "utf8");
const re = /\/\/ <<SEED-START>>[\s\S]*?\/\/ <<SEED-END>>/;
if (!re.test(html)) {
  console.error("generate: SEED markers not found in", INDEX_HTML);
  process.exit(1);
}
const next = html.replace(re, block);
if (next === html) {
  console.log(`generate: already in sync (${cards.length} items).`);
} else {
  writeFileSync(INDEX_HTML, next);
  console.log(`generate: wrote ${cards.length} items to index.html.`);
}

const byCol = c => cards.filter(x => x.col === c).length;
console.log(`  todo ${byCol("todo")} · progress ${byCol("progress")} · review ${byCol("review")} · done ${byCol("done")}` +
  (priority.size ? ` · ★ ${[...priority].join(", ")}` : ""));
