// Pure renderer — no imports. The file-I/O wrapper (later task) adds node:fs / node:path.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtUsd = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
const fmtInt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const pct = (r) => `${Math.round((Number(r) || 0) * 100)}%`;

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
.st{display:inline-block;width:16px;font-weight:600}.st-A{color:#2ea043}.st-M{color:#bf8700}.st-D{color:#cf222e}
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
  return `<section class="kpis">
${tile("Total cost", fmtUsd(t.total_cost_usd), capNote)}
${tile("Input tokens", fmtInt(t.total_input_tokens))}
${tile("Output tokens", fmtInt(t.total_output_tokens))}
${tile("Cache hit", pct(t.cache_hit_ratio))}
${tile("Phases", fmtInt((t.phases || []).length))}
${tile("Model corrections", fmtInt(t.model_enforcement_corrections))}
</section>`;
}

export function renderReport(t, extras = {}) {
  const sections = [
    headerSection(t),
    kpiSection(t),
  ].filter(Boolean);
  return doc(t, sections.join("\n"));
}
