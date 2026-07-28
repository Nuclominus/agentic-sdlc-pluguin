import { existsSync, readFileSync } from "node:fs";
import YAML from "yaml";

export const REQUIRES = new Set(["bash_match", "agent_dispatch"]);
export const CARDINALITIES = new Set(["once-per-run", "once-per-phase"]);
export const OPS = new Set(["==", "!=", "exists", "absent"]);

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
  } else if (raw.requires === "bash_match") {
    try { new RegExp(raw.pattern); } catch (e) { errs.push(`${label}: uncompilable pattern — ${e.message}`); }
  }
  if (typeof raw.since !== "string" || !ISO_DATE.test(raw.since) || Number.isNaN(Date.parse(raw.since))) {
    errs.push(`${label}: since must be YYYY-MM-DD, got '${raw.since}'`);
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
      cardinality: raw.cardinality, since: raw.since, applies_when: conditions,
    },
  };
}

/**
 * Read every `sdlc-contract` block out of a SKILL.md.
 *
 * The contracts live inside the skill, adjacent to the prose they describe, so
 * that renumbering a step without updating its contract shows up in one diff. A
 * manifest kept in a separate file drifts on the first such edit and then either
 * fails forever or silently audits nothing.
 *
 * Returns errors rather than throwing: the CLI decides whether a malformed
 * contract is fatal.
 */
export function parseContracts(skillPath) {
  if (!skillPath || !existsSync(skillPath)) {
    return { contracts: [], errors: [`cannot read ${skillPath}`] };
  }
  let text;
  try { text = readFileSync(skillPath, "utf8"); }
  catch (e) { return { contracts: [], errors: [`cannot read ${skillPath}: ${e.message}`] }; }

  const contracts = [], errors = [], seen = new Set();
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
  return { contracts, errors };
}
