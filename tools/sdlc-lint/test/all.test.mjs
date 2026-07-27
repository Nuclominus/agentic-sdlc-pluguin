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
  // Anchor the window to the step's own DRIFT GUARD terminator, not a fixed length — a fixed
  // window that outlives a future reword would spill into Step 4, which ALSO contains
  // "tool unavailable on this host" and "continue", making both assertions pass vacuously.
  const guardMarker = "Track G1. -->";
  const guardIdx = text.indexOf(guardMarker, heal);
  assert.ok(heal > -1, "3e-heal step missing");
  assert.ok(guardIdx > -1, "3e-heal DRIFT GUARD terminator missing");
  const section = text.slice(heal, guardIdx + guardMarker.length);
  assert.match(section, /tool unavailable on this host/,
    "heal must reuse Step 4's capability gate, else a host without the toolchain heals to the cap every phase");
  assert.match(section, /Never halt the run/,
    "heal exhaustion must continue the pipeline, not halt it — pin the explicit wording, not a bare /continue/i which Step 4 would also satisfy");
});

test("3e-heal's orchestrator-side pre-existing check (step 4a) runs BEFORE the heal re-dispatch (step 5)", () => {
  const text = readFileSync(SKILL, "utf8");
  const heal = text.indexOf("**3e-heal.");
  const preExisting = text.indexOf("**4a. Orchestrator-side pre-existing-breakage check", heal);
  const dispatch = text.indexOf("5. **The heal re-dispatch.", heal);
  assert.ok(heal > -1, "3e-heal step missing");
  assert.ok(preExisting > -1, "orchestrator-side pre-existing-breakage check (step 4a) missing");
  assert.ok(dispatch > -1, "heal re-dispatch (step 5) missing");
  assert.ok(preExisting < dispatch,
    "the orchestrator-side pre-existing check must run BEFORE the heal dispatch — it already holds " +
    "heal_touched_files and the failing command's output, so it must resolve pre-existing breakage " +
    "at zero attempt cost before a dispatch that would burn one");
});

test("the dry-run cost formula gates BOTH heal terms on non-empty heal_checks", () => {
  const text = readFileSync(SKILL, "utf8");
  const totals = text.indexOf("**4. Totals.**");
  // Anchor to the next subsection heading, not a fixed length — 1d-2 is the stable boundary
  // of the Totals point, same anchoring discipline as the 3e-heal DRIFT GUARD window above.
  const terminator = "#### 1d-2.";
  const terminatorIdx = text.indexOf(terminator, totals);
  assert.ok(totals > -1, "Step 1d-1 point 4 (Totals) missing");
  assert.ok(terminatorIdx > -1, "1d-2 terminator missing");
  const section = text.slice(totals, terminatorIdx);
  const matches = section.match(/Σ over healed phases WITH non-empty heal_checks/g) || [];
  assert.equal(matches.length, 2,
    "both expected_total AND worst_total must sum their heal term only over phases whose active " +
    "profile supplies non-empty heal_checks — otherwise a vanilla stack's inert heal: blocks " +
    "(no heal_checks defined) inflate the dry-run estimate for healing that can never fire");
});
