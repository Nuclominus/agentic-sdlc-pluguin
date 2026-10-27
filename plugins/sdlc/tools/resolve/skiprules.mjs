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
//
// An EMPTY diff establishes no size (ADR-0040). Step 0 runs at the start of a run, and a fresh
// feature branch has no commits yet: its diff is empty, LOC_TOUCHED reads 0, and every rule
// gated on "the change is small" used to fire — that is how a 28-file change with purchase
// screens lost its security phase (issue #239). `empty_diff` marks the case, and the rules
// that read LOC_TOUCHED are WITHHELD on it, and reported as withheld rather than staying silent.

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
  empty_diff: false,
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
 *
 * `empty_diff` is true when the range changes no path at all. `loc_touched` still reads the
 * true count (0); it is the rules and the recipe matcher that must not read 0 as "small".
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
    empty_diff: changed.length === 0,
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
 *
 * On an empty diff a rule gated on LOC_TOUCHED does not fire; if every OTHER condition held,
 * it lands in `withheld` instead, so the user hears which phase was kept and why. The
 * whitespace-only and config-only signals are false on an empty diff by construction, so
 * only typo-fix and lightweight-no-db can be withheld.
 */
export function applySkipRules(signals, { args = "", phases = [], forceBa = false, disabled = false } = {}) {
  const remaining = new Set(phases);
  const applied = [];
  const withheld = [];
  const injections = {};

  if (disabled || signals.degraded) {
    return { applied, withheld, phases: [...remaining], injections, suppressed: disabled ? "--no-skip-rules" : "degraded signals" };
  }

  const drop = (rule, phase, reason) => {
    if (!remaining.has(phase)) return false;
    remaining.delete(phase);
    applied.push({ rule, phase_skipped: phase, reason });
    return true;
  };
  const loc = signals.loc_touched;
  const sizeUnknown = signals.empty_diff === true;
  const withhold = (rule, phase) => {
    if (!remaining.has(phase)) return;
    withheld.push({ rule, phase_kept: phase, reason: `the diff against ${signals.base_ref ?? "the base ref"} is empty — the change size is unknown at run start` });
  };

  // 1 — typo-fix. "rename Foo to Bar" reads as a typo and can touch 28 files: the LOC bound is
  // the guard, and an empty diff cannot satisfy it.
  if (!forceBa && TYPO_ARGS.test(String(args).trim())) {
    if (sizeUnknown) withhold("typo-fix", "business_analysis");
    else if (loc < 30) drop("typo-fix", "business_analysis", `task reads as a typo/format fix; LOC_TOUCHED=${loc}`);
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
  // 4 — lightweight-no-db. On an empty diff "no migrations, no sensitive paths" holds
  // vacuously: nothing has been written yet to contain them.
  if (!signals.has_migrations && !signals.changed_files.some((f) => SENSITIVE_PATH.test(f))) {
    if (sizeUnknown) withhold("lightweight-no-db", "security");
    else if (loc < 50 && drop("lightweight-no-db", "security", `LOC_TOUCHED=${loc}, no migrations, no security-sensitive paths`)) {
      injections.development = SECURITY_LITE_INJECTION;
    }
  }

  return { applied, withheld, phases: [...remaining], injections, suppressed: null };
}

/**
 * The verbatim block Step 0c owes the user — null when no rule fired and none was withheld.
 * A withheld rule is printed too: a run that silently keeps a phase it used to skip looks
 * like a regression, and one that says why does not.
 */
export function renderSkipPrint(applied, withheld = []) {
  const lines = [];
  if (applied?.length) {
    lines.push("✂️ Skip-rules applied:", ...applied.map((a) => `   ${a.rule} → skipped ${a.phase_skipped}: ${a.reason}`));
  }
  if (withheld?.length) {
    lines.push("🛡️ Skip-rules withheld:", ...withheld.map((w) => `   ${w.rule} → kept ${w.phase_kept}: ${w.reason}`));
  }
  return lines.length ? lines.join("\n") : null;
}
