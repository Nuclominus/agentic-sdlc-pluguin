// `plan --json --digest`: keep Step 0's output under the harness's inline limit (ADR-0019 start window).

import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Under Claude Code's ~30k-char inline Bash output limit, with margin for the harness's own framing.
export const INLINE_LIMIT = 20000;

export function digestOf(plan) {
  if (!plan) return plan;
  const { prompt_blocks: _blocks, ...profile } = plan.profile ?? {};
  const out = { ...plan, profile };
  if (plan.skip_rules?.signals) {
    const { changed_files: _files, ...signals } = plan.skip_rules.signals;
    out.skip_rules = { ...plan.skip_rules, signals };
  }
  return out;
}

const uid = typeof process.getuid === "function" ? process.getuid() : null;

export function planFilePath(cwd, dir = tmpdir()) {
  return join(dir, `sdlc-plan-${uid ?? "user"}`, `${createHash("sha256").update(String(cwd)).digest("hex").slice(0, 16)}.json`);
}

// tmpdir() is a shared, world-writable /tmp on Linux: the file must live in a directory only we control.
function ensurePrivateDir(d) {
  try { mkdirSync(d, { mode: 0o700 }); } catch (e) { if (e.code !== "EEXIST") throw e; }
  const st = lstatSync(d);
  if (!st.isDirectory()) throw new Error(`${d} is not a directory`);
  if (uid !== null && (st.uid !== uid || (st.mode & 0o077) !== 0)) throw new Error(`${d} is not private to this user (needs owner ${uid}, mode 0700)`);
}

function writeAtomic(path, text) {
  ensurePrivateDir(dirname(path));
  const tmp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(tmp, text, { flag: "wx", mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * `plan_file` is null exactly when the blocks need no file: a dry run or halt (nothing is dispatched),
 * a plan small enough to print whole, or a failed write (whole plan inline, with a WARN).
 */
export function digestEnvelope(envelope, { cwd, dryRun = false, limit = INLINE_LIMIT, dir } = {}) {
  if (!envelope.plan || envelope.halt || dryRun) return { ...envelope, plan: digestOf(envelope.plan), plan_file: null };
  const full = JSON.stringify(envelope);
  if (full.length <= limit) return { ...envelope, plan_file: null };
  const path = planFilePath(cwd, dir);
  try {
    writeAtomic(path, full);
  } catch (e) {
    const msg = `WARN: could not write the plan file (${e && e.message ? e.message : e}) — the full plan is inline, prompt_blocks included`;
    return { ...envelope, prints: [...envelope.prints, msg], warnings: [...envelope.warnings, msg], plan_file: null };
  }
  return { ...envelope, plan: digestOf(envelope.plan), plan_file: path };
}

/** The pasteable 3b-1a text for one agent, read from a saved plan envelope. */
export function blocksFrom(file, agent, { planning = false } = {}) {
  let envelope;
  try { envelope = JSON.parse(readFileSync(file, "utf8")); } catch (e) {
    return { ok: false, code: 1, error: `cannot read plan file ${file}: ${e && e.message ? e.message : e}` };
  }
  const blocks = envelope?.plan?.profile?.prompt_blocks;
  if (!blocks) return { ok: false, code: 1, error: `${file} carries no plan.profile.prompt_blocks` };
  if (!(agent in blocks)) return { ok: false, code: 2, error: `unknown agent '${agent}' — known: ${Object.keys(blocks).sort().join(", ")}` };
  const b = blocks[agent] ?? {};
  const skills = planning ? b.skills_planning : b.skills;
  return { ok: true, code: 0, text: [b.expertise, skills].filter(Boolean).join("\n\n") };
}
