import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  loadRegistry, extractUsage, priceUsage, priceTranscripts,
  findAgentTranscript, sessionSubagentsDir, deriveDispatchMap, enrichTelemetry,
  phaseCost,
  CACHE_PRESSURE_PEAK_TOKENS,
} from "../lib/usage.mjs";

const REGISTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugins", "sdlc", "config", "models.json");
const reg = loadRegistry(REGISTRY);

// One assistant turn with a given usage block, as a Claude Code transcript line.
const turn = (model, usage, extra = {}) =>
  JSON.stringify({ type: "assistant", timestamp: "2026-07-07T13:40:00Z", ...extra, message: { role: "assistant", model, usage } });

function writeAgent(dir, id, lines) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `agent-${id}.jsonl`), lines.join("\n") + "\n");
  return join(dir, `agent-${id}.jsonl`);
}

test("extractUsage sums the split and honors the ephemeral 5m/1h cache-write breakdown", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const p = writeAgent(dir, "aaaaaaaaaaaa", [
    turn("claude-sonnet-5", { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 4000,
      cache_creation_input_tokens: 600, cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 100 } }),
    turn("claude-sonnet-5", { input_tokens: 50, output_tokens: 10, cache_read_input_tokens: 1000 }),
  ]);
  const { byModel, combined } = extractUsage(p);
  const u = byModel["claude-sonnet-5"];
  assert.equal(u.input_tokens, 150);
  assert.equal(u.output_tokens, 210);
  assert.equal(u.cache_read_tokens, 5000);
  assert.equal(u.cache_write_5m_tokens, 500);
  assert.equal(u.cache_write_1h_tokens, 100);
  assert.equal(u.turns, 2);
  assert.equal(combined.input_tokens, 150);
});

test("extractUsage with no TTL split treats the whole cache-creation count as 5m", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const p = writeAgent(dir, "bbbbbbbbbbbb", [
    turn("claude-opus-4-8", { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 800 }),
  ]);
  const u = extractUsage(p).byModel["claude-opus-4-8"];
  assert.equal(u.cache_write_5m_tokens, 800);
  assert.equal(u.cache_write_1h_tokens, 0);
});

test("extractUsage counts a multi-block assistant turn once (dedup on message.id)", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  // One API response (msg id "m1") logged as 3 content-block lines that all
  // repeat the SAME response-level usage — the real Claude Code transcript shape.
  const block = (content) => JSON.stringify({
    type: "assistant", uuid: content, timestamp: "2026-07-07T13:40:00Z",
    message: { role: "assistant", id: "m1", model: "claude-sonnet-5", content: [{ type: content }],
      usage: { input_tokens: 5, output_tokens: 8, cache_read_input_tokens: 15000, cache_creation_input_tokens: 1000 } },
  });
  // A genuinely distinct second call (msg id "m2").
  const second = JSON.stringify({
    type: "assistant", timestamp: "2026-07-07T13:40:01Z",
    message: { role: "assistant", id: "m2", model: "claude-sonnet-5", content: [{ type: "text" }],
      usage: { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 20000, cache_creation_input_tokens: 0 } },
  });
  const p = writeAgent(dir, "dedup0000000", [block("thinking"), block("tool_use"), block("tool_use"), second]);
  const u = extractUsage(p).byModel["claude-sonnet-5"];
  // Without dedup this would be 15000*3 + 20000 = 65000; with dedup it is 35000.
  assert.equal(u.cache_read_tokens, 35000, "m1 counted once, not per block");
  assert.equal(u.input_tokens, 8);
  assert.equal(u.output_tokens, 12);
  assert.equal(u.cache_write_5m_tokens, 1000);
  assert.equal(u.turns, 2, "two API calls, not four transcript lines");
});

test("extractUsage records peak_prefix_tokens as the max single-turn cache-read", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const p = writeAgent(dir, "peak00000000", [
    turn("claude-sonnet-5", { input_tokens: 5, output_tokens: 8, cache_read_input_tokens: 20000 }),
    turn("claude-sonnet-5", { input_tokens: 5, output_tokens: 8, cache_read_input_tokens: 90000 }),
    turn("claude-sonnet-5", { input_tokens: 5, output_tokens: 8, cache_read_input_tokens: 45000 }),
  ]);
  const u = extractUsage(p).byModel["claude-sonnet-5"];
  assert.equal(u.peak_prefix_tokens, 90000);
  assert.equal(u.turns, 3);
});

test("priceUsage applies input/cached/output rates and cache-write multipliers", () => {
  // sonnet pricing 2.00 / 0.20 / 10.00; multipliers 1.25 (5m), 2.0 (1h).
  const u = { input_tokens: 1_000_000, output_tokens: 2_000_000, cache_read_tokens: 4_000_000,
    cache_write_5m_tokens: 500_000, cache_write_1h_tokens: 100_000 };
  const cost = priceUsage(u, "claude-sonnet-5", reg);
  // 1*2 + 4*0.2 + 0.5*2*1.25 + 0.1*2*2 + 2*10 = 24.45
  assert.ok(Math.abs(cost - 24.45) < 1e-9, `got ${cost}`);
});

test("priceUsage returns null for a model with no registry pricing", () => {
  const fakeReg = { byId: new Map([["claude-x", null]]), multipliers: reg.multipliers };
  assert.equal(priceUsage({ input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 }, "claude-x", fakeReg), null);
});

test("priceTranscripts takes peak as max across transcripts and turns as the sum", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const a = writeAgent(dir, "planaaaa0000", [turn("claude-sonnet-5", { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 30000 })]);
  const b = writeAgent(dir, "implbbbb0000", [
    turn("claude-sonnet-5", { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 101000 }),
    turn("claude-sonnet-5", { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 60000 }),
  ]);
  const r = priceTranscripts([a, b], reg);
  assert.equal(r.peak_prefix_tokens, 101000);
  assert.equal(r.turns, 3);
});

test("deriveDispatchMap parses phase, subagent_type, and agent_id in dispatch order", () => {
  const dir = mkdtempSync(join(tmpdir(), "sess-"));
  const sess = join(dir, "sid.jsonl");
  writeFileSync(sess, [
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
      { type: "tool_use", id: "t1", name: "Agent", input: { subagent_type: "x:ba", description: "Phase 1/6: business_analysis" } }] } }),
    JSON.stringify({ type: "user", message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "t1", content: "Async agent launched. agentId: ac70de3f30beff161 ok" }] } }),
    JSON.stringify({ type: "assistant", message: { role: "assistant", content: [
      { type: "tool_use", id: "t2", name: "Agent", input: { subagent_type: "x:dev", description: "Phase 2/6: development plan" } }] } }),
    JSON.stringify({ type: "user", message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "t2", content: "agentId: a8123971f938c54cb" }] } }),
  ].join("\n") + "\n");
  const dm = deriveDispatchMap(sess);
  assert.equal(dm.length, 2);
  assert.deepEqual(dm.map((d) => d.phase), ["business_analysis", "development"]);
  assert.equal(dm[0].agent_id, "ac70de3f30beff161");
  assert.equal(dm[1].agent_id, "a8123971f938c54cb");
});

test("findAgentTranscript resolves via an explicit subagents dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "find-"));
  const sub = join(dir, "subagents");
  writeAgent(sub, "cccccccccccc", [turn("claude-haiku-4-5-20251001", { input_tokens: 1, output_tokens: 1 })]);
  assert.ok(findAgentTranscript("cccccccccccc", { subagentsDir: sub }));
  assert.equal(findAgentTranscript("nope000000000", { subagentsDir: sub }), null);
});

// End-to-end enrichment against a synthetic session + subagents + telemetry.
function buildRun() {
  const root = mkdtempSync(join(tmpdir(), "run-"));
  const proj = join(root, "proj");
  const sid = "0753771fdeadbeef";
  const sess = join(proj, `${sid}.jsonl`);
  const sub = join(proj, sid, "subagents");
  mkdirSync(dirname(sess), { recursive: true });
  // Session: 2 Agent dispatches + 1 in-window main-loop turn + 1 out-of-window turn.
  writeFileSync(sess, [
    JSON.stringify({ type: "assistant", timestamp: "2026-07-07T13:30:00Z", message: { role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0 }, content: [
      { type: "tool_use", id: "t1", name: "Agent", input: { subagent_type: "x:ba", description: "Phase 1/6: business_analysis" } }] } }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "agentId: aaaa11112222" }] } }),
    JSON.stringify({ type: "assistant", timestamp: "2026-07-07T13:35:00Z", message: { role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 0 }, content: [
      { type: "tool_use", id: "t2", name: "Agent", input: { subagent_type: "x:dev", description: "Phase 2/6: development" } }] } }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t2", content: "agentId: bbbb33334444" }] } }),
    // Out-of-window main-loop turn (after completed_at) — must be excluded from overhead.
    turn("claude-opus-4-8", { input_tokens: 9_000_000, output_tokens: 9_000_000, cache_read_input_tokens: 0 }, { timestamp: "2026-07-07T20:00:00Z" }),
  ].join("\n") + "\n");
  writeAgent(sub, "aaaa11112222", [turn("claude-opus-4-8", { input_tokens: 100000, output_tokens: 5000, cache_read_input_tokens: 200000, cache_creation_input_tokens: 50000 })]);
  writeAgent(sub, "bbbb33334444", [turn("claude-sonnet-5", { input_tokens: 20, output_tokens: 4000, cache_read_input_tokens: 1000000, cache_creation_input_tokens: 80000 })]);
  // A nested/non-phase subagent (not in the dispatch map) → orchestration overhead.
  writeAgent(sub, "dddd55556666", [turn("claude-haiku-4-5-20251001", { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 5000 })]);

  const runDir = join(root, "plan");
  mkdirSync(runDir, { recursive: true });
  const projectsRoot = root; // findAgentTranscript globs here in forward mode
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
    task_slug: "demo", started_at: "2026-07-07T13:28:00Z", completed_at: "2026-07-07T14:16:00Z",
    phases: [
      { phase: "business_analysis", agent: "x-ba", model: "claude-opus-4-8", status: "completed", subagent_tokens: 5000, usage_source: "subagent_aggregate", cost_usd: null },
      { phase: "development", agent: "x-dev", model: "claude-sonnet-5", status: "completed", subagent_tokens: 6000, usage_source: "subagent_aggregate", cost_usd: null },
    ],
    total_subagent_tokens: 11000, total_cost_usd: null, cache_hit_ratio: null,
  }, null, 2));
  return { runDir, sess, projectsRoot };
}

test("enrichTelemetry patches real per-phase cost + totals and window-bounds overhead", () => {
  const { runDir, sess } = buildRun();
  const r = enrichTelemetry(runDir, { sessionTranscript: sess, registry: reg });
  assert.deepEqual(r.enriched.sort(), ["business_analysis", "development"]);
  assert.deepEqual(r.skipped, []);

  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  const ba = tel.phases.find((p) => p.phase === "business_analysis");
  assert.equal(ba.usage_source, "transcript");
  assert.equal(ba.agent_id, "aaaa11112222");
  assert.equal(ba.input_tokens, 100000);
  assert.equal(ba.cached_input_tokens, 200000);
  assert.equal(ba.cache_creation_tokens, 50000);
  assert.equal(ba.billed_tokens, 100000 + 5000 + 200000 + 50000);
  assert.ok(ba.cost_usd > 0);

  // Totals reflect real usage; cost is positive and finite.
  assert.equal(tel.total_input_tokens, 100020);
  assert.equal(tel.total_cached_input_tokens, 1200000);
  assert.ok(tel.total_cost_usd > 0);
  assert.equal(tel.cost_basis, "transcript");
  assert.ok(tel.cache_hit_ratio > 0.9);

  // Overhead present; main-loop bounded to the run window (out-of-window 9M/9M turn excluded).
  const oh = tel.orchestration_overhead;
  assert.ok(oh && oh.cost_usd > 0);
  assert.equal(oh.main_loop.turns, 2, "only the two in-window orchestrator turns counted");
  assert.ok(oh.nested_subagents.cost_usd >= 0);
  // total = phase costs + overhead, all real.
  const phaseCost = tel.phases.reduce((a, p) => a + (p.cost_usd || 0), 0);
  assert.ok(Math.abs(tel.total_cost_usd - (phaseCost + oh.cost_usd)) < 0.02);
});

test("enrichTelemetry works forward-mode from recorded agent_id (no --session), auto-deriving overhead", () => {
  const { runDir, projectsRoot } = buildRun();
  // Record agent_ids on phases (as Step 3d-1 would), then enrich without a session path.
  const tel0 = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  tel0.phases[0].agent_id = "aaaa11112222";
  tel0.phases[1].agent_id = "bbbb33334444";
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify(tel0));
  const r = enrichTelemetry(runDir, { registry: reg, projectsRoot });
  assert.deepEqual(r.enriched.sort(), ["business_analysis", "development"]);
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  assert.ok(tel.total_cost_usd > 0);
  // overhead auto-derived from the sibling session transcript
  assert.ok(tel.orchestration_overhead && tel.orchestration_overhead.cost_usd > 0);
});

test("enrichTelemetry skips a phase with no locatable transcript, keeping its aggregate", () => {
  const { runDir, projectsRoot } = buildRun();
  const tel0 = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  tel0.phases[0].agent_id = "aaaa11112222";
  tel0.phases[1].agent_id = "0000nonexistent0";
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify(tel0));
  const r = enrichTelemetry(runDir, { registry: reg, projectsRoot });
  assert.deepEqual(r.enriched, ["business_analysis"]);
  assert.deepEqual(r.skipped, ["development"]);
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  assert.equal(tel.phases[1].usage_source, "subagent_aggregate");
  assert.equal(tel.phases[1].cost_usd, null);
});

test("enrichTelemetry sets turns, peak_prefix_tokens and cache_pressure per phase", () => {
  const { runDir, sess } = buildRun();
  enrichTelemetry(runDir, { sessionTranscript: sess, registry: reg });
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  const dev = tel.phases.find((p) => p.phase === "development");   // agent bbbb33334444, cache_read 1_000_000
  assert.equal(dev.turns, 1);
  assert.equal(dev.peak_prefix_tokens, 1000000);
  assert.equal(dev.cache_pressure, true);
  const ba = tel.phases.find((p) => p.phase === "business_analysis"); // cache_read 200_000 < 80k? no, 200k > 80k
  assert.equal(ba.cache_pressure, true);
});

test("enrichTelemetry flags cache_pressure=false when peak stays under the threshold", () => {
  // Self-contained minimal run (own tmp session + one subagent) so the false
  // branch is exercised without disturbing buildRun() or the other enrich tests.
  const root = mkdtempSync(join(tmpdir(), "run-"));
  const sub = join(root, "proj", "sess", "subagents");
  // Single transcript-derived phase; peak single-turn cache-read 60k ≤ 80k threshold.
  writeAgent(sub, "eeee66667777", [
    turn("claude-sonnet-5", { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 60000 }),
  ]);
  const runDir = join(root, "plan");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
    task_slug: "low", started_at: "2026-07-07T13:28:00Z", completed_at: "2026-07-07T14:16:00Z",
    phases: [
      { phase: "development", agent: "x-dev", model: "claude-sonnet-5", status: "completed",
        agent_id: "eeee66667777", subagent_tokens: 100, usage_source: "subagent_aggregate", cost_usd: null },
    ],
    total_subagent_tokens: 100, total_cost_usd: null, cache_hit_ratio: null,
  }, null, 2));
  enrichTelemetry(runDir, { registry: reg, projectsRoot: root });
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  const dev = tel.phases.find((p) => p.phase === "development");
  assert.equal(dev.usage_source, "transcript");
  assert.equal(dev.turns, 1);
  assert.equal(dev.peak_prefix_tokens, 60000);
  assert.equal(dev.cache_pressure, false);
});

test("cache-pressure budget is pinned at 80k", () => {
  // A documented budget, not an incidental constant: moving it changes which
  // phases the report and AAR flag, and breaks cross-run comparability.
  assert.equal(CACHE_PRESSURE_PEAK_TOKENS, 80_000);
});

// Build a one-phase run whose single turn has an exact peak cache-read, and
// return the enriched phase. Mirrors the self-contained pattern used by the
// "flags cache_pressure=false" test above.
function enrichWithPeak(agentId, peak) {
  const root = mkdtempSync(join(tmpdir(), "run-"));
  const sub = join(root, "proj", "sess", "subagents");
  writeAgent(sub, agentId, [
    turn("claude-sonnet-5", { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: peak }),
  ]);
  const runDir = join(root, "plan");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
    task_slug: "boundary", started_at: "2026-07-07T13:28:00Z", completed_at: "2026-07-07T14:16:00Z",
    phases: [
      { phase: "development", agent: "x-dev", model: "claude-sonnet-5", status: "completed",
        agent_id: agentId, subagent_tokens: 100, usage_source: "subagent_aggregate", cost_usd: null },
    ],
    total_subagent_tokens: 100, total_cost_usd: null, cache_hit_ratio: null,
  }));
  enrichTelemetry(runDir, { registry: reg, projectsRoot: join(root, "proj") });
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  return tel.phases[0];
}

test("one token under the budget is not flagged", () => {
  assert.equal(enrichWithPeak("aaaa11112222", CACHE_PRESSURE_PEAK_TOKENS - 1).cache_pressure, false);
});

test("exactly at the budget is not flagged (strict greater-than)", () => {
  assert.equal(enrichWithPeak("bbbb22223333", CACHE_PRESSURE_PEAK_TOKENS).cache_pressure, false);
});

test("one token over the budget is flagged", () => {
  assert.equal(enrichWithPeak("cccc33334444", CACHE_PRESSURE_PEAK_TOKENS + 1).cache_pressure, true);
});

test("priceUsage tolerates a bracketed context suffix and a dated snapshot id", () => {
  const u = { input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 };
  const opus = priceUsage(u, "claude-opus-4-8", reg);
  const sonnet = priceUsage(u, "claude-sonnet-5", reg);
  assert.ok(opus > 0 && sonnet > 0);
  // A [1m] context tag and a dated snapshot both resolve to the base model's price.
  assert.equal(priceUsage(u, "claude-opus-4-8[1m]", reg), opus);
  assert.equal(priceUsage(u, "claude-sonnet-5-20260115", reg), sonnet);
  // A genuinely unknown model is still unpriced.
  assert.equal(priceUsage(u, "gpt-5", reg), null);
});

test("priceUsage tolerates a Bedrock region prefix and version suffix, alone or combined", () => {
  const u = { input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 };
  const opus = priceUsage(u, "claude-opus-4-8", reg);
  assert.ok(opus > 0);
  assert.equal(priceUsage(u, "us.anthropic.claude-opus-4-8", reg), opus);
  assert.equal(priceUsage(u, "anthropic.claude-opus-4-8", reg), opus);
  assert.equal(priceUsage(u, "claude-opus-4-8-v1:0", reg), opus);
  // Prefix + date + version all stacked, in the real Bedrock cross-region shape.
  assert.equal(priceUsage(u, "us.anthropic.claude-opus-4-8-20260115-v1:0", reg), opus);

  // The dated-registry-key case (PR #77 review finding 1): haiku's canonical id
  // IS dated, so the date stripper must run AFTER the prefix stripper — date-first
  // never probes the bare `claude-haiku-4-5-20251001` and the only dated registry
  // key becomes unreachable from every Bedrock shape. Haiku is a pipeline tier;
  // this was a silent cost drop, and the opus-only cases above cannot catch it
  // (opus's registry key is undated, so any strip order resolves it).
  const haiku = priceUsage(u, "claude-haiku-4-5-20251001", reg);
  assert.ok(haiku > 0);
  assert.equal(priceUsage(u, "us.anthropic.claude-haiku-4-5-20251001", reg), haiku);
  assert.equal(priceUsage(u, "us.anthropic.claude-haiku-4-5-20251001-v1:0", reg), haiku);
});

test("enrichTelemetry prices an opus-tier phase whose transcript model carries a Bedrock region prefix", () => {
  // Reproduces the observed bug: business_analysis and security run on the opus
  // tier; their transcripts recorded the model id in the Bedrock cross-region
  // inference-profile shape (`us.anthropic.<id>`). Before the lookupPricing fix,
  // that id silently failed to match the registry's "claude-opus-4-8" entry, so
  // the phase ended up with usage_source:"transcript" (a real transcript WAS
  // resolved) and cost_usd:null (nothing in it could be priced) — the exact
  // self-contradictory pairing from the bug report. It must now resolve to a
  // real, non-null cost.
  const root = mkdtempSync(join(tmpdir(), "opus-prefix-"));
  const sub = join(root, "proj", "sess", "subagents");
  writeAgent(sub, "ffaa11112222", [
    turn("us.anthropic.claude-opus-4-8", { input_tokens: 5000, output_tokens: 1200, cache_read_input_tokens: 20000, cache_creation_input_tokens: 3000 }),
  ]);
  const runDir = join(root, "plan");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
    task_slug: "opus-prefix", started_at: "2026-07-07T13:28:00Z", completed_at: "2026-07-07T14:16:00Z",
    phases: [
      { phase: "business_analysis", agent: "x-ba", model: "claude-opus-4-8", status: "completed",
        agent_id: "ffaa11112222", subagent_tokens: 500, usage_source: "subagent_aggregate", cost_usd: null },
    ],
    total_subagent_tokens: 500, total_cost_usd: null, cache_hit_ratio: null,
  }, null, 2));
  const r = enrichTelemetry(runDir, { registry: reg, projectsRoot: root });
  assert.deepEqual(r.enriched, ["business_analysis"], "phase resolved a transcript and was priced, not skipped");
  assert.deepEqual(r.skipped, []);
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  const ba = tel.phases[0];
  assert.equal(ba.usage_source, "transcript");
  assert.ok(ba.cost_usd != null && ba.cost_usd > 0, `expected a real priced cost, got ${ba.cost_usd}`);
});

test("enrichTelemetry does not claim usage_source:\"transcript\" when the transcript's model is genuinely unpriced", () => {
  // Defense in depth for the other half of the contract: a transcript that DOES
  // resolve but whose model is absent from the registry even after lookupPricing's
  // normalisation must not be reported as a priced transcript with a null cost —
  // it must be treated like "no transcript resolved" (skipped, aggregate untouched).
  const root = mkdtempSync(join(tmpdir(), "unpriced-"));
  const sub = join(root, "proj", "sess", "subagents");
  writeAgent(sub, "zzzz99998888", [
    turn("claude-nonexistent-9", { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0 }),
  ]);
  const runDir = join(root, "plan");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
    task_slug: "unpriced", started_at: "2026-07-07T13:28:00Z", completed_at: "2026-07-07T14:16:00Z",
    phases: [
      { phase: "business_analysis", agent: "x-ba", model: "claude-nonexistent-9", status: "completed",
        agent_id: "zzzz99998888", subagent_tokens: 40, usage_source: "subagent_aggregate", cost_usd: null },
    ],
    total_subagent_tokens: 40, total_cost_usd: null, cache_hit_ratio: null,
  }, null, 2));
  const r = enrichTelemetry(runDir, { registry: reg, projectsRoot: root });
  assert.deepEqual(r.enriched, []);
  assert.deepEqual(r.skipped, ["business_analysis"]);
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  assert.equal(tel.phases[0].usage_source, "subagent_aggregate", "not falsely claimed as transcript");
  assert.equal(tel.phases[0].cost_usd, null);
});

test("enrichTelemetry recovers agent_id from the run checkpoint when telemetry omits it", () => {
  const root = mkdtempSync(join(tmpdir(), "cp-"));
  const sub = join(root, "proj", "sess", "subagents");
  writeAgent(sub, "ccee11112222", [turn("claude-sonnet-5", { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 1000 })]);
  const runDir = join(root, "plan");
  mkdirSync(join(runDir, ".checkpoint"), { recursive: true });
  // The checkpoint carries the id; the telemetry phase does NOT.
  writeFileSync(join(runDir, ".checkpoint", "security.json"), JSON.stringify({ phase: "security", agent_id: "ccee11112222", status: "completed" }));
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
    task_slug: "cp", started_at: "2026-07-07T13:28:00Z", completed_at: "2026-07-07T14:16:00Z",
    phases: [{ phase: "security", agent: "x-sec", model: "claude-sonnet-5", status: "completed", subagent_tokens: 300, usage_source: "subagent_aggregate", cost_usd: null }],
    total_subagent_tokens: 300, total_cost_usd: null, cost_basis: "subagent_aggregate", cache_hit_ratio: null,
  }, null, 2));
  const r = enrichTelemetry(runDir, { registry: reg, projectsRoot: root });
  assert.deepEqual(r.enriched, ["security"]);
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  assert.equal(tel.phases[0].usage_source, "transcript");
  assert.equal(tel.phases[0].agent_id, "ccee11112222");
  assert.ok(tel.phases[0].cost_usd > 0);
  assert.equal(tel.cost_basis, "transcript");
});

test("enrichTelemetry recovers cost when the checkpoint's agent_id is an ARRAY (G1 healed guarded phase)", () => {
  // A guarded phase that healed at least once records a LIST agent_id on its
  // checkpoint (3d-1: "append the new agent_id to this unit's agent_id"). When
  // telemetry omits agent_id, checkpointAgentId() must recover the array intact
  // so the call site can flatten it — not re-wrap it into a nested array, which
  // would build an unresolvable filename like "agent-dddd1111,eeee2222.jsonl"
  // and silently drop the phase's real cost into `skipped`.
  const root = mkdtempSync(join(tmpdir(), "cp-arr-"));
  const sub = join(root, "proj", "sess", "subagents");
  writeAgent(sub, "dddd11112222", [turn("claude-sonnet-5", { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 1000 })]);
  writeAgent(sub, "eeee33334444", [turn("claude-sonnet-5", { input_tokens: 50, output_tokens: 80, cache_read_input_tokens: 2000, cache_creation_input_tokens: 500 })]);
  const runDir = join(root, "plan");
  mkdirSync(join(runDir, ".checkpoint"), { recursive: true });
  // The checkpoint carries a LIST (phase healed once: original attempt + heal
  // re-dispatch); the telemetry phase does NOT carry agent_id at all.
  writeFileSync(join(runDir, ".checkpoint", "security.json"), JSON.stringify({
    phase: "security", agent_id: ["dddd11112222", "eeee33334444"], status: "completed",
    heal_attempts_used: 1, heal_status: "healed",
  }));
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
    task_slug: "cp-arr", started_at: "2026-07-07T13:28:00Z", completed_at: "2026-07-07T14:16:00Z",
    phases: [{ phase: "security", agent: "x-sec", model: "claude-sonnet-5", status: "completed", subagent_tokens: 300, usage_source: "subagent_aggregate", cost_usd: null }],
    total_subagent_tokens: 300, total_cost_usd: null, cost_basis: "subagent_aggregate", cache_hit_ratio: null,
  }, null, 2));
  const r = enrichTelemetry(runDir, { registry: reg, projectsRoot: root });
  assert.deepEqual(r.enriched, ["security"], "phase resolved a transcript, not skipped");
  assert.deepEqual(r.skipped, []);
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  assert.equal(tel.phases[0].usage_source, "transcript");
  assert.deepEqual(tel.phases[0].agent_id, ["dddd11112222", "eeee33334444"]);
  assert.ok(tel.phases[0].cost_usd > 0, "real cost resolved, not dropped");
  assert.equal(tel.cost_basis, "transcript");
});

test("enrichTelemetry prices a resumed subagent once across two phases (no double count)", () => {
  const root = mkdtempSync(join(tmpdir(), "dedup-"));
  const sub = join(root, "proj", "sess", "subagents");
  writeAgent(sub, "abcabc123123", [turn("claude-sonnet-5", { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 50000, cache_creation_input_tokens: 4000 })]);
  const runDir = join(root, "plan");
  mkdirSync(runDir, { recursive: true });
  // Both dev passes recorded the SAME resumed subagent id — one transcript.
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
    task_slug: "dd", started_at: "2026-07-07T13:28:00Z", completed_at: "2026-07-07T14:16:00Z",
    phases: [
      { phase: "development_plan", agent: "x-dev", model: "claude-sonnet-5", status: "completed", agent_id: "abcabc123123", subagent_tokens: 100, usage_source: "subagent_aggregate", cost_usd: null },
      { phase: "development_implement", agent: "x-dev", model: "claude-sonnet-5", status: "completed", agent_id: "abcabc123123", subagent_tokens: 200, usage_source: "subagent_aggregate", cost_usd: null },
    ],
    total_subagent_tokens: 300, total_cost_usd: null, cache_hit_ratio: null,
  }, null, 2));
  const single = priceTranscripts([join(sub, "agent-abcabc123123.jsonl")], reg).cost_usd;
  const r = enrichTelemetry(runDir, { registry: reg, projectsRoot: root });
  assert.equal(r.enriched.length, 1, "shared transcript priced for exactly one phase");
  assert.deepEqual(r.skipped, ["development_implement"]);
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  assert.ok(Math.abs(tel.total_cost_usd - single) < 1e-9, `total ${tel.total_cost_usd} should equal a single count ${single}`);
});

// A run whose orchestrator wrote a WRONG started_at/completed_at into telemetry
// (the model transcribed the epoch anchor incorrectly) but whose machine-written
// .checkpoint/_started_at is correct. The overhead window must come from the
// authoritative anchor, not the bad ISO strings — else every main-loop turn is
// silently filtered out and the largest cost bucket reads as $0 (ADR-0007).
function buildAnchorRun({ withAnchor = true, telWindow, wallSeconds } = {}) {
  const root = mkdtempSync(join(tmpdir(), "anchor-"));
  const sess = join(root, "proj", "sess.jsonl");
  const sub = join(root, "proj", "sess", "subagents");
  mkdirSync(dirname(sess), { recursive: true });
  // Two orchestrator main-loop turns at 13:30 and 13:35 (one is an Agent dispatch),
  // plus the dispatched phase subagent transcript.
  writeFileSync(sess, [
    JSON.stringify({ type: "assistant", timestamp: "2026-07-07T13:30:00Z", message: { role: "assistant", model: "claude-opus-4-8", usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0 }, content: [
      { type: "tool_use", id: "t1", name: "Agent", input: { subagent_type: "x:dev", description: "Phase 1/1: development" } }] } }),
    JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "agentId: ffff00001111" }] } }),
    turn("claude-opus-4-8", { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 0 }, { timestamp: "2026-07-07T13:35:00Z" }),
  ].join("\n") + "\n");
  writeAgent(sub, "ffff00001111", [turn("claude-sonnet-5", { input_tokens: 100, output_tokens: 2000, cache_read_input_tokens: 50000, cache_creation_input_tokens: 4000 }, { timestamp: "2026-07-07T13:31:00Z" })]);

  const runDir = join(root, "plan");
  mkdirSync(join(runDir, ".checkpoint"), { recursive: true });
  if (withAnchor) {
    const startEpoch = Math.floor(Date.parse("2026-07-07T13:28:00Z") / 1000);
    writeFileSync(join(runDir, ".checkpoint", "_started_at"), String(startEpoch));
  }
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
    task_slug: "anchor",
    // Bogus model-authored window that excludes the 13:30/13:35 orchestrator turns.
    started_at: (telWindow || ["2026-07-07T01:00:00Z", "2026-07-07T01:10:00Z"])[0],
    completed_at: (telWindow || ["2026-07-07T01:00:00Z", "2026-07-07T01:10:00Z"])[1],
    wall_clock_seconds: wallSeconds ?? 3000, // 13:28 + 50min covers the real turns
    phases: [{ phase: "development", agent: "x-dev", model: "claude-sonnet-5", status: "completed", agent_id: "ffff00001111", subagent_tokens: 100, usage_source: "subagent_aggregate", cost_usd: null }],
    total_subagent_tokens: 100, total_cost_usd: null, cache_hit_ratio: null,
  }, null, 2));
  return { runDir, projectsRoot: root };
}

test("enrichTelemetry prices overhead from the checkpoint epoch anchor when telemetry timestamps are wrong", () => {
  const { runDir, projectsRoot } = buildAnchorRun();
  enrichTelemetry(runDir, { registry: reg, projectsRoot });
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  const oh = tel.orchestration_overhead;
  assert.ok(oh, "overhead present");
  assert.equal(oh.main_loop.turns, 2, "both orchestrator turns recovered via the anchor window");
  assert.ok(oh.main_loop.cost_usd > 0, "main-loop cost priced, not zeroed by the bad telemetry window");
  assert.ok(oh.cost_usd > 0);
});

test("enrichTelemetry falls back to the full transcript and flags it when the window excludes every main-loop turn", () => {
  // No authoritative anchor + a bogus telemetry window => the window would zero the
  // overhead. The tool must fall back to the unbounded transcript and signal it.
  const { runDir, projectsRoot } = buildAnchorRun({ withAnchor: false });
  const r = enrichTelemetry(runDir, { registry: reg, projectsRoot });
  assert.equal(r.overhead_window_fallback, true, "fallback flagged so the CLI/orchestrator can WARN");
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  assert.ok(tel.orchestration_overhead.main_loop.cost_usd > 0, "overhead recovered rather than silently $0");
});

test("enrichTelemetry leaves telemetry untouched when nothing resolves (no zero-clobber)", () => {
  const root = mkdtempSync(join(tmpdir(), "noclobber-"));
  const runDir = join(root, "plan");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
    task_slug: "nc", started_at: "2026-07-07T13:28:00Z", completed_at: "2026-07-07T14:16:00Z",
    phases: [{ phase: "business_analysis", agent: "x-ba", model: "claude-opus-4-8", status: "completed", agent_id: "0000nonexist0", subagent_tokens: 5000, usage_source: "subagent_aggregate", cost_usd: null }],
    total_subagent_tokens: 5000, total_cost_usd: null, cost_basis: "subagent_aggregate", cache_hit_ratio: null,
  }, null, 2));
  const r = enrichTelemetry(runDir, { registry: reg, projectsRoot: root });
  assert.equal(r.skipped_all, true);
  assert.deepEqual(r.enriched, []);
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  assert.equal(tel.cost_basis, "subagent_aggregate", "cost_basis not flipped to transcript");
  assert.equal(tel.total_cost_usd, null, "cost not clobbered to 0");
  assert.equal(tel.phases[0].usage_source, "subagent_aggregate");
  assert.equal(tel.phases[0].cost_usd, null);
});

// ── phaseCost — the in-run cost-cap gate's price source (Step 3d-1b) ──────────
//
// Regression cover for the dead cost cap: 3d-cap used to accumulate ONLY the
// live Agent-envelope price, and this harness's envelope is aggregate-only
// (`subagent_tokens`, no input/output/cache split), so every phase priced as
// `null` → treated as $0 → the gate could never fire at any cap. The phase's
// real price is on disk in its own subagent transcript the moment the agent
// returns; these tests pin that it is readable BETWEEN phases, not only at 5b.

test("phaseCost prices a single finished phase from its subagent transcript", () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-"));
  const sub = join(dir, "subagents");
  writeAgent(sub, "aaaa11112222", [turn("claude-opus-4-8", {
    input_tokens: 100000, output_tokens: 5000, cache_read_input_tokens: 200000, cache_creation_input_tokens: 50000 })]);
  const r = phaseCost("aaaa11112222", { registry: reg, subagentsDir: sub });
  assert.equal(r.resolved, true);
  assert.equal(r.usage_source, "transcript");
  assert.ok(r.cost_usd > 0);
  assert.equal(r.input_tokens, 100000);
  assert.equal(r.output_tokens, 5000);
  assert.equal(r.cached_input_tokens, 200000);
  assert.equal(r.cache_creation_tokens, 50000);
  assert.equal(r.turns, 1);
  assert.deepEqual(r.agent_id, ["aaaa11112222"]);
});

test("phaseCost sums a multi-pass phase and takes peak as the max across passes", () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-multi-"));
  const sub = join(dir, "subagents");
  writeAgent(sub, "aaaa11112222", [turn("claude-sonnet-5", { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 90000 })]);
  writeAgent(sub, "bbbb33334444", [turn("claude-sonnet-5", { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 40000 })]);
  const r = phaseCost(["aaaa11112222", "bbbb33334444"], { registry: reg, subagentsDir: sub });
  assert.equal(r.resolved, true);
  assert.equal(r.input_tokens, 15);
  assert.equal(r.turns, 2);
  assert.equal(r.peak_prefix_tokens, 90000, "peak is the max single-turn cache read, not the sum");
  assert.equal(r.cache_pressure, true);
  assert.deepEqual(r.agent_id, ["aaaa11112222", "bbbb33334444"]);
});

test("phaseCost drops already-priced ids so a reused subagent is never double-counted", () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-excl-"));
  const sub = join(dir, "subagents");
  // Million-token scale so the two costs differ by more than round2's cent.
  writeAgent(sub, "aaaa11112222", [turn("claude-sonnet-5", { input_tokens: 1_000_000, output_tokens: 20, cache_read_input_tokens: 1000 })]);
  writeAgent(sub, "bbbb33334444", [turn("claude-sonnet-5", { input_tokens: 500_000, output_tokens: 7, cache_read_input_tokens: 500 })]);
  const both = phaseCost(["aaaa11112222", "bbbb33334444"], { registry: reg, subagentsDir: sub });
  const one = phaseCost(["aaaa11112222", "bbbb33334444"], { registry: reg, subagentsDir: sub, exclude: ["aaaa11112222"] });
  assert.equal(one.input_tokens, 500_000);
  assert.deepEqual(one.agent_id, ["bbbb33334444"]);
  assert.ok(one.cost_usd < both.cost_usd);
  // Every id already priced → nothing left to charge this phase for.
  const none = phaseCost(["aaaa11112222"], { registry: reg, subagentsDir: sub, exclude: ["aaaa11112222"] });
  assert.equal(none.resolved, false);
  assert.equal(none.cost_usd, null);
});

test("phaseCost reports unresolved (never throws) when no transcript exists yet", () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-miss-"));
  const sub = join(dir, "subagents");
  mkdirSync(sub, { recursive: true });
  const r = phaseCost("0000nonexistent0", { registry: reg, subagentsDir: sub, projectsRoot: dir });
  assert.equal(r.resolved, false);
  assert.equal(r.cost_usd, null);
  assert.equal(r.usage_source, null);
  assert.equal(r.reason, "no-transcript");
});

test("phaseCost reports unresolved for a resolved-but-unpriced model (no false $0 for the gate)", () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-unpriced-"));
  const sub = join(dir, "subagents");
  writeAgent(sub, "cccc55556666", [turn("some-unknown-model-9", { input_tokens: 10, output_tokens: 20 })]);
  const r = phaseCost("cccc55556666", { registry: reg, subagentsDir: sub });
  assert.equal(r.resolved, false);
  assert.equal(r.cost_usd, null);
  assert.equal(r.reason, "unpriced-model");
});

test("phaseCost derives the subagents dir from a session transcript path", () => {
  const { sess, projectsRoot } = buildRun();
  const r = phaseCost("aaaa11112222", { registry: reg, sessionTranscript: sess, projectsRoot });
  assert.equal(r.resolved, true);
  assert.ok(r.cost_usd > 0);
});

test("phase-cost CLI emits the gate's machine contract and never exits non-zero on a miss", () => {
  const { sess, projectsRoot } = buildRun();
  const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugins", "sdlc", "tools", "usage", "cli.mjs");
  const run = (args) => JSON.parse(execFileSync("node", [CLI, "phase-cost", ...args, "--json"],
    { encoding: "utf8", cwd: projectsRoot }));

  const hit = run(["aaaa11112222", "--session", sess, "--registry", REGISTRY, "--projects-root", projectsRoot]);
  assert.equal(hit.ok, true);
  assert.equal(hit.resolved, true);
  assert.equal(hit.usage_source, "transcript");
  assert.ok(hit.cost_usd > 0, "the gate gets a real number between phases");

  const miss = run(["0000nonexistent0", "--session", sess, "--registry", REGISTRY, "--projects-root", projectsRoot]);
  assert.equal(miss.ok, true, "a miss is not a pipeline failure");
  assert.equal(miss.resolved, false);
  assert.equal(miss.cost_usd, null);
});

// ── post-run cap reconciliation (defense in depth behind the 3d-1b gate) ──────
//
// 3d-1b makes the in-run gate work, but it can still come up blind (transcript
// not yet flushed, node missing, unpriced model) and fall back to counting a
// phase as $0. When that happens the run silently finishes over cap with
// cap_status:"within". Enrichment sees the real numbers at the end, so it is the
// last place a breach can still be told the truth.

function capRun(cap, capStatus = "within") {
  const { runDir, sess, projectsRoot } = buildRun();
  const tel = JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));
  tel.cost_cap_usd = cap;
  tel.cap_status = capStatus;
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify(tel, null, 2));
  return { runDir, sess, projectsRoot };
}
const readTel = (runDir) => JSON.parse(readFileSync(join(runDir, "_telemetry.json"), "utf8"));

test("enrichTelemetry flags a cap breach the in-run gate missed", () => {
  const { runDir, sess } = capRun(0.01);
  enrichTelemetry(runDir, { sessionTranscript: sess, registry: reg });
  const tel = readTel(runDir);
  assert.equal(tel.cap_status, "exceeded-undetected", "a real breach must not keep reading as 'within'");
  assert.ok(tel.cap_breach_usd > 0);
  const phaseCostSum = tel.phases.reduce((a, p) => a + (p.cost_usd || 0), 0);
  assert.ok(Math.abs(tel.cap_breach_usd - (phaseCostSum - 0.01)) < 0.02, "breach is measured against PHASE spend");
});

test("enrichTelemetry does not invent a breach from orchestration overhead", () => {
  // Cap sized above phase spend but below phase spend + overhead. Overhead is
  // deliberately outside the gate (Step 5), so this must stay "within".
  const probe = capRun(0.01);
  enrichTelemetry(probe.runDir, { sessionTranscript: probe.sess, registry: reg });
  const t0 = readTel(probe.runDir);
  const phaseSum = t0.phases.reduce((a, p) => a + (p.cost_usd || 0), 0);
  const overhead = t0.orchestration_overhead.cost_usd;
  assert.ok(overhead > 0.02, "fixture must have real overhead for this test to mean anything");

  const { runDir, sess } = capRun(phaseSum + overhead / 2);
  enrichTelemetry(runDir, { sessionTranscript: sess, registry: reg });
  const tel = readTel(runDir);
  assert.equal(tel.cap_status, "within");
  assert.equal(tel.cap_breach_usd, undefined);
  assert.ok(tel.total_cost_usd > tel.cost_cap_usd, "total legitimately exceeds the cap via overhead");
});

test("enrichTelemetry leaves a breach the gate already caught untouched", () => {
  for (const status of ["exceeded-continued", "exceeded-aborted"]) {
    const { runDir, sess } = capRun(0.01, status);
    enrichTelemetry(runDir, { sessionTranscript: sess, registry: reg });
    const tel = readTel(runDir);
    assert.equal(tel.cap_status, status, "the gate's own verdict wins — it had the user in the loop");
    assert.ok(tel.cap_breach_usd > 0, "the overage size is still recorded");
  }
});

test("enrichTelemetry invents no cap fields when the recipe declared no cap", () => {
  const { runDir, sess } = buildRun();
  enrichTelemetry(runDir, { sessionTranscript: sess, registry: reg });
  const tel = readTel(runDir);
  assert.equal(tel.cap_status, undefined);
  assert.equal(tel.cap_breach_usd, undefined);
});

test("a last-dispatch overage is reported but is NOT attributed to a blind gate", () => {
  // The gate only acts when a next dispatch exists, so an overage on the final
  // phase is unpreventable by construction — as is any single-phase recipe,
  // which has no gate boundary at all. Still a breach worth reporting, but the
  // absence of cap_gate_blind is what says "cap too small", not "gate broken".
  const { runDir, sess } = capRun(0.01);
  enrichTelemetry(runDir, { sessionTranscript: sess, registry: reg });
  const tel = readTel(runDir);
  assert.equal(tel.cap_status, "exceeded-undetected");
  assert.ok(tel.phases.every((p) => !p.cap_gate_blind), "no phase was blind — the gate priced them all");
});

// ── dry-run estimation baselines (SKILL.md 1d-1) ─────────────────────────────
//
// The old baseline modelled one dispatch as a single API call (35k input, 60%
// cached, 3k output) and priced an opus row at $0.16. A phase is a multi-turn
// agent loop whose every turn re-reads the accumulated prefix, so real cost ran
// 6-10x higher — and recipe caps derived from that estimate sat below their own
// median run. These pin the corrected baselines to measured reality.

// Median per-tier cost over 56 transcript-priced phases across 10 real runs,
// excluding `development` (which carries its own x5.4 phase multiplier).
const MEASURED_MEDIAN_USD = { opus: 0.95, sonnet: 0.38, haiku: 0.15 };
const TIER_MODEL = { opus: "claude-opus-5", sonnet: "claude-sonnet-5", haiku: "claude-haiku-4-5-20251001", fable: "claude-fable-5" };

const estimateRow = (tier, registry) => {
  const b = registry.raw.estimation_baselines[tier];
  return priceUsage({
    input_tokens: b.input, cache_read_tokens: b.cache_read,
    cache_write_5m_tokens: b.cache_write, cache_write_1h_tokens: 0, output_tokens: b.output,
  }, TIER_MODEL[tier], registry);
};

test("the registry carries an estimation baseline for every pipeline tier", () => {
  const b = reg.raw.estimation_baselines;
  assert.ok(b, "estimation_baselines missing — the 1d-1 preview has nothing to price");
  for (const tier of reg.raw.pipeline_tiers) {
    assert.ok(b[tier], `no baseline for tier ${tier}`);
    for (const k of ["input", "cache_read", "cache_write", "output"]) {
      assert.equal(typeof b[tier][k], "number", `${tier}.${k} must be a number`);
    }
  }
});

test("each baseline reproduces its tier's measured median cost within 15%", () => {
  for (const [tier, measured] of Object.entries(MEASURED_MEDIAN_USD)) {
    const est = estimateRow(tier, reg);
    const err = Math.abs(est / measured - 1);
    assert.ok(err < 0.15, `${tier}: estimate $${est.toFixed(4)} vs measured $${measured} (${(err * 100).toFixed(1)}% off)`);
  }
});

test("cache_read dominates every baseline — the shape the old model got wrong", () => {
  // The pre-fix baseline assumed uncached input was the bulk of a dispatch. If a
  // future retune reverts to that shape the estimate silently collapses again,
  // because cache reads are where a multi-turn phase actually spends.
  for (const tier of ["opus", "sonnet", "haiku"]) {
    const b = reg.raw.estimation_baselines[tier];
    assert.ok(b.cache_read > b.input * 100, `${tier}: cache_read must dominate uncached input`);
    assert.ok(b.cache_read > b.cache_write, `${tier}: a phase re-reads more than it writes`);
  }
});

test("the corrected baseline is far above the pre-2026-07 estimate it replaced", () => {
  // Regression guard on the actual bug: the old opus row priced at $0.16.
  assert.ok(estimateRow("opus", reg) > 0.5, "opus row must no longer price like a single API call");
  assert.ok(estimateRow("sonnet", reg) > 0.2);
});

test("fable has a baseline despite no measured run, priced at its own rates", () => {
  const b = reg.raw.estimation_baselines;
  assert.deepEqual(b.fable, b.opus, "fable documents its opus-shaped inheritance");
  // Same tokens, dearer tier → a strictly higher row than opus.
  assert.ok(estimateRow("fable", reg) > estimateRow("opus", reg));
});
