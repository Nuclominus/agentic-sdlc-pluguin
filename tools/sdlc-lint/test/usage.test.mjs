import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  loadRegistry, extractUsage, priceUsage, priceTranscripts,
  findAgentTranscript, sessionSubagentsDir, deriveDispatchMap, enrichTelemetry,
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
