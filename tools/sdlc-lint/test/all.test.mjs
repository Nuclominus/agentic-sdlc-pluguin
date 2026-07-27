import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFileSync } from "node:fs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const CLI = resolve(REPO, "tools/sdlc-lint/cli.mjs");

test("`all --json` exits 0 on a clean repo", () => {
  const out = execFileSync("node", [CLI, "all", "--json"], { cwd: REPO, encoding: "utf8" });
  const report = JSON.parse(out.trim().split("\n").pop());
  assert.equal(report.ok, true);
  assert.equal(report.exit, 0);
});

test("`resume` over a good fixture exits 0", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "resume-clean-midpoint");
  const out = execFileSync("node", [CLI, "resume", dir, "--json"], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /"reenter_at":"qa"/);
});

test("`all` runs resume and stays green", () => {
  const out = execFileSync("node", [CLI, "all", "--json"], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /"command":"resume"/);
  assert.match(out, /"command":"all","ok":true/);
});

test("`all` runs read-discipline and stays green", () => {
  const out = execFileSync("node", [CLI, "all", "--json"], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /"command":"read-discipline"/);
  assert.match(out, /"command":"all","ok":true/);
});

test("`all` runs plugin-paths and stays green", () => {
  const out = execFileSync("node", [CLI, "all", "--json"], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /"command":"plugin-paths"/);
  assert.match(out, /"command":"all","ok":true/);
});

const SKILL = resolve(REPO, "plugins/sdlc/skills/pipeline-orchestrator/SKILL.md");

test("the 3e-heal step exists and sits between 3e validation and the 3d-3 checkpoint write", () => {
  const text = readFileSync(SKILL, "utf8");
  const validate = text.indexOf("**3e. Validate phase output:**");
  const heal = text.indexOf("**3e-heal.");
  const checkpoint = text.indexOf("**3d-3. Write the phase checkpoint");
  assert.ok(validate > -1, "3e validation step missing");
  assert.ok(heal > -1, "3e-heal step missing");
  assert.ok(checkpoint > -1, "3d-3 checkpoint step missing");
  assert.ok(validate < heal && heal < checkpoint,
    "3e-heal must run AFTER output validation and BEFORE the checkpoint write — " +
    "otherwise the checkpoint records an unhealed state or heal burns attempts on an invalid phase");
});

test("the heal contract names its capability-gate and continue-on-exhaustion rules", () => {
  const text = readFileSync(SKILL, "utf8");
  const heal = text.indexOf("**3e-heal.");
  const section = text.slice(heal, heal + 4000);
  assert.match(section, /tool unavailable on this host/,
    "heal must reuse Step 4's capability gate, else a host without the toolchain heals to the cap every phase");
  assert.match(section, /continue/i, "heal exhaustion must continue the pipeline, not halt it");
});
