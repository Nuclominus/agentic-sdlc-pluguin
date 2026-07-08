// SSOT for transcript-derived token/cost accounting.
//
// This file lives INSIDE the shipped `sdlc` plugin payload (marketplace source
// `./plugins/sdlc`) so a marketplace consumer can run it via
// `${CLAUDE_PLUGIN_ROOT}/tools/usage/cli.mjs` — see pipeline-orchestrator
// Step 5b. It is intentionally DEPENDENCY-FREE (node builtins only) so it needs
// no `node_modules` on a consumer install. The dev/CI copy at
// `tools/sdlc-lint/lib/usage.mjs` re-exports from here, so the tests exercise
// the exact code that ships.
//
// Why it exists: the Claude Code Agent tool result envelope exposes only a single
// aggregate `subagent_tokens` count — no input/output/cache split — so a phase's
// cost cannot be priced from it (this is the ADR-0004 limitation, and that
// aggregate also badly understates real billed usage because it ignores the
// per-turn cache READS that dominate a long agent run). The real split lives in
// each subagent's own transcript at
//   ~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl
// Every assistant turn there carries a `message.usage` block
// (`input_tokens` = uncached input, `cache_read_input_tokens`,
// `cache_creation_input_tokens` with an `ephemeral_5m`/`ephemeral_1h` split, and
// `output_tokens`). Summed across turns and priced against the model registry,
// that yields the authoritative per-phase cost. ADR-0005 supersedes ADR-0004.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";

// ── registry ────────────────────────────────────────────────────────────────

const DEFAULT_REGISTRY = join(homedir(), ".claude", "plugins", "cache");

/** Load the model registry (models.json). Returns { byId, multipliers, raw }. */
export function loadRegistry(explicitPath) {
  const path = explicitPath || findRegistry();
  if (!path) throw new Error("model registry (models.json) not found");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const byId = new Map();
  for (const m of raw.models || []) if (m.model_id) byId.set(m.model_id, m.pricing || null);
  const multipliers = raw.cache_write_multipliers || { ephemeral_5m: 1.25, ephemeral_1h: 2.0 };
  return { byId, multipliers, raw, path };
}

function findRegistry() {
  // Prefer the shipped copy next to this file's plugin, then the plugin cache.
  const local = join(dirname(dirname(new URL(".", import.meta.url).pathname)), "config", "models.json");
  if (existsSync(local)) return local;
  const hits = globJsonl(DEFAULT_REGISTRY, /\/sdlc\/config\/models\.json$/);
  return hits[0] || null;
}

// ── transcript extraction ─────────────────────────────────────────────────────

const num = (v) => (Number.isFinite(v) ? v : Number(v) || 0);

// Cache-pressure threshold: a phase is flagged when its worst-case single-turn
// cache-read (peak_prefix_tokens) exceeds this. One documented constant, tuned
// here; consumers (report, metrics) read the stored `cache_pressure` boolean.
export const CACHE_PRESSURE_PEAK_TOKENS = 80_000;

/**
 * Sum the real usage split from one transcript JSONL (a subagent's, or a main
 * session's). `onlyMainLoop` keeps only non-sidechain assistant turns (used to
 * price the orchestrator's own turns from a session transcript). Returns a map
 * of model_id -> usage totals, plus a `combined` roll-up.
 */
export function extractUsage(jsonlPath, { onlyMainLoop = false, since, until } = {}) {
  const s = since ? Date.parse(since) : null;
  const u0 = until ? Date.parse(until) : null;
  const byModel = {};
  const add = (model, u) => {
    const t = (byModel[model] ||= zeroUsage());
    t.input_tokens += num(u.input_tokens);
    t.output_tokens += num(u.output_tokens);
    t.cache_read_tokens += num(u.cache_read_input_tokens);
    t.peak_prefix_tokens = Math.max(t.peak_prefix_tokens, num(u.cache_read_input_tokens));
    const cc = u.cache_creation || {};
    const w5 = num(cc.ephemeral_5m_input_tokens);
    const w1 = num(cc.ephemeral_1h_input_tokens);
    const ccTotal = num(u.cache_creation_input_tokens);
    if (w5 || w1) {
      t.cache_write_5m_tokens += w5;
      t.cache_write_1h_tokens += w1;
    } else {
      // No TTL split reported — treat the whole cache-creation count as 5m.
      t.cache_write_5m_tokens += ccTotal;
    }
    t.turns += 1;
  };
  // Claude Code writes ONE JSONL line per content block of an assistant turn
  // (a thinking block, each parallel tool_use, etc.), and every one of those
  // lines repeats the SAME response-level `message.usage`. Summing per line
  // therefore multiplies a single API call's usage by its block count (~2-4x).
  // Dedup on `message.id` (the API response id, unique per call) so each turn
  // is counted once; fall back to counting lines that carry no id.
  const seen = new Set();
  for (const line of readLines(jsonlPath)) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    if (onlyMainLoop && d.isSidechain) continue;
    if ((s != null || u0 != null) && d.timestamp) {
      const t = Date.parse(d.timestamp);
      if (Number.isFinite(t) && ((s != null && t < s) || (u0 != null && t > u0))) continue;
    }
    const m = d.message;
    if (!m || typeof m !== "object" || !m.usage || m.role !== "assistant") continue;
    const model = m.model || "unknown";
    if (model === "<synthetic>") continue;
    if (m.id) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
    }
    add(model, m.usage);
  }
  const combined = zeroUsage();
  for (const t of Object.values(byModel)) for (const k of Object.keys(combined)) {
    combined[k] = k === "peak_prefix_tokens" ? Math.max(combined[k], t[k]) : combined[k] + t[k];
  }
  return { byModel, combined };
}

function zeroUsage() {
  return {
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0,
    cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, peak_prefix_tokens: 0, turns: 0,
  };
}

// ── pricing ───────────────────────────────────────────────────────────────────

/**
 * Resolve registry pricing for a transcript's model id, tolerating suffixes the
 * harness may append that are not literal registry keys: a bracketed context tag
 * (`claude-opus-4-8[1m]`) or a trailing dated snapshot (`claude-sonnet-5-20260115`).
 * The exact id is tried first, so a registry key that legitimately IS dated
 * (e.g. `claude-haiku-4-5-20251001`) still matches. Returns the pricing object,
 * `null` for a known-but-unpriced model, or `null` when the id is unknown.
 */
export function lookupPricing(modelId, registry) {
  if (modelId == null) return null;
  const id = String(modelId);
  let P = registry.byId.get(id);
  if (P !== undefined) return P;
  const noBracket = id.replace(/\[[^\]]*\]$/, "");
  if (noBracket !== id) { P = registry.byId.get(noBracket); if (P !== undefined) return P; }
  const noDate = noBracket.replace(/-\d{8}$/, "");
  if (noDate !== noBracket) { P = registry.byId.get(noDate); if (P !== undefined) return P; }
  return null;
}

/** Price one model's usage totals against the registry. Returns cost_usd or null. */
export function priceUsage(u, modelId, registry) {
  const P = lookupPricing(modelId, registry);
  if (!P || P.input == null) return null;
  const cachedRate = P.cached_input != null ? P.cached_input : P.input * 0.1;
  const m5 = registry.multipliers.ephemeral_5m ?? 1.25;
  const m1 = registry.multipliers.ephemeral_1h ?? 2.0;
  return (
    u.input_tokens / 1e6 * P.input +
    u.cache_read_tokens / 1e6 * cachedRate +
    u.cache_write_5m_tokens / 1e6 * P.input * m5 +
    u.cache_write_1h_tokens / 1e6 * P.input * m1 +
    u.output_tokens / 1e6 * P.output
  );
}

/**
 * Extract + price a set of transcripts, rolled up into a single priced record.
 * Handles a transcript (or several, e.g. a multi-pass phase) with one or many
 * models. cost is null only when NO model in the set could be priced.
 */
export function priceTranscripts(paths, registry) {
  const total = zeroUsage();
  let cost = 0, anyPriced = false, unpriced = 0;
  const models = new Set();
  for (const p of paths) {
    const { byModel } = extractUsage(p);
    for (const [model, u] of Object.entries(byModel)) {
      models.add(model);
      for (const k of Object.keys(total)) total[k] = k === "peak_prefix_tokens" ? Math.max(total[k], u[k]) : total[k] + u[k];
      const c = priceUsage(u, model, registry);
      if (c == null) unpriced += 1; else { cost += c; anyPriced = true; }
    }
  }
  return {
    model: [...models].join(", ") || null,
    input_tokens: total.input_tokens,
    output_tokens: total.output_tokens,
    cached_input_tokens: total.cache_read_tokens,
    cache_creation_tokens: total.cache_write_5m_tokens + total.cache_write_1h_tokens,
    cache_write_5m_tokens: total.cache_write_5m_tokens,
    cache_write_1h_tokens: total.cache_write_1h_tokens,
    billed_tokens: total.input_tokens + total.output_tokens + total.cache_read_tokens +
      total.cache_write_5m_tokens + total.cache_write_1h_tokens,
    turns: total.turns,
    peak_prefix_tokens: total.peak_prefix_tokens,
    cost_usd: anyPriced ? round2(cost) : null,
    unpriced_models: unpriced,
  };
}

// ── transcript discovery ───────────────────────────────────────────────────────

/**
 * Resolve a subagent transcript for an agentId. Searches, in order:
 *   1. an explicit subagentsDir
 *   2. ~/.claude/projects/<cwd>/<session>/subagents/agent-<id>.jsonl (session-nested)
 *   3. ~/.claude/projects/<cwd>/subagents/agent-<id>.jsonl (flat)
 */
export function findAgentTranscript(agentId, { subagentsDir, projectsRoot } = {}) {
  const name = `agent-${agentId}.jsonl`;
  if (subagentsDir) {
    const p = join(subagentsDir, name);
    if (existsSync(p)) return p;
  }
  const root = projectsRoot || join(homedir(), ".claude", "projects");
  const hits = globJsonl(root, new RegExp(`/subagents/${name.replace(/[.]/g, "\\.")}$`));
  return hits[0] || null;
}

/** subagents dir for a session transcript path .../projects/<cwd>/<sid>.jsonl */
export function sessionSubagentsDir(sessionTranscriptPath) {
  const dir = dirname(sessionTranscriptPath);
  const sid = basename(sessionTranscriptPath).replace(/\.jsonl$/, "");
  return join(dir, sid, "subagents");
}

/**
 * Recover a phase's subagent id from its run checkpoint when _telemetry.json
 * lacks `agent_id` (the orchestrator failed to propagate it — the primary
 * lost-cost bug). Matches <runDir>/.checkpoint/<file>.json to the phase by name,
 * separator-insensitive, preferring an exact phase(+aspect) match over a
 * phase-only match. Returns the recovered id, or null.
 */
export function checkpointAgentId(runDir, phase) {
  if (!runDir || !phase) return null;
  const dir = join(runDir, ".checkpoint");
  if (!existsSync(dir)) return null;
  const norm = (s) => String(s).toLowerCase().replace(/[-_\s]/g, "");
  const wantExact = norm(phase.aspect ? `${phase.phase}-${phase.aspect}` : phase.phase);
  const wantPhase = norm(phase.phase);
  let fallback = null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let cp;
    try { cp = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
    if (!cp || !cp.agent_id) continue;
    const base = norm(f.replace(/\.json$/, ""));
    if (base === wantExact) return cp.agent_id;
    if (base === wantPhase) fallback = cp.agent_id;
  }
  return fallback;
}

/**
 * Parse an orchestrator session transcript into an ordered dispatch map:
 * one entry per Agent tool call — { index, phase, subagent_type, agent_id, description }.
 * `phase` is the pipeline phase name parsed from a "Phase N/M: <phase> ..."
 * description, or null for non-phase dispatches (e.g. session-recorder).
 */
export function deriveDispatchMap(sessionTranscriptPath) {
  const uses = new Map();   // tool_use_id -> { subagent_type, description }
  const order = [];         // tool_use_id, in dispatch order
  const results = new Map(); // tool_use_id -> agent_id
  for (const line of readLines(sessionTranscriptPath)) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const m = d.message;
    const content = m && Array.isArray(m.content) ? m.content : null;
    if (!content) continue;
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "tool_use" && b.name === "Agent") {
        const inp = b.input || {};
        uses.set(b.id, { subagent_type: inp.subagent_type || null, description: inp.description || "" });
        order.push(b.id);
      } else if (b.type === "tool_result" && b.tool_use_id) {
        const mm = String(JSON.stringify(b)).match(/agentId["'\s:]+([a-f0-9]{12,})/);
        if (mm && !results.has(b.tool_use_id)) results.set(b.tool_use_id, mm[1]);
      }
    }
  }
  return order.map((id, index) => {
    const u = uses.get(id) || {};
    const phase = (u.description.match(/Phase\s+\d+\/\d+:\s*(\S+)/) || [])[1] || null;
    return { index, phase, subagent_type: u.subagent_type, agent_id: results.get(id) || null, description: u.description };
  });
}

// ── enrichment ─────────────────────────────────────────────────────────────────

/**
 * Recompute real per-phase tokens + cost for a run from its subagent transcripts
 * and patch docs/plans/<slug>/_telemetry.json in place.
 *
 * opts.sessionTranscript — the orchestrator session .jsonl. Preferred: lets the
 *   tool derive the phase→agentId map deterministically, price the orchestrator's
 *   own turns and any non-phase/nested subagents as `orchestration_overhead`,
 *   and locate transcripts in the session's own subagents dir.
 * When absent, each telemetry phase must carry a recorded `agent_id`
 *   (string or array); overhead is not computed.
 */
export function enrichTelemetry(runDir, opts = {}) {
  const registry = opts.registry || loadRegistry(opts.registryPath);
  const telPath = join(runDir, "_telemetry.json");
  if (!existsSync(telPath)) throw new Error(`no _telemetry.json in ${runDir}`);
  const tel = JSON.parse(readFileSync(telPath, "utf8"));
  const phases = tel.phases || [];

  let subagentsDir, dispatch, byPhase = new Map();
  if (opts.sessionTranscript) {
    subagentsDir = sessionSubagentsDir(opts.sessionTranscript);
    dispatch = deriveDispatchMap(opts.sessionTranscript);
    for (const d of dispatch) {
      if (!d.phase || !d.agent_id) continue;
      if (!byPhase.has(d.phase)) byPhase.set(d.phase, []);
      byPhase.get(d.phase).push(d.agent_id);
    }
  }

  const enriched = [], skipped = [];
  const pricedIds = new Set();   // a subagent transcript is priced for at most one phase
  let firstResolved = null;
  for (const p of phases) {
    let ids = byPhase.get(p.phase);
    if ((!ids || !ids.length) && p.agent_id) ids = Array.isArray(p.agent_id) ? p.agent_id : [p.agent_id];
    // Fallback: recover the id from the run's per-phase checkpoint when the
    // orchestrator did not copy `agent_id` into _telemetry.json.
    if (!ids || !ids.length) {
      const cpId = checkpointAgentId(runDir, p);
      if (cpId) ids = [cpId];
    }
    if (!ids || !ids.length) { skipped.push(p.phase); continue; }
    // Drop ids already priced for an earlier phase: a two-pass phase can reuse
    // one resumed subagent whose single transcript must be counted exactly once.
    const resolved = ids
      .filter((id) => !pricedIds.has(id))
      .map((id) => ({ id, path: findAgentTranscript(id, { subagentsDir, projectsRoot: opts.projectsRoot }) }))
      .filter((x) => x.path);
    if (!resolved.length) { skipped.push(p.phase); continue; }
    const usedIds = resolved.map((x) => x.id);
    const paths = resolved.map((x) => x.path);
    for (const id of usedIds) pricedIds.add(id);
    if (!firstResolved) firstResolved = paths[0];
    const r = priceTranscripts(paths, registry);
    p.agent_id = usedIds.length === 1 ? usedIds[0] : usedIds;
    p.input_tokens = r.input_tokens;
    p.output_tokens = r.output_tokens;
    p.cached_input_tokens = r.cached_input_tokens;
    p.cache_creation_tokens = r.cache_creation_tokens;
    p.billed_tokens = r.billed_tokens;
    p.turns = r.turns;
    p.peak_prefix_tokens = r.peak_prefix_tokens;
    p.cache_pressure = r.peak_prefix_tokens > CACHE_PRESSURE_PEAK_TOKENS;
    p.cost_usd = r.cost_usd;
    p.usage_source = "transcript";
    enriched.push(p.phase);
  }

  // If NOTHING resolved to a transcript, do not clobber the pre-enrich telemetry
  // (aggregate tokens / null cost) with recomputed zeros or a misleading
  // cost_basis:"transcript". Leave the file untouched and report the skip so the
  // caller can surface it instead of silently reporting $0.00.
  if (!enriched.length) {
    return { telPath, enriched, skipped, total_cost_usd: tel.total_cost_usd ?? null,
      overhead_cost_usd: null, overhead_window_fallback: false, skipped_all: true };
  }

  // Resolve the orchestrator session transcript for overhead accounting. Explicit
  // --session wins (backfill); otherwise derive it from a resolved phase transcript
  // (…/<session>/subagents/agent-<id>.jsonl → …/<session>.jsonl), so forward runs
  // get overhead without the orchestrator having to know its own transcript path.
  let sessionTranscript = opts.sessionTranscript;
  if (!sessionTranscript && firstResolved) {
    subagentsDir = subagentsDir || dirname(firstResolved);
    const cand = `${dirname(subagentsDir)}.jsonl`;
    if (existsSync(cand)) sessionTranscript = cand;
  }

  // Orchestration overhead = orchestrator main-loop turns + non-phase/nested subagents.
  let overhead = null, overheadWindowFallback = false;
  if (sessionTranscript) {
    const paths = [];
    const phaseIds = new Set([].concat(...[...byPhase.values()], ...phases.map((p) => (Array.isArray(p.agent_id) ? p.agent_id : p.agent_id ? [p.agent_id] : []))));
    if (subagentsDir && existsSync(subagentsDir)) {
      for (const f of readdirSync(subagentsDir)) {
        const m = f.match(/^agent-([a-f0-9]{12,})\.jsonl$/);
        if (m && !phaseIds.has(m[1])) paths.push(join(subagentsDir, f));
      }
    }
    const nested = priceTranscripts(paths, registry);
    // Bound the orchestrator's own turns to the run window so a long-lived session
    // (activity before/after this run) doesn't inflate the run's overhead. Source the
    // window from the MACHINE-written .checkpoint/_started_at epoch (+ wall_clock),
    // NOT the model-authored started_at/completed_at ISO strings — the orchestrator
    // can transcribe those wrong, and a window that misses the transcript silently
    // zeroes the largest cost bucket (ADR-0007).
    const win = overheadWindow(runDir, tel);
    let main = priceMainLoop(sessionTranscript, registry, win);
    // Defense in depth: if the window excluded EVERY main-loop turn but the
    // transcript genuinely has some, the window is wrong — recover the real cost
    // from the whole transcript and flag it so the caller can WARN rather than
    // silently report $0 orchestration overhead.
    if (main.turns === 0) {
      const unbounded = priceMainLoop(sessionTranscript, registry, {});
      if (unbounded.turns > 0) { main = unbounded; overheadWindowFallback = true; }
    }
    overhead = {
      cost_usd: round2((main.cost_usd || 0) + (nested.cost_usd || 0)),
      main_loop: main,
      nested_subagents: nested,
    };
    tel.orchestration_overhead = overhead;
  }

  // Totals.
  const sum = (key) => enrichedPhaseSum(phases, key);
  tel.total_input_tokens = sum("input_tokens");
  tel.total_output_tokens = sum("output_tokens");
  tel.total_cached_input_tokens = sum("cached_input_tokens");
  tel.total_cache_creation_tokens = sum("cache_creation_tokens");
  const phaseCost = phases.reduce((a, p) => a + (p.usage_source === "transcript" && p.cost_usd != null ? p.cost_usd : 0), 0);
  tel.total_cost_usd = round2(phaseCost + (overhead ? overhead.cost_usd : 0));
  const denom = tel.total_input_tokens + tel.total_cached_input_tokens;
  tel.cache_hit_ratio = denom > 0 ? Math.round((tel.total_cached_input_tokens / denom) * 100) / 100 : null;
  tel.cost_basis = "transcript";

  writeFileSync(telPath, JSON.stringify(tel, null, 2) + "\n");
  return { telPath, enriched, skipped, total_cost_usd: tel.total_cost_usd,
    overhead_cost_usd: overhead ? overhead.cost_usd : null, overhead_window_fallback: overheadWindowFallback };
}

/**
 * The window used to bound the orchestrator's own (main-loop) turns for overhead
 * pricing. Prefer the authoritative MACHINE-written epoch anchor
 * (<runDir>/.checkpoint/_started_at, written by orchestrator Step 2 via `date +%s`)
 * plus `wall_clock_seconds`; fall back to the model-authored started_at/completed_at
 * only when no usable anchor exists. This decouples cost accounting from the model's
 * fallible ISO-timestamp transcription in Step 5 — a wrong absolute start there used
 * to move the window off the real turns and zero the overhead (ADR-0007).
 */
function overheadWindow(runDir, tel) {
  let since = tel.started_at, until = tel.completed_at;
  try {
    const ep = Number(readFileSync(join(runDir, ".checkpoint", "_started_at"), "utf8").trim());
    if (Number.isFinite(ep) && ep > 0) {
      const startMs = ep * 1000;
      since = new Date(startMs).toISOString();
      const wall = num(tel.wall_clock_seconds);
      until = wall > 0 ? new Date(startMs + wall * 1000).toISOString() : tel.completed_at;
    }
  } catch { /* no readable anchor — keep the telemetry ISO window */ }
  return { since, until };
}

function priceMainLoop(sessionTranscriptPath, registry, window = {}) {
  const { byModel } = extractUsage(sessionTranscriptPath, { onlyMainLoop: true, ...window });
  const total = zeroUsage();
  let cost = 0, anyPriced = false;
  const models = new Set();
  for (const [model, u] of Object.entries(byModel)) {
    models.add(model);
    for (const k of Object.keys(total)) total[k] = k === "peak_prefix_tokens" ? Math.max(total[k], u[k]) : total[k] + u[k];
    const c = priceUsage(u, model, registry);
    if (c != null) { cost += c; anyPriced = true; }
  }
  return {
    model: [...models].join(", ") || null,
    input_tokens: total.input_tokens, output_tokens: total.output_tokens,
    cached_input_tokens: total.cache_read_tokens,
    cache_creation_tokens: total.cache_write_5m_tokens + total.cache_write_1h_tokens,
    turns: total.turns, cost_usd: anyPriced ? round2(cost) : null,
  };
}

function enrichedPhaseSum(phases, key) {
  return phases.reduce((a, p) => a + (p.usage_source === "transcript" ? num(p[key]) : 0), 0);
}

// ── small helpers ──────────────────────────────────────────────────────────────

function round2(n) { return Math.round(n * 100) / 100; }

function* readLines(path) {
  // Stream-ish: split the file once but yield lazily so callers can break early.
  const text = readFileSync(path, "utf8");
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") { yield text.slice(start, i); start = i + 1; }
  }
  if (start < text.length) yield text.slice(start);
}

/** Recursive-ish glob for JSONL paths under root matching a regex on the full path. */
function globJsonl(root, re, depth = 6) {
  const out = [];
  const walk = (dir, d) => {
    if (d < 0) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, d - 1);
      else if (re.test(full)) out.push(full);
    }
  };
  walk(root, depth);
  return out;
}
