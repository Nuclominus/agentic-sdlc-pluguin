// Drift gate for Track J — is dist/ what the emitter would produce right now?
//
// dist/ is committed (so every host can install from any branch or worktree, none
// of them having an install-time build step), which means dist/ can be edited by
// hand, and a hand edit is invisible: it survives every other lint verb, ships,
// and silently diverges from the SSOT it claims to be generated from. This verb
// is the thing that makes committing generated output safe.
//
// Three axes, each catching a failure the others miss:
//   content  — a file whose bytes differ from a fresh render (the hand edit)
//   orphans  — a file in dist/ the emitter would not produce at all (the hand
//              edit that was then RENAMED, which content alone cannot see)
//   drops    — an artifact the emitter skipped without a stated reason. Same
//              lesson as scripts/expertise-coverage.mjs: a paragraph that fails
//              to land raises no error, it just stops existing.
//
// `emit` writes; `check` never does. Only `check` runs in CI — regenerating there
// and committing the result would let a bad transform land unseen.
//
// Source-tree only — never runs at pipeline runtime (like lib/plugin-paths.mjs).

import { readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, posix } from "node:path";
import { globSync } from "tinyglobby";
import { DIST_ROOT, emitAll } from "./index.mjs";

/** Bumped whenever a transform changes shape, so a stale manifest cannot pass. */
export const EMITTER_VERSION = 1;

/** Name of the per-host manifest that carries the fast path. */
export const MANIFEST_NAME = ".emit-manifest.json";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Resolve an emission plan entry to its bytes.
 * @param {string} root
 * @param {{kind: string, content?: string, from?: string}} entry
 */
function renderEntry(root, entry) {
  return entry.kind === "copy" ? readFileSync(join(root, entry.from)) : Buffer.from(entry.content, "utf8");
}

/**
 * Compare dist/<host>/ against a fresh render.
 *
 * @param {string} root  repo root
 * @param {object} host  parsed host descriptor
 * @param {{ plugins?: string[] }} [opts]
 * @returns {{ ok: boolean, host: string, errors: string[], warnings: string[], counts: object, tool_error?: boolean }}
 */
export function checkHost(root, host, opts = {}) {
  const errors = [];
  const warnings = [];
  const plan = emitAll(root, host, opts);

  if (plan.errors.length) {
    // A render error is a tool error, not drift: we cannot say anything about
    // dist/ because we could not produce the thing to compare it against.
    return {
      ok: false, host: host.host, tool_error: true, errors: plan.errors, warnings,
      counts: { rendered: 0, compared: 0, orphans: 0, drops: plan.drops.length },
    };
  }

  const hostDist = posix.join(DIST_ROOT, host.host);
  const absDist = join(root, hostDist);

  // Axis 3 first — it needs no dist/ at all, so it reports even on a fresh tree.
  for (const d of plan.drops) {
    if (!d.reason || !d.reason.trim()) {
      errors.push(`undeclared drop: ${d.plugin}/${d.path} — every skipped artifact needs a stated reason in hosts/${host.host}.json`);
    }
  }

  if (!existsSync(absDist)) {
    errors.push(`${hostDist}/ does not exist — run: node tools/sdlc-lint/cli.mjs emit --host ${host.host}`);
    return { ok: false, host: host.host, errors, warnings, counts: { rendered: plan.outputs.size, compared: 0, orphans: 0, drops: plan.drops.length } };
  }

  // Axis 1 — content.
  let compared = 0;
  const shown = 10;
  let hidden = 0;
  for (const [rel, entry] of [...plan.outputs].sort(([a], [b]) => a.localeCompare(b))) {
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      if (errors.length < shown) errors.push(`missing in dist: ${rel}`); else hidden++;
      continue;
    }
    compared++;
    const want = renderEntry(root, entry);
    const got = readFileSync(abs);
    if (sha(want) !== sha(got)) {
      if (errors.length < shown) {
        errors.push(`stale in dist: ${rel} (${firstDiff(want, got)})`);
      } else hidden++;
    }
  }

  // Axis 2 — orphans.
  const produced = new Set(plan.outputs.keys());
  const onDisk = globSync("**/*", { cwd: absDist, dot: true, onlyFiles: true })
    .map((p) => posix.join(hostDist, p))
    .filter((p) => posix.basename(p) !== MANIFEST_NAME);
  const orphans = onDisk.filter((p) => !produced.has(p)).sort();
  for (const o of orphans) {
    if (errors.length < shown) errors.push(`orphan in dist (the emitter would not produce it): ${o}`); else hidden++;
  }

  if (hidden) warnings.push(`${hidden} further finding(s) not listed — see \`git diff ${hostDist}\``);

  return {
    ok: errors.length === 0,
    host: host.host,
    errors, warnings,
    counts: { rendered: plan.outputs.size, compared, orphans: orphans.length, drops: plan.drops.length },
  };
}

/** First differing line, as a one-line hint. The full diff belongs to git. */
function firstDiff(want, got) {
  const a = want.toString("utf8").split("\n");
  const b = got.toString("utf8").split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `first differs at line ${i + 1}`;
  }
  return `same lines, different bytes (line endings or trailing newline)`;
}

/**
 * The manifest written beside an emitted tree. Its only job is the fast path:
 * if every source hash and the emitter version match, dist/ cannot be stale, so
 * `check` can skip rendering entirely.
 */
export function buildManifest(root, host, plan) {
  const sources = {};
  for (const entry of plan.outputs.values()) {
    if (entry.kind !== "copy") continue;
    sources[entry.from] = sha(readFileSync(join(root, entry.from)));
  }
  const outputs = {};
  for (const [rel, entry] of plan.outputs) outputs[rel] = sha(renderEntry(root, entry));
  return {
    emitter_version: EMITTER_VERSION,
    host: host.host,
    host_descriptor_sha: sha(readFileSync(join(root, "tools", "sdlc-lint", "hosts", `${host.host}.json`))),
    plugins: plan.plugins,
    sources,
    outputs,
  };
}

/** True when nothing that feeds the render has moved since the manifest was written. */
export function manifestIsCurrent(root, host, manifest) {
  if (!manifest || manifest.emitter_version !== EMITTER_VERSION) return false;
  const descPath = join(root, "tools", "sdlc-lint", "hosts", `${host.host}.json`);
  if (!existsSync(descPath) || manifest.host_descriptor_sha !== sha(readFileSync(descPath))) return false;
  for (const [rel, want] of Object.entries(manifest.sources ?? {})) {
    const abs = join(root, rel);
    if (!existsSync(abs) || !statSync(abs).isFile()) return false;
    if (sha(readFileSync(abs)) !== want) return false;
  }
  return true;
}
