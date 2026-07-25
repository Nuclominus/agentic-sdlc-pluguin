import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { estimateTokens, corpusStats, FLOOR_TOKENS, MIN_CORPUS_RATIO } from "../lib/corpus.mjs";

test("estimateTokens uses 4 chars per token, rounded up", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});

test("the power floor and ratio are pinned", () => {
  assert.equal(FLOOR_TOKENS, 21_000);
  assert.equal(MIN_CORPUS_RATIO, 3);
});

function corpusOf(totalChars) {
  const root = mkdtempSync(join(tmpdir(), "corpus-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "A.kt"), "x".repeat(totalChars));
  writeFileSync(join(root, "src", "notes.md"), "y".repeat(totalChars)); // must be ignored
  return corpusStats(root);
}

test("corpusStats counts only .kt files", () => {
  const s = corpusOf(4000);
  assert.equal(s.files, 1);
  assert.equal(s.chars, 4000);
  assert.equal(s.tokens, 1000);
});

test("a corpus below 3x the floor is not ok", () => {
  const s = corpusOf(FLOOR_TOKENS * 4 * MIN_CORPUS_RATIO - 4); // one token short
  assert.equal(s.ok, false);
  assert.ok(s.ratio < MIN_CORPUS_RATIO);
});

test("a corpus at exactly 3x the floor is ok", () => {
  const s = corpusOf(FLOOR_TOKENS * 4 * MIN_CORPUS_RATIO);
  assert.equal(s.ok, true);
  assert.equal(s.ratio, MIN_CORPUS_RATIO);
});
