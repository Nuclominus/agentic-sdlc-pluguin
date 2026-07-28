import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { extractFactsFrom } from "./transcript-facts.mjs";
import { knownRunAgentIds, findAgentTranscript } from "./usage.mjs";

/**
 * Every session transcript that owns at least one of this run's agents, oldest first.
 *
 * The union, not the newest: a run under `--resume` spans sessions, and a step
 * performed in the second one must not read as a miss. Never derived from the cwd —
 * the harness files a session under the directory it STARTED in, so a worktree-isolated
 * run resolves to an unrelated session (see sessionOwnsRun in the shipped usage.mjs).
 */
export function resolveRunSessions(runDir, phases, opts = {}) {
  const sessions = new Map();   // path -> mtimeMs
  for (const id of knownRunAgentIds(runDir, phases)) {
    const agentPath = findAgentTranscript(id, { projectsRoot: opts.projectsRoot });
    if (!agentPath) continue;
    // .../<sid>/subagents/agent-<id>.jsonl  ->  .../<sid>.jsonl
    const session = `${dirname(dirname(agentPath))}.jsonl`;
    if (sessions.has(session) || !existsSync(session)) continue;
    let mtime = 0;
    try { mtime = statSync(session).mtimeMs; } catch { /* unreadable: sort first */ }
    sessions.set(session, mtime);
  }
  return [...sessions.entries()].sort((a, b) => a[1] - b[1]).map(([p]) => p);
}

function telemetryValue(tel, field) {
  return field.split(".").reduce((o, k) => (o == null ? undefined : o[k]), tel);
}

function conditionHolds(cond, tel) {
  const actual = telemetryValue(tel, cond.field);
  if (cond.op === "exists") return actual !== undefined && actual !== null;
  if (cond.op === "absent") return actual === undefined || actual === null;
  const equal = actual === cond.value;
  return cond.op === "==" ? equal : !equal;
}

// A dispatch names the agent; the `<plugin>:` prefix is an install detail. Transcripts
// carry the namespaced form (`sdlc:session-recorder`), so a contract written against the
// bare agent name must still match — otherwise the contract measures the namespace and
// reports a flat 0%, which is what the first real audit run produced.
function dispatchMatches(subagentType, pattern) {
  return subagentType === pattern || subagentType.endsWith(`:${pattern}`);
}

function countMatches(contract, facts) {
  if (contract.requires === "agent_dispatch") {
    return facts.filter((f) => f.tool === "Agent" && f.subagent_type
      && dispatchMatches(f.subagent_type, contract.pattern)).length;
  }
  const re = new RegExp(contract.pattern);
  return facts.filter((f) => f.tool === "Bash" && f.command && re.test(f.command)).length;
}

// Phases that actually dispatched an agent. NOT the id set: one resumed subagent can
// serve several phases, and the denominator is phases, not distinct agents.
function expectedPhases(phases) {
  return (phases || []).filter((p) => {
    const a = p.agent_id;
    return Array.isArray(a) ? a.length > 0 : Boolean(a);
  }).length;
}

function runDate(runDir, tel) {
  const iso = typeof tel.started_at === "string" ? Date.parse(tel.started_at) : NaN;
  if (Number.isFinite(iso)) {
    return { date: new Date(iso).toISOString().slice(0, 10), date_source: "started_at" };
  }
  try {
    const m = statSync(join(runDir, "_telemetry.json")).mtimeMs;
    return { date: new Date(m).toISOString().slice(0, 10), date_source: "mtime" };
  } catch {
    return { date: null, date_source: "none" };
  }
}

function evaluate(contract, { facts, tel, phaseCount, date }) {
  const na = (reason) => ({ id: contract.id, verdict: "na", reason, matched: 0, expected: 0 });

  // Lexicographic on two YYYY-MM-DD strings is exactly chronological. `since` is
  // validated to that shape by parseContracts; `date` is built from toISOString().
  if (date && contract.since > date) return na("predates");
  for (const c of contract.applies_when) if (!conditionHolds(c, tel)) return na("not-applicable");

  const matched = countMatches(contract, facts);
  if (contract.cardinality === "once-per-phase") {
    if (phaseCount === 0) return na("phase-skipped");
    const verdict = matched >= phaseCount ? "pass" : matched > 0 ? "partial" : "fail";
    return { id: contract.id, verdict, reason: null, matched, expected: phaseCount };
  }
  return {
    id: contract.id,
    verdict: matched > 0 ? "pass" : "fail",
    reason: null, matched, expected: 1,
  };
}

/**
 * Audit ONE run directory against the contract set.
 *
 * Pure: reads files, returns a result, prints nothing and throws nothing. A run with
 * no resolvable transcript is `unauditable` and carries no verdicts at all — folding
 * such runs into the rate would silently dilute it.
 */
export function auditRun(runDir, contracts, opts = {}) {
  const base = { run: basename(runDir), dir: runDir, sessions: [], verdicts: [] };
  const telPath = join(runDir, "_telemetry.json");
  if (!existsSync(telPath)) {
    return { ...base, date: null, date_source: "none", plugin_version: null,
             status: "unauditable", reason: "no-telemetry" };
  }
  let tel;
  try { tel = JSON.parse(readFileSync(telPath, "utf8")); }
  catch { return { ...base, date: null, date_source: "none", plugin_version: null,
                   status: "unauditable", reason: "unreadable-telemetry" }; }

  const phases = tel.phases || [];
  const { date, date_source } = runDate(runDir, tel);
  const plugin_version = typeof tel.plugin_version === "string" ? tel.plugin_version : null;
  const head = { ...base, date, date_source, plugin_version };

  const sessions = resolveRunSessions(runDir, phases, opts);
  if (!sessions.length) {
    return { ...head, status: "unauditable", reason: "no-agent-ids" };
  }

  const facts = extractFactsFrom(sessions);
  const phaseCount = expectedPhases(phases);
  return {
    ...head,
    sessions,
    status: "auditable",
    reason: null,
    verdicts: contracts.map((c) => evaluate(c, { facts, tel, phaseCount, date })),
  };
}
