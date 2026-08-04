// Step 0c as code. The rules are conservative by design, so most of these tests assert that
// something does NOT happen — a skip that fires when it should not costs a security review.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applySkipRules, computeDiffSignals, resolveBaseRef, renderSkipPrint, SAFE_DEFAULTS,
} from "../../../plugins/sdlc/tools/resolve/skiprules.mjs";

const PHASES = ["business_analysis", "development", "qa", "security", "documentation"];

function repo(defaultBranch = "develop") {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-skip-"));
  const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  g("init", "-q", "-b", defaultBranch);
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  writeFileSync(join(dir, "seed.txt"), "one\ntwo\nthree\n");
  g("add", "-A"); g("commit", "-qm", "seed");
  // A local ref standing in for the remote-tracking branch.
  g("update-ref", `refs/remotes/origin/${defaultBranch}`, "HEAD");
  return { dir, g };
}

test("signals: a plain code change counts LOC and finds no migrations", () => {
  const { dir, g } = repo();
  try {
    writeFileSync(join(dir, "app.js"), "const a = 1;\nconst b = 2;\n");
    g("add", "-A"); g("commit", "-qm", "code");
    const s = computeDiffSignals(dir);
    assert.equal(s.base_ref, "origin/develop", "the base ref is resolved, not hard-coded to origin/main");
    assert.equal(s.degraded, false);
    assert.equal(s.loc_touched, 2);
    assert.equal(s.has_migrations, false);
    assert.equal(s.config_only, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("signals: config_only is true only when EVERY changed path is config", () => {
  const { dir, g } = repo();
  try {
    writeFileSync(join(dir, "a.yaml"), "x: 1\n");
    writeFileSync(join(dir, "b.json"), "{}\n");
    g("add", "-A"); g("commit", "-qm", "config");
    assert.equal(computeDiffSignals(dir).config_only, true);
    writeFileSync(join(dir, "c.js"), "1\n");
    g("add", "-A"); g("commit", "-qm", "plus code");
    assert.equal(computeDiffSignals(dir).config_only, false, "one non-config path is enough to disqualify");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("signals: migrations are detected by path", () => {
  const { dir, g } = repo();
  try {
    mkdirSync(join(dir, "db", "migrations"), { recursive: true });
    writeFileSync(join(dir, "db", "migrations", "001.sql"), "SELECT 1;\n");
    g("add", "-A"); g("commit", "-qm", "migration");
    assert.equal(computeDiffSignals(dir).has_migrations, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("signals: whitespace-only is detected via the -w diff", () => {
  const { dir, g } = repo();
  try {
    writeFileSync(join(dir, "seed.txt"), "one   \ntwo\t\nthree\n");
    g("add", "-A"); g("commit", "-qm", "reformat");
    const s = computeDiffSignals(dir);
    assert.equal(s.whitespace_only, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("signals: no resolvable base ref degrades to defaults that fire nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-skip-bare-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
    const s = computeDiffSignals(dir);
    assert.equal(s.degraded, true);
    assert.equal(s.loc_touched, SAFE_DEFAULTS.loc_touched);
    const r = applySkipRules(s, { args: "typo", phases: PHASES });
    assert.deepEqual(r.applied, [], "degraded signals must never produce a skip");
    assert.equal(r.suppressed, "degraded signals");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("resolveBaseRef prefers the repository's own origin/HEAD over the guesses", () => {
  const { dir, g } = repo("trunk");
  try {
    g("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk");
    assert.equal(resolveBaseRef(dir), "origin/trunk");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("rule 1: typo-fix skips BA, and --force-ba defeats it", () => {
  const s = { ...SAFE_DEFAULTS, degraded: false, loc_touched: 12, has_migrations: false, changed_files: ["a.js"] };
  const r = applySkipRules(s, { args: "typo in the README", phases: PHASES });
  assert.ok(r.applied.some((a) => a.rule === "typo-fix" && a.phase_skipped === "business_analysis"));
  const forced = applySkipRules(s, { args: "typo in the README", phases: PHASES, forceBa: true });
  assert.ok(!forced.applied.some((a) => a.phase_skipped === "business_analysis"));
});

test("rule 1 does not fire on a large diff, however it is described", () => {
  const s = { ...SAFE_DEFAULTS, degraded: false, loc_touched: 400, has_migrations: false, changed_files: ["a.js"] };
  const r = applySkipRules(s, { args: "typo", phases: PHASES });
  assert.ok(!r.applied.some((a) => a.rule === "typo-fix"), "LOC_TOUCHED >= 30 disqualifies it");
});

test("rule 4: security is skipped only without migrations and sensitive paths", () => {
  const base = { ...SAFE_DEFAULTS, degraded: false, loc_touched: 20, has_migrations: false };
  const clean = applySkipRules({ ...base, changed_files: ["ui/Button.kt"] }, { phases: PHASES });
  assert.ok(clean.applied.some((a) => a.rule === "lightweight-no-db" && a.phase_skipped === "security"));
  assert.match(clean.injections.development, /SECURITY-LITE MODE/, "skipping security owes the developer a check");

  const sensitive = applySkipRules({ ...base, changed_files: ["auth/TokenStore.kt"] }, { phases: PHASES });
  assert.ok(!sensitive.applied.some((a) => a.phase_skipped === "security"), "a sensitive path blocks the skip");

  const migrations = applySkipRules({ ...base, has_migrations: true, changed_files: ["ui/Button.kt"] }, { phases: PHASES });
  assert.ok(!migrations.applied.some((a) => a.phase_skipped === "security"));
});

test("a phase the project already removed cannot be skipped again", () => {
  const s = { ...SAFE_DEFAULTS, degraded: false, loc_touched: 10, has_migrations: false, changed_files: ["ui/a.kt"] };
  const withoutSecurity = PHASES.filter((p) => p !== "security");
  const r = applySkipRules(s, { phases: withoutSecurity });
  assert.deepEqual(r.applied, [], "no rule may report skipping a phase that was never present");
  assert.ok(!("development" in r.injections), "and it owes no injection either");
});

test("--no-skip-rules suppresses everything and says so", () => {
  const s = { ...SAFE_DEFAULTS, degraded: false, loc_touched: 5, has_migrations: false, changed_files: ["a.kt"] };
  const r = applySkipRules(s, { phases: PHASES, disabled: true });
  assert.deepEqual(r.applied, []);
  assert.equal(r.suppressed, "--no-skip-rules");
  assert.deepEqual(r.phases, PHASES);
});

test("the verbatim print is emitted only when a rule fired", () => {
  assert.equal(renderSkipPrint([]), null);
  const out = renderSkipPrint([{ rule: "config-only", phase_skipped: "qa", reason: "because" }]);
  assert.match(out, /^✂️ Skip-rules applied:\n {3}config-only → skipped qa: because$/);
});
