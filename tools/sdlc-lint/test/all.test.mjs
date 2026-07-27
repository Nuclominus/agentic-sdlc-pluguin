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

test("the development planning gate defines a deterministic HEADLESS rule that cannot exit 0 having run nothing (Track G1 F6)", () => {
  const text = readFileSync(SKILL, "utf8");
  const gate = text.indexOf("**Approval gate:**");
  // Anchor to the next subsection heading, not a fixed length — "Pass 2 — Implementation:"
  // is the stable boundary of the approval-gate block.
  const terminator = "**Pass 2 — Implementation:**";
  const terminatorIdx = text.indexOf(terminator, gate);
  assert.ok(gate > -1, "development plan Approval gate section missing");
  assert.ok(terminatorIdx > -1, "Pass 2 terminator missing");
  const section = text.slice(gate, terminatorIdx);

  assert.match(section, /HEADLESS == true/,
    "the approval gate must branch explicitly on HEADLESS, else a headless run falls through to " +
    "the interactive ask-the-user prompt with no stdin attached — the observed nondeterministic " +
    "stop-at-$2.84-and-exit-0 defect");
  assert.match(section, /exit 1/,
    "a headless run that hits this gate must exit NON-ZERO — exiting 0 having completed zero " +
    "phases is exactly the unreliable behaviour this rule closes");
  assert.match(section, /aborted_at_phase/,
    "a headless stop at this gate must record aborted_at_phase so partial telemetry (Step 5) names " +
    "where the run stopped, same as any other full-run abort");
});

test("expected_total's heal term uses an AVERAGE-case round count, distinct from worst_total's worst-case rounds(H) (Track G1 F3)", () => {
  const text = readFileSync(SKILL, "utf8");
  const totals = text.indexOf("**4. Totals.**");
  const terminator = "#### 1d-2.";
  const terminatorIdx = text.indexOf(terminator, totals);
  assert.ok(totals > -1, "Step 1d-1 point 4 (Totals) missing");
  assert.ok(terminatorIdx > -1, "1d-2 terminator missing");
  const section = text.slice(totals, terminatorIdx);

  // Each total is a two-line formula inside the fenced code block (the heal term wraps onto a
  // continuation line) — slice expected_total's own span (up to worst_total's start) and
  // worst_total's own span (up to the closing fence) rather than a single line.
  const expectedStart = section.indexOf("expected_total");
  const worstStart = section.indexOf("worst_total", expectedStart);
  const fenceEnd = section.indexOf("```", worstStart);
  assert.ok(expectedStart > -1, "expected_total formula missing");
  assert.ok(worstStart > -1, "worst_total formula missing");
  assert.ok(fenceEnd > -1, "closing fence of the Totals formula block missing");
  const expectedLine = section.slice(expectedStart, worstStart);
  const worstLine = section.slice(worstStart, fenceEnd);

  assert.match(expectedLine, /avg_rounds\(H\)/,
    "expected_total's heal term must use avg_rounds(H), an average-case round count, matching the " +
    "loop term's own 0.5-average convention on the same line — using worst-case rounds(H) here " +
    "over-weights the WITHIN/EXCEEDS verdict (computed from expected_total) with a worst-case " +
    "assumption while the loop term next to it stays average-case");
  assert.doesNotMatch(worstLine, /avg_rounds\(H\)/,
    "worst_total must keep the full worst-case rounds(H) — every round hitting the cap is exactly " +
    "what worst-case means; it must not be softened to the average-case avg_rounds(H)");
  assert.match(worstLine, /(?<!avg_)rounds\(H\)/,
    "worst_total's heal term must still use rounds(H) (worst-case dispatch count)");

  assert.match(section, /avg_rounds\(H\)\s*=\s*1\.5/,
    "avg_rounds(H) must be pinned to 1.5 for a looped-and-guarded phase — the SAME ~1.5-round " +
    "figure the loop term already assumes, not a fraction of max_rounds");
  assert.match(section, /rounds\(H\)\s*=\s*max_rounds/,
    "rounds(H) = max_rounds must remain the worst-case definition, unchanged, feeding worst_total only");
});
