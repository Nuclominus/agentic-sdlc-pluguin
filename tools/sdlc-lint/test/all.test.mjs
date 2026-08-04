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

test("`all` runs machine-values and stays green", () => {
  const out = execFileSync("node", [CLI, "all", "--json"], { cwd: REPO, encoding: "utf8" });
  assert.match(out, /"command":"machine-values"/);
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

// RETIRED — the dry-run cost formula is no longer prose. It is caps.mjs, and the invariant this
// guarded (a heal: block over an empty heal_checks list adds exactly $0 to BOTH totals) is now
// asserted directly in caps.test.mjs, "heal costs NOTHING when the profile supplies no checks".

test("total_cost_usd is null, not 0, when no phase carries a price", () => {
  const text = readFileSync(SKILL, "utf8");
  // H3 removed the `- `total_cost_usd` = …` bullet (the formula is finish's now, ADR-0015), so
  // the window is anchored on the judgement block that replaced it. The facts below are
  // unchanged — only the model's obligation to COMPUTE them went away.
  const idx = text.indexOf("**The cost and token totals are not yours to write either.**");
  assert.ok(idx > -1, "Step 5 totals block missing");
  const end = text.indexOf("### Step 5b", idx);
  assert.ok(end > idx, "Step 5b heading (the block's terminator) missing");
  const rule = text.slice(idx, end);

  assert.match(rule, /`total_cost_usd` as\s+`null`,\s+not\s+`0`/,
    "an all-unpriced run and a genuinely free run are different facts; writing 0 asserts the " +
    "second while meaning the first. Observed in a real run: the banner honestly printed " +
    "'$— (unpriced)' while the JSON beside it carried total_cost_usd: 0");
  assert.match(rule, /cache_hit_ratio/,
    "the rule should point at cache_hit_ratio, which resolves this exact ambiguity the same way — " +
    "an unknown must not be encoded as a measured zero");
  assert.match(rule, /larger than the work it wraps/,
    "total_cost_usd includes orchestration overhead — verified across 4 real runs (1.68 = 0.51 " +
    "phases + 1.17 overhead; 1.33 = 0.33 + 1.00). A total defined as the phase sum alone " +
    "understates the run by more than the phases themselves cost");
  assert.match(rule, /NOT what the cost cap gates on/,
    "3d-cap compares running_cost_usd (phase costs only) against max_total_cost_usd, so a run can " +
    "report total_cost_usd above the cap with cap_status \"within\" and both be right. Undocumented, " +
    "that reads as a bug and invites someone to fold overhead into the gate — silently " +
    "re-tightening every existing recipe cap");
});

test("no headless ABORT contract depends on a printed marker line — telemetry state is the contract", () => {
  const text = readFileSync(SKILL, "utf8");

  // The two headless aborts. Each must NOT reintroduce a verbatim marker line, and each must
  // name _telemetry.json / aborted_at_phase as what a machine reads.
  // The headless DRY-RUN line (formerly 1d-3) is no longer prose — the resolve command emits it,
  // and caps.test.mjs / plan.test.mjs assert its shape. What remains here are the two aborts that
  // are still the orchestrator's own to perform.
  for (const [label, marker, anchor, span] of [
    ["3b-special headless gate", "ERROR: development planning gate reached", "**Approval gate:**", 4200],
    ["3d-cap headless abort", "ERROR: cost cap exceeded", "**Headless (`HEADLESS == true`), any other next-dispatch type:**", 1400],
  ]) {
    const idx = text.indexOf(anchor);
    assert.ok(idx > -1, `${label}: anchor missing`);
    const section = text.slice(idx, idx + span);

    assert.ok(!section.includes(marker) || /Earlier revisions|removed after/.test(section),
      `${label} must not require the verbatim marker "${marker}". Three consecutive real headless ` +
      "runs aborted correctly — right blocker, right aborted_at_phase, no phases dispatched — and " +
      "the marker appeared in none of them, across three phrasings including this document's own " +
      "MUST PRINT VERBATIM idiom. The orchestrator paraphrases fixed strings but reliably writes " +
      "telemetry, so a printed line cannot carry a machine contract");
    assert.match(section, /aborted_at_phase/,
      `${label} must name aborted_at_phase — with the marker line gone, telemetry state is the ` +
      "only abort signal a machine can read");
  }

  // The headless dry-run JSON is still the one signal with NO telemetry to fall back on: --dry-run
  // writes no file, so stdout is the only channel that exists. It is no longer its own prose step —
  // the resolve command composes the line — so what has to be guarded here is the rule that gets it
  // to stdout at all: Step 0's obligation to echo prints[] verbatim. Without that, a composed line
  // is just a string in a JSON blob nobody printed.
  const step0 = text.indexOf("### Step 0 — Resolve the run");
  assert.ok(step0 > -1, "Step 0 anchor missing");
  // Whitespace-collapsed: these are prose sentences in a wrapped markdown list, so where the line
  // break falls is an editing accident. Matching the raw text made an earlier edit fail for moving
  // a word across a newline — a guard that reports on reflow is a guard nobody trusts.
  const resolve = text.slice(step0, step0 + 3000).replace(/\s+/g, " ");
  assert.match(resolve, /Echo `prints\[\]` in order, verbatim/,
    "the verbatim-echo obligation is what carries every composed signal, the headless dry-run line " +
    "included; its shape is asserted in caps.test.mjs and plan.test.mjs");
  assert.match(resolve, /Do not reformat, reorder, summarise or fill a template/,
    "echoing is not paraphrasing — the values are the command's");
  assert.match(resolve, /echo the JSON's `halt`/,
    "under --json the command writes NOTHING to stderr — halt travels inside the stdout envelope. " +
    "An obligation pointing at stderr echoes an empty string, and the user gets a stop with no reason");
});

test("no rule anywhere promises an exit code or a stderr write — neither is reachable from a skill prompt", () => {
  const text = readFileSync(SKILL, "utf8");
  // 0a-1 states the constraint once and is the only place allowed to NAME the two dead channels
  // (it exists to forbid them). Everything after it must comply.
  const rule = text.indexOf("**What \"machine-readable\" can and cannot mean here");
  assert.ok(rule > -1, "0a-1's headless channel/exit-code constraint is missing");

  const offenders = [];
  for (const [label, re] of [
    ["exit-code promise", /\bexits? (?:with )?(?:code )?1\b/gi],
    // `{stderr ...}` is an INTERPOLATION of a subprocess's captured stderr, which the Bash tool
    // hands back and the orchestrator may legitimately quote. Only an unbraced `stderr` is a claim
    // about writing the host process's own stderr stream.
    ["stderr write", /(?:write|written|print)[^.\n]{0,40}\bstderr\b(?![}\s]*(?:tail)?\s*\})/gi],
  ]) {
    for (const m of text.matchAll(re)) {
      // The constraint block itself cites both as the things NOT to do.
      if (m.index >= rule && m.index < rule + 1400) continue;
      const line = text.slice(0, m.index).split("\n").length;
      offenders.push(`${label} at line ${line}: ${JSON.stringify(m[0])}`);
    }
  }
  assert.deepEqual(offenders, [],
    "this orchestrator is a prompt, not a program: it cannot set the hosting `claude -p` process's " +
    "exit code (verified — a correctly-aborting headless run exited 0) and cannot write that " +
    "process's stderr (verified — a headless run whose warn policy fired left stderr empty). Any " +
    "rule specifying either names a signal that is silently discarded. Route machine-readable " +
    "output to stdout and express aborts as artifacts (stdout marker + aborted_at_phase)");
});

test("3e-heal step 4a's pre-existing blocker names its own status, never the reserved word 'skipped'", () => {
  const text = readFileSync(SKILL, "utf8");
  const start = text.indexOf("**4a. Orchestrator-side pre-existing-breakage check");
  const terminatorIdx = text.indexOf("**4b. Attempt-budget branch**", start);
  assert.ok(start > -1, "3e-heal step 4a section missing");
  assert.ok(terminatorIdx > -1, "4b terminator missing");
  const section = text.slice(start, terminatorIdx);

  assert.match(section, /blocker `"\{phase\} heal pre-existing —/,
    "4a sets heal_status = \"pre-existing\", so its blocker template must say pre-existing too");
  assert.doesNotMatch(section, /blocker `"\{phase\} heal skipped/,
    "the blocker must not say \"heal skipped\" on a phase recorded as \"pre-existing\": \"skipped\" " +
    "is a distinct enum value collapsing three other situations, so this wording makes the prose " +
    "contradict the field beside it (observed in a real run's _telemetry.json blockers array)");
});

test("the development planning gate defines a deterministic HEADLESS rule detectable without the exit code (Track G1 F6)", () => {
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
  assert.match(section, /jq -e '\.aborted_at_phase != null'/,
    "the CI note must give the concrete telemetry gate: with no marker line and no usable exit " +
    "code, `aborted_at_phase` in _telemetry.json is the only abort signal a machine can read, and " +
    "an integrator needs to be shown exactly how to read it");
  assert.doesNotMatch(section, /\bexit 1\b/,
    "the rule must NOT promise a non-zero exit status: this orchestrator is a prompt, not a " +
    "program, and cannot set the hosting `claude -p` process's exit code — verified by execution, " +
    "a correctly-aborting headless run still exited 0");
  assert.match(section, /[Nn]ot on\s+`\$\?`/,
    "the rule must tell CI explicitly not to gate on $?, otherwise an integrator reads the abort " +
    "language and wires up the one signal that silently reports success");
  assert.match(section, /aborted_at_phase/,
    "a headless stop at this gate must record aborted_at_phase so partial telemetry (Step 5) names " +
    "where the run stopped, same as any other full-run abort");
});

// RETIRED — see caps.test.mjs, "a looped AND healed phase: expected uses avg rounds, worst uses
// max_rounds (Track G1 F3)". That test was written BECAUSE this guard lost its anchor: the
// invariant was briefly uncovered, and deleting a guard without replacing it is how that happens.

