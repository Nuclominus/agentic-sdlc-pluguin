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
//   <config-dir>/projects/<encoded-cwd>/<sessionId>/subagents/agent-<agentId>.jsonl
// Every assistant turn there carries a `message.usage` block
// (`input_tokens` = uncached input, `cache_read_input_tokens`,
// `cache_creation_input_tokens` with an `ephemeral_5m`/`ephemeral_1h` split, and
// `output_tokens`). Summed across turns and priced against the model registry,
// that yields the authoritative per-phase cost. ADR-0005 supersedes ADR-0004.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";

// ── config dir ──────────────────────────────────────────────────────────────

/**
 * The active Claude config dir. NEVER assume the home default: under a custom
 * `CLAUDE_CONFIG_DIR` (CI containers, per-project configs, the bench harness)
 * the home tree belongs to a different install, and reading it silently mixes
 * two plugin trees in one run — issue #70. See plugins/sdlc/PLUGIN-PATHS.md.
 */
export function claudeConfigDir(env = process.env) {
  const explicit = env.CLAUDE_CONFIG_DIR;
  if (explicit) return explicit;
  // The running plugin's own root is ground truth when the harness exported it.
  const root = env.CLAUDE_PLUGIN_ROOT;
  const at = root ? root.indexOf("/plugins/cache/") : -1;
  if (at > 0) return root.slice(0, at);
  return join(homedir(), ".claude");
}

// ── registry ────────────────────────────────────────────────────────────────

const defaultRegistry = () => join(claudeConfigDir(), "plugins", "cache");

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
  const hits = globJsonl(defaultRegistry(), /\/sdlc\/config\/models\.json$/);
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
 * Resolve registry pricing for a transcript's model id, tolerating decorations
 * an inference platform or the harness may attach that are not literal registry
 * keys: a bracketed context tag (`claude-opus-4-8[1m]`), a trailing dated
 * snapshot (`claude-sonnet-5-20260115`), a Bedrock-style region/provider prefix
 * (`us.anthropic.claude-opus-4-8`, `anthropic.claude-opus-4-8`), or a trailing
 * Bedrock version suffix (`claude-opus-4-8-v1:0`). The exact id is tried first,
 * so a registry key that legitimately IS dated (e.g. `claude-haiku-4-5-20251001`)
 * still matches. Decorations are stripped to a fixed point so combinations —
 * e.g. a prefixed AND dated AND versioned Bedrock id — still resolve once fully
 * normalised, not just single-decoration cases.
 *
 * ORDER MATTERS: the registry is probed after every individual strip, and the
 * date stripper is deliberately LAST. Bracket/version/prefix are never part of
 * a registry key, but a date can be (`claude-haiku-4-5-20251001`) — stripping
 * the date before the prefix means the probe sequence for
 * `us.anthropic.claude-haiku-4-5-20251001` never visits the bare dated id, and
 * the one dated registry key becomes unreachable from its Bedrock shape
 * (PR #77 review finding 1). Never-a-key decorations first, date last.
 * Returns the pricing object, `null` for a known-but-unpriced model, or `null`
 * when the id is unknown even after normalisation.
 */
const MODEL_ID_STRIPPERS = [
  (s) => s.replace(/\[[^\]]*\]$/, ""),                 // trailing context tag: [1m]
  (s) => s.replace(/-v\d+:\d+$/, ""),                  // trailing Bedrock version: -v1:0
  (s) => s.replace(/^[a-z]{2}\.anthropic\./, "").replace(/^anthropic\./, ""), // us.anthropic. / anthropic. prefix
  (s) => s.replace(/-\d{8}$/, ""),                     // trailing dated snapshot: -20260115 — LAST (see above)
];

export function lookupPricing(modelId, registry) {
  if (modelId == null) return null;
  let norm = String(modelId);
  let P = registry.byId.get(norm);
  if (P !== undefined) return P;
  let changed = true;
  while (changed) {
    changed = false;
    for (const strip of MODEL_ID_STRIPPERS) {
      const next = strip(norm);
      if (next === norm) continue;
      norm = next;
      changed = true;
      P = registry.byId.get(norm);
      if (P !== undefined) return P;
    }
  }
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
 *   2. <config-dir>/projects/<cwd>/<session>/subagents/agent-<id>.jsonl (session-nested)
 *   3. <config-dir>/projects/<cwd>/subagents/agent-<id>.jsonl (flat)
 * where <config-dir> is claudeConfigDir() — NOT unconditionally the home default.
 */
export function findAgentTranscript(agentId, { subagentsDir, projectsRoot } = {}) {
  const name = `agent-${agentId}.jsonl`;
  if (subagentsDir) {
    const p = join(subagentsDir, name);
    if (existsSync(p)) return p;
  }
  const root = projectsRoot || join(claudeConfigDir(), "projects");
  const hits = globJsonl(root, new RegExp(`/subagents/${name.replace(/[.]/g, "\\.")}$`));
  return hits[0] || null;
}

/**
 * The version of the plugin this enricher shipped in, read from its own manifest.
 *
 * Stamped into telemetry so a later compliance audit can tell whether a mandated
 * step had actually reached this install, rather than inferring it from a commit
 * date in the marketplace repo. Read here, by the machine that already holds the
 * value — asking the orchestrator to `cat` the manifest and copy the number into
 * JSON would add exactly the class of hand-transcribed machine value that the
 * instruction-fidelity work exists to remove.
 *
 * Best-effort: a missing or malformed manifest yields null, never a throw. Pricing
 * must not fail over a diagnostic field.
 */
function pluginVersion() {
  try {
    const manifest = new URL("../../.claude-plugin/plugin.json", import.meta.url);
    const v = JSON.parse(readFileSync(manifest, "utf8")).version;
    return typeof v === "string" ? v : null;
  } catch { return null; }
}

/** subagents dir for a session transcript path .../projects/<cwd>/<sid>.jsonl */
export function sessionSubagentsDir(sessionTranscriptPath) {
  const dir = dirname(sessionTranscriptPath);
  const sid = basename(sessionTranscriptPath).replace(/\.jsonl$/, "");
  return join(dir, sid, "subagents");
}

/** Every subagent id this run is known to have dispatched, from telemetry + checkpoints. */
export function knownRunAgentIds(runDir, phases) {
  const ids = new Set();
  for (const p of phases || []) {
    const a = p.agent_id ?? checkpointAgentId(runDir, p);
    for (const id of Array.isArray(a) ? a : a ? [a] : []) ids.add(id);
  }
  return ids;
}

/**
 * Does this session transcript actually belong to this run?
 *
 * The harness files a session under the cwd it STARTED in, not the cwd it ends up
 * working in. A pipeline that moves into a git worktree mid-session — which is the
 * normal shape for /sdlc:batch and for any worktree-isolated run — therefore has its
 * transcript filed under the ORIGINAL project dir, while a caller deriving `--session`
 * from the current cwd looks under the worktree's project dir and finds a stranger's
 * session. Phase costs survive that (findAgentTranscript globs the whole projects
 * root), but orchestration overhead is priced from the session's own main loop: a
 * mismatched session silently swaps in an unrelated main loop and can under-report the
 * run's largest single cost bucket by an order of magnitude. Wrong is worse than absent
 * here — with no session at all, enrichTelemetry recovers the real one by walking back
 * from a resolved phase transcript.
 *
 * Ownership test: at least one of the run's known agent ids has a transcript in this
 * session's own subagents dir. When the run has NO known ids (a backfill where neither
 * telemetry nor the checkpoints carry `agent_id`), the session's dispatch map is the
 * only thing that can supply them — there is nothing to check it against, so trust it.
 */
export function sessionOwnsRun(sessionTranscriptPath, runDir, phases) {
  const ids = knownRunAgentIds(runDir, phases);
  if (!ids.size) return true;
  const dir = sessionSubagentsDir(sessionTranscriptPath);
  if (!existsSync(dir)) return false;
  for (const id of ids) if (existsSync(join(dir, `agent-${id}.jsonl`))) return true;
  return false;
}

/**
 * Recover a phase's subagent id from its run checkpoint when _telemetry.json
 * lacks `agent_id` (the orchestrator failed to propagate it — the primary
 * lost-cost bug). Matches <runDir>/.checkpoint/<file>.json to the phase by name,
 * separator-insensitive, preferring an exact phase(+aspect) match over a
 * phase-only match. Returns the recovered `agent_id` verbatim as read from the
 * checkpoint — a single id string, OR an array of ids when the checkpoint records
 * a multi-pass phase (e.g. a healed guarded phase) — or null if none is found.
 * Callers must handle both shapes; do not re-wrap the result in `[...]` blindly.
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

// ── in-run phase pricing (the cost-cap gate's source) ─────────────────────────

/**
 * Resolve a phase's agent id(s) to existing transcript paths, dropping ids that
 * were already priced for an earlier phase (a resumed subagent reused across two
 * passes has ONE transcript and must be charged exactly once).
 */
function resolvePhaseTranscripts(agentIds, { exclude, subagentsDir, projectsRoot } = {}) {
  const skip = exclude instanceof Set ? exclude : new Set(exclude || []);
  const resolved = (Array.isArray(agentIds) ? agentIds : [agentIds])
    .filter(Boolean)
    .filter((id) => !skip.has(id))
    .map((id) => ({ id, path: findAgentTranscript(id, { subagentsDir, projectsRoot }) }))
    .filter((x) => x.path);
  return { ids: resolved.map((x) => x.id), paths: resolved.map((x) => x.path) };
}

/**
 * Price ONE finished phase from its own subagent transcript(s), for use BETWEEN
 * phases — this is what the Step 3d-cap cost gate spends against.
 *
 * Why this exists separately from enrichTelemetry: the gate runs mid-pipeline,
 * when there is no `_telemetry.json` on disk yet (Step 5 writes it) and no other
 * phase to reconcile. The Agent result envelope this harness returns carries only
 * an aggregate `subagent_tokens` count, so the live capture in 3d-1 cannot price
 * a phase at all — it yields `null`, which the gate counts as $0, which made the
 * cap unenforceable at ANY value. The phase's real price is already on disk the
 * moment the agent returns; this reads it there.
 *
 * NEVER throws for a missing/unpriced transcript — it reports `resolved: false`
 * so the caller can fall back to the aggregate path instead of failing the run.
 * `resolved: false` always pairs with `cost_usd: null`: an unknown cost must not
 * reach the gate as a measured $0.
 */
export function phaseCost(agentIds, opts = {}) {
  const registry = opts.registry || loadRegistry(opts.registryPath);
  const subagentsDir = opts.subagentsDir ||
    (opts.sessionTranscript ? sessionSubagentsDir(opts.sessionTranscript) : undefined);
  const requested = (Array.isArray(agentIds) ? agentIds : [agentIds]).filter(Boolean);
  const miss = (reason) => ({
    resolved: false, reason, agent_id: requested, usage_source: null, cost_usd: null,
  });
  if (!requested.length) return miss("no-agent-id");

  const { ids, paths } = resolvePhaseTranscripts(requested, {
    exclude: opts.exclude, subagentsDir, projectsRoot: opts.projectsRoot,
  });
  if (!paths.length) return miss("no-transcript");

  const r = priceTranscripts(paths, registry);
  // Same rule as enrichTelemetry: a transcript whose model(s) are all unknown to
  // the registry is NOT a priced phase. Reporting it as `transcript` with a null
  // cost would claim a price it does not have.
  if (r.cost_usd == null) return miss("unpriced-model");

  return {
    resolved: true,
    reason: null,
    agent_id: ids,
    usage_source: "transcript",
    model: r.model,
    cost_usd: r.cost_usd,
    input_tokens: r.input_tokens,
    output_tokens: r.output_tokens,
    cached_input_tokens: r.cached_input_tokens,
    cache_creation_tokens: r.cache_creation_tokens,
    billed_tokens: r.billed_tokens,
    turns: r.turns,
    peak_prefix_tokens: r.peak_prefix_tokens,
    cache_pressure: r.peak_prefix_tokens > CACHE_PRESSURE_PEAK_TOKENS,
  };
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
  // A `--session` that does not belong to this run is discarded rather than trusted:
  // see sessionOwnsRun. Nulling it here lets the recovery below (walk back from a
  // resolved phase transcript) find the session that actually ran the pipeline.
  let sessionArg = opts.sessionTranscript || null;
  const sessionMismatch = !!sessionArg && !sessionOwnsRun(sessionArg, runDir, phases);
  if (sessionMismatch) sessionArg = null;
  if (sessionArg) {
    subagentsDir = sessionSubagentsDir(sessionArg);
    dispatch = deriveDispatchMap(sessionArg);
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
      // cp.agent_id can itself be a list (checkpoint schema: "when the phase ran
      // multiple passes", e.g. a healed guarded phase) — flatten instead of
      // re-wrapping, or a nested array here becomes a single bogus id downstream
      // (`agent-<arrayToString>.jsonl`, e.g. "agent-aaaa1111,bbbb3333.jsonl") that
      // never resolves to a real transcript file, silently dropping the phase's cost.
      if (cpId) ids = Array.isArray(cpId) ? cpId : [cpId];
    }
    if (!ids || !ids.length) { skipped.push(p.phase); continue; }
    // Drop ids already priced for an earlier phase: a two-pass phase can reuse
    // one resumed subagent whose single transcript must be counted exactly once.
    const { ids: usedIds, paths } = resolvePhaseTranscripts(ids, {
      exclude: pricedIds, subagentsDir, projectsRoot: opts.projectsRoot,
    });
    if (!paths.length) { skipped.push(p.phase); continue; }
    for (const id of usedIds) pricedIds.add(id);
    if (!firstResolved) firstResolved = paths[0];
    const r = priceTranscripts(paths, registry);
    // A resolved transcript whose model(s) are ALL unpriced (unknown even after
    // lookupPricing's normalisation) must not be reported as usage_source:
    // "transcript" with a null cost_usd — that pairing claims a priced
    // transcript while admitting it has no price. Treat it the same as "no
    // transcript resolved": leave the phase's pre-enrich aggregate fields
    // untouched and report the skip, rather than clobbering real fields with a
    // self-contradictory source label.
    if (r.cost_usd == null) { skipped.push(p.phase); continue; }
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
      overhead_cost_usd: null, overhead_window_fallback: false, session_mismatch: sessionMismatch,
      skipped_all: true };
  }

  // Resolve the orchestrator session transcript for overhead accounting. Explicit
  // --session wins (backfill); otherwise derive it from a resolved phase transcript
  // (…/<session>/subagents/agent-<id>.jsonl → …/<session>.jsonl), so forward runs
  // get overhead without the orchestrator having to know its own transcript path.
  let sessionTranscript = sessionArg;
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

  // Correct the run window against the machine anchor. Done AFTER overhead pricing, which
  // reads the anchor directly and is unaffected either way.
  const timestampsCorrected = reconcileRunWindow(tel, machineRunWindow(runDir, tel));

  // Totals.
  const sum = (key) => enrichedPhaseSum(phases, key);
  tel.total_input_tokens = sum("input_tokens");
  tel.total_output_tokens = sum("output_tokens");
  tel.total_cached_input_tokens = sum("cached_input_tokens");
  tel.total_cache_creation_tokens = sum("cache_creation_tokens");
  const phaseCostSum = phases.reduce((a, p) => a + (p.usage_source === "transcript" && p.cost_usd != null ? p.cost_usd : 0), 0);
  tel.total_cost_usd = round2(phaseCostSum + (overhead ? overhead.cost_usd : 0));
  const denom = tel.total_input_tokens + tel.total_cached_input_tokens;
  tel.cache_hit_ratio = denom > 0 ? Math.round((tel.total_cached_input_tokens / denom) * 100) / 100 : null;
  tel.cost_basis = "transcript";
  reconcileCapStatus(tel, phaseCostSum);

  // Rides the success path only: the zero-resolve branch above returns early
  // precisely to leave pre-enrich telemetry alone, and a diagnostic field is not a
  // reason to start writing on it.
  const pv = pluginVersion();
  if (pv) tel.plugin_version = pv;

  writeFileSync(telPath, JSON.stringify(tel, null, 2) + "\n");
  return { telPath, enriched, skipped, total_cost_usd: tel.total_cost_usd,
    overhead_cost_usd: overhead ? overhead.cost_usd : null, overhead_window_fallback: overheadWindowFallback,
    session_mismatch: sessionMismatch, timestamps_corrected: timestampsCorrected,
    cap_breach_usd: tel.cap_breach_usd ?? null, cap_status: tel.cap_status ?? null };
}

/**
 * Last line of defense for the cost cap. A run can finish over cap while still
 * reporting `cap_status: "within"` for TWO distinct reasons, and this function
 * catches both:
 *
 *   a. **The gate went blind.** Step 3d-1b could not price a phase (transcript
 *      unresolvable, no node, unpriced model), so it entered the gate as $0.
 *      Those phases carry `cap_gate_blind: true`. This is a defect.
 *   b. **The overage landed on the last dispatch.** Step 3d-cap only acts when a
 *      next dispatch exists — there is nothing left to stop after the final
 *      phase, and a single-phase recipe has no gate boundary at all. This is not
 *      a defect; it is the shape of a pre-dispatch gate, and no amount of
 *      pricing accuracy changes it.
 *
 * Read `cap_gate_blind` on the phases to tell them apart. Either way the run
 * exceeded its cap and nobody was asked, which is what `cap_status` must not
 * hide. Enrichment holds the real per-phase prices, so it is the last place the
 * record can be corrected before anyone reads it.
 *
 * Compared against PHASE spend only, never `total_cost_usd`: orchestration
 * overhead is deliberately outside the gate (see Step 5), and folding it in here
 * would retroactively re-tighten every recipe's cap.
 *
 * A verdict the gate already reached (`exceeded-continued` / `exceeded-aborted`)
 * is never overwritten — that one had a user in the loop and carries meaning this
 * function cannot reconstruct. Only a `"within"` that the numbers contradict is
 * corrected, to `"exceeded-undetected"`.
 */
function reconcileCapStatus(tel, phaseCostSum) {
  const cap = tel.cost_cap_usd;
  if (cap == null || !(phaseCostSum > cap)) return;
  tel.cap_breach_usd = round2(phaseCostSum - cap);
  if (tel.cap_status == null || tel.cap_status === "within") tel.cap_status = "exceeded-undetected";
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
  const { since, until } = machineRunWindow(runDir, tel);
  return { since, until };
}

/**
 * The run's wall-clock window, preferring the machine anchor over the model's prose.
 * Returns `anchored: true` only when `.checkpoint/_started_at` was readable.
 */
function machineRunWindow(runDir, tel) {
  let since = tel.started_at, until = tel.completed_at, anchored = false;
  try {
    const ep = Number(readFileSync(join(runDir, ".checkpoint", "_started_at"), "utf8").trim());
    if (Number.isFinite(ep) && ep > 0) {
      const startMs = ep * 1000;
      since = new Date(startMs).toISOString();
      const wall = num(tel.wall_clock_seconds);
      until = wall > 0 ? new Date(startMs + wall * 1000).toISOString() : tel.completed_at;
      anchored = true;
    }
  } catch { /* no readable anchor — keep the telemetry ISO window */ }
  return { since, until, anchored };
}

// A drift below this is rounding; above it the ISO strings were not derived from the anchor.
const RUN_WINDOW_TOLERANCE_MS = 120_000;

/**
 * Correct `started_at` / `completed_at` against the machine anchor.
 *
 * Step 5 tells the orchestrator to render both from `.checkpoint/_started_at` via `date -u -r`.
 * When it instead transcribes them by hand the result is confidently wrong: an observed run
 * recorded `started_at: "2026-07-28T14:24:17Z"` against an anchor of `11:04:17Z` — the local
 * EEST clock stamped `Z`, plus 20 minutes of drift — and derived `completed_at` from it, so the
 * record was internally consistent and externally false. Pricing already ignores these strings
 * (ADR-0007), but the report header, the journal and every cross-run rollup read them.
 *
 * Only the ISO strings are rewritten. `wall_clock_seconds` is the anchor's own arithmetic
 * (`end - start`) and is left alone; correcting the start while preserving the duration keeps
 * the two consistent.
 */
function reconcileRunWindow(tel, win) {
  if (!win.anchored || !win.since) return null;
  const stated = Date.parse(tel.started_at);
  const anchor = Date.parse(win.since);
  if (Number.isFinite(stated) && Math.abs(stated - anchor) <= RUN_WINDOW_TOLERANCE_MS) return null;
  const from = tel.started_at ?? null;
  tel.started_at = win.since;
  if (win.until) tel.completed_at = win.until;
  return { from, to: win.since, drift_seconds: Number.isFinite(stated) ? Math.round((stated - anchor) / 1000) : null };
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
