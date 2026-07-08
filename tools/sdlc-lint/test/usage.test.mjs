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
