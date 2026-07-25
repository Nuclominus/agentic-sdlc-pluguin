// Power check for the benchmark specimen. Read discipline can only move the
// part of the prompt prefix made of file content the agent chose to pull in;
// the fixed floor is E1's problem, not E2's. If the readable corpus is small
// relative to the floor, the experiment cannot detect the effect even if it
// is real — so the specimen's size is a measurement precondition, not taste.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

/** Measured worst-case per-turn fixed floor (android-docs). */
export const FLOOR_TOKENS = 21_000;

/** Corpus must be at least this many times the floor to have detection power. */
export const MIN_CORPUS_RATIO = 3;

/** Rough token estimate. 4 chars/token is the usual working approximation. */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (extname(abs) === ".kt") out.push(abs);
  }
  return out;
}

/**
 * Estimate the readable corpus of a Kotlin project.
 * @returns {{files:number, chars:number, tokens:number, ratio:number, ok:boolean}}
 */
export function corpusStats(rootDir) {
  const files = walk(rootDir);
  const chars = files.reduce((n, f) => n + readFileSync(f, "utf8").length, 0);
  const tokens = estimateTokens("x".repeat(chars));
  const ratio = tokens / FLOOR_TOKENS;
  return { files: files.length, chars, tokens, ratio, ok: ratio >= MIN_CORPUS_RATIO };
}
