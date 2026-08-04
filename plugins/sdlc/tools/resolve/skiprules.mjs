// Step 0c — skip-rule analysis. Deterministic, and conservative by construction: when a
// signal cannot be established the rules must not fire.
//
// One thing the prose gets wrong in practice and this module fixes: it hard-codes
// `origin/main` in all three git commands. Neither consumer project uses that name — both
// live on `develop`, and the transcripts show the model probing for the right ref before
// diffing (`git rev-parse --verify origin/develop`). A hard-coded base either errors, and
// every signal falls back to "no skip", or worse, silently diffs against the wrong branch.
// The base ref is therefore RESOLVED, and the resolved name travels in the output so a
// reader can see which branch a skip was justified against.

import { execFileSync } from "node:child_process";

const CONFIG_EXT = /\.(env|env\..+|ya?ml|json|toml|ini)$/i;
const MIGRATION_PATH = /(database\/migrations|\/migrations\/)/;
const SENSITIVE_PATH = /(auth|password|crypt|secret|token|jwt|session)/i;
const TYPO_ARGS = /^(typo|fix typo|rename .* to|format)/i;

/** Signals that make every rule stay silent. Used whenever git cannot answer. */
export const SAFE_DEFAULTS = Object.freeze({
  loc_touched: 999999,
  has_migrations: true,
  config_only: false,
  whitespace_only: false,
  changed_files: [],
  base_ref: null,
  degraded: true,
});

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}
function gitOrNull(cwd, args) {
  try { return git(cwd, args); } catch { return null; }
}

/**
 * The branch this work forks from.
 *
 * `origin/HEAD` is the repository's own answer and is preferred; the named fallbacks exist
 * because a clone made with `--single-branch`, or one whose origin/HEAD was never set, has
 * no symbolic ref to read.
 */
export function resolveBaseRef(cwd, preferred = null) {
  const candidates = [];
  if (preferred) candidates.push(preferred);
  const sym = gitOrNull(cwd, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  if (sym) candidates.push(sym.trim().replace(/^refs\/remotes\//, ""));
  candidates.push("origin/main", "origin/master", "origin/develop");
  for (const ref of candidates) {
    if (gitOrNull(cwd, ["rev-parse", "--verify", "--quiet", ref])) return ref;
  }
  return null;
}

/**
 * Compute the four diff signals in one pass.
 *
 * Any git failure — no remote, detached HEAD, not a repository — yields SAFE_DEFAULTS with
 * `degraded: true`, so no rule can fire on a signal that was never established.
 */
export function computeDiffSignals(cwd = process.cwd(), { baseRef = null } = {}) {
  const base = resolveBaseRef(cwd, baseRef);
  if (!base) return { ...SAFE_DEFAULTS, reason: "no comparable base ref" };

  const range = `${base}...HEAD`;
  const names = gitOrNull(cwd, ["diff", "--name-only", range]);
  const numstat = gitOrNull(cwd, ["diff", "--numstat", range]);
  if (names === null || numstat === null) return { ...SAFE_DEFAULTS, base_ref: base, reason: `git diff against ${base} failed` };

  const changed = names.split("\n").map((s) => s.trim()).filter(Boolean);
  let added = 0, deleted = 0;
  for (const line of numstat.split("\n")) {
    const [a, d] = line.split("\t");
    if (a === undefined) continue;
    added += Number(a) || 0;               // "-" for binary files -> 0, matching awk
    deleted += Number(d) || 0;
  }

  // Whitespace-only: the -w diff is empty while the plain diff is not.
  const plainStat = gitOrNull(cwd, ["diff", "--shortstat", range]) ?? "";
  const wStat = gitOrNull(cwd, ["diff", "--shortstat", "-w", range]) ?? "";
  const hasChanges = /insertion|deletion/.test(plainStat);
  const whitespaceOnly = hasChanges && !/insertion|deletion/.test(wStat);

  return {
    loc_touched: added + deleted,
    added,
    deleted,
    has_migrations: changed.some((f) => MIGRATION_PATH.test(f)),
    config_only: changed.length > 0 && changed.every((f) => CONFIG_EXT.test(f)),
    whitespace_only: whitespaceOnly,
    changed_files: changed,
    base_ref: base,
    degraded: false,
  };
}

export const SECURITY_LITE_INJECTION = `SECURITY-LITE MODE: this run skipped the dedicated security phase. Before
returning your compact summary, run:
  rg -n -i 'aws[_-]?access|api[_-]?key|secret|password|bearer|token' -- <changed files>
Report any matches in your compact summary under a \`SECRET-LEAK CHECK:\` line
(value: "clean" or "found: <count> — see N-development.md").`;

/**
 * Apply the four rules, in order, to the phases that are still present.
 *
 * Ordering is load-bearing: a phase removed by an earlier rule cannot be removed again, and
 * a phase the project already disabled via `skip_phases` was never a candidate. Returns the
 * applied list, the remaining phases, and any prompt injection a rule owes a phase.
 */
export function applySkipRules(signals, { args = "", phases = [], forceBa = false, disabled = false } = {}) {
  const remaining = new Set(phases);
  const applied = [];
  const injections = {};

  if (disabled || signals.degraded) {
    return { applied, phases: [...remaining], injections, suppressed: disabled ? "--no-skip-rules" : "degraded signals" };
  }

  const drop = (rule, phase, reason) => {
    if (!remaining.has(phase)) return false;
    remaining.delete(phase);
    applied.push({ rule, phase_skipped: phase, reason });
    return true;
  };
  const loc = signals.loc_touched;

  // 1 — typo-fix
  if (!forceBa && TYPO_ARGS.test(String(args).trim()) && loc < 30) {
    drop("typo-fix", "business_analysis", `task reads as a typo/format fix; LOC_TOUCHED=${loc}`);
  }
  // 2 — whitespace-only
  if (signals.whitespace_only) {
    if (!forceBa) drop("whitespace-only", "business_analysis", "diff is whitespace-only (-w produces no insertions/deletions)");
    drop("whitespace-only", "qa", "diff is whitespace-only; post-pipeline formatting checks cover it");
  }
  // 3 — config-only
  if (signals.config_only && loc < 200) {
    drop("config-only", "qa", `all ${signals.changed_files.length} changed paths are config files; LOC_TOUCHED=${loc}`);
  }
  // 4 — lightweight-no-db
  if (loc < 50 && !signals.has_migrations && !signals.changed_files.some((f) => SENSITIVE_PATH.test(f))) {
    if (drop("lightweight-no-db", "security", `LOC_TOUCHED=${loc}, no migrations, no security-sensitive paths`)) {
      injections.development = SECURITY_LITE_INJECTION;
    }
  }

  return { applied, phases: [...remaining], injections, suppressed: null };
}

/** The verbatim block Step 0c owes the user — empty when nothing fired. */
export function renderSkipPrint(applied) {
  if (!applied || applied.length === 0) return null;
  return ["✂️ Skip-rules applied:", ...applied.map((a) => `   ${a.rule} → skipped ${a.phase_skipped}: ${a.reason}`)].join("\n");
}
