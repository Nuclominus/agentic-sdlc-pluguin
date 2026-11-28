// `plan --json --digest`: keep Step 0's output under the harness's inline limit (ADR-0019 start window).

import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
const KEEP_MS = 7 * 24 * 3600 * 1000;

export const planFileDir = (dir = tmpdir()) => join(dir, `sdlc-plan-${uid ?? "user"}`);

// One file per run: a second run in the same checkout must never overwrite the blocks a first run still reads.
export function planFilePath(cwd, dir = tmpdir(), runId = randomBytes(6).toString("hex")) {
  return join(planFileDir(dir), `${createHash("sha256").update(String(cwd)).digest("hex").slice(0, 16)}-${runId}.json`);
}

// tmpdir() is a shared, world-writable /tmp on Linux: the file must live in a directory only we control.
function ensurePrivateDir(d) {
  try { mkdirSync(d, { mode: 0o700 }); } catch (e) { if (e.code !== "EEXIST") throw e; }
  const st = lstatSync(d);
  if (!st.isDirectory()) throw new Error(`${d} is not a directory`);
  if (uid !== null && (st.uid !== uid || (st.mode & 0o077) !== 0)) throw new Error(`${d} is not private to this user (needs owner ${uid}, mode 0700)`);
}

function pruneOld(d, now = Date.now()) {
  for (const f of readdirSync(d)) {
    try { if (now - lstatSync(join(d, f)).mtimeMs > KEEP_MS) unlinkSync(join(d, f)); } catch { /* raced or gone */ }
  }
}

function writeAtomic(path, text) {
  const d = dirname(path);
  ensurePrivateDir(d);
  const tmp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(tmp, text, { flag: "wx", mode: 0o600 });
  renameSync(tmp, path);
  try { pruneOld(d); } catch { /* the file is written; a failed cleanup must not read as a failed write */ }
}

const errText = (e) => (e && e.message ? e.message : String(e));

function withWarn(envelope, msg) {
  return { ...envelope, prints: [...envelope.prints, msg], warnings: [...envelope.warnings, msg] };
}

/** `plan_file` is null exactly when no file is needed: dry run, halt, a plan that fits whole, or a failed write. */
export function digestEnvelope(envelope, { cwd, dryRun = false, limit = INLINE_LIMIT, dir, runId } = {}) {
  if (!envelope.plan || envelope.halt || dryRun) return { ...envelope, plan: digestOf(envelope.plan), plan_file: null };
  const full = JSON.stringify(envelope);
  if (full.length <= limit) return { ...envelope, plan_file: null };
  const path = planFilePath(cwd, dir, runId);
  try {
    writeAtomic(path, full);
  } catch (e) {
    return { ...withWarn(envelope, `WARN: could not write the plan file (${errText(e)}) — the full plan is inline, prompt_blocks included`), plan_file: null };
  }
  const out = { ...envelope, plan: digestOf(envelope.plan), plan_file: path };
  const size = JSON.stringify(out).length;
  return size > limit
    ? withWarn(out, `WARN: the plan digest is ${size} characters, over the ${limit}-character inline budget — if the harness saves it to a file, follow Step 0-blocks`)
    : out;
}

function readEnvelope(file) {
  try { return { envelope: JSON.parse(readFileSync(file, "utf8")) }; } catch (e) {
    return { error: { ok: false, code: 1, error: `cannot read plan file ${file}: ${errText(e)}` } };
  }
}

/** The digest of a saved envelope; `section` splits it when the digest alone overflowed the inline limit. */
export function digestFrom(file, { section = null } = {}) {
  const { envelope, error } = readEnvelope(file);
  if (error) return error;
  if (!envelope || !Array.isArray(envelope.prints)) return { ok: false, code: 1, error: `${file} is not a resolve plan envelope` };
  const hasBlocks = Boolean(envelope.plan?.profile?.prompt_blocks);
  const out = { ...envelope, plan: digestOf(envelope.plan), plan_file: hasBlocks ? file : (envelope.plan_file ?? null) };
  if (section === null) return { ok: true, code: 0, envelope: out };
  if (section === "prints") return { ok: true, code: 0, envelope: { ok: out.ok, halt: out.halt ?? null, prints: out.prints } };
  if (section === "context") return { ok: true, code: 0, envelope: { ok: out.ok, halt: out.halt ?? null, plan: out.plan, plan_file: out.plan_file } };
  return { ok: false, code: 2, error: `unknown --section '${section}' — prints or context` };
}

export const BLOCK_MARKERS = { expertise: "=== role_expertise_block ===", skills: "=== skills_block ===" };

/** One agent's two 3b-1a blocks from a saved envelope; `part` selects one, raw. */
export function blocksFrom(file, agent, { planning = false, part = null } = {}) {
  const { envelope, error } = readEnvelope(file);
  if (error) return error;
  const blocks = envelope?.plan?.profile?.prompt_blocks;
  if (!blocks) return { ok: false, code: 1, error: `${file} carries no plan.profile.prompt_blocks` };
  if (!(agent in blocks)) return { ok: false, code: 2, error: `unknown agent '${agent}' — known: ${Object.keys(blocks).sort().join(", ")}` };
  const b = blocks[agent] ?? {};
  const expertise = b.expertise ?? "";
  const skills = (planning ? b.skills_planning : b.skills) ?? "";
  if (part === "expertise") return { ok: true, code: 0, text: expertise };
  if (part === "skills") return { ok: true, code: 0, text: skills };
  if (part !== null) return { ok: false, code: 2, error: `unknown --part '${part}' — expertise or skills` };
  return { ok: true, code: 0, text: [BLOCK_MARKERS.expertise, expertise, BLOCK_MARKERS.skills, skills].join("\n") };
}
