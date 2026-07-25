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

/** Rough token estimate from a character count. 4 chars/token is the usual approximation. */
export function estimateTokensFromLength(chars) {
  return Math.ceil(chars / 4);
}

/** Rough token estimate for a string. */
export function estimateTokens(text) {
  return estimateTokensFromLength(text.length);
}

/**
 * Directories that never hold hand-authored source. Generated Kotlin counted
 * toward the corpus would report a false `ok: true` — the instrument lying in
 * the reassuring direction, which is the failure this whole check exists to
 * prevent. Dot-directories (.gradle, .kotlin, .git) are skipped by prefix.
 */
const SKIP_DIRS = new Set(["build", "out", "node_modules"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
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
  const tokens = estimateTokensFromLength(chars); // no throwaway allocation
  const ratio = tokens / FLOOR_TOKENS;
  return { files: files.length, chars, tokens, ratio, ok: ratio >= MIN_CORPUS_RATIO };
}
