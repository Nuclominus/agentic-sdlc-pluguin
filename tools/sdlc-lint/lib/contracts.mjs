import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";

export const REQUIRES = new Set(["bash_match", "agent_dispatch", "agent_prompt", "agent_skill"]);
export const CARDINALITIES = new Set(["once-per-run", "once-per-phase", "every-dispatch", "every-mandate"]);
// `agent_skill` needs the pattern to CAPTURE the skill id out of the dispatch prompt; without a
// group there is nothing to compare against what the subagent invoked, and every mandate would
// score unmet — a flat 0% indistinguishable from total non-compliance.
const CAPTURING = /\((?!\?[:=!])/;
export const OPS = new Set(["==", "!=", "exists", "absent"]);

// `every-dispatch` needs a denominator the run declares about itself, because the phase count
// cannot supply one: a review loop dispatches the same phase several times, so `matched >=
// phaseCount` passes while one dispatch of eleven silently carried nothing. `dispatch_scope`
// names a telemetry field listing the agents the contract applies to; expected is then the
// number of dispatches TO those agents, and one miss is one short.
const SCOPE = /^telemetry\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)$/;

// A fenced block whose info string is exactly `sdlc-contract`. Non-greedy body so
// consecutive blocks do not merge into one.
const BLOCK = /^```sdlc-contract[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

// `telemetry.<dotted.path> <op>[ <value>]` — deliberately not an expression
// language. The moment the grammar grows parentheses it needs its own test suite.
const CONDITION = /^telemetry\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\s+(==|!=|exists|absent)(?:\s+(.*))?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseCondition(raw) {
  const m = CONDITION.exec(String(raw).trim());
  if (!m) return null;
  const [, field, op, rest] = m;
  if (op === "exists" || op === "absent") {
    return rest && rest.trim() ? null : { field, op, value: null };
  }
  if (!rest || !rest.trim()) return null;
  let value;
  try { value = YAML.parse(rest.trim()); } catch { value = rest.trim(); }
  return { field, op, value };
}

function validate(raw, seen) {
  const errs = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: ["contract block is not a mapping"] };
  }
  const id = raw.id;
  const label = typeof id === "string" && id ? `'${id}'` : "(unnamed)";
  if (typeof id !== "string" || !id) errs.push("missing required field 'id'");
  else if (seen.has(id)) errs.push(`duplicate id '${id}'`);

  if (!REQUIRES.has(raw.requires)) {
    errs.push(`${label}: unknown requires '${raw.requires}' (expected ${[...REQUIRES].join(" | ")})`);
  }
  if (!CARDINALITIES.has(raw.cardinality)) {
    errs.push(`${label}: unknown cardinality '${raw.cardinality}' (expected ${[...CARDINALITIES].join(" | ")})`);
  }
  if (typeof raw.pattern !== "string" || !raw.pattern) {
    errs.push(`${label}: missing required field 'pattern'`);
  } else if (raw.requires === "bash_match" || raw.requires === "agent_prompt" || raw.requires === "agent_skill") {
    try { new RegExp(raw.pattern); } catch (e) { errs.push(`${label}: uncompilable pattern — ${e.message}`); }
    if (raw.requires === "agent_skill" && !CAPTURING.test(raw.pattern)) {
      errs.push(`${label}: an 'agent_skill' pattern must capture the skill id in a group, e.g. \`MANDATORY — invoke \\\`([^\\\`]+)\\\`\``);
    }
  }

  // `dispatch_scope` belongs to `every-dispatch` and to nothing else: required there so the
  // denominator is never guessed, rejected elsewhere so it cannot sit in a contract reading as
  // if it constrained something.
  let dispatch_scope = null;
  const SCOPED_CARDINALITY = { "every-dispatch": "agent_prompt", "every-mandate": "agent_skill" };
  if (SCOPED_CARDINALITY[raw.cardinality]) {
    // Each evaluates the dispatch PROMPT, so each is meaningful only with its own `requires`.
    // Paired with anything else the evaluator would still compile this pattern — which validation
    // above only checks for the requires that own one — and throw out of `new RegExp` mid-audit,
    // taking the whole corpus run down with it.
    const need = SCOPED_CARDINALITY[raw.cardinality];
    if (raw.requires !== need) {
      errs.push(`${label}: cardinality '${raw.cardinality}' requires '${need}', got '${raw.requires}'`);
    }
    if (typeof raw.dispatch_scope !== "string" || !raw.dispatch_scope) {
      errs.push(`${label}: cardinality '${raw.cardinality}' requires 'dispatch_scope' (a telemetry.<field> naming the agents in scope)`);
    } else {
      const m = SCOPE.exec(raw.dispatch_scope.trim());
      if (!m) errs.push(`${label}: dispatch_scope must be telemetry.<field>, got '${raw.dispatch_scope}'`);
      else dispatch_scope = m[1];
    }
  } else if (raw.dispatch_scope != null) {
    errs.push(`${label}: dispatch_scope is only meaningful with a dispatch-scoped cardinality (${Object.keys(SCOPED_CARDINALITY).join(" | ")})`);
  }
  if (typeof raw.since !== "string" || !ISO_DATE.test(raw.since) || Number.isNaN(Date.parse(raw.since))) {
    errs.push(`${label}: since must be YYYY-MM-DD, got '${raw.since}'`);
  }
  // `until` marks a contract retired: the step it describes was replaced on that date.
  // Optional — a live contract has no closing edge.
  if (raw.until != null) {
    if (typeof raw.until !== "string" || !ISO_DATE.test(raw.until) || Number.isNaN(Date.parse(raw.until))) {
      errs.push(`${label}: until must be YYYY-MM-DD, got '${raw.until}'`);
    } else if (typeof raw.since === "string" && ISO_DATE.test(raw.since) && raw.until < raw.since) {
      errs.push(`${label}: until '${raw.until}' precedes since '${raw.since}'`);
    }
  }

  const conditions = [];
  const aw = raw.applies_when;
  if (aw != null) {
    if (!Array.isArray(aw)) errs.push(`${label}: applies_when must be a list`);
    else for (const c of aw) {
      const parsed = parseCondition(c);
      if (!parsed) errs.push(`${label}: unparseable applies_when condition '${c}'`);
      else conditions.push(parsed);
    }
  }

  if (errs.length) return { errors: errs };
  return {
    errors: [],
    contract: {
      id, requires: raw.requires, pattern: raw.pattern,
      cardinality: raw.cardinality, since: raw.since, until: raw.until ?? null,
      applies_when: conditions, dispatch_scope,
    },
  };
}

/**
 * Read every `sdlc-contract` block out of one or more files.
 *
 * Live contracts live inside `SKILL.md`, adjacent to the prose they describe, so
 * that renumbering a step without updating its contract shows up in one diff. A
 * manifest kept apart from the procedure drifts on the first such edit and then
 * either fails forever or silently audits nothing.
 *
 * RETIRED contracts are read from a second file. A contract carrying an `until`
 * describes a procedure that no longer exists and therefore cannot drift from it,
 * while keeping dead blocks inside the live procedure would grow exactly the
 * prompt surface Track H is trying to shrink.
 *
 * Returns errors rather than throwing: the CLI decides whether a malformed
 * contract is fatal. `seen` spans the whole set, so an id duplicated across two
 * files is caught.
 */
export function parseContracts(pathOrPaths) {
  const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];
  const contracts = [], errors = [], seen = new Set();
  for (const p of paths) {
    if (!p || !existsSync(p)) { errors.push(`cannot read ${p}`); continue; }
    let text;
    try { text = readFileSync(p, "utf8"); }
    catch (e) { errors.push(`cannot read ${p}: ${e.message}`); continue; }
    BLOCK.lastIndex = 0;
    for (const m of text.matchAll(BLOCK)) {
      let raw;
      try { raw = YAML.parse(m[1]); }
      catch (e) { errors.push(`contract block: unparseable YAML — ${e.message}`); continue; }
      const { errors: errs, contract } = validate(raw, seen);
      if (errs.length) { errors.push(...errs); continue; }
      seen.add(contract.id);
      contracts.push(contract);
    }
  }
  return { contracts, errors };
}
