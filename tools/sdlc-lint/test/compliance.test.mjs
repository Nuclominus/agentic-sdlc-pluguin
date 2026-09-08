import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, utimesSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { auditRun, resolveRunSessions } from "../lib/compliance.mjs";
import { parseContracts } from "../lib/contracts.mjs";
import { aggregate, renderText } from "../lib/compliance-report.mjs";
import { extractFactsFrom } from "../lib/transcript-facts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "fixtures", "compliance");
const REPO = resolve(HERE, "..", "..", "..");
const PROJECTS = join(FIX, "projects");
const run = (name) => join(FIX, "runs", name);

const SKILLDIR = join(REPO, "plugins/sdlc/skills/pipeline-orchestrator");
const { contracts } = parseContracts([join(SKILLDIR, "SKILL.md"), join(SKILLDIR, "contracts-retired.md")]);
const audit = (name) => auditRun(run(name), contracts, { projectsRoot: PROJECTS });
const verdict = (res, id) => res.verdicts.find((v) => v.id === id);

test("a fully compliant run of the old era passes every contract that applied to it", () => {
  const res = audit("compliant");                       // dated 2026-07-28
  assert.equal(res.status, "auditable");
  assert.deepEqual(res.verdicts.filter((v) => v.verdict !== "pass" && v.verdict !== "na"), []);
  // The tail was three calls back then, and the collapsed contract did not exist yet.
  assert.equal(verdict(res, "5b-finish").reason, "predates");
});

test("a run of the new era passes the collapsed contract and retires the old three", () => {
  const res = audit("sealed");                          // dated 2026-07-30
  assert.equal(verdict(res, "5b-finish").verdict, "pass");
  for (const id of ["5-clock", "5b-0-enrich", "5b-2-report"]) {
    assert.equal(verdict(res, id).reason, "retired", id);
  }
  assert.deepEqual(res.verdicts.filter((v) => v.verdict === "fail"), []);
});

test("the incident shape fails 5b-0-enrich", () => {
  const res = audit("incident");
  assert.equal(verdict(res, "5b-0-enrich").verdict, "fail");
  assert.equal(verdict(res, "5b-2-report").verdict, "pass");
});

test("a resumed run unions its sessions rather than picking one", () => {
  const res = audit("resumed");
  assert.equal(res.sessions.length, 2);
  // The second session spells the call unquoted (`.../cli.mjs enrich`) while the
  // first uses SKILL.md's quoted form. A pattern pinned to one of them scored a real
  // enrichment as a miss on the first audit — the contract must match the command,
  // not the shell quoting around its path.
  assert.equal(verdict(res, "5b-0-enrich").verdict, "pass");
});

test("agent_dispatch matches the plugin-namespaced form of the agent name", () => {
  // The fixture's second session dispatches `sdlc:session-recorder`; the contract
  // names the bare agent. Strict equality here reported a flat 0% on the first real
  // audit — the contract was measuring the install namespace, not the step.
  assert.equal(verdict(audit("resumed"), "6-journal").verdict, "pass");
});

test("a run with no resolvable agent id is unauditable and yields no verdicts", () => {
  const res = audit("no-anchor");
  assert.equal(res.status, "unauditable");
  assert.equal(res.reason, "no-agent-ids");
  assert.deepEqual(res.verdicts, []);
});

test("a contract newer than the run is na: predates", () => {
  const v = verdict(audit("old"), "3d-1b-phase-cost");
  assert.equal(v.verdict, "na");
  assert.equal(v.reason, "predates");
});

test("once-per-phase short of its denominator is partial, with the fraction", () => {
  const v = verdict(audit("partial"), "3d-1b-phase-cost");
  assert.equal(v.verdict, "partial");
  assert.equal(v.matched, 2);
  assert.equal(v.expected, 3);
});

test("the run date comes from started_at when telemetry carries one", () => {
  const res = audit("compliant");
  assert.equal(res.date_source, "started_at");
  assert.equal(res.date, "2026-07-28");
});

test("a run that cannot be dated from its own content is scored against nothing", () => {
  // RETIRED in place (issue #116): this asserted the mtime fallback. mtime is not a property of
  // a run — a `cp -R` without `-p` restamps it — and the run date decides every `predates`
  // verdict and therefore every denominator. The full date chain is tested in the block below;
  // what this pins now is the end of it, which is silence rather than a guess.
  const res = audit("no-date");
  assert.equal(res.date, null);
  assert.equal(res.date_source, "unresolved");
  assert.equal(res.status, "auditable", "the run is still readable — it just cannot be placed in time");
  assert.ok(res.verdicts.length > 0);
  assert.ok(res.verdicts.every((v) => v.verdict === "na" && v.reason === "undated"),
    "an undated run must contribute to no rate at all; a misdated one contributes to all of them");
});

test("plugin_version is surfaced when telemetry carries it", () => {
  assert.equal(audit("compliant").plugin_version, "1.14.1");
  assert.equal(audit("incident").plugin_version, null);
});

test("sealed_by is surfaced, and absent on runs that predate the seal marker", () => {
  // Orthogonal to every verdict: it says which path sealed the run, not whether the
  // orchestrator followed a step. The auditor reads it so the two can be read together.
  assert.equal(audit("incident").sealed_by, null);
});

test("a contract retired before the run is na: retired", () => {
  const retired = [{ id: "gone", requires: "bash_match", pattern: "date -u",
    cardinality: "once-per-run", since: "2026-07-06", until: "2026-07-10", applies_when: [] }];
  const res = auditRun(run("compliant"), retired, { projectsRoot: PROJECTS });   // run dated 2026-07-28
  assert.equal(res.verdicts[0].verdict, "na");
  assert.equal(res.verdicts[0].reason, "retired");
});

test("a run inside the retirement window is still judged", () => {
  const retired = [{ id: "still-live", requires: "bash_match", pattern: "date -u",
    cardinality: "once-per-run", since: "2026-07-06", until: "2026-07-31", applies_when: [] }];
  const res = auditRun(run("compliant"), retired, { projectsRoot: PROJECTS });
  assert.equal(res.verdicts[0].verdict, "pass");
});

// ---- issue #116: the run date comes from the run, never from the filesystem -------------
//
// mtime is not a property of a run. Copying, restoring, archiving or syncing a directory
// rewrites it, and the date decides every `predates` verdict and so every denominator. A
// `cp -R` without `-p` while merging two corpora moved three published rates by up to 37
// points — `5b-finish` from 100% to 63% — and both outputs looked equally healthy.

/** A run directory plus a projects root, built on disk so the whole chain is exercised. */
function dated({ startedAt = null, anchor = null, checkpointAt = null, transcriptAt = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-date-"));
  const runDir = join(dir, "run");
  const projects = join(dir, "projects", "proj");
  const subagents = join(projects, "sess", "subagents");
  mkdirSync(join(runDir, ".checkpoint"), { recursive: true });
  mkdirSync(subagents, { recursive: true });

  const tel = { task_slug: "r", phases: [{ phase: "development", agent_id: "abc123abc123" }] };
  if (startedAt) tel.started_at = startedAt;
  writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify(tel));
  if (anchor != null) writeFileSync(join(runDir, ".checkpoint", "_started_at"), String(anchor));
  if (checkpointAt) {
    writeFileSync(join(runDir, ".checkpoint", "development.json"),
      JSON.stringify({ phase: "development", agent_id: "abc123abc123", completed_at: checkpointAt }));
  }
  writeFileSync(join(subagents, "agent-abc123abc123.jsonl"), "");
  writeFileSync(join(projects, "sess.jsonl"),
    transcriptAt ? JSON.stringify({ timestamp: transcriptAt, message: { role: "assistant", content: [] } }) : "");
  return { dir, runDir, projects };
}
const dateOf = (w) => auditRun(w.runDir, contracts, { projectsRoot: w.projects });

test("#116 chain 1: telemetry's own started_at wins", () => {
  const w = dated({ startedAt: "2026-07-28T10:00:00Z", anchor: 1700000000, checkpointAt: "2020-01-01T00:00:00Z" });
  try {
    const r = dateOf(w);
    assert.equal(r.date_source, "started_at");
    assert.equal(r.date, "2026-07-28");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("#116 chain 2: the .checkpoint/_started_at anchor, in epoch SECONDS", () => {
  // ADR-0014's machine anchor: `date -u +%s`. Read as seconds, or the run lands in 1970 and
  // predates every contract there is.
  const w = dated({ anchor: 1785304015, checkpointAt: "2020-01-01T00:00:00Z" });
  try {
    const r = dateOf(w);
    assert.equal(r.date_source, "checkpoint_anchor");
    assert.equal(r.date, "2026-07-29");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("#116 chain 2b: a millisecond anchor is not read as 1970", () => {
  const w = dated({ anchor: 1785304015000 });
  try { assert.equal(dateOf(w).date, "2026-07-29"); } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("#116 chain 3: the oldest checkpoint's completed_at, model-typed but run-specific", () => {
  const w = dated({ checkpointAt: "2026-07-29T09:00:00Z", transcriptAt: "2020-01-01T00:00:00Z" });
  try {
    const r = dateOf(w);
    assert.equal(r.date_source, "checkpoint_completed_at");
    assert.equal(r.date, "2026-07-29");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("#116 chain 4: the owning session transcript, last because it dates the SESSION", () => {
  // Harness-written and reliable, but a resumed session can start days before the run it later
  // performs — which would wrongly age the run and turn live contracts into `predates`.
  const w = dated({ transcriptAt: "2026-07-30T08:00:00Z" });
  try {
    const r = dateOf(w);
    assert.equal(r.date_source, "session_transcript");
    assert.equal(r.date, "2026-07-30");
  } finally { rmSync(w.dir, { recursive: true, force: true }); }
});

test("#116 acceptance: a copy WITHOUT -p produces the same verdicts as the original", () => {
  // The literal reproduction. `cpSync` does not preserve mtimes, which is what `cp -R` did.
  const w = dated({ anchor: 1785304015 });
  const copyRoot = mkdtempSync(join(tmpdir(), "sdlc-datecopy-"));
  try {
    const copied = join(copyRoot, "run");
    cpSync(w.runDir, copied, { recursive: true });
    const before = dateOf(w);
    const after = auditRun(copied, contracts, { projectsRoot: w.projects });
    assert.notEqual(statSync(join(copied, "_telemetry.json")).mtimeMs,
      statSync(join(w.runDir, "_telemetry.json")).mtimeMs, "the copy really did restamp mtime");
    assert.equal(after.date, before.date, "…and the audited date did not move with it");
    assert.deepEqual(after.verdicts.map((v) => `${v.id}:${v.verdict}:${v.reason}`),
      before.verdicts.map((v) => `${v.id}:${v.verdict}:${v.reason}`));
  } finally {
    rmSync(w.dir, { recursive: true, force: true });
    rmSync(copyRoot, { recursive: true, force: true });
  }
});

test("#116 chain 4 does not depend on which session mtime happens to sort first", () => {
  // resolveRunSessions orders sessions by MTIME. Taking the first session's first timestamp
  // would leave the "content-derived" chain resting on the filesystem at its last link — the
  // very defect it exists to remove. The earliest timestamp across ALL sessions is order-free.
  const dir = mkdtempSync(join(tmpdir(), "sdlc-date2-"));
  try {
    const runDir = join(dir, "run");
    const projects = join(dir, "projects", "proj");
    mkdirSync(join(runDir, ".checkpoint"), { recursive: true });
    writeFileSync(join(runDir, "_telemetry.json"), JSON.stringify({
      task_slug: "r",
      phases: [{ phase: "development", agent_id: "aaa" }, { phase: "qa", agent_id: "bbb" }],
    }));
    // Two sessions: the OLDER run happened in `late.jsonl`'s file, whose mtime we make newest.
    for (const [sid, agent, ts] of [["early", "aaa", "2026-07-20T08:00:00Z"], ["late", "bbb", "2026-07-25T08:00:00Z"]]) {
      mkdirSync(join(projects, sid, "subagents"), { recursive: true });
      writeFileSync(join(projects, sid, "subagents", `agent-${agent}.jsonl`), "");
      writeFileSync(join(projects, `${sid}.jsonl`), JSON.stringify({ timestamp: ts, message: { role: "assistant", content: [] } }));
    }
    const dateWith = (newest) => {
      // Restamp so `newest` sorts last, then first — the answer must not move.
      utimesSync(join(projects, "early.jsonl"), new Date(newest === "early" ? 3e9 : 1e9), new Date(newest === "early" ? 3e9 : 1e9));
      utimesSync(join(projects, "late.jsonl"), new Date(newest === "late" ? 3e9 : 1e9), new Date(newest === "late" ? 3e9 : 1e9));
      return auditRun(runDir, contracts, { projectsRoot: projects });
    };
    const a = dateWith("early"), b = dateWith("late");
    assert.equal(a.date_source, "session_transcript");
    assert.equal(a.date, "2026-07-20", "the EARLIEST session dates the run");
    assert.equal(b.date, a.date, "and reordering the files' mtimes must not move it");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an undated run does not render as a ✓ in the per-run detail", () => {
  // All-`na` means `bad` is empty, so the old renderer printed the same ✓ a fully compliant run
  // gets. "Both outputs look equally healthy" is the sentence issue #116 was filed over.
  const res = audit("no-date");
  const text = renderText(aggregate([res], contracts), [res]);
  assert.ok(!/✓\s+no-date/.test(text), "a run scored against nothing must not read as one that passed");
  assert.match(text, /\?\s+no-date\s+undated — scored against no contract/);
  assert.match(text, /undated — scored against nothing, so absent from every rate above \(1\)/);
});

// ---- resolveRunSessions, directly (#129) ------------------------------------------------
//
// It was exercised only transitively, through the `resumed` fixture. Its ordering contract is
// what decides fact `seq` order across files, and therefore once-per-phase counting — so it
// deserves assertions of its own rather than inheriting them from a run-level test.

test("resolveRunSessions returns every session owning one of the run's agents, oldest mtime first", () => {
  const sessions = resolveRunSessions(run("resumed"),
    [{ phase: "development", agent_id: "ddd444" }, { phase: "qa", agent_id: "eee555" }],
    { projectsRoot: PROJECTS });
  assert.deepEqual(sessions.map((s) => s.split("/").pop()), ["sess-a.jsonl", "sess-b.jsonl"]);

  // The ORDER is mtime, not argument order — restamping must reorder the result. This is the
  // property #128 deliberately kept the run DATE independent of; the fact stream still rides on
  // it, which is why it is pinned here rather than assumed either way.
  const [a, b] = sessions;
  utimesSync(a, new Date(3e9), new Date(3e9));
  utimesSync(b, new Date(1e9), new Date(1e9));
  try {
    const flipped = resolveRunSessions(run("resumed"),
      [{ phase: "development", agent_id: "ddd444" }, { phase: "qa", agent_id: "eee555" }],
      { projectsRoot: PROJECTS });
    assert.deepEqual(flipped.map((s) => s.split("/").pop()), ["sess-b.jsonl", "sess-a.jsonl"]);
  } finally {
    // Fixtures are checked-in files: leave their mtimes as found, or the next test inherits them.
    utimesSync(a, new Date(2e9), new Date(2e9));
    utimesSync(b, new Date(2e9), new Date(2e9));
  }
});

test("resolveRunSessions de-duplicates a session that owns several of the run's agents", () => {
  const sessions = resolveRunSessions(run("compliant"),
    [{ phase: "development", agent_id: "aaa111" }, { phase: "qa", agent_id: "bbb222" }],
    { projectsRoot: PROJECTS });
  assert.equal(sessions.length, 1, "aaa111 and bbb222 both live in sess-a — that is one session");
});

test("resolveRunSessions yields nothing when no agent id resolves, rather than guessing", () => {
  assert.deepEqual(resolveRunSessions(run("compliant"), [], { projectsRoot: PROJECTS }), []);
  assert.deepEqual(
    resolveRunSessions(run("compliant"), [{ phase: "x", agent_id: "no-such-agent" }], { projectsRoot: PROJECTS }), [],
    "an unresolvable id makes the run unauditable — it must never fall back to some other session");
});

test("a run spanning two sessions is audited as ONE fact stream", () => {
  // The reason resolveRunSessions exists. `6-journal` is performed in the second session; scoring
  // only the first would report it as a miss, which is the failure mode the union prevents.
  const res = audit("resumed");
  assert.equal(res.sessions.length, 2);
  assert.equal(verdict(res, "6-journal").verdict, "pass");
  const facts = extractFactsFrom(res.sessions);
  assert.deepEqual(facts.map((f) => f.seq), facts.map((_, i) => i),
    "seq is renumbered across files, so a contract counting occurrences sees one ordered stream");
  assert.equal(new Set(facts.map((f) => f.source)).size, 2, "and both files really did contribute");
});

// --- every-dispatch: the ADR-0021 expertise hand-off (PR-4) -------------------------------
// The denominator is the point. A review loop dispatches `development` three times, so a
// once-per-phase count of matches passes at 9 matches against 7 phases while one dispatch
// carried nothing. Scoping to the agents the run says it rendered a block for makes one
// miss one short.
const DISPATCH_FIX = join(FIX, "skill-contracts-dispatch.md");

test("every-dispatch counts dispatches in scope, so a single missed block fails the run", () => {
  const { contracts: cs } = parseContracts(DISPATCH_FIX);
  const c = cs.filter((x) => x.id === "3b-1a-expertise-block");
  const res = auditRun(run("expertise-gap"), c, { projectsRoot: PROJECTS });
  assert.equal(res.status, "auditable");
  const v = verdict(res, "3b-1a-expertise-block");
  assert.equal(v.expected, 3, "three dispatches went to agents the run rendered a block for");
  assert.equal(v.matched, 2, "document-writer's dispatch carried no block");
  assert.equal(v.verdict, "partial");
});

test("a dispatch to an agent outside the scope is not counted for or against", () => {
  const { contracts: cs } = parseContracts(DISPATCH_FIX);
  const c = cs.filter((x) => x.id === "3b-1a-expertise-block");
  const res = auditRun(run("expertise-gap"), c, { projectsRoot: PROJECTS });
  // session-recorder is dispatched but has no role_expertise, so it is neither expected nor matched.
  assert.equal(verdict(res, "3b-1a-expertise-block").expected, 3);
});

test("a run whose telemetry names no scope field is n/a, never a silent pass", () => {
  const { contracts: cs } = parseContracts(DISPATCH_FIX);
  const c = cs.filter((x) => x.id === "3b-1a-expertise-block");
  // Same era as the contract, but the run declares no expertise_block_agents — a vanilla stack
  // legitimately renders no block, and that must read as "nothing to check", not as compliance.
  const res = auditRun(run("no-expertise-scope"), c, { projectsRoot: PROJECTS });
  const v = verdict(res, "3b-1a-expertise-block");
  assert.equal(v.verdict, "na");
  assert.equal(v.reason, "no-dispatch-scope");
});

test("every-dispatch counts only the dispatches inside the run's own window", () => {
  // Review finding 3 on #146. The fact stream is SESSION-wide: two SDLC runs in one session see
  // each other's dispatches. For once-per-run that only dilutes; for every-dispatch it invents a
  // failure, because a neighbouring run's dispatch enters `expected` and can never match. The
  // run's own started_at/completed_at bound it. sess-e dispatches at :01 developer(block),
  // :02 reviewer(block), :03 document-writer(no block), :04 session-recorder(out of scope);
  // this run owns :02-:03 only.
  const { contracts: cs } = parseContracts(DISPATCH_FIX);
  const c = cs.filter((x) => x.id === "3b-1a-expertise-block");
  const v = verdict(auditRun(run("expertise-window"), c, { projectsRoot: PROJECTS }), "3b-1a-expertise-block");
  assert.equal(v.expected, 2, "the developer dispatch at :01 belongs to a different run");
  assert.equal(v.matched, 1);
  assert.equal(v.verdict, "partial");
});

test("a run with no completed_at is scored against its whole session rather than nothing", () => {
  // A half-open window would silently drop every dispatch and read as a clean n/a. Falling back
  // to the full stream keeps the old (diluting) behaviour, which is the honest degradation.
  const { contracts: cs } = parseContracts(DISPATCH_FIX);
  const c = cs.filter((x) => x.id === "3b-1a-expertise-block");
  const v = verdict(auditRun(run("expertise-gap"), c, { projectsRoot: PROJECTS }), "3b-1a-expertise-block");
  assert.equal(v.expected, 3, "expertise-gap carries no completed_at — all three in-scope dispatches count");
});

// --- every-mandate: did the subagent invoke what its prompt mandated of it? -----------------
// Three runs measured this by hand, one dispatch at a time. The auditor could not: it resolves
// a subagent transcript only to walk UP to the parent session, so a subagent's own `Skill` calls
// — the entire evidence — were never read.
const MANDATE_FIX = join(FIX, "skill-contracts-mandate.md");
const mandateContract = () => parseContracts(MANDATE_FIX).contracts.filter((c) => c.id === "3b-1a-mandatory-skill");

test("every-mandate counts skill mandates, not dispatches, and pairs each with its own subagent", () => {
  // developer was mandated 2 and invoked 1; document-writer was mandated 1 and invoked none —
  // the two shapes measured on real runs (a review-loop round, and a documentation phase).
  const res = auditRun(run("mandate-gap"), mandateContract(), { projectsRoot: PROJECTS });
  assert.equal(res.status, "auditable");
  const v = verdict(res, "3b-1a-mandatory-skill");
  assert.equal(v.expected, 3, "two mandates on one dispatch plus one on the other");
  assert.equal(v.matched, 1);
  assert.equal(v.verdict, "partial");
});

test("a mandate is met by the bare skill name the harness also accepts", () => {
  // Measured on run 5 (growth-log-screen). The mandate reads `frontend-design:frontend-design`;
  // the subagent invoked `frontend-design`, which the harness resolves to the same skill. Comparing
  // the two strings exactly scored a skill that WAS invoked as a miss — the same defect
  // `dispatchMatches` already fixes for agent names, where a contract written against the bare name
  // must still match a namespaced dispatch. Left unfixed, the auditor measures the namespace.
  // Five mandates against three invocations, covering every branch of the rule:
  //   `frontend-design:frontend-design` ← Skill(`frontend-design`)            bare invoked   ✓
  //   `superpowers:test-driven-development` ← same                            exact          ✓
  //   `brainstorming` ← Skill(`superpowers:brainstorming`)                    bare mandated  ✓
  //   `acme:other`                                                            never invoked  ✗
  //   `acme:brainstorming` vs Skill(`superpowers:brainstorming`)              same tail      ✗
  // The last row is the one that pins the rule's narrowness: two namespaced ids that share a
  // skill segment are different skills, and matching them would invent an ambiguity nobody wrote.
  const res = auditRun(run("mandate-bare"), mandateContract(), { projectsRoot: PROJECTS });
  assert.equal(res.status, "auditable");
  const v = verdict(res, "3b-1a-mandatory-skill");
  assert.equal(v.expected, 5);
  assert.equal(v.matched, 3);
  assert.equal(v.verdict, "partial");
});

test("every-mandate is n/a when the run declares no scope, never a pass", () => {
  const v = verdict(auditRun(run("no-expertise-scope"), mandateContract(), { projectsRoot: PROJECTS }),
    "3b-1a-mandatory-skill");
  assert.equal(v.verdict, "na");
  assert.equal(v.reason, "no-dispatch-scope");
});

test("a mandate pattern that captures nothing is rejected at parse time", () => {
  // Without a capture group there is no skill id to compare, so the contract would silently
  // score every mandate as unmet — a flat 0% that reads exactly like total non-compliance.
  const { contracts, errors } = parseContracts(MANDATE_FIX);
  assert.equal(contracts.some((c) => c.id === "no-capture"), false);
  assert.ok(errors.some((e) => /no-capture/.test(e) && /capture/.test(e)), errors.join("; "));
});
