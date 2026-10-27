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
// A size that cannot be measured is not a small one (ADR-0040). Step 0 runs at the start of
// a run, and a fresh feature branch has no commits yet: its diff is empty, and a LOC count of
// 0 used to read as "small" — that is how a 28-file change with purchase screens lost its
// security phase (issue #239). When the size is unknown — an empty diff, binary files git
// cannot count in lines, more untracked files than are worth reading — `size_unknown` carries
// the reason and `loc_touched` takes the same sentinel as degraded signals, so a reader that
// only compares `loc_touched < n` gets the safe answer without knowing this rule exists.
// `loc_measured` keeps the count that WAS measured: it is a lower bound, and a lower bound
// already over a limit still settles "not small" (`locAtLeast`).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_EXT = /\.(env|env\..+|ya?ml|json|toml|ini)$/i;
const MIGRATION_PATH = /(database\/migrations|\/migrations\/)/;
const SENSITIVE_PATH = /(auth|password|crypt|secret|token|jwt|session)/i;
const TYPO_ARGS = /^(typo|fix typo|rename .* to|format)/i;

// The pipeline's own files are not the change: an untracked `.sdlc/sdlc.local.yaml` left by
// /sdlc:init would otherwise turn a fresh branch into a small config-only diff, and a resumed
// run's `docs/plans/<slug>/` would count its own reports as code.
const PATHSPEC = ["--", ":/", ":(exclude).sdlc", ":(exclude)docs/plans"];
// Untracked files are read to count their lines. Past this many, the size is called unknown
// rather than paid for.
const UNTRACKED_READ_LIMIT = 500;

/** Signals that make every rule stay silent. Used whenever git cannot answer. */
export const SAFE_DEFAULTS = Object.freeze({
  loc_touched: 999999,
  loc_measured: null,
  has_migrations: true,
  config_only: false,
  whitespace_only: false,
  changed_files: [],
  empty_diff: false,
  size_unknown: null,
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
 * Is the change at least `n` LOC? `true` / `false`, or `null` when the size is unknown and the
 * measured part does not settle it. The ONE reading of the size every consumer shares — the
 * skip-rules here and the recipe bounds in workflow.mjs — so neither can treat an unknown size
 * as a small one.
 */
export function locAtLeast(signals, n) {
  if (!signals.size_unknown) return signals.loc_touched >= n;
  return (signals.loc_measured ?? 0) >= n ? true : null;
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

/** Lines in a text buffer, counted the way `git diff --numstat` counts an added file. */
function countLines(buf) {
  if (buf.length === 0) return 0;
  let n = 0;
  for (const byte of buf) if (byte === 10) n++;
  return buf[buf.length - 1] === 10 ? n : n + 1;
}

/**
 * Compute the four diff signals in one pass.
 *
 * Any git failure — no remote, detached HEAD, not a repository — yields SAFE_DEFAULTS with
 * `degraded: true`, so no rule can fire on a signal that was never established.
 *
 * The change is measured from the merge base to the WORKING TREE, plus untracked files — not
 * `<base>...HEAD`, which sees commits only. A branch with one 3-line commit and 28 files of
 * uncommitted work is a 28-file change, and every signal (size, migrations, sensitive paths,
 * config-only, whitespace-only) has to see it as one.
 */
export function computeDiffSignals(cwd = process.cwd(), { baseRef = null } = {}) {
  const base = resolveBaseRef(cwd, baseRef);
  if (!base) return { ...SAFE_DEFAULTS, reason: "no comparable base ref" };

  const mergeBase = gitOrNull(cwd, ["merge-base", base, "HEAD"])?.trim();
  const top = gitOrNull(cwd, ["rev-parse", "--show-toplevel"])?.trim();
  if (!mergeBase || !top) return { ...SAFE_DEFAULTS, base_ref: base, reason: `no merge base with ${base}` };

  const names = gitOrNull(cwd, ["diff", "--name-only", mergeBase, ...PATHSPEC]);
  const numstat = gitOrNull(cwd, ["diff", "--numstat", mergeBase, ...PATHSPEC]);
  const others = gitOrNull(cwd, ["ls-files", "--others", "--exclude-standard", "--full-name", "-z", ...PATHSPEC]);
  if (names === null || numstat === null || others === null) {
    return { ...SAFE_DEFAULTS, base_ref: base, reason: `git diff against ${base} failed` };
  }

  const tracked = names.split("\n").map((s) => s.trim()).filter(Boolean);
  const untracked = others.split("\0").filter(Boolean);
  let added = 0, deleted = 0, binary = 0;
  for (const line of numstat.split("\n")) {
    const [a, d] = line.split("\t");
    if (a === undefined || d === undefined) continue;
    if (a === "-") { binary++; continue; }  // git counts no lines in a binary file
    added += Number(a) || 0;
    deleted += Number(d) || 0;
  }
  const tooManyUntracked = untracked.length > UNTRACKED_READ_LIMIT;
  if (!tooManyUntracked) {
    for (const f of untracked) {
      let buf;
      try { buf = readFileSync(join(top, f)); } catch { continue; }
      if (buf.subarray(0, 8000).includes(0)) binary++;
      else added += countLines(buf);
    }
  }

  // Whitespace-only: the -w diff is empty while the plain diff is not. A new file is content,
  // never a reformat, so any untracked file rules it out.
  const plainStat = gitOrNull(cwd, ["diff", "--shortstat", mergeBase, ...PATHSPEC]) ?? "";
  const wStat = gitOrNull(cwd, ["diff", "--shortstat", "-w", mergeBase, ...PATHSPEC]) ?? "";
  const hasChanges = /insertion|deletion/.test(plainStat);
  const whitespaceOnly = hasChanges && !/insertion|deletion/.test(wStat) && untracked.length === 0;

  const changed = [...new Set([...tracked, ...untracked])];
  const measured = added + deleted;
  const sizeUnknown = changed.length === 0
    ? `the diff against ${base} is empty — the change size is unknown at run start`
    : tooManyUntracked
      ? `${untracked.length} untracked files — too many to measure, so the change size is unknown`
      : binary > 0
        ? `the diff against ${base} has ${binary} binary file(s) git cannot count in lines — the change size is unknown`
        : null;

  return {
    loc_touched: sizeUnknown ? SAFE_DEFAULTS.loc_touched : measured,
    loc_measured: measured,
    added,
    deleted,
    has_migrations: changed.some((f) => MIGRATION_PATH.test(f)),
    config_only: changed.length > 0 && changed.every((f) => CONFIG_EXT.test(f)),
    whitespace_only: whitespaceOnly,
    changed_files: changed,
    untracked_files: untracked.length,
    binary_files: binary,
    empty_diff: changed.length === 0,
    size_unknown: sizeUnknown,
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
 * A rule gated on LOC_TOUCHED does not fire while the size is unknown; if every OTHER condition
 * held, it lands in `withheld` instead, so the user hears which phase was kept and why. A
 * measured part already over the limit settles the rule without withholding anything.
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
  const withhold = (rule, phase) => {
    if (remaining.has(phase)) withheld.push({ rule, phase_kept: phase, reason: signals.size_unknown });
  };
  /** true / false, or null when an unknown size leaves it open. */
  const smallerThan = (n) => {
    const atLeast = locAtLeast(signals, n);
    return atLeast === null ? null : !atLeast;
  };
  const loc = signals.loc_touched;

  // 1 — typo-fix. "rename Foo to Bar" reads as a typo and can touch 28 files: the LOC bound is
  // the guard, and an unknown size cannot satisfy it.
  if (!forceBa && TYPO_ARGS.test(String(args).trim())) {
    const small = smallerThan(30);
    if (small === null) withhold("typo-fix", "business_analysis");
    else if (small) drop("typo-fix", "business_analysis", `task reads as a typo/format fix; LOC_TOUCHED=${loc}`);
  }
  // 2 — whitespace-only
  if (signals.whitespace_only) {
    if (!forceBa) drop("whitespace-only", "business_analysis", "diff is whitespace-only (-w produces no insertions/deletions)");
    drop("whitespace-only", "qa", "diff is whitespace-only; post-pipeline formatting checks cover it");
  }
  // 3 — config-only
  if (signals.config_only) {
    const small = smallerThan(200);
    if (small === null) withhold("config-only", "qa");
    else if (small) drop("config-only", "qa", `all ${signals.changed_files.length} changed paths are config files; LOC_TOUCHED=${loc}`);
  }
  // 4 — lightweight-no-db. On an empty diff "no migrations, no sensitive paths" holds
  // vacuously: nothing has been written yet to contain them.
  if (!signals.has_migrations && !signals.changed_files.some((f) => SENSITIVE_PATH.test(f))) {
    const small = smallerThan(50);
    if (small === null) withhold("lightweight-no-db", "security");
    else if (small && drop("lightweight-no-db", "security", `LOC_TOUCHED=${loc}, no migrations, no security-sensitive paths`)) {
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
