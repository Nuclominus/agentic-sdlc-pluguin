// The only writer in Track J's emit path.
//
// Kept out of lib/emit/index.mjs on purpose: index.mjs returns a plan and touches
// nothing, which is what lets lib/emit/check.mjs run the identical render in CI
// with no risk of it "fixing" dist/ behind our backs. One module writes; the rest
// cannot.
//
// Source-tree only — never runs at pipeline runtime (like lib/plugin-paths.mjs).

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { DIST_ROOT } from "./index.mjs";
import { buildManifest, MANIFEST_NAME } from "./check.mjs";

/**
 * Write an emission plan to dist/<host>/, replacing whatever was there.
 *
 * The tree is removed first rather than merged into: a merge would leave orphans
 * behind, and an orphan in a committed generated tree is exactly the thing the
 * check verb exists to catch. Removing means `emit` can never produce a tree that
 * `emit --check` would then fail.
 *
 * @param {string} root  repo root
 * @param {object} host  parsed host descriptor
 * @param {{outputs: Map<string, object>, drops: object[], plugins: string[]}} plan
 * @returns {{ written: number, removed: boolean, dist: string }}
 */
export function writeEmission(root, host, plan) {
  const hostDist = posix.join(DIST_ROOT, host.host);
  const absDist = join(root, hostDist);

  const removed = existsSync(absDist);
  if (removed) rmSync(absDist, { recursive: true, force: true });

  for (const [rel, entry] of plan.outputs) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, entry.kind === "copy" ? readFileSync(join(root, entry.from)) : entry.content);
  }

  const manifest = buildManifest(root, host, plan);
  writeFileSync(join(absDist, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n");

  return { written: plan.outputs.size, removed, dist: hostDist };
}
