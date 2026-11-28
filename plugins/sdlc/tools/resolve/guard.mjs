// Step 2a's three model-run commands, as one filesystem check inside the start window (ADR-0019).

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join, sep } from "node:path";

const real = (p) => { try { return realpathSync(p); } catch { return null; } };
// Windows paths are case-insensitive: git and realpath can disagree on the drive letter's case.
const posix = (p) => (p == null ? null : process.platform === "win32" ? p.split(sep).join("/").toLowerCase() : p.split(sep).join("/"));

export function detectWorktreeGuard(cwd) {
  const cwdReal = posix(real(cwd));
  let toplevel = null;
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    toplevel = posix(real(out) ?? out);
  } catch { /* not a git checkout */ }
  // A missing docs/plans is inactive: Step 2 creates it as a plain directory inside the worktree.
  const plansReal = posix(real(join(cwd, "docs", "plans")));
  const inHarnessWorktree = Boolean(cwdReal && cwdReal.includes("/.claude/worktrees/"));
  const plansInside = Boolean(toplevel && plansReal && (plansReal === toplevel || plansReal.startsWith(`${toplevel}/`)));
  return {
    active: Boolean(inHarnessWorktree && toplevel && plansReal && !plansInside),
    cwd_real: cwdReal,
    toplevel,
    plans_real: plansReal,
  };
}

export function renderWorktreeGuardPrint(guard) {
  if (!guard?.active) return null;
  return `⚠️ Worktree guard: docs/plans resolves outside this worktree (${guard.plans_real}). The harness refuses Write/Edit there, so this run writes docs/plans/ files with Bash heredocs and keeps every Bash command simple. Cleaner: run from the main checkout or a sibling worktree outside .claude/worktrees/.`;
}
