// Provenance for one benchmark run. Written by prepare.mjs BEFORE the run,
// never derived at harvest time: arms are switched between runs by design, so
// reading provenance afterwards records the state that happened to be live
// when someone got round to harvesting. That record is plausible and wrong —
// the worst failure mode available here, because it looks verified.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MANIFEST_NAME = "_bench-manifest.json";

/** Fields compared between the recorded manifest and live state at harvest. */
const COMPARED = ["arm", "plugin_version", "marketplace_sha", "config_dir", "task_sha256", "answers_sha256"];

export function buildManifest(fields) {
  return {
    arm: fields.arm,
    run: fields.run,
    plugin_version: fields.plugin_version,
    marketplace_sha: fields.marketplace_sha,
    config_dir: fields.config_dir,
    task_sha256: fields.task_sha256,
    answers_sha256: fields.answers_sha256,
    inter_run_gap_seconds: fields.inter_run_gap_seconds,
    prepared_at: fields.prepared_at,
  };
}

export function writeManifest(dir, manifest) {
  writeFileSync(join(dir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n");
}

export function readManifest(dir) {
  const path = join(dir, MANIFEST_NAME);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`cannot read ${MANIFEST_NAME} at ${path}: ${e.message}`);
  }
}

/** @returns {string[]} one description per diverging field; empty when they agree. */
export function diffManifest(recorded, live) {
  return COMPARED
    .filter((k) => recorded[k] !== live[k])
    .map((k) => `${k}: recorded "${recorded[k]}" but live is "${live[k]}"`);
}
