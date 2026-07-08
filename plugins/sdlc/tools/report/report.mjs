// SSOT for the SDLC HTML run-report renderer.
//
// This file lives INSIDE the shipped `sdlc` plugin payload (marketplace source
// `./plugins/sdlc`) so a marketplace consumer can run it via
// `${CLAUDE_PLUGIN_ROOT}/tools/report/cli.mjs` — see pipeline-orchestrator
// Step 5b. It is intentionally DEPENDENCY-FREE (node builtins only) so it needs
// no `node_modules` on a consumer install. The dev/CI copy at
// `tools/sdlc-lint/lib/report.mjs` re-exports from here, so the tests exercise
// the exact code that ships.
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
// Cache-pressure subline: average cache-read prefix per turn + the worst-case
// single-turn prefix, with a ⚠ when the phase tripped `cache_pressure` (set at
// enrich time). Only for transcript-split phases that recorded turns.
const cacheLine = (p) => {
  if (!hasSplit(p) || !p.turns) return "";
  const perTurn = Math.round((p.cached_input_tokens || 0) / p.turns);
  const warn = p.cache_pressure ? " ⚠" : "";
  return `<div class="ts">cache ${fmtTok(perTurn)}/turn · peak ${fmtTok(p.peak_prefix_tokens)}${warn}</div>`;
};

const CSS = `
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e3e3e3;--card:#f7f7f8;--bar:#4f6bed;--accent:#4f6bed}
@media(prefers-color-scheme:dark){:root{--bg:#15161a;--fg:#e8e8ea;--muted:#9a9aa2;--line:#2b2d33;--card:#1e2026;--bar:#6b83f0;--accent:#8ea2ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}
.sub{color:var(--muted);margin:0 0 2px}.meta{color:var(--muted);font-size:13px;margin:0}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;background:var(--card);color:var(--muted);vertical-align:middle}
.badge-resume{background:var(--accent);color:#fff}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-top:20px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.tv{font-size:20px;font-weight:600}.tl{color:var(--muted);font-size:12px;margin-top:2px}.ts{color:var(--muted);font-size:11px;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:500}.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{width:120px}.bar span{display:block;height:8px;border-radius:4px;background:var(--bar)}
.note{color:var(--muted);font-size:12px}.sig li,.files li{margin:3px 0}ul{padding-left:18px}
.st{display:inline-block;min-width:16px;font-weight:600}.st-A{color:#2ea043}.st-M{color:#bf8700}.st-D{color:#cf222e}.st-R{color:#8250df}.st-C{color:#8250df}
details{margin-top:10px}pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto}
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
<footer class="meta" style="margin-top:40px">Generated from _telemetry.json · ${esc(t.completed_at || "")}</footer>
</main></body>
</html>`;
}

function headerSection(t) {
  const profiles = [t.primary_profile, ...(t.additive_profiles || [])].filter(Boolean).join(" + ");
  const resumed = t.resumed ? ` <span class="badge badge-resume">RESUMED</span>` : "";
  return `<header><h1>${esc(t.task_slug)}${resumed}</h1>
<p class="sub">${esc(t.stack || "—")} · <code>${esc(profiles || "—")}</code></p>
<p class="meta">${esc(t.started_at || "?")} → ${esc(t.completed_at || "?")} · ${fmtInt(t.wall_clock_seconds)}s</p></header>`;
}

function tile(label, value, sub) {
  return `<div class="tile"><div class="tv">${value}</div><div class="tl">${esc(label)}</div>${sub ? `<div class="ts">${sub}</div>` : ""}</div>`;
}
function kpiSection(t) {
  const capNote = t.cost_cap_usd != null ? `${fmtUsd(t.cost_cap_usd)} cap · ${esc(t.cap_status || "—")}` : "no cap";
  const oh = t.orchestration_overhead;
  const costSub = oh && oh.cost_usd != null ? `${capNote} · orch ${fmtUsd(oh.cost_usd)}` : capNote;
  const billed = totalBilled(t);
  // Billed tokens are the real, priced total (incl. per-turn cache reads/writes);
  // fall back to the harness aggregate only if no phase was transcript-enriched.
  const billedTile = billed > 0
    ? tile("Billed tokens", fmtInt(billed), `in ${fmtTok(t.total_input_tokens)} · out ${fmtTok(t.total_output_tokens)} · cache r/w ${fmtTok(t.total_cached_input_tokens)}/${fmtTok(t.total_cache_creation_tokens)}`)
    : tile("Aggregate tokens", fmtInt(t.total_subagent_tokens), "harness aggregate — unpriced");
  return `<section class="kpis">
${tile("Total cost", fmtUsd(t.total_cost_usd), costSub)}
${billedTile}
${tile("Output tokens", fmtInt(t.total_output_tokens))}
${tile("Cache hit", pct(t.cache_hit_ratio))}
${tile("Phases", fmtInt((t.phases || []).length))}
${tile("Model corrections", fmtInt(t.model_enforcement_corrections))}
</section>`;
}

const ICON = { completed: "✅", skipped: "⏩", aborted: "⏸", approved: "✅" };

function tokenCell(p) {
  // Real billed total + a compact split subline, or the harness aggregate when
  // the phase was not transcript-enriched (older runs / missing transcript).
  const billed = billedTokens(p);
  if (billed == null) {
    return `<td class="num">${fmtInt(p.subagent_tokens)}<div class="ts">aggregate</div></td>`;
  }
  const split = `in ${fmtTok(p.input_tokens)} · out ${fmtTok(p.output_tokens)} · cache-r ${fmtTok(p.cached_input_tokens)} · cache-w ${fmtTok(p.cache_creation_tokens)}`;
  return `<td class="num">${fmtInt(billed)}<div class="ts">${split}</div>${cacheLine(p)}</td>`;
}

function timelineSection(t) {
  const phases = t.phases || [];
  if (!phases.length) return "";
  const oh = t.orchestration_overhead;
  const ohCost = oh && oh.cost_usd != null ? oh.cost_usd : 0;
  const maxCost = Math.max(...phases.map((p) => p.cost_usd || 0), ohCost, 0.0001);
  const rows = phases.map((p) => {
    const name = p.aspect ? `${p.phase} · ${p.aspect}` : p.phase;
    const w = Math.round(((p.cost_usd || 0) / maxCost) * 100);
    const origin = p.origin === "resumed" ? ` <span class="badge">resumed</span>` : "";
    return `<tr><td>${ICON[p.status] || "•"}</td>
<td>${esc(name)}${origin}</td>
<td>${esc(p.agent || "—")}</td>
<td><code>${esc(p.model || "—")}</code></td>
${tokenCell(p)}
<td class="num">${fmtUsd(p.cost_usd)}</td>
<td class="bar"><span style="width:${w}%"></span></td></tr>`;
  }).join("\n");
  // Orchestration overhead (orchestrator main-loop + non-phase/nested subagents)
  // is not a phase but is real spend — show it so per-row costs reconcile to the total.
  let ohRow = "";
  if (oh && oh.cost_usd != null) {
    const ml = oh.main_loop || {};
    const billed = (ml.input_tokens || 0) + (ml.output_tokens || 0) + (ml.cached_input_tokens || 0) + (ml.cache_creation_tokens || 0);
    const w = Math.round((ohCost / maxCost) * 100);
    ohRow = `<tr><td>⚙</td>
<td>orchestration <span class="badge">overhead</span></td>
<td>orchestrator</td>
<td><code>${esc(ml.model || "—")}</code></td>
<td class="num">${fmtInt(billed)}<div class="ts">main-loop + nested</div></td>
<td class="num">${fmtUsd(oh.cost_usd)}</td>
<td class="bar"><span style="width:${w}%"></span></td></tr>`;
  }
  return `<section><h2>Phase timeline</h2>
<table><thead><tr><th></th><th>Phase</th><th>Agent</th><th>Model</th><th class="num">Billed tokens</th><th class="num">Cost</th><th>Cost share</th></tr></thead>
<tbody>${rows}
${ohRow}</tbody></table></section>`;
}

function costBreakdownSection(t) {
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
  const rows = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost).map(([model, m]) =>
    `<tr><td><code>${esc(model)}</code></td><td class="num">${fmtInt(m.input)}</td><td class="num">${fmtInt(m.cacheR)}</td><td class="num">${fmtInt(m.cacheW)}</td><td class="num">${fmtInt(m.output)}</td><td class="num">${fmtUsd(m.cost)}</td></tr>`).join("\n");
  const note = unpriced ? `<p class="note">Cost partial — ${unpriced} phase(s) unpriced (aggregate-only usage, no transcript to split).</p>` : "";
  return `<section><h2>Cost by model</h2>
<table><thead><tr><th>Model</th><th class="num">Input</th><th class="num">Cache read</th><th class="num">Cache write</th><th class="num">Output</th><th class="num">Cost</th></tr></thead>
<tbody>${rows}</tbody></table>${note}</section>`;
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
  return `<section><h2>Signals</h2><ul class="sig">${items.map((i) => `<li>${i}</li>`).join("")}</ul></section>`;
}

function postChecksSection(t, md) {
  const checks = t.post_pipeline_checks || [];
  if (!checks.length && !md) return "";
  const rows = checks.map((c) => {
    const icon = c.skipped || c.exit_code == null ? "⏭" : c.exit_code === 0 ? "✅" : "❌";
    const ec = c.exit_code == null ? "skip" : esc(c.exit_code);
    return `<tr><td>${icon}</td><td><code>${esc(c.command)}</code></td><td class="num">${ec}</td></tr>`;
  }).join("\n");
  const excerpt = md ? `<details><summary>Output tail</summary><pre>${esc(md)}</pre></details>` : "";
  return `<section><h2>Post-pipeline checks</h2>${checks.length ? `<table><tbody>${rows}</tbody></table>` : ""}${excerpt}</section>`;
}

function touchedFilesSection(t) {
  const files = t.touched_files;
  if (!Array.isArray(files) || !files.length) return "";
  const rows = files.map((f) => {
    const status = String(f.status ?? "");
    // Class is keyed on the first letter so git rename/copy codes (R100, C75, …)
    // map to .st-R / .st-C; the full status is kept as the visible label.
    return `<li><span class="st st-${esc(status.charAt(0))}">${esc(status)}</span> <code>${esc(f.path)}</code></li>`;
  }).join("");
  return `<section><h2>Touched files (${files.length})</h2><ul class="files">${rows}</ul></section>`;
}

function depsSection(t) {
  const d = t.deps_preflight;
  if (!d || !Object.keys(d).length) return "";
  const rows = Object.entries(d).map(([name, v]) => {
    const miss = v && v.missing_skills && v.missing_skills.length ? ` — missing ${esc(v.missing_skills.join(", "))}` : "";
    return `<li><code>${esc(name)}</code>: ${esc(v ? v.status : "—")}${miss}</li>`;
  }).join("");
  return `<section><h2>Dependency preflight</h2><ul>${rows}</ul></section>`;
}

function artifactsSection(t, files) {
  const list = (files || []).map((f) => `<li><a href="${esc(f)}">${esc(f)}</a></li>`).join("");
  return `<section><h2>Artifacts</h2><ul class="files">${list}<li><a href="_telemetry.json">_telemetry.json</a></li></ul></section>`;
}

export function renderReport(t, extras = {}) {
  const sections = [
    headerSection(t),
    kpiSection(t),
    timelineSection(t),
    costBreakdownSection(t),
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
