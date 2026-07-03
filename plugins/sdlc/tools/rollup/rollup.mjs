// SSOT for the SDLC cross-run rollup (/sdlc:report).
//
// Lives INSIDE the shipped `sdlc` plugin payload so the /sdlc:report command can
// run it via `${CLAUDE_PLUGIN_ROOT}/tools/rollup/cli.mjs`. Dependency-free (node
// builtins only). Deterministic: no Date.now()/new Date()/Math.random(). The
// dev/CI copy at tools/sdlc-lint/lib/rollup.mjs re-exports from here.
import { computeMetrics } from "../aar/metrics.mjs";

const num = (n) => (typeof n === "number" && isFinite(n) ? n : 0);
const byNameAsc = (a, b, k) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0);
const fmtUsd = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
const fmtInt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (r) => (r == null ? "—" : `${Math.round(Number(r) * 100)}%`);

// dated asc, undated last, slug-asc tiebreak
function cmpStartedAt(a, b) {
  if (a.started_at && b.started_at) {
    if (a.started_at !== b.started_at) return a.started_at < b.started_at ? -1 : 1;
    return byNameAsc(a, b, "slug");
  }
  if (a.started_at && !b.started_at) return -1;
  if (!a.started_at && b.started_at) return 1;
  return byNameAsc(a, b, "slug");
}

export function computeRollup(runs) {
  const rows = (Array.isArray(runs) ? runs : []).map(({ slug, telemetry }) => {
    const m = computeMetrics(telemetry);
    return {
      slug: slug ?? m.task_slug ?? "(unknown)",
      started_at: telemetry.started_at ?? null,
      stack: m.stack,
      resumed: m.resumed === true,
      cost_usd: m.totals.cost_usd,
      input_tokens: num(m.totals.input_tokens),
      output_tokens: num(m.totals.output_tokens),
      cached_input_tokens: num(m.totals.cached_input_tokens),
      cache_hit_ratio: m.totals.cache_hit_ratio,
      cap_status: m.totals.cap_status,
      cost_cap_usd: m.totals.cost_cap_usd,
      cap_breach: m.cap_breach,
      qa_iterations: num(m.qa_iterations),
      skip_rules_count: num(m.skip_rules_count),
      phase_count: m.by_phase.length,
      unpriced: m.unpriced_phase_count > 0,
      _by_phase: m.by_phase,
      _by_model: m.by_model,
      _skips: Array.isArray(telemetry.skip_rules_applied) ? telemetry.skip_rules_applied : [],
    };
  }).sort(cmpStartedAt);

  let costSum = 0, anyCost = false, inSum = 0, outSum = 0, cachedSum = 0;
  let capBreaches = 0, skipRules = 0, qaIters = 0, unpricedRuns = 0;
  for (const r of rows) {
    if (r.cost_usd != null) { costSum += r.cost_usd; anyCost = true; }
    inSum += r.input_tokens;
    outSum += r.output_tokens;
    cachedSum += r.cached_input_tokens;
    if (r.cap_breach) capBreaches += 1;
    skipRules += r.skip_rules_count;
    qaIters += r.qa_iterations;
    if (r.unpriced) unpricedRuns += 1;
  }

  const modelMap = new Map();
  for (const r of rows) {
    for (const m of r._by_model) {
      const e = modelMap.get(m.model) ?? { model: m.model, runs: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0, unpriced: 0 };
      e.runs += 1;
      e.cost_usd += num(m.cost_usd);
      e.input_tokens += num(m.input_tokens);
      e.output_tokens += num(m.output_tokens);
      e.unpriced += num(m.unpriced);
      modelMap.set(m.model, e);
    }
  }
  const by_model = [...modelMap.values()].sort((a, b) => b.cost_usd - a.cost_usd || byNameAsc(a, b, "model"));

  const phaseMap = new Map();
  for (const r of rows) {
    for (const p of r._by_phase) {
      const e = phaseMap.get(p.phase) ?? { phase: p.phase, runs: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 };
      e.runs += 1;
      e.cost_usd += num(p.cost_usd);
      e.input_tokens += num(p.input_tokens);
      e.output_tokens += num(p.output_tokens);
      phaseMap.set(p.phase, e);
    }
  }
  const by_phase = [...phaseMap.values()].sort((a, b) => b.cost_usd - a.cost_usd || byNameAsc(a, b, "phase"));

  let cum = 0;
  const cost_over_time = rows.map((r) => { cum += num(r.cost_usd); return { slug: r.slug, started_at: r.started_at, cost_usd: r.cost_usd, cumulative_usd: cum }; });
  const cache_trend = rows.map((r) => ({ slug: r.slug, started_at: r.started_at, cache_hit_ratio: r.cache_hit_ratio }));

  const qa_distribution = {};
  for (const r of rows) { const k = String(r.qa_iterations); qa_distribution[k] = (qa_distribution[k] ?? 0) + 1; }

  const cap_breach_incidents = rows.filter((r) => r.cap_breach).map((r) => ({ slug: r.slug, cap_status: r.cap_status, cost_usd: r.cost_usd, cost_cap_usd: r.cost_cap_usd }));
  const skips = [];
  for (const r of rows) for (const s of r._skips) skips.push({ slug: r.slug, phase_skipped: s.phase_skipped, rule: s.rule });

  const publicRows = rows.map(({ _by_phase, _by_model, _skips, cost_cap_usd, cached_input_tokens, ...pub }) => pub);

  return {
    run_count: rows.length,
    runs: publicRows,
    totals: {
      cost_usd: anyCost ? costSum : null,
      input_tokens: inSum,
      output_tokens: outSum,
      cache_hit_ratio_weighted: inSum > 0 ? cachedSum / inSum : null,
      cap_breaches: capBreaches,
      skip_rules: skipRules,
      qa_iterations: qaIters,
      unpriced_runs: unpricedRuns,
    },
    by_model,
    by_phase,
    cost_over_time,
    cache_trend,
    qa_distribution,
    incidents: { cap_breaches: cap_breach_incidents, skips },
  };
}

export function renderRollupText(agg) {
  if (agg.run_count === 0) return "No pipeline runs recorded yet (no docs/plans/*/_telemetry.json).";
  const t = agg.totals;
  const lines = [];
  lines.push(`SDLC cross-run rollup — ${agg.run_count} run(s)`);
  lines.push(
    `Total cost ${fmtUsd(t.cost_usd)}${t.unpriced_runs ? ` (partial — ${t.unpriced_runs} unpriced)` : ""}` +
    ` · cache ${pct(t.cache_hit_ratio_weighted)} · cap breaches ${t.cap_breaches}` +
    ` · skips ${t.skip_rules} · QA iters ${t.qa_iterations}`
  );
  lines.push("");
  lines.push(`${"RUN".padEnd(24)} ${"WHEN".padEnd(20)} ${"COST".padStart(8)} ${"CACHE".padStart(6)} CAP`);
  for (const r of agg.runs) {
    lines.push(
      `${String(r.slug).padEnd(24).slice(0, 24)} ${String(r.started_at ?? "—").padEnd(20).slice(0, 20)}` +
      ` ${fmtUsd(r.cost_usd).padStart(8)} ${pct(r.cache_hit_ratio).padStart(6)} ${r.cap_breach ? "OVER" : "ok"}`
    );
  }
  lines.push("");
  lines.push("BY MODEL");
  for (const m of agg.by_model) {
    lines.push(`  ${String(m.model).padEnd(28)} ${fmtUsd(m.cost_usd).padStart(8)} ${fmtInt(m.input_tokens + m.output_tokens).padStart(11)} tok`);
  }
  lines.push("BY PHASE");
  for (const p of agg.by_phase) {
    lines.push(`  ${String(p.phase).padEnd(28)} ${fmtUsd(p.cost_usd).padStart(8)} ${fmtInt(p.input_tokens + p.output_tokens).padStart(11)} tok`);
  }
  return lines.join("\n");
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ROLLUP_CSS = `
:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#e3e3e3;--card:#f7f7f8;--bar:#4f6bed}
@media(prefers-color-scheme:dark){:root{--bg:#15161a;--fg:#e8e8ea;--muted:#9a9aa2;--line:#2b2d33;--card:#1e2026;--bar:#6b83f0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 12px;border-bottom:1px solid var(--line);padding-bottom:6px}
.sub{color:var(--muted);margin:0 0 2px}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-top:20px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.tv{font-size:20px;font-weight:600}.tl{color:var(--muted);font-size:12px;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line)}
th{color:var(--muted);font-weight:500}.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{width:160px}.bar span{display:block;height:8px;border-radius:4px;background:var(--bar)}
.badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;background:var(--card);color:var(--muted)}
.over{color:#cf222e;font-weight:600}.note{color:var(--muted);font-size:12px}ul{padding-left:18px}li{margin:3px 0}
`;

function barCell(value, max) {
  const w = max > 0 ? Math.round((num(value) / max) * 100) : 0;
  return `<td class="bar"><span style="width:${w}%"></span></td>`;
}

export function renderRollupHtml(agg) {
  const head = (body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SDLC cross-run rollup</title>
<style>${ROLLUP_CSS}</style>
</head>
<body><main class="wrap">
${body}
<footer class="note" style="margin-top:40px">Generated from docs/plans/*/_telemetry.json · ${agg.run_count} run(s)</footer>
</main></body>
</html>`;

  if (agg.run_count === 0) {
    return head(`<header><h1>SDLC cross-run rollup</h1><p class="sub">No pipeline runs recorded yet.</p></header>`);
  }

  const t = agg.totals;
  const tile = (label, value) => `<div class="tile"><div class="tv">${value}</div><div class="tl">${esc(label)}</div></div>`;
  const kpis = `<section class="kpis">
${tile("Runs", agg.run_count)}
${tile("Total cost", fmtUsd(t.cost_usd))}
${tile("Cache hit", pct(t.cache_hit_ratio_weighted))}
${tile("Cap breaches", t.cap_breaches)}
${tile("Skips", t.skip_rules)}
${tile("QA iterations", t.qa_iterations)}
</section>`;
  const partial = t.unpriced_runs ? `<p class="note">Cost partial — ${t.unpriced_runs} run(s) unpriced (no registry pricing).</p>` : "";

  const maxRunCost = Math.max(...agg.runs.map((r) => num(r.cost_usd)), 0.0001);
  const runRows = agg.runs.map((r) =>
    `<tr><td>${esc(r.slug)}${r.resumed ? ` <span class="badge">resumed</span>` : ""}</td>
<td>${esc(r.started_at ?? "—")}</td>
<td><code>${esc(r.stack ?? "—")}</code></td>
<td class="num">${fmtUsd(r.cost_usd)}</td>
<td class="num">${pct(r.cache_hit_ratio)}</td>
<td>${r.cap_breach ? `<span class="over">${esc(r.cap_status)}</span>` : "ok"}</td>
${barCell(r.cost_usd, maxRunCost)}</tr>`).join("\n");
  const runsSection = `<section><h2>Runs (${agg.run_count})</h2>
<table><thead><tr><th>Run</th><th>Started</th><th>Stack</th><th class="num">Cost</th><th class="num">Cache</th><th>Cap</th><th>Cost share</th></tr></thead>
<tbody>${runRows}</tbody></table>${partial}</section>`;

  const maxCum = Math.max(...agg.cost_over_time.map((c) => num(c.cumulative_usd)), 0.0001);
  const cotRows = agg.cost_over_time.map((c) =>
    `<tr><td>${esc(c.slug)}</td><td>${esc(c.started_at ?? "—")}</td><td class="num">${fmtUsd(c.cost_usd)}</td><td class="num">${fmtUsd(c.cumulative_usd)}</td>${barCell(c.cumulative_usd, maxCum)}</tr>`).join("\n");
  const cotSection = `<section><h2>Cost over time</h2>
<table><thead><tr><th>Run</th><th>Started</th><th class="num">Cost</th><th class="num">Cumulative</th><th>Trend</th></tr></thead>
<tbody>${cotRows}</tbody></table></section>`;

  const modelRows = agg.by_model.map((m) =>
    `<tr><td><code>${esc(m.model)}</code></td><td class="num">${m.runs}</td><td class="num">${fmtInt(m.input_tokens)}</td><td class="num">${fmtInt(m.output_tokens)}</td><td class="num">${fmtUsd(m.cost_usd)}</td></tr>`).join("\n");
  const modelSection = `<section><h2>Cost by model</h2>
<table><thead><tr><th>Model</th><th class="num">Runs</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cost</th></tr></thead>
<tbody>${modelRows}</tbody></table></section>`;

  const phaseRows = agg.by_phase.map((p) =>
    `<tr><td>${esc(p.phase)}</td><td class="num">${p.runs}</td><td class="num">${fmtInt(p.input_tokens + p.output_tokens)}</td><td class="num">${fmtUsd(p.cost_usd)}</td></tr>`).join("\n");
  const phaseSection = `<section><h2>Cost by phase</h2>
<table><thead><tr><th>Phase</th><th class="num">Occurrences</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead>
<tbody>${phaseRows}</tbody></table></section>`;

  const qaKeys = Object.keys(agg.qa_distribution).sort((a, b) => Number(a) - Number(b));
  const maxQa = Math.max(...qaKeys.map((k) => agg.qa_distribution[k]), 1);
  const qaRows = qaKeys.map((k) =>
    `<tr><td class="num">${esc(k)}</td><td class="num">${agg.qa_distribution[k]}</td>${barCell(agg.qa_distribution[k], maxQa)}</tr>`).join("\n");
  const qaSection = qaKeys.length ? `<section><h2>QA-iteration distribution</h2>
<table><thead><tr><th class="num">Iterations</th><th class="num">Runs</th><th>Frequency</th></tr></thead>
<tbody>${qaRows}</tbody></table></section>` : "";

  const capItems = agg.incidents.cap_breaches.map((c) =>
    `<li><code>${esc(c.slug)}</code> — <span class="over">${esc(c.cap_status)}</span> · ${fmtUsd(c.cost_usd)} / ${fmtUsd(c.cost_cap_usd)} cap</li>`).join("");
  const skipItems = agg.incidents.skips.map((s) =>
    `<li><code>${esc(s.slug)}</code> — skipped <b>${esc(s.phase_skipped)}</b> (${esc(s.rule)})</li>`).join("");
  const incidentsSection = (capItems || skipItems)
    ? `<section><h2>Incidents</h2>${capItems ? `<h3 class="note">Cap breaches</h3><ul>${capItems}</ul>` : ""}${skipItems ? `<h3 class="note">Skips</h3><ul>${skipItems}</ul>` : ""}</section>`
    : "";

  return head([
    `<header><h1>SDLC cross-run rollup</h1><p class="sub">${agg.run_count} run(s) · ${fmtUsd(t.cost_usd)} total</p></header>`,
    kpis, runsSection, cotSection, modelSection, phaseSection, qaSection, incidentsSection,
  ].filter(Boolean).join("\n"));
}
