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

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, posix } from "node:path";
import { globSync } from "tinyglobby";
import { DIST_ROOT, emitAll, EMIT_IGNORE } from "./index.mjs";

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
  const plan = emitAll(root, host, opts);
  // An unmeasured assumption the package ships on is reported on every check, not only on emit.
  const warnings = [...(plan.warnings ?? [])];

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
  // Same ignore list as the emitter: a Finder-created .DS_Store under dist/ is gitignored and
  // invisible to git, and re-emitting cannot remove what Finder recreates.
  const onDisk = globSync("**/*", { cwd: absDist, dot: true, onlyFiles: true, ignore: EMIT_IGNORE })
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
 * Provenance written beside an emitted tree: which emitter, which host
 * descriptor, which plugins. It is not an input to `check` — a full re-render
 * costs well under a second, so a hash-manifest fast path would only add a
 * second way to decide the same question, and two paths can disagree. What it is
 * for is the reviewer of a committed generated tree, who can otherwise not tell
 * which descriptor produced these bytes.
 */
export function buildManifest(root, host, plan) {
  return {
    emitter_version: EMITTER_VERSION,
    host: host.host,
    host_descriptor_sha: sha(readFileSync(join(root, "tools", "sdlc-lint", "hosts", `${host.host}.json`))),
    host_cli_version: host.verified_on?.cli_version ?? null,
    plugins: plan.plugins,
    files: plan.outputs.size,
    regenerate: `node tools/sdlc-lint/cli.mjs emit --host ${host.host}`,
  };
}
