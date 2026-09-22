import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { resolveFixture, listFixtures } from "../lib/detect.mjs";
import { resolveStack } from "../../../plugins/sdlc/tools/resolve/detect.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const FIX = resolve(HERE, "..", "fixtures");

for (const name of listFixtures(FIX)) {
  test(`fixture ${name} resolves to expected stack`, () => {
    const { actual, expected, ok } = resolveFixture(join(FIX, name), REPO);
    assert.equal(ok, true, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  });
}

test("listFixtures ignores stray files and dirs without expected.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-fix-"));
  try {
    mkdirSync(join(dir, "real"));
    writeFileSync(join(dir, "real", "expected.json"), "{}");
    writeFileSync(join(dir, ".DS_Store"), "junk");         // stray file
    mkdirSync(join(dir, "no-expected"));                    // dir without expected.json
    assert.deepEqual(listFixtures(dir), ["real"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Step 0b's `--stack=NAME` override ------------------------------------------------
//
// The prose that carried this flag was deleted in #121 and the command did not implement it,
// so for one commit `--stack` was advertised in four places and did nothing. These tests are
// the contract: it restricts candidates AND skips detection, and an unknown name never falls
// through to a different profile.

const MANIFESTS = {
  foundations: [
    { file: "/c/m/high/9.9.9/manifest.yaml", key: "high@m", doc: { kind: "foundation", stack: "high", priority: 300, aspects: ["a"], detect: "*" } },
    { file: "/c/m/low/1.0.0/manifest.yaml", key: "low@m", doc: { kind: "foundation", stack: "low", priority: 10, aspects: ["b"], detect: { file_exists: "nothing-here" } } },
  ],
  frameworks: [],
};

test("--stack=NAME wins over a higher-priority profile that detects", () => {
  const r = resolveStack("/tmp", MANIFESTS, { forceStack: "low" });
  assert.equal(r.foundation, "low");
  assert.equal(r.forced, true);
  assert.equal(r.priority, 10, "the forced profile keeps its own priority — it is not promoted");
});

test("--stack=NAME skips detection entirely, it does not merely filter it", () => {
  // `low` detects on a file that does not exist. Auto-detect would reject it; forcing must not,
  // because the whole point of the flag is overriding a detection the user disagrees with.
  assert.equal(resolveStack("/tmp", MANIFESTS, {}).foundation, "high");
  assert.equal(resolveStack("/tmp", MANIFESTS, { forceStack: "low" }).foundation, "low");
});

test("a --stack nobody declares resolves to nothing and reports what IS installed", () => {
  const r = resolveStack("/tmp", MANIFESTS, { forceStack: "cobol" });
  assert.equal(r.foundation, null);
  assert.equal(r.forced_unresolved, "cobol", "the caller must halt — silently picking vanilla is the bug this prevents");
  assert.deepEqual(r.known_stacks, ["high", "low"]);
});

test("profile_source names the plugin, not the version directory it is cached under", () => {
  const r = resolveStack("/tmp", MANIFESTS, {});
  assert.equal(r.source, "high/manifest.yaml");
  assert.equal(r.source_file, "/c/m/high/9.9.9/manifest.yaml");
});

test("a development checkout without an install key falls back to the containing directory", () => {
  const dev = { foundations: [{ file: "/dev/plugins/my-foundation/manifest.yaml", doc: { stack: "x", detect: "*" } }], frameworks: [] };
  assert.equal(resolveStack("/tmp", dev, {}).source, "my-foundation/manifest.yaml");
});

// ---- `frameworks.disable` from .sdlc/sdlc.local.yaml (issue #197) ---------------------
//
// The key was orchestrator prose (Step 0b-frameworks) until #121 moved resolution into this
// module and did not carry it across. It shipped documented-but-dead from v1.13.0 to v3.0.0.
// These tests are the contract: suppression PREVENTS attachment here, where attachment is
// decided — it is not a post-hoc filter over `additive`, because a framework that never
// attached also never contributed a `role_expertise` path or a `convention_skills` row.

const HOSTING = {
  foundations: [
    { file: "/c/m/android-foundation/3.0.0/manifest.yaml", key: "android-foundation@m", doc: {
      kind: "foundation", stack: "android", priority: 100, aspects: ["mobile"], detect: "*",
      hosts_aspects: "all", framework_detection: ["deps.txt"],
    } },
  ],
  frameworks: [
    { file: "/c/m/android-foundation/3.0.0/manifest.yaml", doc: { kind: "framework", stack: "ktor", enriches_aspect: "network", dependency: "io.ktor:ktor-client-core" } },
    { file: "/c/m/android-foundation/3.0.0/manifest.yaml", doc: { kind: "framework", stack: "retrofit", enriches_aspect: "network", dependency: "com.squareup.retrofit2:retrofit" } },
  ],
};

/** A project carrying BOTH network coordinates — the mid-migration case ADR-0026 made sharp. */
function bothNetworkLibs() {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-fw-"));
  writeFileSync(join(dir, "deps.txt"), "io.ktor:ktor-client-core:3.0.0\ncom.squareup.retrofit2:retrofit:2.11.0\n");
  return dir;
}

test("both contesting frameworks attach when nothing suppresses them", () => {
  const dir = bothNetworkLibs();
  try {
    assert.deepEqual(resolveStack(dir, HOSTING, {}).additive, ["ktor", "retrofit"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("frameworks.disable suppresses a framework whose dependency IS present", () => {
  const dir = bothNetworkLibs();
  try {
    const r = resolveStack(dir, HOSTING, { disableFrameworks: ["ktor"] });
    assert.deepEqual(r.additive, ["retrofit"], "the disabled framework must not attach");
    assert.deepEqual(r.suppressed, ["ktor"], "what was suppressed is reportable — the user overrode detection");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("disabling every framework leaves the foundation itself untouched", () => {
  const dir = bothNetworkLibs();
  try {
    const r = resolveStack(dir, HOSTING, { disableFrameworks: ["ktor", "retrofit"] });
    assert.equal(r.foundation, "android", "suppression is scoped to frameworks, never the winner");
    assert.deepEqual(r.additive, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("disabling a framework that did not detect is a silent no-op, not a warning", () => {
  const dir = mkdtempSync(join(tmpdir(), "sdlc-fw-"));
  try {
    writeFileSync(join(dir, "deps.txt"), "com.squareup.retrofit2:retrofit:2.11.0\n");
    const r = resolveStack(dir, HOSTING, { disableFrameworks: ["ktor"] });
    assert.deepEqual(r.additive, ["retrofit"]);
    assert.deepEqual(r.suppressed, [], "nothing was suppressed — pre-emptively listing a name is legitimate");
    assert.deepEqual(r.disable_unknown, [], "'ktor' is an installed framework; it simply did not detect");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a disabled name no installed framework declares is reported, not silently ignored", () => {
  const dir = bothNetworkLibs();
  try {
    const r = resolveStack(dir, HOSTING, { disableFrameworks: ["ktorr"] });
    assert.deepEqual(r.additive, ["ktor", "retrofit"]);
    assert.deepEqual(r.disable_unknown, ["ktorr"], "a typo that silently does nothing is the worse half of #197");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("suppression survives --stack, which overrides the foundation and not the frameworks", () => {
  const dir = bothNetworkLibs();
  try {
    const r = resolveStack(dir, HOSTING, { forceStack: "android", disableFrameworks: ["ktor"] });
    assert.deepEqual(r.additive, ["retrofit"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
