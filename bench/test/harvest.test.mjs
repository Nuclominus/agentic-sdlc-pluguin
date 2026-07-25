import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync, realpathSync, utimesSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { buildManifest, writeManifest } from "../lib/manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const HARVEST = join(REPO, "bench", "harvest.mjs");

const manifestFields = (over = {}) => ({
  arm: "a", run: 1, plugin_version: "1.9.1", marketplace_sha: "9d1af30",
  config_dir: "/tmp/arm-a", task_sha256: "aaa", answers_sha256: "bbb",
  inter_run_gap_seconds: 60, prepared_at: "2026-07-25T12:00:00.000Z", ...over,
});

// Build a scratch tree that looks like a finished pipeline run.
function scratchRun(fixture, over = {}) {
  const root = mkdtempSync(join(tmpdir(), "scratch-"));
  const dest = join(root, `${over.arm ?? "a"}-${over.run ?? 1}`);
  mkdirSync(join(dest, "docs", "plans", "bench-validation"), { recursive: true });
  cpSync(join(HERE, "fixtures", fixture), join(dest, "docs", "plans", "bench-validation", "_telemetry.json"));
  writeManifest(dest, buildManifest(manifestFields(over)));
  return { root, dest };
}

function harvest(args, env = {}) {
  return execFileSync("node", [HARVEST, ...args], {
    cwd: REPO, encoding: "utf8", env: { ...process.env, BENCH_SKIP_LIVE_CHECK: "1", ...env },
  });
}

test("stores a result with the manifest and telemetry", () => {
  const { root } = scratchRun("telemetry-transcript.json");
  const out = mkdtempSync(join(tmpdir(), "results-"));
  harvest(["--arm", "a", "--run", "1", "--results", out], { BENCH_SCRATCH_ROOT: root });
  const r = JSON.parse(readFileSync(join(out, "a-1.json"), "utf8"));
  assert.equal(r.manifest.arm, "a");
  assert.equal(r.telemetry.total_cached_input_tokens, 900000);
  assert.deepEqual(r.flags, []);
});

test("a skipped live check is recorded, not silent", () => {
  // BENCH_SKIP_LIVE_CHECK=1 is forced by the harvest() helper here — this is
  // the everyday hermetic-test path, and it must leave a trace in the result.
  const { root } = scratchRun("telemetry-transcript.json", { run: 8 });
  const out = mkdtempSync(join(tmpdir(), "results-"));
  harvest(["--arm", "a", "--run", "8", "--results", out], { BENCH_SCRATCH_ROOT: root });
  const r = JSON.parse(readFileSync(join(out, "a-8.json"), "utf8"));
  assert.equal(r.live_check, "skipped");
});

test('records live_check: "passed" when the live cross-check actually runs and agrees', () => {
  // Build a self-contained fake CLAUDE_CONFIG_DIR: one cached plugin version
  // and a one-commit git repo standing in for the marketplace clone, so the
  // live cross-check has something real to agree with — no ambient machine
  // state involved.
  const configDir = mkdtempSync(join(tmpdir(), "config-"));
  const cacheDir = join(configDir, "plugins", "cache", "agentic-sdlc", "sdlc");
  mkdirSync(join(cacheDir, "1.9.1"), { recursive: true });
  const marketplaceDir = join(configDir, "plugins", "marketplaces", "agentic-sdlc");
  mkdirSync(marketplaceDir, { recursive: true });
  const git = (...a) => execFileSync("git", a, { cwd: marketplaceDir, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "bench@test.local");
  git("config", "user.name", "bench-test");
  writeFileSync(join(marketplaceDir, "README.md"), "x");
  git("add", "README.md");
  git("commit", "-q", "-m", "init");
  const sha = git("rev-parse", "HEAD").trim();

  const { root } = scratchRun("telemetry-transcript.json", {
    arm: "a", run: 9, plugin_version: "1.9.1", marketplace_sha: sha, config_dir: configDir,
  });
  const out = mkdtempSync(join(tmpdir(), "results-"));
  harvest(
    ["--arm", "a", "--run", "9", "--results", out],
    { BENCH_SCRATCH_ROOT: root, BENCH_SKIP_LIVE_CHECK: "0", CLAUDE_CONFIG_DIR: configDir },
  );
  const r = JSON.parse(readFileSync(join(out, "a-9.json"), "utf8"));
  assert.equal(r.live_check, "passed");
});

test("rejects telemetry whose cost_basis is not transcript", () => {
  const { root } = scratchRun("telemetry-aggregate.json", { run: 2 });
  const out = mkdtempSync(join(tmpdir(), "results-"));
  assert.throws(
    () => harvest(["--arm", "a", "--run", "2", "--results", out], { BENCH_SCRATCH_ROOT: root }),
    (e) => /cost_basis/.test(e.stderr ?? "") && e.status !== 0,
  );
});

test("fails when no telemetry exists", () => {
  const root = mkdtempSync(join(tmpdir(), "scratch-"));
  mkdirSync(join(root, "a-3"), { recursive: true });
  writeManifest(join(root, "a-3"), buildManifest(manifestFields({ run: 3 })));
  const out = mkdtempSync(join(tmpdir(), "results-"));
  assert.throws(
    () => harvest(["--arm", "a", "--run", "3", "--results", out], { BENCH_SCRATCH_ROOT: root }),
    (e) => /_telemetry\.json/.test(e.stderr ?? "") && e.status !== 0,
  );
});

test("archives even when the harvest is rejected", () => {
  // The runs most worth inspecting are the ones that failed. Archiving must
  // happen before any check that can abort.
  const { root } = scratchRun("telemetry-aggregate.json", { run: 6 });
  const out = mkdtempSync(join(tmpdir(), "results-"));
  const arch = mkdtempSync(join(tmpdir(), "archive-"));
  assert.throws(
    () => harvest(["--arm", "a", "--run", "6", "--results", out, "--archive", arch], { BENCH_SCRATCH_ROOT: root }),
    (e) => e.status !== 0,
  );
  assert.ok(existsSync(join(arch, "a-6.tar.gz")), "a rejected run must still be archived");
});

test("archives the whole scratch tree", () => {
  const { root } = scratchRun("telemetry-transcript.json", { run: 4 });
  const out = mkdtempSync(join(tmpdir(), "results-"));
  const arch = mkdtempSync(join(tmpdir(), "archive-"));
  harvest(["--arm", "a", "--run", "4", "--results", out, "--archive", arch], { BENCH_SCRATCH_ROOT: root });
  assert.ok(existsSync(join(arch, "a-4.tar.gz")), "expected an archive tarball");
});

test('idempotent: already-transcript telemetry is not re-enriched, recorded as "already"', () => {
  // Run 1's telemetry was already enriched (by a previous harvest, or by hand
  // before this feature existed). Re-harvesting must not re-run enrichment —
  // there is nothing to add, and doing so is the one behavior that must never
  // change a value that downstream comparisons already trust.
  const { root } = scratchRun("telemetry-transcript.json", { run: 10 });
  const out = mkdtempSync(join(tmpdir(), "results-"));
  const stdout = harvest(["--arm", "a", "--run", "10", "--results", out], { BENCH_SCRATCH_ROOT: root });
  assert.match(stdout, /enrichment: already/);
  const r = JSON.parse(readFileSync(join(out, "a-10.json"), "utf8"));
  assert.equal(r.enriched, "already");
  // Untouched: still exactly the fixture's numbers, not recomputed.
  assert.equal(r.telemetry.total_cached_input_tokens, 900000);
});

test("enriches telemetry using the projects root derived from manifest.config_dir, not the live environment", () => {
  // Build a scratch run whose telemetry has NOT been enriched yet (cost_basis
  // is not "transcript"), plus a fake arm config dir containing exactly the
  // projects/<encoded-cwd>/<session>.jsonl + .../subagents/agent-<id>.jsonl
  // layout usage.mjs expects — but rooted at the RECORDED manifest.config_dir,
  // not at any live CLAUDE_CONFIG_DIR. A deliberately bogus live
  // CLAUDE_CONFIG_DIR (with no matching transcripts at all) is passed to the
  // harvest process itself: if the implementation ever read live state instead
  // of the manifest, this test would find nothing and fail.
  const root = mkdtempSync(join(tmpdir(), "scratch-"));
  const dest = join(root, "a-20");
  mkdirSync(join(dest, "docs", "plans", "bench-validation"), { recursive: true });

  const configDir = mkdtempSync(join(tmpdir(), "config-"));
  writeManifest(dest, buildManifest(manifestFields({ run: 20, config_dir: configDir })));

  const AGENT_ID = "abc123def456ab"; // 14 hex chars — matches usage.mjs's agent-id shape
  const telemetry = {
    task_slug: "bench-validation",
    stack: "vanilla",
    cost_basis: "subagent_aggregate",
    completed_at: "2026-07-25T12:10:40.000Z",
    phases: [
      { phase: "development", agent: "developer", model: "claude-sonnet-5",
        status: "completed", usage_source: "subagent_aggregate", agent_id: AGENT_ID,
        turns: 1, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cost_usd: null },
    ],
  };
  writeFileSync(
    join(dest, "docs", "plans", "bench-validation", "_telemetry.json"),
    JSON.stringify(telemetry, null, 2),
  );

  // The encoding harvest.mjs must reproduce: realpath the scratch dir (macOS
  // resolves the tmpdir under /private/var/...), then both "/" and "_" -> "-".
  const encoded = realpathSync(dest).replace(/[/_]/g, "-");
  const sessionDir = join(configDir, "projects", encoded);
  const sessionId = "sess1";
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(sessionDir, `${sessionId}.jsonl`), "");
  const subagentsDir = join(sessionDir, sessionId, "subagents");
  mkdirSync(subagentsDir, { recursive: true });
  writeFileSync(
    join(subagentsDir, `agent-${AGENT_ID}.jsonl`),
    JSON.stringify({
      message: {
        role: "assistant", model: "claude-sonnet-5", id: "resp-1",
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900000, cache_creation_input_tokens: 0 },
      },
    }) + "\n",
  );

  const out = mkdtempSync(join(tmpdir(), "results-"));
  const bogusLiveConfigDir = mkdtempSync(join(tmpdir(), "bogus-config-"));
  const stdout = harvest(
    ["--arm", "a", "--run", "20", "--results", out],
    { BENCH_SCRATCH_ROOT: root, CLAUDE_CONFIG_DIR: bogusLiveConfigDir },
  );

  assert.match(stdout, /enrichment: performed/);
  const r = JSON.parse(readFileSync(join(out, "a-20.json"), "utf8"));
  assert.equal(r.enriched, "performed");
  assert.equal(r.telemetry.cost_basis, "transcript");
  assert.equal(r.telemetry.phases[0].cached_input_tokens, 900000);
  assert.deepEqual(r.flags, []);
});

test('encodes both "/" and "_" as "-" — the exact-match session dir wins over a newer decoy elsewhere in projectsRoot', () => {
  // Regression pin for a one-character bug: a macOS temp-dir realpath always
  // contains at least one "_" segment (e.g. ".../7wn2stn92dx8lyn_ppq_.../T"),
  // and Claude Code's own projects-dir encoding turns EVERY "/" and "_" into
  // "-". Replacing only "/" makes the exact-match lookup miss on every real
  // run and fall through to "newest jsonl anywhere" — which can silently
  // attach a DIFFERENT run's leftover session.
  //
  // That is not merely imprecise: if the wrongly-picked session's own
  // transcript happens to contain a dispatch for a phase with the SAME NAME
  // (e.g. two pilot runs of the same task both dispatch a "development"
  // phase), its dispatch map is preferred over the telemetry's own recorded
  // agent_id — silently substituting a different run's subagent transcript
  // with no error. This test builds exactly that trap: a "decoy" session,
  // made deliberately the newest file anywhere in projectsRoot, that dispatches
  // its OWN "development" phase to a DIFFERENT agent_id than the one actually
  // recorded in this run's telemetry. If the encoding fix ever regresses, the
  // exact-match directory stops matching, the decoy wins the "newest anywhere"
  // fallback, and the enriched numbers come from the wrong run's transcript.
  const root = mkdtempSync(join(tmpdir(), "scratch_with_underscore-"));
  const dest = join(root, "a-21");
  mkdirSync(join(dest, "docs", "plans", "bench-validation"), { recursive: true });

  const configDir = mkdtempSync(join(tmpdir(), "config-"));
  writeManifest(dest, buildManifest(manifestFields({ run: 21, config_dir: configDir })));

  const CORRECT_AGENT_ID = "aaaaaaaaaaaa11";
  const DECOY_AGENT_ID = "aaaaaaaaaaaa22";
  const telemetry = {
    task_slug: "bench-validation",
    stack: "vanilla",
    cost_basis: "subagent_aggregate",
    completed_at: "2026-07-25T12:10:40.000Z",
    phases: [
      { phase: "development", agent: "developer", model: "claude-sonnet-5",
        status: "completed", usage_source: "subagent_aggregate", agent_id: CORRECT_AGENT_ID,
        turns: 1, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cost_usd: null },
    ],
  };
  writeFileSync(
    join(dest, "docs", "plans", "bench-validation", "_telemetry.json"),
    JSON.stringify(telemetry, null, 2),
  );

  const projectsRoot = join(configDir, "projects");
  const realDest = realpathSync(dest);
  const correctEncoded = realDest.replace(/[/_]/g, "-");
  const buggyEncoded = realDest.replace(/\//g, "-"); // "/" only — the pre-fix behavior
  assert.notEqual(correctEncoded, buggyEncoded, "fixture path must contain \"_\" for this test to be meaningful");

  // The correct session: this run's actual transcript. No dispatch blocks —
  // enrichment must fall back to the telemetry's own recorded agent_id here.
  const correctSessionDir = join(projectsRoot, correctEncoded);
  const correctSessionId = "sess-correct";
  mkdirSync(correctSessionDir, { recursive: true });
  writeFileSync(join(correctSessionDir, `${correctSessionId}.jsonl`), "");
  const correctSubagentsDir = join(correctSessionDir, correctSessionId, "subagents");
  mkdirSync(correctSubagentsDir, { recursive: true });
  writeFileSync(
    join(correctSubagentsDir, `agent-${CORRECT_AGENT_ID}.jsonl`),
    JSON.stringify({ message: { role: "assistant", model: "claude-sonnet-5", id: "resp-correct",
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900000, cache_creation_input_tokens: 0 } } }) + "\n",
  );

  // The decoy: a DIFFERENT run's leftover session sitting elsewhere under the
  // same projectsRoot, with its own dispatch of a same-named "development"
  // phase to a different agent_id, and a top-level file forced newer than
  // anything the correct session wrote.
  const decoySessionDir = join(projectsRoot, "some-other-run-entirely");
  const decoySessionId = "sess-decoy";
  mkdirSync(decoySessionDir, { recursive: true });
  writeFileSync(
    join(decoySessionDir, `${decoySessionId}.jsonl`),
    JSON.stringify({ message: { role: "assistant", content: [
      { type: "tool_use", id: "tu1", name: "Agent",
        input: { subagent_type: "developer", description: "Phase 2/5: development - implement thing" } },
    ] } }) + "\n" +
    JSON.stringify({ message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "tu1", content: `agentId: ${DECOY_AGENT_ID} dispatched` },
    ] } }) + "\n",
  );
  const decoySubagentsDir = join(decoySessionDir, decoySessionId, "subagents");
  mkdirSync(decoySubagentsDir, { recursive: true });
  writeFileSync(
    join(decoySubagentsDir, `agent-${DECOY_AGENT_ID}.jsonl`),
    JSON.stringify({ message: { role: "assistant", model: "claude-sonnet-5", id: "resp-decoy",
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 111, cache_creation_input_tokens: 0 } } }) + "\n",
  );
  const future = new Date(Date.now() + 60_000);
  utimesSync(join(decoySessionDir, `${decoySessionId}.jsonl`), future, future);

  const out = mkdtempSync(join(tmpdir(), "results-"));
  const stdout = harvest(["--arm", "a", "--run", "21", "--results", out], { BENCH_SCRATCH_ROOT: root });

  assert.match(stdout, /enrichment: performed/);
  const r = JSON.parse(readFileSync(join(out, "a-21.json"), "utf8"));
  assert.equal(r.enriched, "performed");
  assert.equal(r.telemetry.cost_basis, "transcript");
  // The CORRECT session's transcript was used (900000), not the newer decoy's
  // (111) — proving the exact-match branch found its own directory instead of
  // falling through to "newest anywhere".
  assert.equal(r.telemetry.phases[0].cached_input_tokens, 900000);
  assert.equal(r.telemetry.phases[0].agent_id, CORRECT_AGENT_ID);
});

test("flags a run whose arm disagrees with its filename", () => {
  const { root } = scratchRun("telemetry-transcript.json", { arm: "a", run: 5 });
  // Corrupt the manifest so the recorded arm no longer matches the CLI arm.
  const dest = join(root, "a-5");
  const m = JSON.parse(readFileSync(join(dest, "_bench-manifest.json"), "utf8"));
  writeFileSync(join(dest, "_bench-manifest.json"), JSON.stringify({ ...m, arm: "b" }, null, 2));
  const out = mkdtempSync(join(tmpdir(), "results-"));
  assert.throws(
    () => harvest(["--arm", "a", "--run", "5", "--results", out], { BENCH_SCRATCH_ROOT: root }),
    (e) => /arm/.test(e.stderr ?? "") && e.status !== 0,
  );
});
