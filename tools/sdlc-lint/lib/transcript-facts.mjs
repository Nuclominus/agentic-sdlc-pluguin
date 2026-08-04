import { existsSync, readFileSync } from "node:fs";

/**
 * Normalise ONE session transcript into an ordered fact stream — a single fact
 * per `tool_use` block found in an assistant message.
 *
 * This module knows the transcript wire format and nothing else: no SDLC step,
 * contract or run concept may leak in here. Compliance auditing, and any later
 * consumer (a deterministic runner, an AAR pass), consumes this shape rather
 * than re-parsing JSONL for itself.
 *
 * Never throws. A transcript is an append-only log that can end mid-write, so a
 * malformed line is skipped, not fatal.
 */
export function extractFacts(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  let raw;
  try { raw = readFileSync(transcriptPath, "utf8"); } catch { return []; }

  const facts = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }   // truncated tail, or a non-JSON line
    const content = d && d.message && Array.isArray(d.message.content) ? d.message.content : null;
    if (!content) continue;
    for (const b of content) {
      if (!b || typeof b !== "object" || b.type !== "tool_use") continue;
      const input = b.input && typeof b.input === "object" ? b.input : {};
      facts.push({
        seq: facts.length,
        tool: typeof b.name === "string" ? b.name : null,
        command: typeof input.command === "string" ? input.command : null,
        subagent_type: typeof input.subagent_type === "string" ? input.subagent_type : null,
        path: typeof input.file_path === "string" ? input.file_path : null,
        // `timestamp` and `skill` carry no SDLC meaning — they are wire-format fields like the
        // rest. A consumer that needs to bound a token window (start-window.mjs) needs the
        // clock, and one that needs to know WHICH skill was loaded needs the name; without
        // them it would have to re-parse the JSONL, which is what this module exists to prevent.
        timestamp: typeof d.timestamp === "string" ? d.timestamp : null,
        skill: typeof input.skill === "string" ? input.skill : null,
      });
    }
  }
  return facts;
}

/**
 * Facts from several transcripts, concatenated in the order given, with `seq`
 * renumbered across the whole stream and each fact tagged with its source file.
 *
 * A run under `--resume` spans several sessions; its facts must be evaluated as
 * one stream, or a step performed in the second session reads as a miss.
 */
export function extractFactsFrom(paths) {
  const out = [];
  for (const p of paths || []) {
    for (const f of extractFacts(p)) out.push({ ...f, seq: out.length, source: p });
  }
  return out;
}
