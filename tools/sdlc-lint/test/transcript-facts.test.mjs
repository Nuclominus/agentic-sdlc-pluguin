import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { extractFacts, extractFactsFrom } from "../lib/transcript-facts.mjs";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "compliance");

test("extracts one fact per tool_use block, in order", () => {
  const facts = extractFacts(join(FIX, "session-basic.jsonl"));
  assert.equal(facts.length, 3);
  assert.deepEqual(facts.map((f) => f.tool), ["Bash", "Agent", "Write"]);
  assert.deepEqual(facts.map((f) => f.seq), [0, 1, 2]);
});

test("carries the fields each tool kind identifies itself by", () => {
  const [bash, agent, write] = extractFacts(join(FIX, "session-basic.jsonl"));
  assert.match(bash.command, /usage\/cli\.mjs" enrich my-slug$/);
  assert.equal(bash.subagent_type, null);
  assert.equal(agent.subagent_type, "session-recorder");
  assert.equal(agent.command, null);
  assert.equal(write.path, "/tmp/out.md");
});

test("a truncated final line is skipped, not thrown on", () => {
  assert.doesNotThrow(() => extractFacts(join(FIX, "session-basic.jsonl")));
});

test("a missing transcript yields no facts rather than an error", () => {
  assert.deepEqual(extractFacts(join(FIX, "does-not-exist.jsonl")), []);
});

test("extractFactsFrom concatenates, renumbers seq globally and records the source", () => {
  const p = join(FIX, "session-basic.jsonl");
  const facts = extractFactsFrom([p, p]);
  assert.equal(facts.length, 6);
  assert.deepEqual(facts.map((f) => f.seq), [0, 1, 2, 3, 4, 5]);
  assert.ok(facts.every((f) => f.source === p));
});
