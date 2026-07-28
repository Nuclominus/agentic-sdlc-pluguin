import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { resolveWorkspace } from "../../../plugins/sdlc/tools/run/reentry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");

test("the completeness rule ships inside the plugin, where the Stop hook can reach it", () => {
  const dir = mkdtempSync(join(tmpdir(), "reentry-"));
  const cp = join(dir, ".checkpoint");
  mkdirSync(cp, { recursive: true });
  writeFileSync(join(cp, "_run.json"),
    JSON.stringify({ resolved_phases: [{ name: "development" }, { name: "qa" }] }));
  writeFileSync(join(cp, "development.json"), JSON.stringify({ status: "completed" }));

  assert.equal(resolveWorkspace(dir).reenter_at, "qa");

  writeFileSync(join(cp, "qa.json"), JSON.stringify({ status: "completed" }));
  assert.equal(resolveWorkspace(dir).reenter_at, null,
    "a run whose every resolved phase is terminal is what the seal gate calls complete");
});
