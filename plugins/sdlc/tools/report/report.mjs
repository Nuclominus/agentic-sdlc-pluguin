// SSOT for the SDLC HTML run-report renderer.
//
// This file lives INSIDE the shipped `sdlc` plugin payload (marketplace source
// `./plugins/sdlc`) so a marketplace consumer can run it via
// `${CLAUDE_PLUGIN_ROOT}/tools/report/cli.mjs` — see pipeline-orchestrator
// Step 5b. It is intentionally DEPENDENCY-FREE (node builtins only) so it needs
// no `node_modules` on a consumer install. The dev/CI copy at
// `tools/sdlc-lint/lib/report.mjs` re-exports from here, so the tests exercise
// the exact code that ships.
//
// Visual language is ported from the "SDLC Run Report" claude.ai/design mock
// (IBM Plex type, card grid, dark hero, cost-share + cache-economics panels).
// The design linked web fonts and used a runtime theme prop; neither is allowed
// here — D4 mandates a fully self-contained document with ZERO external refs, so
// the fonts degrade to the system stack and theming is `prefers-color-scheme`.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtUsd = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
const fmtInt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (r) => (r == null ? "—" : `${Math.round(Number(r) * 100)}%`);
// Compact token count for dense breakdown lines: 5.0M, 17k, 146.
const fmtTok = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${Math.round(v / 1e3)}k`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
};
// A share "0.15%" / "12%" — coarse for readability, finer below 10%.
const pctOf = (part, whole) => {
  const w = Number(whole) || 0;
  if (!w) return null;
  const v = (Number(part) || 0) / w * 100;
  if (v >= 10) return `${Math.round(v)}%`;
  if (v >= 1) return `${v.toFixed(1)}%`;
  return `${v.toFixed(2)}%`;
};
// Wall-clock as "1 h 20 m 07 s" (design header). Deterministic, no Date.
const fmtDur = (s) => {
  const t = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const p = (n) => String(n).padStart(2, "0");
  if (h) return `${h} h ${p(m)} m ${p(sec)} s`;
  if (m) return `${m} m ${p(sec)} s`;
  return `${sec} s`;
};
// Date / clock slices from an ISO stamp — string ops only, no parsing.
const dateOf = (iso) => String(iso || "").slice(0, 10);
const clockOf = (iso) => { const s = String(iso || ""); const i = s.indexOf("T"); return i >= 0 ? s.slice(i + 1) : s; };

// A phase has a real input/output/cache split (usage_source "reported" or
// "transcript", or an "estimated" fallback) vs. only the harness aggregate
// `subagent_tokens` (usage_source "subagent_aggregate"), which cannot be split.
const hasSplit = (p) => p && p.usage_source !== "subagent_aggregate" &&
  (p.input_tokens != null || p.output_tokens != null || p.cached_input_tokens != null);
const billedTokens = (p) => hasSplit(p)
  ? (p.billed_tokens != null
    ? p.billed_tokens
    : (p.input_tokens || 0) + (p.output_tokens || 0) + (p.cached_input_tokens || 0) + (p.cache_creation_tokens || 0))
  : null;
const totalBilled = (t) => (t.total_input_tokens || 0) + (t.total_output_tokens || 0) +
  (t.total_cached_input_tokens || 0) + (t.total_cache_creation_tokens || 0);

// Model-tier tone for the phase pill; keyed on the family name so registry ids
// (claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5-…) all classify.
const modelTone = (model) => {
  const m = String(model || "").toLowerCase();
  if (m.includes("opus")) return "m-opus";
  if (m.includes("haiku")) return "m-haiku";
  if (m.includes("sonnet")) return "m-sonnet";
  if (m.includes("fable")) return "m-fable";
  return "m-other";
};

// Fixed fills for the stacked cost-share / cost-by-model bars. Light-blue tints
// read on both themes (they sit on a neutral track), matching the design mock.
const SHARE_RAMP = ["var(--accent)", "#6a7ce2", "#8d9bee", "#a9b5f4", "#c3ccf8", "#dde2fb", "#edf0fd", "#f2f4fe"];
const MODEL_RAMP = ["var(--ink)", "var(--accent)", "#8d9bee", "#a9b5f4", "#c3ccf8", "#dde2fb"];
const HATCH = "repeating-linear-gradient(-45deg,#c8ccd6 0 6px,#d8dbe3 6px 12px)";

const CSS = `
:root{
--bg:#f4f5f8;--card:#fff;--line:#e6e8f0;--track:#edeff4;
--ink:#191c24;--ink2:#3d4250;--muted:#6b7180;--faint:#9aa0b2;
--accent:#4a5bc4;--accent-hover:#38489f;--accent-soft:#eef1fd;--accent-border:#d4daf6;
--chip:#eef0f5;--surface2:#f7f8fb;
--green:#2f9e5f;--green-bg:#e9f5ee;--green-line:#c8e6d4;
--warn:#b3801d;--warn-bg:#fbf3df;--warn-line:#eddcb4;--warn-ink:#8a6a1c;
--red:#d4534b;--red-bg:#fbe9e7;
--font:'IBM Plex Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
--mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace}
@media(prefers-color-scheme:dark){:root{
--bg:#101116;--card:#1a1c22;--line:#2b2e37;--track:#262932;
--ink:#e8e9ee;--ink2:#c9ccd6;--muted:#9aa0b2;--faint:#6f7484;
--accent:#93a3f5;--accent-hover:#b4c0fa;--accent-soft:#232945;--accent-border:#39406b;
--chip:#262932;--surface2:#20232b;
--green:#5fd68f;--green-bg:#1c2b23;--green-line:#2c473a;
--warn:#e3b355;--warn-bg:#2b2416;--warn-line:#4a3c1c;--warn-ink:#e3c884;
--red:#f08078;--red-bg:#392120}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--font);-webkit-font-smoothing:antialiased}
.wrap{max-width:1080px;margin:0 auto;padding:40px 24px 80px}
h1,h2{margin:0}code{font:12px/1.4 var(--mono)}
.mono{font-family:var(--mono)}.num{text-align:right;font-variant-numeric:tabular-nums}
a{color:var(--accent);text-decoration:none}a:hover{color:var(--accent-hover);text-decoration:underline}

/* hero */
.hero{background:#191c24;color:#f2f3f7;border-radius:14px;padding:32px 36px;display:flex;flex-direction:column;gap:14px}
.hero-top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.hero-eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.12em;color:#9aa3c0}
.hero h1{font-family:var(--mono);font-size:30px;font-weight:700;letter-spacing:-.01em;word-break:break-word}
.chips{display:flex;gap:8px;flex-wrap:wrap;font-family:var(--mono);font-size:12px}
.chip{background:rgba(255,255,255,.08);padding:3px 10px;border-radius:6px;color:#c6cbdc}
.hero-meta{display:flex;gap:24px;flex-wrap:wrap;color:#9aa3c0;font-size:13px;font-family:var(--mono)}
.hero-meta b{color:#f2f3f7;font-weight:600}
.pills{display:flex;gap:8px;flex-wrap:wrap}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:3px 12px;border-radius:99px;background:rgba(255,255,255,.08);color:#c6cbdc}
.pill i{width:7px;height:7px;border-radius:50%;background:currentColor}
.pill-ok{background:var(--green-bg);color:var(--green)}
.pill-warn{background:var(--warn-bg);color:var(--warn)}
.pill-bad{background:var(--red-bg);color:var(--red)}
.pill-accent{background:var(--accent);color:#fff}
.pill-neutral{background:rgba(255,255,255,.08);color:#c6cbdc}

/* kpis */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:20px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.tv{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}.tv.good{color:var(--green)}
.tl{color:var(--muted);font-size:12px;margin-top:2px}.ts{color:var(--faint);font-size:11px;margin-top:4px}

/* generic card */
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:26px 28px;margin-top:20px}
.card h2{font-size:17px;font-weight:600}
.lead{margin:4px 0 18px;color:var(--muted);font-size:13px}
.lead b{color:var(--ink)}
.note{color:var(--muted);font-size:12px;margin:12px 0 0}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px}
.cols>.card{margin-top:0}

/* cost share */
.share-bar{display:flex;height:34px;border-radius:8px;overflow:hidden;font-size:0}
.share-seg{height:100%}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:14px;font-size:12px;color:var(--muted)}
.legend-item{display:inline-flex;align-items:center;gap:6px}
.swatch{width:10px;height:10px;border-radius:3px;flex-shrink:0}

/* timeline */
.timeline{display:flex;flex-direction:column}
.tl-row{display:grid;grid-template-columns:44px 1fr 260px;gap:16px;align-items:start;padding-bottom:22px}
.tl-rail{display:flex;flex-direction:column;align-items:center;align-self:stretch}
.tl-node{width:30px;height:30px;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:12px;font-weight:600;border:1px solid var(--accent-border);flex-shrink:0}
.tl-node.ghost{background:var(--chip);color:var(--muted);border-color:var(--line);font-family:var(--font);margin:0 auto}
.tl-line{width:2px;flex:1;background:var(--line);margin-top:4px}
.tl-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.tl-name{font-weight:600;font-size:15px}
.tl-agent{font-family:var(--mono);font-size:12px;color:var(--muted)}
.tl-detail{font-family:var(--mono);font-size:11.5px;color:var(--faint);margin-top:4px}
.tl-metrics{display:flex;flex-direction:column;gap:7px;padding-top:2px}
.metric{display:grid;grid-template-columns:64px 1fr 52px;gap:8px;align-items:center;font-size:11px;color:var(--faint)}
.metric .track{height:8px;background:var(--track);border-radius:4px;overflow:hidden;position:relative}
.metric .track i{display:block;height:100%;border-radius:4px}
.metric .thr{position:absolute;top:-2px;bottom:-2px;left:40%;width:1.5px;background:var(--warn);opacity:.6}
.metric-val{text-align:right;font-family:var(--mono);color:var(--ink);font-weight:600}
.tl-foot{display:grid;grid-template-columns:44px 1fr 260px;gap:16px;align-items:center;border-top:1px dashed var(--line);padding-top:16px;margin-top:2px}
.tl-foot .metric-val.big{font-size:14px}
.badge{display:inline-block;font-size:11px;font-weight:600;color:var(--muted);background:var(--chip);padding:1px 8px;border-radius:5px}
.badge-warn{display:inline-block;font-size:11px;font-weight:600;color:var(--warn);background:var(--warn-bg);padding:1px 8px;border-radius:5px}
.model-pill{font-family:var(--mono);font-size:11px;padding:1px 8px;border-radius:5px;background:var(--chip);color:var(--muted)}
.model-pill.m-opus{background:var(--accent-soft);color:var(--accent)}
.model-pill.m-haiku{background:var(--green-bg);color:var(--green)}
.model-pill.m-fable{background:var(--surface2);color:var(--ink2)}

/* cost by model */
.cm-list{display:flex;flex-direction:column;gap:14px}
.cm-top{display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px}
.cm-top .mono{font-family:var(--mono)}.cm-top b{font-variant-numeric:tabular-nums}
.cm-track{height:10px;background:var(--track);border-radius:5px;overflow:hidden}
.cm-track i{display:block;height:100%;border-radius:5px}
.cm-detail{font-size:11px;color:var(--faint);margin-top:4px;font-family:var(--mono)}

/* cache economics */
.cache-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cache-tile{background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.cache-tile.good{background:var(--green-bg);border-color:var(--green-line)}
.cval{font-size:19px;font-weight:700;font-variant-numeric:tabular-nums}
.cache-tile.good .cval{color:var(--green)}
.clbl{font-size:11.5px;color:var(--muted)}
.callout{margin-top:16px;background:var(--warn-bg);border:1px solid var(--warn-line);border-radius:10px;padding:12px 14px;font-size:12.5px;color:var(--warn-ink);line-height:1.5}

/* signals + deps */
.sig,.deps{margin:0;padding-left:18px}.sig li,.deps li{margin:3px 0}

/* post-checks */
table.checks{width:100%;border-collapse:collapse;font-size:13px}
table.checks th{text-align:left;padding:8px 10px;color:var(--faint);font-weight:500;border-bottom:1px solid var(--line)}
table.checks td{padding:9px 10px;border-bottom:1px solid var(--track)}
table.checks .w36{width:36px}table.checks .w60{width:60px}
.ck-ok{color:var(--green);font-weight:700}.ck-bad{color:var(--red);font-weight:700}.ck-skip{color:var(--faint)}
details{margin-top:12px}summary{cursor:pointer;color:var(--muted);font-size:13px}
pre{background:var(--surface2);border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;font:12px/1.5 var(--mono)}

/* touched files */
.tf-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:6px}
.tf-count{color:var(--faint);font-weight:500}
.tf-pills{display:flex;gap:8px;font-size:12px;font-weight:600}
.tf-pills .pill{padding:2px 10px}
.tf-dist{display:flex;height:8px;border-radius:4px;overflow:hidden;margin:8px 0 20px}
.tf-dist i{display:block;height:100%}
.tf-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px 32px;font-family:var(--mono);font-size:12px}
.tf-dir{color:var(--muted);font-size:11px;letter-spacing:.04em;margin-bottom:6px;font-weight:600}
.tf-files{display:flex;flex-direction:column;gap:3px}
.tf-file{display:flex;gap:8px;align-items:baseline}
.tf-name{color:var(--ink2);word-break:break-all}
.st{width:14px;font-weight:700;flex-shrink:0}
.st-A{color:var(--green)}.st-M{color:var(--warn)}.st-D{color:var(--red)}.st-R{color:var(--accent)}.st-C{color:var(--accent)}

/* artifacts */
.arts{display:flex;gap:8px;flex-wrap:wrap;font-family:var(--mono);font-size:12px}
.art{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 12px}
.art:hover{background:var(--accent-soft);border-color:var(--accent-border);text-decoration:none}

.foot{margin-top:32px;color:var(--faint);font-size:12px;text-align:center;font-family:var(--mono)}

@media(max-width:760px){
.wrap{padding:24px 14px 60px}
.hero{padding:24px 20px}.hero h1{font-size:24px}
.cols{grid-template-columns:1fr}
.tl-row,.tl-foot{grid-template-columns:1fr;gap:8px}
.tl-rail{display:none}
.tl-foot .tl-node{display:none}
.tf-grid{grid-template-columns:1fr}
}
`;

function doc(t, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SDLC run — ${esc(t.task_slug)}</title>
<style>${CSS}</style>
</head>
<body><main class="wrap">
${body}
<footer class="foot">Generated from _telemetry.json · ${esc(t.completed_at || "")}</footer>
</main></body>
</html>`;
}

function headerSection(t) {
  const phases = t.phases || [];
  const passed = phases.filter((p) => p.status === "completed" || p.status === "approved").length;
  const statusPill = t.aborted_at_phase
    ? `<span class="pill pill-bad"><i></i>Aborted</span>`
    : `<span class="pill pill-ok"><i></i>Completed</span>`;
  const phasePill = phases.length
    ? `<span class="pill pill-neutral">${passed} / ${phases.length} phases passed</span>` : "";
  const resumed = t.resumed ? `<span class="pill pill-accent">RESUMED</span>` : "";
  const chips = [t.primary_profile, ...(t.additive_profiles || [])].filter(Boolean);
  const chipList = chips.length ? chips : [t.stack].filter(Boolean);
  const chipHtml = chipList.map((c) => `<span class="chip">${esc(c)}</span>`).join("");
  const meta = [];
  if (t.started_at || t.completed_at) {
    meta.push(`<span>${esc(clockOf(t.started_at) || "?")} → ${esc(clockOf(t.completed_at) || "?")}</span>`);
  }
  if (t.wall_clock_seconds != null) meta.push(`<span>wall clock <b>${esc(fmtDur(t.wall_clock_seconds))}</b></span>`);
  const qa = phases.find((p) => p.phase === "qa");
  if (qa && qa.qa_iterations_used != null) meta.push(`<span>${fmtInt(qa.qa_iterations_used)} QA iteration(s)</span>`);
  if (t.model_enforcement_corrections != null) meta.push(`<span>${fmtInt(t.model_enforcement_corrections)} model corrections</span>`);
  const eyebrow = `SDLC PIPELINE RUN${t.started_at ? ` · ${esc(dateOf(t.started_at))}` : ""}`;
  return `<header class="hero">
<div class="hero-top">
<div class="hero-eyebrow">${eyebrow}</div>
<div class="pills">${statusPill}${phasePill}${resumed}</div>
</div>
<h1>${esc(t.task_slug || "—")}</h1>
${chipHtml ? `<div class="chips">${chipHtml}</div>` : ""}
${meta.length ? `<div class="hero-meta">${meta.join("")}</div>` : ""}
</header>`;
}

function tile(value, label, sub, cls) {
  return `<div class="tile"><div class="tv${cls ? " " + cls : ""}">${value}</div><div class="tl">${esc(label)}</div>${sub ? `<div class="ts">${sub}</div>` : ""}</div>`;
}
function kpiSection(t) {
  const capNote = t.cost_cap_usd != null ? `${fmtUsd(t.cost_cap_usd)} cap · ${esc(t.cap_status || "—")}` : "no cap set";
  const oh = t.orchestration_overhead;
  const costSub = oh && oh.cost_usd != null ? `${capNote} · orch ${fmtUsd(oh.cost_usd)}` : capNote;
  const billed = totalBilled(t);
  // Billed tokens are the real, priced total (incl. per-turn cache reads/writes);
  // fall back to the harness aggregate only if no phase was transcript-enriched.
  const billedTile = billed > 0
    ? tile(fmtTok(billed), "Billed tokens", `${fmtInt(billed)} total`)
    : tile(fmtInt(t.total_subagent_tokens), "Aggregate tokens", "harness aggregate — unpriced");
  const outSub = billed > 0 ? `${pctOf(t.total_output_tokens, billed) || "—"} of billed` : "";
  const cacheSub = t.total_cached_input_tokens ? `${fmtTok(t.total_cached_input_tokens)} read from cache` : "";
  const tiles = [
    tile(fmtUsd(t.total_cost_usd), "Total cost", costSub),
    billedTile,
    tile(fmtInt(t.total_output_tokens), "Output tokens", outSub),
    tile(pct(t.cache_hit_ratio), "Cache hit", cacheSub, "good"),
    tile(fmtInt((t.phases || []).length), "Phases"),
    tile(fmtInt(t.model_enforcement_corrections), "Model corrections"),
  ];
  const files = t.touched_files;
  if (Array.isArray(files) && files.length) {
    const c = { A: 0, M: 0, D: 0 };
    for (const f of files) {
      const k = String(f.status ?? "").charAt(0);
      if (k === "A") c.A++; else if (k === "D") c.D++; else c.M++;
    }
    tiles.push(tile(fmtInt(files.length), "Files touched", `${c.A} added · ${c.M} modified · ${c.D} deleted`));
  }
  return `<section class="kpis">${tiles.join("")}</section>`;
}

// "Where the money went" — one stacked bar over phases + orchestration overhead,
// so per-segment cost visibly sums to the run total.
function costShareSection(t) {
  const phases = (t.phases || []).filter((p) => p.cost_usd != null);
  const oh = t.orchestration_overhead;
  const ohCost = oh && oh.cost_usd != null ? oh.cost_usd : null;
  const entries = phases.map((p) => ({ label: p.aspect ? `${p.phase} · ${p.aspect}` : p.phase, cost: p.cost_usd, orch: false }));
  if (ohCost != null) entries.push({ label: "orchestration", cost: ohCost, orch: true });
  const total = entries.reduce((s, e) => s + e.cost, 0);
  if (entries.length < 2 || total <= 0) return "";
  const ranked = [...entries.filter((e) => !e.orch)].sort((a, b) => b.cost - a.cost);
  const colorOf = (e) => e.orch ? HATCH : SHARE_RAMP[Math.min(ranked.indexOf(e), SHARE_RAMP.length - 1)];
  const segs = entries.map((e) =>
    `<div class="share-seg" title="${esc(e.label)} ${fmtUsd(e.cost)}" style="width:${(e.cost / total * 100).toFixed(2)}%;background:${colorOf(e)}"></div>`).join("");
  const legend = [...entries].sort((a, b) => b.cost - a.cost).map((e) =>
    `<span class="legend-item"><span class="swatch" style="background:${colorOf(e)}"></span>${esc(e.label)} ${fmtUsd(e.cost)}</span>`).join("");
  const phaseTotal = phases.reduce((s, p) => s + p.cost_usd, 0);
  let lead;
  if (ohCost != null) {
    const p = Math.round(ohCost / total * 100);
    lead = `Orchestration overhead accounts for <b>${fmtUsd(ohCost)} — ${p}%</b> of total spend; the ${phases.length} work phase(s) together cost ${fmtUsd(phaseTotal)}.`;
  } else {
    const top = ranked[0];
    lead = `The ${phases.length} phase(s) cost ${fmtUsd(phaseTotal)} in total; <b>${esc(top.label)}</b> was the largest at ${fmtUsd(top.cost)}.`;
  }
  return `<section class="card"><h2>Where the money went</h2>
<p class="lead">${lead}</p>
<div class="share-bar">${segs}</div>
<div class="legend">${legend}</div></section>`;
}

// Real billed total + a compact split, or the harness aggregate when the phase
// was not transcript-enriched (older runs / missing transcript).
function phaseDetail(p) {
  const billed = billedTokens(p);
  if (billed == null) return `${fmtInt(p.subagent_tokens)} aggregate tokens`;
  const parts = [`${fmtInt(billed)} billed`, `in ${fmtTok(p.input_tokens)}`, `out ${fmtTok(p.output_tokens)}`,
    `cache-r ${fmtTok(p.cached_input_tokens)}`, `cache-w ${fmtTok(p.cache_creation_tokens)}`];
  if (p.turns) parts.push(`${fmtTok(Math.round((p.cached_input_tokens || 0) / p.turns))}/turn`);
  if (p.phase === "qa" && p.qa_iterations_used != null) parts.push(`${fmtInt(p.qa_iterations_used)} iteration(s)`);
  return parts.join(" · ");
}

function timelineSection(t) {
  const phases = t.phases || [];
  if (!phases.length) return "";
  const maxPhaseCost = Math.max(...phases.map((p) => p.cost_usd || 0), 0.0001);
  const rows = phases.map((p, i) => {
    const name = p.aspect ? `${p.phase} · ${p.aspect}` : p.phase;
    const origin = p.origin === "resumed" ? `<span class="badge">resumed</span>` : "";
    const warn = p.cache_pressure ? `<span class="badge-warn">high cache pressure</span>` : "";
    const model = p.model ? `<span class="model-pill ${modelTone(p.model)}">${esc(p.model)}</span>` : "";
    const notLast = i < phases.length - 1;
    const costW = Math.round((p.cost_usd || 0) / maxPhaseCost * 100);
    const costMetric = `<div class="metric"><span>cost</span><div class="track"><i style="width:${costW}%;background:var(--accent)"></i></div><span class="metric-val">${fmtUsd(p.cost_usd)}</span></div>`;
    let peakMetric = "";
    if (p.peak_prefix_tokens != null) {
      const peak = Number(p.peak_prefix_tokens) || 0;
      const peakW = Math.min(100, Math.round(peak / 2000)); // 0..200k mapped to 0..100%
      const fill = p.cache_pressure ? "var(--warn)" : "#7fc99a";
      const fg = p.cache_pressure ? "color:var(--warn)" : "color:var(--muted)";
      peakMetric = `<div class="metric"><span>peak ctx</span><div class="track"><i style="width:${peakW}%;background:${fill}"></i><b class="thr"></b></div><span class="metric-val" style="${fg}">${fmtTok(peak)}</span></div>`;
    }
    return `<div class="tl-row">
<div class="tl-rail"><div class="tl-node">${String(i + 1).padStart(2, "0")}</div>${notLast ? `<div class="tl-line"></div>` : ""}</div>
<div><div class="tl-head"><span class="tl-name">${esc(name)}</span>${origin}<span class="tl-agent">${esc(p.agent || "—")}</span>${model}${warn}</div>
<div class="tl-detail">${phaseDetail(p)}</div></div>
<div class="tl-metrics">${costMetric}${peakMetric}</div>
</div>`;
  }).join("\n");
  // Orchestration overhead (orchestrator main-loop + non-phase/nested subagents)
  // is not a phase but is real spend — show it so per-row costs reconcile to the total.
  const oh = t.orchestration_overhead;
  let ohRow = "";
  if (oh && oh.cost_usd != null) {
    const ml = oh.main_loop || {};
    const billed = (ml.input_tokens || 0) + (ml.output_tokens || 0) + (ml.cached_input_tokens || 0) + (ml.cache_creation_tokens || 0);
    ohRow = `<div class="tl-foot">
<div class="tl-node ghost">⚙</div>
<div><span class="tl-name">orchestration</span> <span class="badge">overhead</span>
<div class="tl-detail"><code>${esc(ml.model || "—")}</code> · main-loop + nested · ${fmtInt(billed)} billed tokens</div></div>
<div class="metric-val big">${fmtUsd(oh.cost_usd)}</div>
</div>`;
  }
  return `<section class="card"><h2>Phase timeline</h2>
<p class="lead">Cost bars are relative to the most expensive phase; peak-context bars are per-turn against the 80k cache-pressure threshold (dashed marker).</p>
<div class="timeline">${rows}</div>${ohRow}</section>`;
}

function costByModelSection(t) {
  const phases = t.phases || [];
  if (!phases.length) return "";
  const byModel = new Map();
  let unpriced = 0;
  const add = (k, p) => {
    const m = byModel.get(k) || { input: 0, output: 0, cacheR: 0, cacheW: 0, cost: 0 };
    m.input += p.input_tokens || 0;
    m.output += p.output_tokens || 0;
    m.cacheR += p.cached_input_tokens || 0;
    m.cacheW += p.cache_creation_tokens || 0;
    if (p.cost_usd != null) m.cost += p.cost_usd;
    byModel.set(k, m);
  };
  for (const p of phases) {
    if (p.cost_usd == null) unpriced++;
    if (!hasSplit(p)) continue; // aggregate-only phase: no split to attribute
    add(p.model || "—", p);
  }
  // Fold orchestration overhead (main-loop + nested subagents) into model rows so totals reconcile.
  const oh = t.orchestration_overhead;
  if (oh) {
    if (oh.main_loop && oh.main_loop.model) add(oh.main_loop.model, oh.main_loop);
    if (oh.nested_subagents && oh.nested_subagents.model) add(oh.nested_subagents.model, oh.nested_subagents);
  }
  const rowsArr = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost);
  if (!rowsArr.length) return "";
  const maxCost = Math.max(...rowsArr.map(([, m]) => m.cost), 0.0001);
  const rows = rowsArr.map(([model, m], i) => {
    const w = Math.round(m.cost / maxCost * 100);
    const color = MODEL_RAMP[Math.min(i, MODEL_RAMP.length - 1)];
    const detail = `in ${fmtTok(m.input)} · cache-r ${fmtTok(m.cacheR)} · cache-w ${fmtTok(m.cacheW)} · out ${fmtTok(m.output)}`;
    return `<div class="cm-row"><div class="cm-top"><span class="mono">${esc(model)}</span><b>${fmtUsd(m.cost)}</b></div><div class="cm-track"><i style="width:${w}%;background:${color}"></i></div><div class="cm-detail">${detail}</div></div>`;
  }).join("");
  const note = unpriced ? `<p class="note">Cost partial — ${unpriced} phase(s) unpriced (aggregate-only usage, no transcript to split).</p>` : "";
  return `<section class="card"><h2>Cost by model</h2><div class="cm-list">${rows}</div>${note}</section>`;
}

function cacheSection(t) {
  const billed = totalBilled(t);
  if (billed <= 0) return "";
  const phases = t.phases || [];
  const pressure = phases.filter((p) => p.cache_pressure);
  const worst = pressure.reduce((a, p) => (p.peak_prefix_tokens || 0) > (a.peak_prefix_tokens || 0) ? p : a, pressure[0]);
  const tiles = [
    `<div class="cache-tile good"><div class="cval">${fmtTok(t.total_cached_input_tokens)}</div><div class="clbl">cache read</div></div>`,
    `<div class="cache-tile"><div class="cval">${fmtTok(t.total_cache_creation_tokens)}</div><div class="clbl">cache write</div></div>`,
    `<div class="cache-tile"><div class="cval">${fmtTok(t.total_input_tokens)}</div><div class="clbl">fresh input</div></div>`,
    `<div class="cache-tile"><div class="cval">${fmtTok(t.total_output_tokens)}</div><div class="clbl">output</div></div>`,
  ].join("");
  const hit = t.cache_hit_ratio != null ? `${pct(t.cache_hit_ratio)} of context tokens were served from prompt cache — ` : "";
  const lead = `${hit}fresh input was just ${fmtTok(t.total_input_tokens)} of ${fmtTok(billed)} billed.`;
  const callout = pressure.length
    ? `<div class="callout"><b>${pressure.length} of ${phases.length} phase(s)</b> ran above the 80k cache-pressure threshold — <b>${esc(worst.phase)}</b> peaked at <b>${fmtTok(worst.peak_prefix_tokens)}</b> tokens per turn. Consider tighter context trimming in the heaviest phases.</div>`
    : "";
  return `<section class="card"><h2>Cache economics</h2><p class="lead">${lead}</p><div class="cache-grid">${tiles}</div>${callout}</section>`;
}

// Cost-by-model and cache-economics sit side by side when both are available.
function economicsRow(t) {
  const cm = costByModelSection(t);
  const ce = cacheSection(t);
  if (cm && ce) return `<div class="cols">${cm}${ce}</div>`;
  return [cm, ce].filter(Boolean).join("\n");
}

function signalsSection(t) {
  const items = [];
  const qa = (t.phases || []).find((p) => p.phase === "qa");
  if (qa && (qa.qa_status || qa.qa_iterations_used != null)) {
    items.push(`QA: ${esc(qa.qa_status || "—")} (${fmtInt(qa.qa_iterations_used)} iteration(s))`);
  }
  for (const s of t.skip_rules_applied || []) {
    items.push(`Skipped <b>${esc(s.phase_skipped)}</b> — ${esc(s.rule)}`);
  }
  if (t.cap_status && t.cap_status !== "within") items.push(`Cap: <b>${esc(t.cap_status)}</b>`);
  if (t.aborted_at_phase) items.push(`Aborted at <b>${esc(t.aborted_at_phase)}</b>`);
  for (const p of t.phases || []) {
    if (p.cache_pressure) items.push(`High cache-pressure: <b>${esc(p.phase)}</b> (peak ${fmtTok(p.peak_prefix_tokens)} &gt; 80k)`);
  }
  if (!items.length) return "";
  return `<section class="card"><h2>Signals</h2><ul class="sig">${items.map((i) => `<li>${i}</li>`).join("")}</ul></section>`;
}

function postChecksSection(t, md) {
  const checks = t.post_pipeline_checks || [];
  if (!checks.length && !md) return "";
  const rows = checks.map((c) => {
    const skip = c.skipped || c.exit_code == null;
    const cell = skip ? `<td class="ck-skip">⏭</td>` : c.exit_code === 0 ? `<td class="ck-ok">✓</td>` : `<td class="ck-bad">✕</td>`;
    const ec = c.exit_code == null ? "skip" : esc(c.exit_code);
    return `<tr>${cell}<td><code>${esc(c.command)}</code></td><td class="num">${ec}</td></tr>`;
  }).join("\n");
  const table = checks.length
    ? `<table class="checks"><thead><tr><th class="w36"></th><th>Command</th><th class="num w60">Exit</th></tr></thead><tbody>${rows}</tbody></table>` : "";
  const excerpt = md ? `<details><summary>Output tail</summary><pre>${esc(md)}</pre></details>` : "";
  return `<section class="card"><h2>Post-pipeline checks</h2>${table}${excerpt}</section>`;
}

function touchedFilesSection(t) {
  const files = t.touched_files;
  if (!Array.isArray(files) || !files.length) return "";
  const counts = { A: 0, M: 0, D: 0 };
  for (const f of files) {
    const k = String(f.status ?? "").charAt(0);
    if (k === "A") counts.A++; else if (k === "D") counts.D++; else counts.M++;
  }
  const groups = new Map();
  for (const f of files) {
    const path = String(f.path ?? "");
    const slash = path.lastIndexOf("/");
    const dir = slash >= 0 ? path.slice(0, slash) : ".";
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push({ status: String(f.status ?? ""), name });
  }
  const total = files.length;
  const w = (n) => (n / total * 100).toFixed(1);
  const dist = `<div class="tf-dist"><i style="width:${w(counts.A)}%;background:#3fb871"></i><i style="width:${w(counts.M)}%;background:#e0b13e"></i><i style="width:${w(counts.D)}%;background:#e0645c"></i></div>`;
  // Class is keyed on the first letter so git rename/copy codes (R100, C75, …)
  // map to .st-R / .st-C; the full status is kept as the visible label.
  const groupHtml = [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([dir, fs]) => {
    const items = fs.sort((a, b) => (a.name < b.name ? -1 : 1)).map((f) =>
      `<div class="tf-file"><span class="st st-${esc(f.status.charAt(0))}">${esc(f.status)}</span><span class="tf-name">${esc(f.name)}</span></div>`).join("");
    return `<div class="tf-group"><div class="tf-dir">${esc(dir)}</div><div class="tf-files">${items}</div></div>`;
  }).join("");
  return `<section class="card">
<div class="tf-head"><h2>Touched files <span class="tf-count">· ${total}</span></h2>
<div class="tf-pills"><span class="pill pill-ok">${counts.A} added</span><span class="pill pill-warn">${counts.M} modified</span><span class="pill pill-bad">${counts.D} deleted</span></div></div>
${dist}
<div class="tf-grid">${groupHtml}</div></section>`;
}

function depsSection(t) {
  const d = t.deps_preflight;
  if (!d || !Object.keys(d).length) return "";
  const rows = Object.entries(d).map(([name, v]) => {
    const miss = v && v.missing_skills && v.missing_skills.length ? ` — missing ${esc(v.missing_skills.join(", "))}` : "";
    return `<li><code>${esc(name)}</code>: ${esc(v ? v.status : "—")}${miss}</li>`;
  }).join("");
  return `<section class="card"><h2>Dependency preflight</h2><ul class="deps">${rows}</ul></section>`;
}

function artifactsSection(t, files) {
  const list = (files || []).map((f) => `<a class="art" href="${esc(f)}">${esc(f)}</a>`).join("");
  return `<section class="card"><h2>Artifacts</h2><div class="arts">${list}<a class="art" href="_telemetry.json">_telemetry.json</a></div></section>`;
}

export function renderReport(t, extras = {}) {
  const sections = [
    headerSection(t),
    kpiSection(t),
    costShareSection(t),
    timelineSection(t),
    economicsRow(t),
    signalsSection(t),
    postChecksSection(t, extras.postChecksMarkdown),
    touchedFilesSection(t),
    depsSection(t),
    artifactsSection(t, extras.artifactFiles),
  ].filter(Boolean);
  return doc(t, sections.join("\n"));
}

export function renderReportFile(dir) {
  const telPath = join(dir, "_telemetry.json");
  if (!existsSync(telPath)) throw new Error(`no _telemetry.json in ${dir}`);
  let t;
  try { t = JSON.parse(readFileSync(telPath, "utf8")); }
  catch (e) { throw new Error(`unparseable _telemetry.json in ${dir}: ${e.message}`); }

  let postChecksMarkdown;
  const pc = join(dir, "05-post-checks.md");
  if (existsSync(pc)) {
    try { postChecksMarkdown = readFileSync(pc, "utf8").split("\n").slice(-30).join("\n"); } catch { /* degrade */ }
  }
  let artifactFiles = [];
  try { artifactFiles = readdirSync(dir).filter((f) => /^\d\d-.*\.md$/.test(f)).sort(); } catch { /* degrade */ }

  const html = renderReport(t, { postChecksMarkdown, artifactFiles });
  const htmlPath = join(dir, "report.html");
  writeFileSync(htmlPath, html);
  return { htmlPath, ok: true };
}
